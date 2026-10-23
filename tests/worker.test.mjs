import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createCentral} from '../central/server.mjs';
import {passwordRecord} from '../central/accounts.mjs';
import {connectorTick,validateConfig} from '../worker/connector.mjs';
test('name-only registration and outbound connector authenticate, bind identity and relay control',async()=>{
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'lf-worker-'));let server;
 try{
  await writeFile(path.join(dataDir,'accounts.json'),JSON.stringify({users:[{id:'owner',name:'Owner',email:'owner@example.com',verified:true,...passwordRecord('owner-password-123')}],farms:[{id:'farm',ownerId:'owner',name:'Farm'},{id:'legacy-farm',ownerId:'admin',name:'Legacy admin farm'}]}));
  await writeFile(path.join(dataDir,'rigs.json'),JSON.stringify([{id:'legacy-admin-rig',farmId:'legacy-farm',name:'Archived legacy connection',nodeId:'node-1'}]));
  ({server}=await createCentral({dataDir}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  const api=async(route,body,headers={})=>{const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return {code:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  const login=await api('/api/login',{email:'owner@example.com',password:'owner-password-123'}),auth={cookie:login.cookie,'X-CSRF-Token':login.data.csrf};
  const added=await api('/api/rigs',{farmId:'farm',name:'Rig One'},auth);assert.equal(added.code,201);const {code,rig}=added.data;assert.match(code,/^lfw_[a-f0-9]{64}$/);assert.equal(rig.workerHash,undefined);assert.ok(!(await readFile(path.join(dataDir,'rigs.json'),'utf8')).includes(code));assert.equal((await api('/api/rigs',undefined,auth)).data.rigs[0].workerHash,undefined);
  assert.equal((await api('/api/worker/poll',{name:'Rig One',nodeId:'node-1'})).code,401);
  const config=validateConfig({server:base,name:'Rig One',code,agentToken:'lf_'+'c'.repeat(64)}),state={completed:new Map()},executed=[];
  const fetcher=async(url,options)=>{if(url.startsWith(base))return fetch(url,options);assert.equal(options.headers.Authorization,'Bearer '+config.agentToken);executed.push({url,options});return new Response(JSON.stringify(url.endsWith('/node')?{id:'node-1'}:url.endsWith('/status')?{hostname:'Test rig',profiles:[],jobs:[],hashrates:{}}:{ok:true}));};
  await connectorTick(config,state,fetcher);assert.equal((await api(`/api/rigs/${rig.id}/status`,undefined,auth)).data.hostname,'Test rig');
  assert.equal((await api('/api/worker/poll',{name:'Rig One',nodeId:'different-node'},{Authorization:'Bearer '+code})).code,400);
  assert.equal((await api('/api/worker/poll',{name:'Wrong name',nodeId:'node-1'},{Authorization:'Bearer '+code})).code,400);
  const operation=api(`/api/rigs/${rig.id}/start`,{id:'cpu-profile'},auth);
  // Poll until the pending browser request reaches the connector, without invoking a real miner.
  for(let i=0;i<10&&!executed.some(c=>c.url.endsWith('/start'));i++){await new Promise(r=>setTimeout(r,20));await connectorTick(config,state,fetcher);}
  assert.ok(executed.some(c=>c.url.endsWith('/start')&&c.options.body==='{"id":"cpu-profile"}'));
  await connectorTick(config,state,fetcher);assert.equal((await operation).code,200);
  await api(`/api/rigs/${rig.id}/remove`,{},auth);assert.equal((await api('/api/worker/poll',{name:'Rig One',nodeId:'node-1'},{Authorization:'Bearer '+code})).code,401);
 }finally{if(server?.listening)await new Promise(r=>server.close(r));await rm(dataDir,{recursive:true,force:true});}
});
test('connector refuses arbitrary commands received from the server',async()=>{
 const state={nodeId:'node',statusAt:Date.now(),completed:new Map()},calls=[];
 await connectorTick({server:'https://central.example',name:'Worker',code:'secret',agentToken:'local'},state,async(url)=>{calls.push(url);return new Response(JSON.stringify({commands:[{id:'bad',method:'POST',route:'https://evil.example/command'}]}));});
 assert.equal(calls.length,1);assert.deepEqual(state.results,[{id:'bad',ok:false}]);
});
