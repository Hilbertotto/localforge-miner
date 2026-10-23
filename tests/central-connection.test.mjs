import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {AgentApi} from '../src/agent-api.mjs';
import {CentralConnection} from '../src/central-connection.mjs';
test('first-run connection persists secrets privately, validates handshake and disconnect revokes local key',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'lf-connect-'));
 try{const api=new AgentApi(directory);await api.init();let allowed=true;const calls=[];
 const fetcher=async(url,options)=>{calls.push({url,body:JSON.parse(options.body||'{}')});return new Response('{}',{status:allowed?200:401});};
 const connection=new CentralConnection(directory,api,fetcher);assert.equal((await connection.status()).configured,false);
 const input={server:'https://central.example',name:'Worker',code:'lfw_'+'a'.repeat(64)};
 allowed=false;await assert.rejects(()=>connection.configure(input));assert.equal((await connection.status()).configured,false);assert.equal((await api.keys()).length,0);
 allowed=true;await connection.configure(input);assert.equal(calls.at(-1).body.handshake,true);
 const status=await connection.status();assert.equal(status.configured,true);assert.ok(!JSON.stringify(status).includes(input.code));assert.equal(status.agentToken,undefined);
 const reloaded=new CentralConnection(directory,api,fetcher);assert.equal((await reloaded.config()).code,input.code);assert.equal((await api.keys()).length,1);
  // A concurrent local settings change may postpone a snapshot, but must not block reconnect.
  reloaded.getBackup=async()=>{throw Error('Settings busy');};reloaded.state.nodeId='node';reloaded.state.statusAt=Date.now();
  reloaded.fetcher=async()=>new Response(JSON.stringify({commands:[]}));await reloaded.tick();assert.equal(reloaded.error,null);assert.ok(reloaded.lastSuccess);
 await reloaded.configure({server:input.server,name:input.name,code:''});assert.equal((await api.keys()).length,1);
 await reloaded.configure({disconnect:true});assert.equal((await api.keys()).length,0);assert.equal((await reloaded.status()).configured,false);
 }finally{await rm(directory,{recursive:true,force:true});}
});
