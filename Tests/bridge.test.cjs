const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname + '/../Resources/Bridge.js', 'utf8');
let checks = 0;
function context({ origin = 'https://new.novaposhta.ua', subject = 'account-a', expiry = Date.now()+600000, errorStatus, fail = false, missingToken = false, incoming = [{Number:'20450000000001'}], outgoing = [], trackingFields = {} } = {}) {
  const calls = [];
  const secret = 'secret-token-that-must-never-leave';
  const values = { access_token: missingToken ? null : secret, expires_at: String(expiry), id_token_claims_obj: JSON.stringify({sub:subject}) };
  const sandbox = { window: {}, location: { origin }, localStorage: {getItem: k => values[k]}, Date, Map, Set, JSON, String, Number, Array, Error, AbortController, setTimeout, clearTimeout, atob,
    fetch: async (url, options) => {
      const body = JSON.parse(options.body); calls.push(body);
      assert.equal(url, 'https://api.novaposhta.ua/v2.0/json/');
      assert.equal(options.headers.TokenOAuth2, secret);
      const list = body.calledMethod === 'getIncomingDocumentsByPhone' ? incoming : outgoing;
      return {ok: !errorStatus, status: errorStatus || 200, json: async () => ({ success: !fail, errors: fail ? ['Failure'] : [],
        data: body.calledMethod === 'getStatusDocuments' ? body.methodProperties.Documents.map(d => ({Number:d.DocumentNumber, Status:'У дорозі', StatusCode:5, PhoneRecipient:'PRIVATE_PHONE', RecipientFullName:'PRIVATE_NAME', ...trackingFields})) : [{result:list}], info:{totalCount:list.length} })};
    }
  };
  vm.createContext(sandbox); vm.runInContext(source, sandbox);
  return { sync: sandbox.window.novaParcelSync, calls, secret };
}
(async () => {
  let c=context(); let r=await c.sync([], 'account-a');
  assert.equal(r.kind,'success'); assert.equal(r.rows.length,1); checks++;
  assert.equal(r.rows[0].StatusCode,'5'); checks++;
  assert(!JSON.stringify(r).includes(c.secret) && !JSON.stringify(r).includes('PRIVATE_')); checks++;
  assert(c.calls.every(x => ['getIncomingDocumentsByPhone','getOutgoingDocumentsByPhone','getStatusDocuments'].includes(x.calledMethod))); checks++;
  c=context(); r=await c.sync(['20450000000002'], 'account-a'); assert.equal(r.rows.length,2); checks++;
  c=context({subject:'account-b'}); r=await c.sync(['20450000000002'], 'account-a'); assert.equal(r.rows.length,1); checks++;
  c=context({origin:'https://evil.example'}); r=await c.sync([], 'account-a'); assert.equal(r.kind,'login'); assert.equal(c.calls.length,0); checks++;
  c=context({missingToken:true}); r=await c.sync([], 'account-a'); assert.equal(r.kind,'login'); assert.equal(c.calls.length,0); checks++;
  c=context({expiry:Date.now()-1}); r=await c.sync([], 'account-a'); assert.equal(r.kind,'expired'); assert.equal(c.calls.length,0); checks++;
  c=context({errorStatus:401}); r=await c.sync([], 'account-a'); assert.equal(r.kind,'expired'); checks++;
  c=context({fail:true}); r=await c.sync([], 'account-a'); assert.equal(r.kind,'error'); checks++;
  c=context({incoming:[{Number:'20450000000001', CargoDescription:'  Книги  '}, {Number:'20450000000002', Description:'Навушники'}], outgoing:[{Number:'20450000000003', Description:'Подарунок'}]});
  r=await c.sync([], 'account-a');
  assert.equal(r.rows.find(row=>row.Number==='20450000000001').Description,'Книги');
  assert.equal(r.rows.find(row=>row.Number==='20450000000002').Description,'Навушники');
  assert.equal(r.rows.find(row=>row.Number==='20450000000003').Description,'Подарунок'); checks++;
  c=context({trackingFields:{Description:'Клавіатура'}}); r=await c.sync([], 'account-a'); assert.equal(r.rows[0].Description,'Клавіатура'); checks++;
  c=context({incoming:[{Number:'20450000000001', Description:'  ', CargoDescription:'Книги'}], trackingFields:{CargoDescriptionString:'Товари'}});
  r=await c.sync([], 'account-a'); assert.equal(r.rows[0].Description,'Книги'); checks++;
  c=context({incoming:[{Number:'20450000000001', Description:'  '}], trackingFields:{DescriptionOfCargo:'Посуд'}});
  r=await c.sync([], 'account-a'); assert.equal(r.rows[0].Description,'Посуд'); checks++;
  c=context({incoming:[],outgoing:[]});
  r=await c.sync([{number:'20450000000003',direction:'outgoing'}], 'account-a');
  assert.equal(r.rows[0].direction,'outgoing'); checks++;
  c=context({incoming:[{Number:'20450000000003'}]});
  r=await c.sync([{number:'20450000000003',direction:'outgoing'}], 'account-a');
  assert.equal(r.rows[0].direction,'incoming'); checks++;
  c=context({incoming:[],subject:'account-b'});
  r=await c.sync([{number:'20450000000003',direction:'outgoing'}], 'account-a');
  assert.equal(r.rows.length,0); checks++;
  c=context({incoming:[],outgoing:[{Number:'20450000000003'}]});
  r=await c.sync([], 'account-a'); assert.equal(r.rows[0].direction,'outgoing'); checks++;
  c=context({incoming:[]}); r=await c.sync(['20450000000003'], 'account-a');
  assert.equal(r.rows[0].direction,''); checks++;
  console.log(`Bridge: ${checks} checks passed`);
})().catch(e=>{console.error(e); process.exitCode=1});
