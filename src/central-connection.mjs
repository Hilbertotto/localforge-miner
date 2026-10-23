import {readFile,writeFile,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {validateConfig,connectorTick} from '../worker/connector.mjs';
export class CentralConnection{
 constructor(dataDir,api,fetcher=fetch){this.file=path.join(dataDir,'worker-connection.json');this.pendingFile=path.join(dataDir,'pending-restore.json');this.api=api;this.fetcher=fetcher;this.state={completed:new Map()};this.busy=false;this.lastSuccess=null;this.error=null;}
 async pending(){try{return JSON.parse(await readFile(this.pendingFile,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 async config(){try{return JSON.parse(await readFile(this.file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 async status(){const config=await this.config(),pending=await this.pending();let defaultServer='';if(!config){try{defaultServer=JSON.parse(await readFile(path.join(path.dirname(this.file),'central-server-default.json'),'utf8')).server||'';}catch(e){if(e.code!=='ENOENT')throw e;}}return {configured:Boolean(config),server:config?.server||defaultServer,name:config?.name||'',lastSuccess:this.lastSuccess,error:this.error,backup:this.state.backupSummary||null,pendingRestore:pending?.summary||null};}
 async configure(input){
  const old=await this.config();if(this.busy)throw Error('Kapcsolódás folyamatban. Próbáld újra néhány másodperc múlva.');
  if(input.disconnect===true){for(const file of [this.file,this.pendingFile])try{await unlink(file);}catch(e){if(e.code!=='ENOENT')throw e;}if(old?.keyId)await this.api.revoke(old.keyId);this.state={completed:new Map()};this.lastSuccess=null;this.error=null;return;}
  const candidate=validateConfig({server:input.server,name:input.name?.trim(),code:input.code||old?.code,agentToken:old?.agentToken||'lf_'+'0'.repeat(64)});
  const response=await this.fetcher(candidate.server+'/api/worker/poll',{method:'POST',headers:{Authorization:'Bearer '+candidate.code,'Content-Type':'application/json'},body:JSON.stringify({name:candidate.name,nodeId:this.api.identity.id,results:[],handshake:true,recover:input.recover===true}),redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('A központ elutasította a munkást. Ellenőrizd a nevet, a kulcsot és a szerver címét.');
  const result=await response.json();if(result.recovery){await writeFile(this.pendingFile+'.tmp',JSON.stringify(result.recovery),{mode:0o600});await rename(this.pendingFile+'.tmp',this.pendingFile);}
  else if(old&&(old.code!==candidate.code||old.server!==candidate.server||old.name!==candidate.name)){try{await unlink(this.pendingFile);}catch(e){if(e.code!=='ENOENT')throw e;}}
  const issued=old?null:await this.api.issue('built-in-outbound-worker',['read','control','power']);
  const next={...candidate,agentToken:issued?.token||old.agentToken,keyId:issued?.key.id||old.keyId};
  try{await writeFile(this.file+'.tmp',JSON.stringify(next,null,2),{mode:0o600});await rename(this.file+'.tmp',this.file);}catch(e){if(issued)await this.api.revoke(issued.key.id);throw e;}
  this.state={completed:new Map()};this.error=null;this.lastSuccess=null;
 }
 start(){if(this.timer)return;this.timer=setInterval(()=>{void this.tick();},2000);this.timer.unref();}
 async restore(options){const pending=await this.pending();if(!pending||!this.restoreBackup)throw Error('Nincs letöltött visszaállítás.');if(this.busy)throw Error('A kapcsolat dolgozik. Próbáld újra.');this.busy=true;try{await this.restoreBackup(pending.data,options);const config=await this.config();if(!config)throw Error('Nincs központi kapcsolat.');await writeFile(this.file+'.tmp',JSON.stringify({...config,restoreComplete:true}),{mode:0o600});await rename(this.file+'.tmp',this.file);await unlink(this.pendingFile);this.state={completed:new Map()};}finally{this.busy=false;}}
 async tick(){if(this.busy)return;this.busy=true;try{const config=await this.config();if(!config)return;this.state.backup=undefined;if(!(await this.pending())&&this.getBackup){try{this.state.backup=await this.getBackup();}catch{}}this.state.restoreComplete=config.restoreComplete===true;await connectorTick(validateConfig(config),this.state,this.fetcher);if(config.restoreComplete&&!this.state.recoveryPending){await writeFile(this.file+'.tmp',JSON.stringify({...config,restoreComplete:false}),{mode:0o600});await rename(this.file+'.tmp',this.file);}this.lastSuccess=new Date().toISOString();this.error=null;}catch{this.error='A központi kapcsolat vagy mentés nem elérhető. Automatikus újrapróbálkozás.';}finally{this.busy=false;}}
 close(){clearInterval(this.timer);}
}
