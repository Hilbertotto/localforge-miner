import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {passwordRecord} from '../central/accounts.mjs';
import {createCentral,validateAddress} from '../central/server.mjs';

test('central rejects credentials and non-HTTP agent URLs',()=>{
 for(const url of ['file:///etc/passwd','http://user:pass@localhost/','http://localhost/private','http://localhost/?token=secret'])assert.throws(()=>validateAddress(url));
 assert.equal(validateAddress('http://192.168.0.18:8080'),'http://192.168.0.18:8080');
});
test('central authenticates, encrypts tokens, forwards approved actions and persists rigs',async()=>{
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'localforge-central-')),token='lf_'+'a'.repeat(64),calls=[];
 const fetcher=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(url.endsWith('/node')?{id:'unique-node'}:{ok:true}),{status:200});};
 let server;
 try{
  await writeFile(path.join(dataDir,'accounts.json'),JSON.stringify({users:[{id:'test-user',name:'Test',email:'test@example.com',verified:true,...passwordRecord('test-password-123')}],farms:[{id:'farm',ownerId:'test-user',name:'Farm'}]}));
  ({server}=await createCentral({dataDir,password:'test-password-123',fetcher}));await new Promise(r=>server.listen(0,'127.0.0.1',r));let base=`http://127.0.0.1:${server.address().port}`;
  const request=(route,body,headers={})=>fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
  assert.equal((await request('/api/rigs')).status,401);
  assert.equal((await request('/api/login',{password:'wrong'})).status,401);
  const login=await request('/api/login',{email:'test@example.com',password:'test-password-123'}),cookie=login.headers.get('set-cookie').split(';')[0],{csrf}=await login.json(),auth={cookie,'X-CSRF-Token':csrf};
  assert.equal((await request('/api/rigs',{farmId:'farm',name:'Rig',address:'http://192.168.0.18:8080',token},{cookie})).status,403);
  assert.equal((await request('/api/rigs',{farmId:'farm',name:'Rig',address:'http://192.168.0.18:8080',token},{...auth,Origin:'https://evil.example'})).status,403);
  const added=await request('/api/rigs',{farmId:'farm',name:'Rig',address:'http://192.168.0.18:8080',token},auth);assert.equal(added.status,201);const {rig}=await added.json();assert.equal(rig.token,undefined);
  assert.equal(calls[0].options.headers.Authorization,`Bearer ${token}`);
  assert.equal((await request(`/api/rigs/${rig.id}/start`,{id:'profile1'},auth)).status,200);assert.equal(calls.at(-1).options.body,'{"id":"profile1"}');
  assert.equal((await request(`/api/rigs/${rig.id}/arbitrary`,{},auth)).status,404);
  const saved=await readFile(path.join(dataDir,'rigs.json'),'utf8');assert.ok(!saved.includes(token));assert.ok(!(await readFile(path.join(dataDir,'admin.json'),'utf8')).includes('test-password-123'));
  assert.equal((await request('/api/rigs',{farmId:'farm',name:'Duplicate',address:'http://192.168.0.19:8080',token},auth)).status,400);
  await new Promise(r=>server.close(r));({server}=await createCentral({dataDir,fetcher}));await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await request('/api/rigs',undefined,auth)).status,401);
  const again=await request('/api/login',{email:'test@example.com',password:'test-password-123'});const renewed={cookie:again.headers.get('set-cookie').split(';')[0]};assert.equal((await (await request('/api/rigs',undefined,renewed)).json()).rigs.length,1);
  assert.equal((await request(`/api/rigs/${rig.id}/status`,undefined,renewed)).status,200);assert.equal(calls.at(-1).options.headers.Authorization,`Bearer ${token}`);
 }finally{if(server?.listening)await new Promise(r=>server.close(r));await rm(dataDir,{recursive:true,force:true});}
});
