import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createCentral} from '../central/server.mjs';
import {createApp} from '../server.mjs';
import {passwordRecord} from '../central/accounts.mjs';
import {defaults} from '../src/watchdog.mjs';
const gpu='GPU-12345678-1234-1234-1234-123456789abc';
const snapshot=()=>({schema:1,profiles:[{id:'cpu',name:'CPU',engine:'xmrig',algorithm:'rx/0',pool:'pool.example:443',wallet:'pool-account',walletId:'wallet',walletTemplate:'%WAL%',password:'secret-pool-password',worker:'rig',threads:1,devices:'',tls:true}],wallets:[{id:'wallet',name:'Account',coin:'XMR',address:'pool-account',externalId:''}],runIds:['cpu'],watchdog:{config:{...defaults,enabled:true},latched:true},oc:[{uuid:gpu,action:'power',value:140},{uuid:gpu,action:'fan',value:100}]});
test('encrypted worker backup survives central restart; reinstall requires recovery and cannot overwrite backup with empty settings',async()=>{
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'lf-backup-')),farmId=randomUUID();let server;
 try{
  await writeFile(path.join(dataDir,'accounts.json'),JSON.stringify({users:[{id:'owner',name:'Owner',email:'backup@example.com',verified:true,...passwordRecord('backup-password-123')}],farms:[{id:farmId,ownerId:'owner',name:'Farm'}]}));
  const start=async()=>{({server}=await createCentral({dataDir}));await new Promise(r=>server.listen(0,'127.0.0.1',r));return `http://127.0.0.1:${server.address().port}`;};let base=await start();
  const post=async(route,body,headers={})=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});return {code:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  const login=await post('/api/login',{email:'backup@example.com',password:'backup-password-123'}),auth={cookie:login.cookie,'X-CSRF-Token':login.data.csrf};
  const {rig,code}=(await post('/api/rigs',{name:'Worker',farmId},auth)).data,headers={Authorization:'Bearer '+code};
  for(let i=0;i<4;i++){const backup=snapshot();backup.profiles[0].name='CPU '+i;assert.equal((await post('/api/worker/poll',{name:'Worker',nodeId:'old-node',results:[],backup},headers)).code,200);}
  const file=path.join(dataDir,'worker-backup-'+rig.id+'.json'),stored=await readFile(file,'utf8');assert.equal(JSON.parse(stored).versions.length,3);assert.ok(!stored.includes('secret-pool-password'));assert.ok(!stored.includes('pool-account'));
  await new Promise(r=>server.close(r));const rigs=JSON.parse(await readFile(path.join(dataDir,'rigs.json'),'utf8'));rigs[0].lastSeenAt=new Date(Date.now()-60000).toISOString();await writeFile(path.join(dataDir,'rigs.json'),JSON.stringify(rigs));base=await start();
  assert.equal((await post('/api/worker/poll',{name:'Worker',nodeId:'new-node',results:[]},headers)).code,400);
  const recovered=await post('/api/worker/poll',{name:'Worker',nodeId:'new-node',results:[],handshake:true,recover:true},headers);assert.equal(recovered.code,200);assert.equal(recovered.data.recovery.data.profiles[0].name,'CPU 3');assert.equal(recovered.data.recovery.data.profiles[0].password,'secret-pool-password');assert.equal(recovered.data.recoveryPending,true);
  const empty={...snapshot(),profiles:[],wallets:[],runIds:[],oc:[]};await post('/api/worker/poll',{name:'Worker',nodeId:'new-node',results:[],backup:empty},headers);assert.equal(JSON.parse(await readFile(file,'utf8')).versions[0].id,recovered.data.recovery.summary.id);
  const complete=await post('/api/worker/poll',{name:'Worker',nodeId:'new-node',results:[],backup:recovered.data.recovery.data,restoreComplete:true},headers);assert.equal(complete.data.recoveryPending,false);
  assert.equal((await post('/api/worker/poll',{name:'Worker',nodeId:'old-node',results:[],handshake:true,recover:true},headers)).code,400);
 }finally{if(server?.listening)await new Promise(r=>server.close(r));await rm(dataDir,{recursive:true,force:true});}
});
test('local restore validates GPU identity, restores settings and preserves thermal latch',async()=>{
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'lf-local-restore-')),ocCalls=[],starts=[];let app;
 try{
  await writeFile(path.join(dataDir,'pending-restore.json'),JSON.stringify({summary:{profiles:1,wallets:1,oc:2},data:snapshot()}));await writeFile(path.join(dataDir,'worker-connection.json'),JSON.stringify({server:'https://central.example',name:'Worker',code:'lfw_'+'a'.repeat(64),agentToken:'lf_'+'a'.repeat(64)}));
  let gpuPresent=false;const manager={jobs:new Map(),status:()=>[],hashrates:async()=>({}),active:()=>false,start:async p=>starts.push(p),stop:async()=>{}};
  app=await createApp({dataDir,manager,telemetry:async()=>({hostname:'Test',gpus:gpuPresent?[{uuid:gpu}]:[]}),readTemperature:async()=>({available:true,celsius:50}),ocAction:async c=>ocCalls.push(c),watchdogTimer:false,autoRestore:false,historyTimer:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`,session=await(await fetch(base+'/api/session')).json();
  const apply=()=>fetch(base+'/api/central-restore',{method:'POST',headers:{'X-Local-Token':session.token},body:JSON.stringify({applyOc:true,start:true})});
  assert.equal((await apply()).status,400);assert.equal(ocCalls.length,0);gpuPresent=true;assert.equal((await apply()).status,200);await new Promise(r=>setTimeout(r,20));assert.equal(ocCalls.length,2);assert.equal(starts.length,0);assert.equal(app.watchdog.latched,true);
  assert.equal(JSON.parse(await readFile(path.join(dataDir,'profiles.json'),'utf8'))[0].name,'CPU');assert.equal(JSON.parse(await readFile(path.join(dataDir,'wallets.json'),'utf8'))[0].name,'Account');assert.equal(JSON.parse(await readFile(path.join(dataDir,'worker-connection.json'),'utf8')).restoreComplete,true);
 }finally{if(app){await app.prepareShutdown();if(app.server.listening)await new Promise(r=>app.server.close(r));}await rm(dataDir,{recursive:true,force:true});}
});
