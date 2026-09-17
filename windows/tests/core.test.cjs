'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fromRow, merge, restore, track, Tracker, validNumber, normalizedNumber } = require('../src/core.cjs');
const { officialURL, cabinetURL, trustedSender } = require('../src/security.cjs');
const number = '20450000000001';
const row = (extra = {}) => ({ Number: number, Status: 'У дорозі', StatusCode: '5', Description: 'Книжки', ...extra });
const saved = (extra = {}) => ({ parcels: [fromRow(row(), 100)], accountID: 'account-a', lastRefresh: 100, ...extra });
test('TTN normalization rejects non-ASCII numbers', () => {
  assert.equal(normalizedNumber('2045 0000-0000 01'), number);
  assert(validNumber(number)); assert(!validNumber('２０４５０００００００００１')); assert(!validNumber('2045'));
});
test('description variants, blank fallback and partial response', () => {
  assert.equal(fromRow(row({Description:' ',CargoDescription:'  Гра '})).title, 'Гра');
  assert.equal(fromRow(row({Description:' Нова назва ',CargoDescription:'Стара'})).title, 'Нова назва');
  assert.equal(fromRow(row({StatusCode:''})), null);
});
test('first sync, duplicate sync and adding description stay silent', () => {
  const parcel = fromRow(row({Description:''}));
  assert.equal(merge([], [parcel]).changes.length, 0);
  assert.equal(merge([parcel], [parcel]).changes.length, 0);
  const named = merge([parcel], [fromRow(row())]);
  assert.equal(named.changes.length, 0); assert.equal(named.parcels[0].title, 'Книжки');
  assert.equal(merge(named.parcels, [parcel]).parcels[0].title, 'Книжки');
});
test('status code and status text each generate one change', () => {
  const old = fromRow(row());
  assert.equal(merge([old], [fromRow(row({StatusCode:'7'}))]).changes.length, 1);
  assert.equal(merge([old], [fromRow(row({Status:'Інший статус'}))]).changes.length, 1);
  assert.deepEqual(merge([old], []).parcels, [old]);
});
test('restore only retains minimal supported data and valid rows', () => {
  const state = restore({ ...saved(), password:'SECRET', parcels:[{...fromRow(row()),access_token:'SECRET'}, {id:'bad'}] });
  assert.equal(state.parcels.length, 1); assert(!JSON.stringify(state).includes('SECRET'));
  assert.deepEqual(restore(null), {parcels:[],accountID:null,lastRefresh:null});
});
test('account switching clears old data and establishes a silent baseline', async () => {
  const notifications = [];
  const store = new Tracker({ saved:saved(), auth:{sync:async () => ({kind:'success',accountID:'account-b',rows:[row({StatusCode:'7',Number:'20450000000002'})]})}, notify:p => notifications.push(p) });
  await store.refresh(true);
  assert.equal(store.parcels.length,1); assert.equal(store.parcels[0].id,'20450000000002'); assert.equal(notifications.length,0);
});
test('persisted baseline prevents duplicate notifications after restart', async () => {
  let snapshot; let notifications = 0;
  const auth = {sync:async () => ({kind:'success',accountID:'account-a',rows:[row({StatusCode:'7'})]})};
  const store = new Tracker({saved:saved(),auth,persist:s => {snapshot=JSON.parse(JSON.stringify(s));},notify:()=>notifications++});
  await store.refresh(true); assert.equal(notifications,1);
  const restarted = new Tracker({saved:snapshot,auth,notify:()=>notifications++});
  await restarted.refresh(true); assert.equal(notifications,1);
});
test('logout during request cannot resurrect account or parcels', async () => {
  let complete; const auth = {sync:()=>new Promise(resolve=>{complete=resolve;}),clear:async()=>{}};
  const store = new Tracker({saved:saved(),auth});
  const pending = store.refresh(true); await store.signOut(); complete({kind:'success',accountID:'account-a',rows:[row()]}); await pending;
  assert.equal(store.accountID,null); assert.deepEqual(store.parcels,[]); assert.equal(store.busy,false);
});
test('malformed status response and network failure preserve baseline', async () => {
  const store = new Tracker({saved:saved(),auth:{sync:async()=>({kind:'success',accountID:'account-a',rows:[{Number:number}]})}});
  await store.refresh(true); assert.equal(store.parcels[0].code,'5'); assert(store.error); assert.equal(store.lastRefresh,100);
  store.auth.sync=async()=>{throw Error('Offline');}; await store.refresh(true); assert.equal(store.parcels.length,1); assert.equal(store.error,'Offline');
});
test('backoff suppresses background requests but manual refresh bypasses it', async () => {
  let calls=0, now=1000; const store = new Tracker({saved:saved(),now:()=>now,auth:{sync:async()=>{calls++;throw Error('Offline');}}});
  await store.refresh(); now+=300000; await store.refresh(); assert.equal(calls,1);
  await store.refresh(true); assert.equal(calls,2);
});
test('overlapping refreshes issue one request', async () => {
  let complete, calls=0;
  const store=new Tracker({saved:saved(),auth:{sync:()=>{calls++;return new Promise(r=>{complete=r;});}}});
  const first=store.refresh(true); await store.refresh(true); assert.equal(calls,1);
  complete({kind:'success',accountID:'account-a',rows:[row()]}); await first;
});
test('manual add in account uses authenticated bridge and starts silently', async () => {
  let requested; let notifications=0;
  const store=new Tracker({saved:saved(),auth:{sync:async numbers=>{requested=numbers;return {kind:'success',accountID:'account-a',rows:[row({Number:'20450000000002'})]};}},publicTrack:()=>{throw Error('Wrong path');},notify:()=>notifications++});
  assert(await store.add('2045 0000 0000 02','Подарунок'));
  assert(requested.includes('20450000000002')); assert.equal(store.parcels[0].title,'Подарунок'); assert.equal(notifications,0);
  await assert.rejects(()=>store.add('20450000000002'),/вже відстежується/);
});
test('public tracking batches 100, rejects HTTP and schema failures', async () => {
  const numbers=Array.from({length:101},(_,i)=>String(20450000000000+i)); const sizes=[];
  await track(numbers,async(url,options)=>{assert.equal(url,'https://api.novaposhta.ua/v2.0/json/'); sizes.push(JSON.parse(options.body).methodProperties.Documents.length);return {ok:true,json:async()=>({success:true,data:[]})};});
  assert.deepEqual(sizes,[100,1]);
  await assert.rejects(()=>track([number],async()=>({ok:false})),/не відповідає/);
  await assert.rejects(()=>track([number],async()=>({ok:true,json:async()=>({success:true,data:{}})})),/Перевірте ТТН/);
});
test('navigation allowlist rejects lookalike origins and unsafe schemes', () => {
  for(const url of ['https://new.novaposhta.ua/dashboard','https://id.novaposhta.ua/login','https://novapost.com/']) assert(officialURL(url));
  for(const url of ['https://novaposhta.ua.evil.example/','https://evilnovaposhta.ua/','http://new.novaposhta.ua/','file:///etc/passwd','javascript:alert(1)','https://x:y@new.novaposhta.ua/']) assert(!officialURL(url));
  assert(cabinetURL('https://new.novaposhta.ua/dashboard')); assert(!cabinetURL('https://id.novaposhta.ua/'));
});
test('IPC accepts only the local main frame, never auth pages or subframes', () => {
  const url='file:///app/index.html', frame={url}, contents={mainFrame:frame,isDestroyed:()=>false};
  assert(trustedSender({sender:contents,senderFrame:frame},contents,url));
  assert(!trustedSender({sender:contents,senderFrame:{url}},contents,url));
  assert(!trustedSender({sender:contents,senderFrame:frame},contents,'https://new.novaposhta.ua/'));
  assert(!trustedSender({sender:{},senderFrame:frame},contents,url));
});
