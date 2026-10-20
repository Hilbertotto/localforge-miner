import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';
test('wallet cimtar API: tartos mentes, JSON import, profilkapcsolat es hasznalt wallet torlesvedelem',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'lf-wallet-api-'));let app;
 const start=async()=>{app=await createApp({dataDir:dir,telemetry:async()=>({gpus:[]}),watchdogTimer:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`,{token}=await(await fetch(base+'/api/session')).json();return {get:async()=>await(await fetch(base+'/api/status')).json(),post:(url,data)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json','X-Local-Token':token},body:JSON.stringify(data)})};};
 try{let api=await start();const w={id:'pearl',name:'Pearl',coin:'PRL',address:'old-address',externalId:'11067194'};assert.equal((await api.post('/api/wallets',w)).status,200);assert.equal((await api.post('/api/wallets',{...w,id:'duplicate'})).status,400);
 const sheet={name:'Pearl',items:[{coin:'PEARL',wal_id:11067194,pool_ssl:false,miner:'srbminer',miner_config:{algo:'pearlhash',url:'prl-eu.kryptex.network:7048',template:'%WAL%',worker:'%WORKER_NAME%',pass:'x'}}]};const imported=await(await api.post('/api/import-profile',{sheet,worker:'rig-01',devices:'0,1'})).json();assert.equal(imported.profile.walletId,'pearl');assert.equal((await api.post('/api/profiles',imported.profile)).status,200);assert.equal((await api.post('/api/wallets/delete',{id:'pearl'})).status,400);assert.equal((await api.post('/api/wallets',{...w,address:'new-address'})).status,200);
 await new Promise(r=>app.server.close(r));app=null;api=await start();const state=await api.get();assert.equal(state.wallets[0].address,'new-address');assert.equal(state.profiles[0].walletId,'pearl');assert.equal((await api.post('/api/delete',{id:imported.profile.id})).status,200);assert.equal((await api.post('/api/wallets/delete',{id:'pearl'})).status,200);
 }finally{if(app)await new Promise(r=>app.server.close(r));await rm(dir,{recursive:true,force:true});}
});
