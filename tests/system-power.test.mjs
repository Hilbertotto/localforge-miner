import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';
test('gépművelet hitelesítést kér, csak rögzített művelet engedett és nincs dupla reboot',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'lf-power-')),calls=[];
 const app=await createApp({dataDir:dir,autoRestore:false,watchdogTimer:false,powerAction:async a=>calls.push(a)});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 try{const base=`http://127.0.0.1:${app.server.address().port}`,{token}=await(await fetch(base+'/api/session')).json();
 const post=(action,auth=token)=>fetch(base+'/api/system-power',{method:'POST',headers:{'Content-Type':'application/json','X-Local-Token':auth},body:JSON.stringify({action})});
 assert.equal((await post('reboot','wrong')).status,403);assert.equal((await post('shell')).status,400);assert.deepEqual(calls,[]);
 const response=await post('reboot-delay');assert.equal(response.status,200);const result=await response.json();assert.equal(result.powerRequest.executeAt-result.powerRequest.requestedAt,30000);
 assert.deepEqual(calls,['reboot-delay']);assert.equal((await post('reboot')).status,409);
 }finally{await app.prepareShutdown();await new Promise(r=>app.server.close(r));await rm(dir,{recursive:true,force:true});}
});
test('hibás rendszerparancs után újra megpróbálható a művelet',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'lf-power-'));let calls=0;
 const app=await createApp({dataDir:dir,autoRestore:false,watchdogTimer:false,powerAction:async()=>{if(++calls===1)throw Error('systemd unavailable');}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 try{const base=`http://127.0.0.1:${app.server.address().port}`,{token}=await(await fetch(base+'/api/session')).json();const post=()=>fetch(base+'/api/system-power',{method:'POST',headers:{'Content-Type':'application/json','X-Local-Token':token},body:JSON.stringify({action:'poweroff'})});assert.equal((await post()).status,400);assert.equal((await post()).status,200);assert.equal(calls,2);
 }finally{await app.prepareShutdown();await new Promise(r=>app.server.close(r));await rm(dir,{recursive:true,force:true});}
});
