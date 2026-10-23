import http from 'node:http';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {randomBytes,randomUUID,scryptSync,timingSafeEqual,createCipheriv,createDecipheriv} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {readRoutes,writeRoutes} from '../src/agent-api.mjs';
import {registration,verifyUser,passwordMatches,publicUser,smtpMailer} from './accounts.mjs';
import {WorkerChannel,workerCredential,matchesWorker} from './worker-channel.mjs';
import {emptyLibrary,publicLibrary,saveFarmWallet,saveFarmProfile,removeFarmItem,deployment} from './farm-library.mjs';
import {BackupStore} from './backup-store.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
export function validateAddress(value){
 const url=new URL(value);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('HTTP(S) gépcím szükséges, útvonal és jelszó nélkül.');
 return url.origin;
}
export async function createCentral({dataDir=path.join(root,'data'),password,fetcher=fetch,sendMail=smtpMailer(),localMail=false}={}){
 await mkdir(dataDir,{recursive:true,mode:0o700});
 const load=async(name,fallback)=>{try{return JSON.parse(await readFile(path.join(dataDir,name),'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
 const save=async(name,value)=>{const file=path.join(dataDir,name),tmp=file+'.tmp';await writeFile(tmp,JSON.stringify(value,null,2),{mode:0o600});await rename(tmp,file);};
 let config=await load('admin.json',null),initialPassword;
 if(!config){initialPassword=password||randomBytes(18).toString('base64url');if(initialPassword.length<12)throw Error('Legalább 12 karakteres adminjelszó szükséges.');const salt=randomBytes(16).toString('hex');config={salt,hash:scryptSync(initialPassword,salt,32).toString('hex')};await save('admin.json',config);}
 let key;try{key=await readFile(path.join(dataDir,'vault.key'));}catch(e){if(e.code!=='ENOENT')throw e;key=randomBytes(32);await writeFile(path.join(dataDir,'vault.key'),key,{flag:'wx',mode:0o600});}
 const encrypt=value=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,cipher.update(value,'utf8'),cipher.final(),cipher.getAuthTag()]).toString('base64');};
 const decrypt=value=>{const b=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));cipher.setAuthTag(b.subarray(-16));return Buffer.concat([cipher.update(b.subarray(12,-16)),cipher.final()]).toString('utf8');};
 let rigs=await load('rigs.json',[]),queue=Promise.resolve();const sessions=new Map(),attempts=new Map();
 const mutate=fn=>{const job=queue.then(fn);queue=job.catch(()=>{});return job;};
 let accounts=await load('accounts.json',null);
 if(!accounts){const farm={id:randomUUID(),ownerId:'admin',name:'Saját farm'};accounts={users:[],farms:[farm]};await save('accounts.json',accounts);}
 // Legacy workers belong to the administrator; never transfer them to a new account.
 if(rigs.some(r=>!r.farmId)){const farm=accounts.farms.find(f=>f.ownerId==='admin');rigs=rigs.map(r=>r.farmId?r:{...r,farmId:farm.id});await save('rigs.json',rigs);}
 const farmsFor=id=>accounts.farms.filter(f=>f.ownerId===id);
 const ownsRig=(rig,id)=>farmsFor(id).some(f=>f.id===rig.farmId);
 const channel=new WorkerChannel();
 const backups=new BackupStore(dataDir,encrypt,decrypt);
 let library=await load('farm-library.json',emptyLibrary());
 const publicRig=({token,workerHash,...rig})=>rig;
 async function agent(rig,route,method='GET',body){
  if(rig.mode==='outbound')return channel.request(rig,route,method,body);
  const response=await fetcher(`${rig.address}/api/v1/${route}`,{method,headers:{Authorization:`Bearer ${decrypt(rig.token)}`,'Content-Type':'application/json'},body:method==='POST'?JSON.stringify(body):undefined,signal:AbortSignal.timeout(6000),redirect:'error'});
  const text=await response.text();if(text.length>4*1024*1024)throw Error('Túl nagy agentválasz.');
  let data;try{data=JSON.parse(text);}catch{throw Error('Az agent nem JSON választ adott.');}if(!response.ok)throw Error(`Agent HTTP ${response.status}`);return data;
 }
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  try{
   const url=new URL(req.url,'http://localhost');
   if(localMail&&!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return send(403,{error:'A helyi tesztlevél csak ezen a számítógépen használható.'});
   if(!['GET','POST'].includes(req.method))return send(405,{error:'Nem támogatott metódus.'});
   const body=async()=>{let text='';const limit=url.pathname==='/api/worker/poll'?4*1024*1024:32768;for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>limit)throw Error('Túl nagy kérés.');}return JSON.parse(text||'{}');};
   if(req.method==='POST'&&req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`&&req.headers.origin!==`https://${req.headers.host}`)return send(403,{error:'Idegen eredetű kérés.'});
   if(url.pathname==='/api/worker/poll'&&req.method==='POST'){
    let rig=rigs.find(r=>r.mode==='outbound'&&matchesWorker(r,req.headers.authorization));
    const farm=rig&&accounts.farms.find(f=>f.id===rig.farmId),owner=farm&&accounts.users.find(u=>u.id===farm.ownerId&&u.verified&&!u.suspended&&!u.deletedAt);
    if(!rig||!owner)return send(401,{error:'Érvénytelen munkáskulcs vagy inaktív fiók.'});
    const input=await body();if(input.name!==rig.name||typeof input.nodeId!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(input.nodeId)||!Array.isArray(input.results||[])||(input.results||[]).length>16)return send(400,{error:'Hibás munkásazonosító.'});
    let recovery,backupSummary;
    await mutate(async()=>{
     rig=rigs.find(r=>r.id===rig.id);if(!rig)throw Error('A munkás törölve lett.');
     const latest=await backups.latest(rig.id),changed=rig.nodeId&&rig.nodeId!==input.nodeId;
     if(changed){if(!input.recover||!input.handshake||!latest)throw Error('A kulcs már másik telepítéshez tartozik. Válaszd az újratelepítés utáni helyreállítást.');const seen=channel.live.get(rig.id)?.seenAt||Date.parse(rig.lastSeenAt||0);if(Date.now()-seen<45000)throw Error('A korábbi munkás még elérhető. Előbb állítsd le a régi kapcsolatot.');}
     if(!rig.nodeId||changed){if(rigs.some(r=>r.id!==rig.id&&r.nodeId===input.nodeId&&!(r.mode!=='outbound'&&accounts.farms.find(f=>f.id===r.farmId)?.ownerId==='admin')))throw Error('Ez a gép már csatlakoztatva van.');rig={...rig,nodeId:input.nodeId};}
     if(input.handshake&&input.recover&&latest){rig={...rig,recoveryPending:true};recovery={summary:backups.summary(latest),data:backups.decode(latest)};}
     if(input.restoreComplete===true)rig={...rig,recoveryPending:false};
     if(input.backup&&!rig.recoveryPending)backupSummary=await backups.put(rig.id,input.backup);else backupSummary=backups.summary(latest);
     if(!rig.lastSeenAt||Date.now()-Date.parse(rig.lastSeenAt)>30000||changed||input.handshake||input.restoreComplete===true){rig={...rig,lastSeenAt:new Date().toISOString()};const next=rigs.map(r=>r.id===rig.id?rig:r);await save('rigs.json',next);rigs=next;}
    });
    return send(200,{...channel.poll(rig,input),backupSummary,recoveryPending:Boolean(rig.recoveryPending),...(recovery?{recovery}:{})});
   }
   if(url.pathname==='/api/auth-config'&&req.method==='GET')return send(200,{emailConfigured:Boolean(sendMail)||localMail,localMail});
   if(req.method==='POST'&&['/api/register','/api/verify'].includes(url.pathname)){
    const ip='registration:'+req.socket.remoteAddress,now=Date.now(),attempt=attempts.get(ip);if(attempt&&now-attempt.at<60000&&attempt.count>=5)return send(429,{error:'Túl sok próbálkozás. Várj egy percet.'});
    attempts.set(ip,{at:attempt&&now-attempt.at<60000?attempt.at:now,count:attempt&&now-attempt.at<60000?attempt.count+1:1});const input=await body();
    if(url.pathname==='/api/verify'){await mutate(async()=>{const verified=verifyUser(accounts.users,input.token);const next={...accounts,users:accounts.users.map(u=>u.id===verified.id?verified:u)};await save('accounts.json',next);accounts=next;});return send(200,{ok:true,message:'E-mail-cím megerősítve. Most már beléphetsz.'});}
    if(!sendMail&&!localMail)return send(503,{error:'Az SMTP levélküldés még nincs beállítva. Regisztráció később lehetséges.'});
    const {user,token}=registration(input);
    let preview;
    await mutate(async()=>{const existing=accounts.users.find(u=>u.email===user.email&&!u.deletedAt);if(existing?.verified||existing?.suspended)return;
     // A retry resends the existing pending identity; it cannot replace its password.
     const pending=existing?{...existing,verificationHash:user.verificationHash,verificationExpires:user.verificationExpires}:user;
     if(localMail){preview={id:randomUUID(),email:pending.email,name:pending.name,subject:'LocalForge – e-mail-cím megerősítése',url:'/?verify='+token,createdAt:new Date().toISOString()};const letters=await load('local-mail.json',[]);await save('local-mail.json',[...letters.slice(-99),preview]);}
     else await sendMail({email:pending.email,name:pending.name,token});
     const next={...accounts,users:existing?accounts.users.map(u=>u.id===existing.id?pending:u):[...accounts.users,pending]};await save('accounts.json',next);accounts=next;});
    return send(200,{ok:true,...(preview?{localMail:preview}:{}),message:localMail?'A helyi tesztlevél elkészült. Külső e-mailt nem küldtünk.':'Ha a cím regisztrálható, elküldtük a megerősítő levelet. A link 24 óráig érvényes.'});
   }
   if(req.method==='POST'&&url.pathname==='/api/login'){
    const ip=req.socket.remoteAddress,now=Date.now(),attempt=attempts.get(ip);if(attempt&&now-attempt.at<60000&&attempt.count>=5)return send(429,{error:'Várj egy percet az újabb próbálkozás előtt.'});
    const input=await body();if(typeof input.password!=='string'||input.password.length>256)return send(400,{error:'Hibás jelszó.'});
    const email=typeof input.email==='string'?input.email.trim().toLowerCase():'';
    const user=email?accounts.users.find(u=>u.email===email&&!u.deletedAt):{id:'admin',name:'Admin',email:null,verified:true,...config};
    if(!passwordMatches(input.password,user||config)||!user?.verified||user.suspended){attempts.set(ip,{at:attempt&&now-attempt.at<60000?attempt.at:now,count:attempt&&now-attempt.at<60000?attempt.count+1:1});return send(401,{error:'Hibás belépési adatok vagy inaktív fiók.'});}
    attempts.delete(ip);for(const [id,s] of sessions)if(s.expires<now)sessions.delete(id);if(sessions.size>=100)sessions.delete(sessions.keys().next().value);
    const id=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');sessions.set(id,{csrf,user:publicUser(user),expires:now+8*3600000});res.setHeader('Set-Cookie',`lfcentral=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${req.socket.encrypted?'; Secure':''}`);return send(200,{csrf,user:publicUser(user)});
   }
   if(req.method==='GET'&&['/','/app.js','/farm-library.js','/style.css'].includes(url.pathname)){const name=url.pathname==='/'?'index.html':url.pathname.slice(1);res.writeHead(200,{'Content-Type':name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8'});return res.end(await readFile(path.join(root,'public',name)));}
   const sid=/(?:^|;\s*)lfcentral=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||'')?.[1],session=sessions.get(sid);
   if(!session||session.expires<Date.now())return send(401,{error:'Jelentkezz be.'});
   if(session.user.id!=='admin'&&!accounts.users.some(u=>u.id===session.user.id&&u.verified&&!u.suspended&&!u.deletedAt)){sessions.delete(sid);return send(401,{error:'A fiók nem aktív. Jelentkezz be újra.'});}
   if(req.method==='POST'&&req.headers['x-csrf-token']!==session.csrf)return send(403,{error:'Hibás munkamenet.'});
   if(url.pathname==='/api/session'&&req.method==='GET')return send(200,{csrf:session.csrf,user:session.user});
   if(url.pathname==='/api/admin/users'&&req.method==='GET'){
    if(session.user.id!=='admin')return send(403,{error:'Csak adminisztrátor számára elérhető.'});
    return send(200,{users:accounts.users.filter(u=>!u.deletedAt).map(u=>({...publicUser(u),verified:u.verified,suspended:Boolean(u.suspended),createdAt:u.createdAt||null,farmCount:farmsFor(u.id).length,workerCount:rigs.filter(r=>ownsRig(r,u.id)).length}))});
   }
   if(url.pathname==='/api/admin/users'&&req.method==='POST'){
    if(session.user.id!=='admin')return send(403,{error:'Csak adminisztrátor számára elérhető.'});
    const input=await body();if(!['verify','unverify','suspend','restore','delete'].includes(input.action))return send(400,{error:'Ismeretlen felhasználói művelet.'});
    await mutate(async()=>{const user=accounts.users.find(u=>u.id===input.id&&!u.deletedAt);if(!user)throw Error('Ismeretlen felhasználó.');
     const updated={...user,updatedAt:new Date().toISOString()};
     if(input.action==='verify'||input.action==='unverify'){updated.verified=input.action==='verify';delete updated.verificationHash;delete updated.verificationExpires;}
     if(input.action==='suspend'||input.action==='restore')updated.suspended=input.action==='suspend';
     if(input.action==='delete'){updated.deletedAt=updated.updatedAt;updated.suspended=true;updated.verified=false;delete updated.hash;delete updated.salt;delete updated.verificationHash;delete updated.verificationExpires;}
     const next={...accounts,users:accounts.users.map(u=>u.id===user.id?updated:u)};await save('accounts.json',next);accounts=next;
     for(const [id,s] of sessions)if(s.user.id===user.id)sessions.delete(id);
    });return send(200,{ok:true});
   }
   if(session.user.id==='admin'&&(url.pathname==='/api/farms'||url.pathname.startsWith('/api/rigs')))return send(403,{error:'Az adminfelület felhasználókezelésre szolgál. A farmokat felhasználói fiókkal kezelheted.'});
   const farmRoute=/^\/api\/farms\/([a-f0-9-]+)\/library(?:\/(wallets|profiles|delete|apply))?$/.exec(url.pathname);
   if(farmRoute){
    const farmId=farmRoute[1],action=farmRoute[2];if(session.user.id==='admin'||!farmsFor(session.user.id).some(f=>f.id===farmId))return send(404,{error:'Ismeretlen farm.'});
    if(req.method==='GET'&&!action)return send(200,publicLibrary(library,farmId));
    if(req.method!=='POST'||!action)return send(405,{error:'Nem támogatott művelet.'});const input=await body();
    if(action==='apply'){
     const rig=rigs.find(r=>r.id===input.rigId&&r.farmId===farmId);if(!rig)return send(404,{error:'Ismeretlen munkás.'});if(typeof input.start!=='boolean')throw Error('Az indítási mód kötelező.');
     const {profile,assignment}=deployment(library,farmId,input.profileId,rig,decrypt);
     const result=await agent(rig,'profiles','POST',{...profile,saveMode:'update'});
     if(input.start&&!result.running)await agent(rig,'start','POST',{id:profile.id});
     await mutate(async()=>{const next={...library,assignments:[...library.assignments.filter(a=>!(a.rigId===rig.id&&a.profileId===profile.id)),assignment]};await save('farm-library.json',next);library=next;});
     return send(200,{ok:true,message:'Flight sheet átküldve a munkásnak.',assignment});
    }
    await mutate(async()=>{const next=action==='wallets'?saveFarmWallet(library,farmId,input):action==='profiles'?saveFarmProfile(library,farmId,input,encrypt,decrypt):removeFarmItem(library,farmId,input.kind,input.id);await save('farm-library.json',next);library=next;});return send(200,{ok:true});
   }
   if(url.pathname==='/api/farms'&&req.method==='GET')return send(200,{farms:farmsFor(session.user.id)});
   if(url.pathname==='/api/farms'&&req.method==='POST'){
    const input=await body();if(typeof input.name!=='string'||!input.name.trim()||input.name.length>80||/[\x00-\x1f]/.test(input.name))return send(400,{error:'A farm neve 1–80 karakter legyen.'});
    const farm={id:randomUUID(),ownerId:session.user.id,name:input.name.trim()};await mutate(async()=>{if(farmsFor(session.user.id).some(f=>f.name.toLowerCase()===farm.name.toLowerCase()))throw Error('Létező farmnév.');const next={...accounts,farms:[...accounts.farms,farm]};await save('accounts.json',next);accounts=next;});return send(201,{farm});
   }
   if(url.pathname==='/api/logout'&&req.method==='POST'){sessions.delete(sid);res.setHeader('Set-Cookie','lfcentral=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return send(200,{ok:true});}
   if(url.pathname==='/api/rigs'&&req.method==='GET')return send(200,{rigs:rigs.filter(r=>ownsRig(r,session.user.id)).map(publicRig)});
   if(url.pathname==='/api/rigs'&&req.method==='POST'){
    const input=await body();if(typeof input.name!=='string'||!input.name.trim()||input.name.length>80||/[\x00-\x1f]/.test(input.name))throw Error('Érvényes munkásnév szükséges.');
    const farmId=input.farmId||(session.user.id==='admin'?farmsFor('admin')[0]?.id:null);if(!farmsFor(session.user.id).some(f=>f.id===farmId))return send(404,{error:'Ismeretlen farm.'});
    if(input.address===undefined&&input.token===undefined){const {code,workerHash}=workerCredential(),rig={id:randomUUID(),farmId,name:input.name.trim(),mode:'outbound',workerHash,createdAt:new Date().toISOString()};await mutate(async()=>{if(rigs.some(r=>r.farmId===farmId&&r.name.toLowerCase()===rig.name.toLowerCase()))throw Error('Létező munkásnév.');const next=[...rigs,rig];await save('rigs.json',next);rigs=next;});return send(201,{rig:publicRig(rig),code});}
    if(!/^lf_[a-f0-9]{64}$/.test(input.token))throw Error('Érvénytelen agent API-kulcs.');
    const rig={id:randomUUID(),farmId,name:input.name.trim(),address:validateAddress(input.address),token:encrypt(input.token)};const identity=await agent(rig,'node');rig.nodeId=identity.id||identity.node?.id;
    if(!rig.nodeId)throw Error('Hiányzó agent gépazonosító.');await mutate(async()=>{if(rigs.some(r=>r.nodeId===rig.nodeId||r.address===rig.address))throw Error('Ez a gép már szerepel.');const next=[...rigs,rig];await save('rigs.json',next);rigs=next;});return send(201,{rig:publicRig(rig)});
   }
   const match=/^\/api\/rigs\/([a-f0-9-]+)\/(.+)$/.exec(url.pathname);if(!match)return send(404,{error:'Ismeretlen végpont.'});const rig=rigs.find(r=>r.id===match[1]&&ownsRig(r,session.user.id));if(!rig)return send(404,{error:'Ismeretlen gép.'});const route=match[2];
   if(route==='backup'&&req.method==='GET')return send(200,{versions:(await backups.versions(rig.id)).map(v=>backups.summary(v)),recoveryPending:Boolean(rig.recoveryPending)});
   if(route==='remove'&&req.method==='POST'){await mutate(async()=>{const next=rigs.filter(r=>r.id!==rig.id);await save('rigs.json',next);rigs=next;});return send(200,{ok:true});}
   const allowed=req.method==='GET'?readRoutes:writeRoutes;if(!allowed.includes(route))return send(404,{error:'Ismeretlen agentművelet.'});
   const query=route==='history'?`?range=${url.searchParams.get('range')==='1d'?'1d':'1h'}`:'';
   try{return send(200,await agent(rig,route+query,req.method,req.method==='POST'?await body():undefined));}catch{return send(502,{error:'A gép nem érhető el, nincs jogosultság, vagy az agent elutasította a műveletet. Ellenőrizd a gép helyi felületét.'});}
  }catch(e){send(400,{error:e.message.startsWith('Agent HTTP')?e.message:'Hibás kérés vagy sikertelen mentés. Ellenőrizd a megadott adatokat.'});}
 });
 server.on('close',()=>channel.close());
 return {server,initialPassword};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const localMail=process.env.LOCALFORGE_MAIL_MODE==='local';
 if(localMail&&process.env.LOCALFORGE_CENTRAL_HOST&&!['127.0.0.1','::1','localhost'].includes(process.env.LOCALFORGE_CENTRAL_HOST))throw Error('Helyi tesztlevélhez loopback bind szükséges.');
 const {server,initialPassword}=await createCentral({dataDir:process.env.LOCALFORGE_CENTRAL_DATA,password:process.env.LOCALFORGE_CENTRAL_PASSWORD,localMail});
 const host=process.env.LOCALFORGE_CENTRAL_HOST||'127.0.0.1',port=Number(process.env.LOCALFORGE_CENTRAL_PORT||8090);
 server.listen(port,host,()=>{console.log(`LocalForge Central: http://${host}:${port}`);if(initialPassword)console.log(`Első adminjelszó: ${initialPassword}\nMentsd el: később nem jelenik meg.`);});
}
