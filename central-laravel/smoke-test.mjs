import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
const base=process.env.LOCALFORGE_TEST_URL||'http://127.0.0.1:8091';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('The smoke test only runs on loopback.');
let cookie='',csrf='';
async function request(path,body,{auth=true,token,status=200}={}){
 const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Accept:'application/json',...(auth&&cookie?{Cookie:cookie,'X-CSRF-Token':csrf}:{}),...(token?{Authorization:'Bearer '+token}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json();
 assert.equal(response.status,status,path+': '+(data.error||''));
 if(auth&&response.headers.get('set-cookie'))cookie=response.headers.getSetCookie().find(x=>x.startsWith('localforge_laravel_test='))?.split(';')[0]||cookie;
 if(data.csrf)csrf=data.csrf;
 return data;
}
const name='Laravel Smoke '+randomUUID().slice(0,8),email=randomUUID()+'@example.test',password=randomUUID();
const reg=await request('/api/register',{name,email,password});
const verify=new URL(reg.localMail.url).searchParams.get('verify');
await request('/api/verify',{token:verify});
await request('/api/verify',{token:verify},{status:400});
await request('/api/login',{email,password});
const {farm}=await request('/api/farms',{name:'Test farm'},{status:201});
const {rig,code}=await request('/api/rigs',{farmId:farm.id},{status:201});
const rigPath='/api/rigs/'+rig.id,library='/api/farms/'+farm.id+'/library';
assert.equal((await request(rigPath+'/connection-code',{})).code,code);
assert.ok(!(await request('/api/rigs')).rigs.some(r=>r.workerCode||r.workerHash));
await request(library+'/wallets',{name:'Test wallet',address:'test-wallet',coin:'XMR'});
const {wallets}=await request(library);
await request(library+'/profiles',{name:'Test profile',engine:'xmrig',algorithm:'rx/0',pool:'pool.example.test:3333',walletId:wallets[0].id,worker:'%WORKER_NAME%',walletTemplate:'%WAL%',threads:2,tls:false,password:'fixture-password'});
const profile=(await request(library)).profiles[0];
assert.equal(profile.password,undefined);
assert.equal(profile.passwordCipher,undefined);
const nodeId=randomUUID(),poll={username:name,nodeId};
await request('/api/worker/poll',{...poll,username:'Incorrect username'},{auth:false,token:code,status:400});
const status={hostname:'Test worker',gpus:[],profiles:[],jobs:[],hashrates:{}};
const record={schema:1,id:randomUUID(),nodeId,at:Date.now(),cpu:{},gpus:[]};
const records=[record],id=createHash('sha256').update(JSON.stringify(records)).digest('hex');
const settingsRecords=[{schema:1,id:randomUUID(),nodeId,at:Date.now(),data:{schema:1,profiles:[],wallets:[],oc:[]}}];
const settingsId=createHash('sha256').update(JSON.stringify(settingsRecords)).digest('hex');
const statusPoll={...poll,status,telemetry:{id,records},settings:{id:settingsId,records:settingsRecords}};
const ack=await request('/api/worker/poll',statusPoll,{auth:false,token:code});
assert.equal(ack.telemetryAck.id,id);assert.equal(ack.settingsAck.id,settingsId);
await request('/api/worker/poll',statusPoll,{auth:false,token:code});
assert.equal((await request(rigPath+'/telemetry')).records.length,1);
assert.equal((await request(rigPath+'/configuration-archive')).versions.length,1);
assert.equal((await request(rigPath+'/status')).hostname,'Test worker');

const applying=request(library+'/apply',{rigId:rig.id,profileId:profile.id,start:false});
let command;
for(let i=0;i<35&&!command;i++){
 await new Promise(r=>setTimeout(r,100));
 command=(await request('/api/worker/poll',poll,{auth:false,token:code})).commands[0];
}
assert.equal(command?.route,'profiles');
assert.equal(command.body.password,'fixture-password');
await request('/api/worker/poll',{...poll,results:[{id:command.id,ok:true,data:{running:false}}]},{auth:false,token:code});
assert.equal((await applying).ok,true);

const html=await fetch(base+'/worker-ui/'+rig.id+'/',{headers:{Cookie:cookie}});
assert.equal(html.status,200);
assert.ok((await html.text()).includes('bridge.js'));
await request(rigPath+'/remove',{});
await request('/api/worker/poll',poll,{auth:false,token:code,status:401});
await request('/api/logout',{});
console.log('Passed: registration, verification, session, farm, wallet, sheet, key reveal, worker poll, journal replay, command delivery, worker UI, removal.');
