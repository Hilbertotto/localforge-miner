import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createCentral} from '../central/server.mjs';
test('local test letter persists, sends no SMTP and verifies the account',async()=>{
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'lf-local-mail-'));let server;
 try{({server}=await createCentral({dataDir,localMail:true,sendMail:async()=>{throw Error('Must not send SMTP');}}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const post=async(route,body)=>{const response=await fetch(base+route,{method:'POST',body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 const user={name:'Local Test',email:'local@example.com',password:'local-test-password'},registered=await post('/api/register',user);assert.equal(registered.status,200);assert.equal(registered.body.localMail.email,user.email);
 const letters=JSON.parse(await readFile(path.join(dataDir,'local-mail.json'),'utf8'));assert.equal(letters.length,1);assert.equal(letters[0].url,registered.body.localMail.url);assert.ok(!JSON.stringify(letters).includes(user.password));
 assert.equal((await post('/api/login',user)).status,401);const token=new URL(letters[0].url,base).searchParams.get('verify');assert.equal((await post('/api/verify',{token})).status,200);assert.equal((await post('/api/login',user)).status,200);
 }finally{if(server?.listening)await new Promise(r=>server.close(r));await rm(dataDir,{recursive:true,force:true});}
});
test('email verification is single use; farms and workers are isolated between users and admin',async()=>{
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'lf-accounts-')),mail=[];let server;
 try{
  ({server}=await createCentral({dataDir,password:'admin-test-password',sendMail:async m=>mail.push(m),fetcher:async()=>new Response(JSON.stringify({id:'worker-node'}))}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  const request=async(route,body,auth={})=>{const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...auth},body:body===undefined?undefined:JSON.stringify(body)});return {code:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};};
  const user={name:'User One',email:'ONE@example.com',password:'account-password-123'};
  assert.equal((await request('/api/register',user)).code,200);assert.equal(mail[0].email,'one@example.com');
  assert.equal((await request('/api/login',user)).code,401);
  assert.equal((await request('/api/verify',{token:mail[0].token})).code,200);
  assert.equal((await request('/api/verify',{token:mail[0].token})).code,400);
  const login=await request('/api/login',user),auth={cookie:login.cookie,'X-CSRF-Token':login.data.csrf};assert.equal(login.code,200);
  assert.equal((await request('/api/admin/users',undefined,auth)).code,403);
  const admin=await request('/api/login',{password:'admin-test-password'}),adminAuth={cookie:admin.cookie,'X-CSRF-Token':admin.data.csrf};
  const listing=await request('/api/admin/users',undefined,adminAuth);assert.equal(listing.code,200);assert.equal(listing.data.users[0].email,'one@example.com');assert.equal(listing.data.users[0].verified,true);
  for(const secret of ['hash','salt','verificationHash','password'])assert.equal(listing.data.users[0][secret],undefined);
  assert.equal((await request('/api/farms',undefined,adminAuth)).code,403);
  assert.equal((await request('/api/rigs',undefined,adminAuth)).code,403);
  assert.equal((await request('/api/farms',{name:'Forbidden admin farm'},adminAuth)).code,403);
  assert.deepEqual((await request('/api/farms',undefined,auth)).data.farms,[]);
  const farm=(await request('/api/farms',{name:'First farm'},auth)).data.farm;
  const rig=(await request('/api/rigs',{name:'Worker',farmId:farm.id,address:'http://192.168.0.18:8080',token:'lf_'+'b'.repeat(64)},auth)).data.rig;assert.ok(rig.id);
  const second={name:'Other',email:'two@example.com',password:'other-password-123'};await request('/api/register',second);await request('/api/verify',{token:mail.at(-1).token});const l2=await request('/api/login',second),a2={cookie:l2.cookie,'X-CSRF-Token':l2.data.csrf};
  assert.deepEqual((await request('/api/rigs',undefined,a2)).data.rigs,[]);
  assert.equal((await request(`/api/rigs/${rig.id}/status`,undefined,a2)).code,404);
  assert.equal((await request(`/api/rigs/${rig.id}/start`,{id:'profile'},a2)).code,404);
  assert.equal((await request('/api/rigs',{name:'Intruder',farmId:farm.id,address:'http://192.168.0.19',token:'lf_'+'b'.repeat(64)},a2)).code,404);
  const file=await readFile(path.join(dataDir,'accounts.json'),'utf8');assert.ok(!file.includes(user.password));assert.ok(!file.includes(mail[1].token));
  const userId=login.data.user.id;
  assert.equal((await request('/api/admin/users',{id:userId,action:'suspend'},a2)).code,403);
  assert.equal((await request('/api/admin/users',{id:userId,action:'suspend'},{cookie:admin.cookie})).code,403);
  assert.equal((await request('/api/admin/users',{id:userId,action:'suspend'},adminAuth)).code,200);
  assert.equal((await request('/api/session',undefined,auth)).code,401);
  assert.equal((await request('/api/login',user)).code,401);
  assert.equal((await request('/api/admin/users',{id:userId,action:'restore'},adminAuth)).code,200);
  const resumed=await request('/api/login',user);assert.equal(resumed.code,200);
  assert.equal((await request('/api/admin/users',{id:userId,action:'unverify'},adminAuth)).code,200);
  assert.equal((await request('/api/session',undefined,{cookie:resumed.cookie})).code,401);
  assert.equal((await request('/api/login',user)).code,401);
  assert.equal((await request('/api/admin/users',{id:userId,action:'verify'},adminAuth)).code,200);
  assert.equal((await request('/api/login',user)).code,200);
  assert.equal((await request('/api/admin/users',{id:userId,action:'delete'},adminAuth)).code,200);
  assert.equal((await request('/api/login',user)).code,401);
  assert.ok(!(await request('/api/admin/users',undefined,adminAuth)).data.users.some(u=>u.id===userId));
  assert.ok(JSON.parse(await readFile(path.join(dataDir,'rigs.json'),'utf8')).some(r=>r.id===rig.id));
  assert.equal((await request('/api/admin/users',{id:userId,action:'restore'},adminAuth)).code,400);
 }finally{if(server?.listening)await new Promise(r=>server.close(r));await rm(dataDir,{recursive:true,force:true});}
});
test('unconfigured email blocks registration and failed email does not create an account',async()=>{
 for(const sendMail of [null,async()=>{throw Error('SMTP failed');}]){const dataDir=await mkdtemp(path.join(os.tmpdir(),'lf-mail-'));let server;try{({server}=await createCentral({dataDir,sendMail}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const response=await fetch(`http://127.0.0.1:${server.address().port}/api/register`,{method:'POST',body:JSON.stringify({name:'Test',email:'test@example.com',password:'password-123456'})});assert.equal(response.status,sendMail?400:503);assert.equal(JSON.parse(await readFile(path.join(dataDir,'accounts.json'),'utf8')).users.length,0);}finally{if(server?.listening)await new Promise(r=>server.close(r));await rm(dataDir,{recursive:true,force:true});}}
});
