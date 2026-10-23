import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,appendFile,readdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {TelemetryHistory,historyRecord} from '../src/history.mjs';
import {createApp} from '../server.mjs';
const source=()=>({system:{gpus:[{uuid:'GPU-test',temp:64,power:'100'}],cpuPower:{available:true,watts:60}},hashrates:{cpu:{total:1000},gpu:{total:2000}},profiles:[{id:'cpu',engine:'xmrig',algorithm:'rx/0'},{id:'gpu',engine:'srbminer',algorithm:'pearlhash'}],jobs:[{id:'cpu',state:'running'},{id:'gpu',state:'running'}]});
async function fixture(t){const dataDir=await mkdtemp(path.join(os.tmpdir(),'lf-history-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));return dataDir;}
test('server measurements survive reload and retain real timestamps, temperatures and nulls',async t=>{
 const dataDir=await fixture(t);let now=Date.UTC(2026,9,20,12);const h=new TelemetryHistory({dataDir,now:()=>now,source:async()=>source()});await h.load();await h.sample();now+=5000;await h.sample();await h.close();
 const next=new TelemetryHistory({dataDir,now:()=>now,source:async()=>source()});await next.load();const q=next.query('1h');assert.equal(q.end-q.start,3600000);assert.equal(q.records.length,2);assert.equal(q.records[1].at,now);assert.equal(q.records[0].temperatures['GPU-test'],64);assert.equal(q.records[0].gpuPower,100);
 const missing=source();missing.system.gpus.push({uuid:'missing',power:'N/A'});missing.system.cpuPower.available=false;assert.equal(historyRecord(missing,now).gpuPower,null);assert.equal(historyRecord(missing,now).cpuPower,null);
});
test('24 hour minute averages do not mix algorithms or invent values across nulls',async t=>{
 const dataDir=await fixture(t),now=Date.UTC(2026,9,20,12),h=new TelemetryHistory({dataDir,source:async()=>source(),now:()=>now});
 h.records=[{at:now-120000,cpuHash:100,cpuKey:'rx/0',gpuHash:1000,gpuKey:'a',cpuPower:50,gpuPower:100},{at:now-115000,cpuHash:200,cpuKey:'rx/0',gpuHash:2000,gpuKey:'b',cpuPower:70,gpuPower:null}];
 const q=h.query('1d');assert.equal(q.end-q.start,86400000);assert.equal(q.stepMs,60000);assert.equal(q.records.length,1);assert.equal(q.records[0].cpuHash,150);assert.equal(q.records[0].gpuHash,null);assert.equal(q.records[0].cpuPower,60);assert.equal(q.records[0].gpuPower,null);assert.throws(()=>h.query('7d'));
});
test('previous UTC day loads, old files expire, interrupted final JSON does not corrupt following samples',async t=>{
 const dataDir=await fixture(t);let now=Date.UTC(2026,9,20,23,59,50);const h=new TelemetryHistory({dataDir,source:async()=>source(),now:()=>now});await h.sample();await appendFile(path.join(dataDir,'history-2026-10-20.jsonl'),'\n{"broken":');now+=5000;await h.sample();await writeFile(path.join(dataDir,'history-2026-10-18.jsonl'),'old');now+=10000;await h.sample();await h.close();
 const next=new TelemetryHistory({dataDir,source:async()=>source(),now:()=>now});await next.load();assert.equal(next.query('1h').records.length,3);assert(!(await readdir(dataDir)).includes('history-2026-10-18.jsonl'));
});
test('concurrent readers share a sample and closed sampler does not write late data',async t=>{
 const dataDir=await fixture(t);let calls=0,release;const h=new TelemetryHistory({dataDir,source:async()=>{calls++;await new Promise(r=>release=r);return source();}});
 const one=h.sample(),two=h.sample();assert.equal(calls,1);const closed=h.close();release();await Promise.all([one,two,closed]);assert.equal(h.records.length,0);assert.deepEqual(await readdir(dataDir),[]);
});
test('background sampling collects without a browser or status request',async t=>{
 const dataDir=await fixture(t);let now=Date.UTC(2026,9,20,12),calls=0;
 const h=new TelemetryHistory({dataDir,intervalMs:10,now:()=>now+=10,source:async()=>{calls++;return source();}});
 h.start();await new Promise(resolve=>setTimeout(resolve,45));await h.close();assert(calls>=2);assert(h.records.length>=2);assert((await readdir(dataDir)).some(name=>name.endsWith('.jsonl')));
});
test('history API is available locally and with read scope; invalid time range is rejected',async t=>{
 const dataDir=await fixture(t),manager={jobs:new Map(),status:()=>[],hashrates:async()=>({})};const app=await createApp({dataDir,manager,autoRestore:false,watchdogTimer:false,historyTimer:false,telemetry:async()=>({gpus:[{uuid:'gpu',temp:60,power:50}]})});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{await app.prepareShutdown();await new Promise(r=>app.server.close(r));});
 const base=`http://127.0.0.1:${app.server.address().port}`,key=await app.agentApi.issue('read',['read']);
 assert.equal((await fetch(base+'/api/v1/history?range=1d')).status,401);
 const response=await fetch(base+'/api/v1/history?range=1d',{headers:{Authorization:`Bearer ${key.token}`}});assert.equal(response.status,200);assert.equal((await response.json()).range,'1d');
 for(const [range,hours] of [['3h',3],['6h',6],['12h',12]]){const result=await(await fetch(base+'/api/history?range='+range)).json();assert.equal(result.range,range);assert.equal(result.end-result.start,hours*3600000);assert.equal(result.stepMs,60000);}const hour=await(await fetch(base+'/api/history?range=1h')).json();assert.equal(hour.records[0].temperatures.gpu,60);assert.equal((await fetch(base+'/api/history?range=7d')).status,400);assert.equal((await fetch(base+'/api/history?range=1h&range=1d')).status,400);
});

test('successful OC forces fresh telemetry before returning, bypassing the five-second status cache',async t=>{
 const dataDir=await fixture(t),uuid='GPU-11111111-1111-1111-1111-111111111111';let limit=140;
 const manager={jobs:new Map(),status:()=>[],hashrates:async()=>({})};
 const app=await createApp({dataDir,manager,autoRestore:false,watchdogTimer:false,historyTimer:false,telemetry:async()=>({gpus:[{uuid,limit,power:limit,temp:65}]}),ocAction:async command=>{limit=command.value;return 'OK';}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{await app.prepareShutdown();await new Promise(r=>app.server.close(r));});
 const base=`http://127.0.0.1:${app.server.address().port}`;
 assert.equal((await(await fetch(base+'/api/status')).json()).gpus[0].limit,140);
 const {token}=await(await fetch(base+'/api/session')).json();
 const response=await fetch(base+'/api/oc',{method:'POST',headers:{'Content-Type':'application/json','X-Local-Token':token},body:JSON.stringify({uuid,action:'power',value:130})});assert.equal(response.status,200);
 assert.equal((await(await fetch(base+'/api/status')).json()).gpus[0].limit,130);
});

test('status separates saved clock target from actual measured clock',async t=>{
 const dataDir=await fixture(t),uuid='GPU-11111111-1111-1111-1111-111111111111',manager={jobs:new Map(),status:()=>[],hashrates:async()=>({})};
 const app=await createApp({dataDir,manager,autoRestore:false,watchdogTimer:false,historyTimer:false,telemetry:async()=>({gpus:[{uuid,core:1440,memoryClock:810}]}),ocAction:async()=> 'Driver accepted'});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{await app.prepareShutdown();await new Promise(r=>app.server.close(r));});const base=`http://127.0.0.1:${app.server.address().port}`,{token}=await(await fetch(base+'/api/session')).json();
 const response=await fetch(base+'/api/oc',{method:'POST',headers:{'Content-Type':'application/json','X-Local-Token':token},body:JSON.stringify({uuid,action:'core',value:1500})});assert.equal(response.status,200);
 const status=await(await fetch(base+'/api/status')).json();assert.equal(status.gpus[0].core,1440);assert.equal(status.ocSettings.find(c=>c.action==='core').value,1500);
});
