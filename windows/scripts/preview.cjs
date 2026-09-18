'use strict';
// Local visual QA only. This server is never included in the installed app.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', 'src', 'ui');
const mock = `window.nova=(()=>{
  let listener=()=>{}, state={parcels:[],connected:false,busy:false,awaitingLogin:false,lastRefresh:null,error:null,pinned:false,notifications:false,notificationSupported:true,loginAtLaunch:false,canAutoStart:true,demo:false,version:'0.3.0'};
  const demo=()=>{state.connected=true;state.lastRefresh=Date.now();state.parcels=[{id:'20450000000001',title:'Книжки на вихідні',status:'Прибув у відділення',code:'7',destination:'Київ · Відділення № 24',expected:'',updatedAt:Date.now(),direction:'incoming'},{id:'20450000000002',title:'Нова клавіатура',status:'Прямує до міста отримувача',code:'5',destination:'Київ · Поштомат № 1024',expected:'18.09.2026',updatedAt:Date.now(),direction:'incoming'},{id:'20450000000003',title:'Подарунок для друга',status:'Прибув у відділення',code:'7',destination:'Львів · Відділення № 12',updatedAt:Date.now(),direction:'outgoing'},{id:'20450000000004',title:'Настільна гра',status:'Відправлення отримано',code:'9',destination:'Одеса · Відділення № 8',updatedAt:Date.now(),direction:'outgoing'}];listener(state);};
  if(location.search.includes('parcels'))demo();
  return {state:async()=>state,subscribe:fn=>{listener=fn;},ready:()=>{},refresh:async()=>{},signIn:async()=>demo(),signOut:async()=>{state.parcels=[];state.connected=false;state.lastRefresh=null;listener(state);},preferences:async value=>{Object.assign(state,value);listener(state);return state;},add:async input=>({ok:false,error:/^[0-9]{14}$/.test(input.number)?'Демо: запити до Нової пошти вимкнено.':'ТТН має містити 14 цифр.'}),testNotification:async()=>'Демо: сповіщення передано Windows.',copy:async()=>{},hide:async()=>{},minimize:async()=>{},quit:async()=>{}};
})();`;
http.createServer((request,response)=>{
  const pathname=new URL(request.url,'http://localhost').pathname;
  if(pathname==='/preview-api.js'){response.writeHead(200,{'Content-Type':'application/javascript'});response.end(mock);return;}
  const allowed={'/':'index.html','/styles.css':'styles.css','/ui.js':'ui.js'};
  const name=allowed[pathname]; if(!name){response.writeHead(404);response.end();return;}
  let body=fs.readFileSync(path.join(root,name));
  if(name==='index.html')body=body.toString().replace('<script src="ui.js">','<script src="preview-api.js"></script><script src="ui.js">');
  response.writeHead(200,{'Content-Type':name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css':'application/javascript'});response.end(body);
}).listen(4178,'127.0.0.1',()=>console.log('Visual preview: http://127.0.0.1:4178 (fictional data only)'));
