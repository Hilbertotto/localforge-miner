import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {createCentral} from '../central/server.mjs';
import {passwordRecord} from '../central/accounts.mjs';
test('farm wallets and sheets persist privately, enforce ownership, and deploy independent worker snapshots',async()=>{
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'lf-library-')),farmId=randomUUID(),otherFarm=randomUUID(),calls=[];let server;
 try{
  await writeFile(path.join(dataDir,'accounts.json'),JSON.stringify({users:[{id:'owner',name:'Owner',email:'owner@example.com',verified:true,...passwordRecord('library-password-123')}],farms:[{id:farmId,ownerId:'owner',name:'Farm'},{id:otherFarm,ownerId:'other',name:'Other farm'}]}));
  const fetcher=async(url,options)=>{calls.push({url,body:options.body&&JSON.parse(options.body)});return new Response(JSON.stringify(url.endsWith('/node')?{id:'worker-node'}:{ok:true,running:false}));};
  ({server}=await createCentral({dataDir,fetcher}));await new Promise(r=>server.listen(0,'127.0.0.1',r));let base=`http://127.0.0.1:${server.address().port}`,auth;
  const request=async(route,body,headers=auth)=>{const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return {code:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};};
  const login=await request('/api/login',{email:'owner@example.com',password:'library-password-123'});auth={cookie:login.cookie,'X-CSRF-Token':login.data.csrf};const route=`/api/farms/${farmId}/library`;
  assert.equal((await request(`/api/farms/${otherFarm}/library`)).code,404);
  assert.equal((await request(route+'/wallets',{name:'XMR wallet',coin:'XMR',address:'wallet-account'})).code,200);
  let library=(await request(route)).data;const walletId=library.wallets[0].id;
  const sheet={name:'Shared CPU',engine:'xmrig',algorithm:'rx/0',pool:'pool.example:443',walletId,walletTemplate:'%WAL%.%WORKER_NAME%',worker:'%WORKER_NAME%',password:'private-pool-secret',threads:1,devices:'',tls:true};
  assert.equal((await request(route+'/profiles',sheet)).code,200);library=(await request(route)).data;const profile=library.profiles[0];assert.equal(profile.password,undefined);assert.equal(profile.passwordCipher,undefined);
  assert.ok(!(await readFile(path.join(dataDir,'farm-library.json'),'utf8')).includes(sheet.password));
  assert.equal((await request(route+'/delete',{kind:'wallets',id:walletId})).code,400);
  assert.equal((await request(route+'/profiles',{...sheet,walletId:'another-farm-wallet'})).code,400);
  const rig=(await request('/api/rigs',{farmId,name:'Rig One',address:'http://192.168.0.18:8080',token:'lf_'+'a'.repeat(64)})).data.rig;
  const before=calls.length;assert.equal((await request(route+'/apply',{profileId:profile.id,rigId:rig.id,start:false})).code,200);assert.equal(calls.length,before+1);
  const sent=calls.at(-1).body;assert.equal(sent.walletId,'');assert.equal(sent.wallet,'wallet-account.Rig_One');assert.equal(sent.worker,'Rig_One');assert.equal(sent.password,sheet.password);
  await request(route+'/wallets',{...library.wallets[0],address:'new-account'});
  await request(route+'/profiles',{...profile,name:'Shared CPU revised'});
  assert.equal((await request(route+'/apply',{profileId:profile.id,rigId:rig.id,start:true})).code,200);assert.ok(calls.at(-1).url.endsWith('/start'));assert.equal(calls.at(-2).body.wallet,'new-account.Rig_One');assert.equal(calls.at(-2).body.password,sheet.password);
  assert.equal((await request(`/api/farms/${otherFarm}/library/apply`,{profileId:profile.id,rigId:rig.id,start:false})).code,404);
  library=(await request(route)).data;assert.equal(library.assignments[0].profileRevision,2);assert.equal(library.assignments[0].walletRevision,2);
  await new Promise(r=>server.close(r));({server}=await createCentral({dataDir,fetcher}));await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
  const again=await request('/api/login',{email:'owner@example.com',password:'library-password-123'});auth={cookie:again.cookie,'X-CSRF-Token':again.data.csrf};assert.equal((await request(route)).data.profiles[0].name,'Shared CPU revised');
 }finally{if(server?.listening)await new Promise(r=>server.close(r));await rm(dataDir,{recursive:true,force:true});}
});
