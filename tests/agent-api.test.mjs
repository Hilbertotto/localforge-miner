import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';
import {AgentApi,readRoutes,writeRoutes} from '../src/agent-api.mjs';

async function fixture(t){
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'lf-api-')),powerCalls=[],jobs=[];
 const manager={jobs:new Map(),status:()=>jobs,hashrates:async()=>({}),active:id=>jobs.some(j=>j.id===id&&j.state==='running'),start:async p=>{const old=jobs.find(j=>j.id===p.id);if(old)old.state='running';else jobs.push({id:p.id,state:'running',logs:[]});},stop:async id=>{const j=jobs.find(j=>j.id===id);if(j)j.state='stopped';}};
 const app=await createApp({dataDir,manager,autoRestore:false,watchdogTimer:false,telemetry:async()=>({gpus:[],hostname:'test-node'}),readTemperature:async()=>({available:true,celsius:60}),powerAction:async action=>powerCalls.push(action)});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await app.prepareShutdown();await new Promise(r=>app.server.close(r));await rm(dataDir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${app.server.address().port}`;
 const request=(route,token,data,extra={})=>fetch(base+'/api/v1/'+route,{method:data===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`}:{}) ,'Content-Type':'application/json',...extra},...(data===undefined?{}:{body:JSON.stringify(data)})});
 return {app,dataDir,base,request,powerCalls};
}
const profile={id:'cpu',name:'CPU',engine:'xmrig',algorithm:'rx/0',pool:'pool.example:443',wallet:'test-wallet',password:'pool-secret',worker:'test',tls:true,threads:1,devices:''};
test('v1 requires Bearer even with valid local session; no session/token disclosure',async t=>{
 const f=await fixture(t),session=await(await fetch(f.base+'/api/session')).json();
 assert.equal((await f.request('status')).status,401);
 assert.equal((await f.request('start',null,{id:'cpu'},{'X-Local-Token':session.token})).status,401);
 const key=await f.app.agentApi.issue('reader',['read']);
 assert.equal((await f.request('session',key.token)).status,404);
 const r=await f.request('status',key.token);assert.equal(r.status,200);const d=await r.json();assert.equal(d.apiVersion,'1');assert.equal(d.hostname,'test-node');assert(d.nodeId);
 assert.equal(r.headers.get('access-control-allow-origin'),null);
});
test('read/control/power scopes enforce separation before hardware actions',async t=>{
 const f=await fixture(t),read=await f.app.agentApi.issue('reader',['read']),control=await f.app.agentApi.issue('controller',['control']),power=await f.app.agentApi.issue('power',['power']);
 assert.equal((await f.request('profiles',read.token,profile)).status,403);
 assert.equal((await f.request('system-power',control.token,{action:'reboot'})).status,403);
 assert.equal((await f.request('profiles',power.token,profile)).status,403);
 assert.equal((await f.request('watchdog',control.token,{enabled:true,threshold:85,action:'reboot',resumeBelow:70,tripSeconds:5,coolSeconds:60})).status,403);
 assert.deepEqual(f.powerCalls,[]);
 assert.equal((await f.request('system-power',power.token,{action:'reboot-delay'})).status,200);assert.deepEqual(f.powerCalls,['reboot-delay']);
});
test('API profiles share start/stop/autostart and retain omitted password without disclosing it',async t=>{
 const f=await fixture(t),key=await f.app.agentApi.issue('controller',['control']);
 assert.equal((await f.request('profiles',key.token,profile)).status,200);
 const list=await(await f.request('profiles',key.token)).json();assert.equal(list.profiles[0].password,undefined);assert.equal(list.profiles[0].passwordConfigured,true);
 assert.equal((await f.request('profiles',key.token,{...list.profiles[0],name:'Updated'})).status,200);
 const stored=JSON.parse(await readFile(path.join(f.dataDir,'profiles.json'),'utf8'));assert.equal(stored[0].password,'pool-secret');
 assert.equal((await f.request('start',key.token,{id:'cpu'})).status,200);assert(f.app.manager.active('cpu'));
 assert.deepEqual(JSON.parse(await readFile(path.join(f.dataDir,'running-profiles.json'),'utf8')).ids,['cpu']);
 assert.equal((await f.request('profiles',key.token,profile)).status,200);
 assert.equal((await f.request('stop',key.token,{id:'cpu'})).status,200);assert(!f.app.manager.active('cpu'));
 const state=await(await f.request('status',key.token)).json();assert.equal(state.profiles[0].password,undefined);
 await f.app.agentApi.auditQueue;const log=await readFile(path.join(f.dataDir,'api-audit.jsonl'),'utf8');assert(!log.includes(key.token));assert(!log.includes('pool-secret'));assert(!log.includes('test-wallet'));assert(log.includes('"endpoint":"start"'));
});
test('keys and node identity survive restart; only key hash stored; revoke is immediate',async t=>{
 const f=await fixture(t),key=await f.app.agentApi.issue('reader',['read']);const disk=await readFile(path.join(f.dataDir,'api-keys.json'),'utf8');assert(!disk.includes(key.token));
 const next=new AgentApi(f.dataDir);await next.init();assert.equal(next.identity.id,f.app.agentApi.identity.id);assert((await next.authenticate(`Bearer ${key.token}`)).id===key.key.id);
 await next.revoke(key.key.id);assert.equal((await f.request('status',key.token)).status,401);
});
test('v1 cannot bypass persistent thermal latch',async t=>{
 const f=await fixture(t),key=await f.app.agentApi.issue('controller',['control']);await f.request('profiles',key.token,profile);
 await f.app.watchdog.configure({enabled:true,threshold:85,action:'stop_cpu',resumeBelow:70,tripSeconds:5,coolSeconds:60});f.app.watchdog.latched=true;
 assert.equal((await f.request('start',key.token,{id:'cpu'})).status,400);assert(!f.app.manager.active('cpu'));
});
test('invalid key store fails closed and unknown/unsupported endpoints do not run commands',async t=>{
 const f=await fixture(t),key=await f.app.agentApi.issue('controller',['control']);
 assert.equal((await f.request('shell',key.token,{command:'anything'})).status,404);
 const response=await fetch(f.base+'/api/v1/status',{method:'DELETE',headers:{Authorization:`Bearer ${key.token}`}});assert.equal(response.status,405);
 await writeFile(path.join(f.dataDir,'api-keys.json'),'{}');assert.notEqual((await f.request('status',key.token)).status,200);assert.deepEqual(f.powerCalls,[]);
});
test('OpenAPI covers the actual versioned routes and bearer protection',async()=>{
 const spec=JSON.parse(await readFile(new URL('../openapi.json',import.meta.url),'utf8'));
 assert.deepEqual(spec.security,[{bearerAuth:[]}]);
 for(const [method,routes]of [['get',readRoutes],['post',writeRoutes]]){
  const documented=Object.entries(spec.paths).filter(([,v])=>v[method]).map(([key])=>key.replace('/api/v1/',''));
  assert.deepEqual(documented.sort(),[...routes].sort());
 }
});
