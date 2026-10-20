import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {AgentApi} from '../src/agent-api.mjs';

// Run locally as the localforge service user. No public key-management endpoint.
const dataDir=process.env.LOCALFORGE_DATA_DIR||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../data');
try{
 await mkdir(dataDir,{recursive:true,mode:0o700});const api=new AgentApi(dataDir);await api.init();
 const [action,name,scopeText]=process.argv.slice(2);
 if(action==='create'){
  const result=await api.issue(name,(scopeText||'read').split(','));
  console.log(JSON.stringify(result,null,2));console.error('A token csak most látható. Mentsd a központi szerver titoktárába.');
 }else if(action==='list')console.log(JSON.stringify((await api.keys()).map(k=>api.publicKey(k)),null,2));
 else if(action==='revoke'){await api.revoke(name);console.log('Kulcs visszavonva.');}
 else throw Error('Használat: node scripts/api-key.mjs create NÉV read,control,power | list | revoke KULCS_ID');
}catch(e){console.error(e.message);process.exitCode=1;}
