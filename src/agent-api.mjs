import {readFile,writeFile,rename,appendFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';

const digest=value=>createHash('sha256').update(value).digest('hex');
export const apiScopes=['read','control','power'];
export const readRoutes=['node','capabilities','status','profiles','wallets','watchdog','logs','history','app-update'];
export const writeRoutes=['profiles','delete','start','stop','wallets','wallets/delete','import-profile','watchdog','watchdog/rearm','oc','system-power','app-update'];
export class AgentApi {
 constructor(dataDir){this.dataDir=dataDir;this.file=path.join(dataDir,'api-keys.json');this.auditQueue=Promise.resolve();}
 async init(){
  const file=path.join(this.dataDir,'node-identity.json');
  try{await writeFile(file,JSON.stringify({id:randomUUID(),createdAt:new Date().toISOString()},null,2),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
  this.identity=JSON.parse(await readFile(file,'utf8'));if(typeof this.identity.id!=='string')throw Error('Hibás gépazonosító.');
 }
 async keys(){try{const data=JSON.parse(await readFile(this.file,'utf8'));if(data.schema!==1||!Array.isArray(data.keys))throw Error('Hibás API-kulcstár.');return data.keys;}catch(e){if(e.code==='ENOENT')return [];throw e;}}
 async save(keys){const temp=this.file+'.tmp';await writeFile(temp,JSON.stringify({schema:1,keys},null,2),{mode:0o600});await rename(temp,this.file);}
 async issue(name,scopes){
  if(typeof name!=='string'||!name.trim()||name.length>80||/[\x00-\x1f]/.test(name)||!Array.isArray(scopes)||!scopes.length||scopes.some(s=>!apiScopes.includes(s)))throw Error('Név és read/control/power jogosultság szükséges.');
  const keys=await this.keys();if(keys.length>=100)throw Error('Legfeljebb 100 API-kulcs tárolható.');
  const token='lf_'+randomBytes(32).toString('hex'),key={id:randomUUID(),name,scopes:[...new Set(scopes)],hash:digest(token),createdAt:new Date().toISOString()};
  await this.save([...keys,key]);return {token,key:this.publicKey(key)};
 }
 publicKey({hash,...key}){return key;}
 async revoke(id){const keys=await this.keys();if(!keys.some(k=>k.id===id))throw Error('Ismeretlen kulcsazonosító.');await this.save(keys.filter(k=>k.id!==id));}
 async authenticate(authorization){
  if(typeof authorization!=='string'||!/^Bearer lf_[a-f0-9]{64}$/.test(authorization))return null;
  const supplied=Buffer.from(digest(authorization.slice(7)),'hex');
  for(const key of await this.keys()){if(typeof key.hash!=='string'||!/^[a-f0-9]{64}$/.test(key.hash))continue;if(timingSafeEqual(supplied,Buffer.from(key.hash,'hex')))return this.publicKey(key);}
  return null;
 }
 allowed(key,scope){return key.scopes.includes(scope)||(scope==='read'&&key.scopes.includes('control'));}
 audit(entry){
  // No request body, wallet, password, token or shell command enters this log.
  const line=JSON.stringify({at:new Date().toISOString(),...entry})+'\n';
  this.auditQueue=this.auditQueue.then(async()=>{const file=path.join(this.dataDir,'api-audit.jsonl');let size=0;try{size=(await stat(file)).size;}catch(e){if(e.code!=='ENOENT')throw e;}if(size>5*1024*1024)await rename(file,file+'.1');await appendFile(file,line,{mode:0o600});}).catch(()=>console.error('[api] Auditnapló írása sikertelen.'));
 }
}
