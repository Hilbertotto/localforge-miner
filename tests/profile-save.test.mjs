import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createApp} from '../server.mjs';
import {Manager} from '../src/miners.mjs';
const cpu={id:'cpu',name:'CPU',engine:'xmrig',algorithm:'rx/0',pool:'pool.example:443',wallet:'wallet-test',password:'private-pool-password',worker:'test',tls:true,threads:1,devices:''};
const gpu={...cpu,id:'gpu',name:'GPU',engine:'srbminer',algorithm:'pearlhash',devices:'0,1'};
async function fixture(t){
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'lf-profile-save-'));let temperature=60,heatOnStop=false;const spawned=[];
 const manager=new Manager((file,args)=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.pid=100+spawned.length;spawned.push({file,args,child});child.kill=signal=>{if(heatOnStop)temperature=100;queueMicrotask(()=>child.emit('exit',null,signal));return true;};queueMicrotask(()=>args.includes('broken.example:443')?child.emit('error',Error('fake start failure')):child.emit('spawn'));return child;});
 const app=await createApp({dataDir,manager,autoRestore:false,historyTimer:false,watchdogTimer:false,telemetry:async()=>({gpus:[]}),readTemperature:async()=>({available:true,celsius:temperature})});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await app.prepareShutdown();await manager.stopAll();await new Promise(r=>app.server.close(r));await rm(dataDir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${app.server.address().port}`,{token}=await(await fetch(base+'/api/session')).json();
 const post=(route,data)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Local-Token':token},body:JSON.stringify(data)});
 for(const p of [cpu,gpu]){assert.equal((await post('/api/profiles',p)).status,200);assert.equal((await post('/api/start',{id:p.id})).status,200);}
 return {app,manager,post,spawned,dataDir,profiles:async()=>JSON.parse(await readFile(path.join(dataDir,'profiles.json'),'utf8')),intent:async()=>JSON.parse(await readFile(path.join(dataDir,'running-profiles.json'),'utf8')),heatOnStop:()=>heatOnStop=true};
}
test('running CPU update replaces same profile, applies new pool and preserves GPU process and autostart',async t=>{
 const f=await fixture(t),oldCpu=f.manager.jobs.get('cpu').child,oldGpu=f.manager.jobs.get('gpu').child;
 const response=await f.post('/api/profiles',{...cpu,pool:'new.example:443'});assert.equal(response.status,200);assert.equal((await response.json()).applied,true);
 assert.notEqual(f.manager.jobs.get('cpu').child,oldCpu);assert.equal(f.manager.jobs.get('gpu').child,oldGpu);assert.equal(f.manager.jobs.get('cpu').profile.pool,'new.example:443');assert.equal((await f.profiles()).length,2);assert((await f.intent()).ids.includes('cpu'));
});
test('save as creates independent UUID, retains password, never starts or adds autostart; original stays unchanged',async t=>{
 const f=await fixture(t),original=f.manager.jobs.get('cpu').child,before=f.spawned.length;const {password,...input}=cpu;
 const response=await f.post('/api/profiles',{...input,name:'CPU copy',sourceId:'cpu',saveMode:'copy',pool:'copy.example:443'});assert.equal(response.status,200);const saved=await response.json();assert.notEqual(saved.id,'cpu');assert.equal(saved.running,false);assert.equal(f.spawned.length,before);assert.equal(f.manager.jobs.get('cpu').child,original);
 const profiles=await f.profiles();assert.equal(profiles.find(p=>p.id==='cpu').pool,cpu.pool);assert.equal(profiles.find(p=>p.id===saved.id).password,password);assert(!(await f.intent()).ids.includes(saved.id));
});
test('invalid parameters and duplicate name are rejected before stopping either miner',async t=>{
 const f=await fixture(t),child=f.manager.jobs.get('cpu').child;
 assert.equal((await f.post('/api/profiles',{...cpu,pool:'bad pool'})).status,400);
 assert.equal((await f.post('/api/profiles',{...cpu,name:' CPU ',saveMode:'copy'})).status,409);assert.equal(f.manager.jobs.get('cpu').child,child);assert.equal((await f.profiles()).length,2);
});
test('device conflict is checked while original CPU process is still running',async t=>{
 const f=await fixture(t),child=f.manager.jobs.get('cpu').child;assert.equal((await f.post('/api/profiles',{...gpu,id:'cpu',name:'CPU',devices:'0'})).status,400);assert.equal(f.manager.jobs.get('cpu').child,child);assert.equal(f.manager.jobs.get('cpu').profile.engine,'xmrig');
});
test('failed replacement spawn restores original stored configuration and running miner',async t=>{
 const f=await fixture(t),gpuChild=f.manager.jobs.get('gpu').child;
 const response=await f.post('/api/profiles',{...cpu,pool:'broken.example:443'});assert.equal(response.status,400);assert.match((await response.json()).error,/korábbi profil visszaállt és fut/);assert(f.manager.active('cpu'));assert.equal(f.manager.jobs.get('cpu').profile.pool,cpu.pool);assert.equal((await f.profiles()).find(p=>p.id==='cpu').pool,cpu.pool);assert.equal(f.manager.jobs.get('gpu').child,gpuChild);
});
test('thermal guard is rechecked after stop and cannot be bypassed by apply or rollback',async t=>{
 const f=await fixture(t);await f.app.watchdog.configure({enabled:true,threshold:85,action:'stop_cpu',resumeBelow:70,tripSeconds:5,coolSeconds:60});f.heatOnStop();
 const response=await f.post('/api/profiles',{...cpu,pool:'new.example:443'});assert.equal(response.status,400);assert(!f.manager.active('cpu'));assert(f.manager.active('gpu'));assert.equal((await f.profiles()).find(p=>p.id==='cpu').pool,cpu.pool);
});
test('editing stopped profile saves without starting it or restoring autostart',async t=>{
 const f=await fixture(t);await f.post('/api/stop',{id:'cpu'});const count=f.spawned.length;const response=await f.post('/api/profiles',{...cpu,pool:'new.example:443'});assert.equal(response.status,200);assert.equal((await response.json()).applied,false);assert.equal(f.spawned.length,count);assert(!f.manager.active('cpu'));assert(!(await f.intent()).ids.includes('cpu'));
});
