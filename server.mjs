import {validatePresets,migratePresets,updatePreset,resolvePresetOc,gpuPresetIdentity,presetKey} from './src/vbios-oc.mjs';
import {saveProfile} from './src/profile-save.mjs';
import {CentralConnection} from './src/central-connection.mjs';
import {validateBackup,validateOc,updateOc} from './src/worker-backup.mjs';
import {GpuIdentityCache} from './src/gpu-identity.mjs';
const gpuIdentityCache=new GpuIdentityCache();
import {TelemetryHistory} from './src/history.mjs';
import {AgentApi,readRoutes,writeRoutes} from './src/agent-api.mjs';
import {CpuPowerReader} from './src/cpu-power.mjs';
const cpuPowerReader=new CpuPowerReader();
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import {validateProfile,Manager,engines} from './src/miners.mjs';
import {cpuTemperature} from './src/temperature.mjs';
import {ThermalWatchdog} from './src/watchdog.mjs';
import {importFlightSheet} from './src/flight-sheet.mjs';
import {validateWallet,resolveWallet} from './src/wallets.mjs';
import {RunState} from './src/run-state.mjs';
import {setTimeout as waitForWork} from 'node:timers/promises';
const run=promisify(execFile),root=path.dirname(fileURLToPath(import.meta.url));
const agentVersion=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version;
export async function createApp({dataDir=path.join(root,'data'),manager=new Manager(),telemetry=hardware,readTemperature=cpuTemperature,reboot=()=>run('sudo',['-n','/usr/local/sbin/localforge-reboot'],{timeout:15000}),powerAction=action=>run('sudo',['-n','/usr/local/sbin/localforge-power',action],{timeout:15000}),ocAction=async data=>{const {stdout}=await run('sudo',['-n','/usr/local/sbin/localforge-oc',data.action,data.uuid,...(['reset','fan-auto'].includes(data.action)?[]:[String(data.value)])],{timeout:15000});return stdout;},watchdogTimer=true,autoRestore=true,historyTimer=true}={}){
 await mkdir(dataDir,{recursive:true});let profiles=[],wallets=[],busy=false;const token=randomBytes(32).toString('hex');
 manager.workDir=path.join(dataDir,'miner-work');
 try{profiles=JSON.parse(await readFile(path.join(dataDir,'profiles.json'),'utf8')).map(validateProfile);}catch(e){if(e.code!=='ENOENT')throw Error(`A profilfájl nem olvasható: ${e.message}`);}
 try{wallets=JSON.parse(await readFile(path.join(dataDir,'wallets.json'),'utf8')).map(validateWallet);}catch(e){if(e.code!=='ENOENT')throw Error(`A walletfájl nem olvasható: ${e.message}`);}
 const agentApi=new AgentApi(dataDir);await agentApi.init();
 const centralConnection=new CentralConnection(dataDir,agentApi);
 const runState=new RunState(dataDir);await runState.load();const restorePending=new Set(runState.ids),restoreErrors=new Map();let shuttingDown=false,powerRequest=null;
 const watchdog=new ThermalWatchdog({dataDir,manager,readTemperature,reboot,getProfiles:()=>profiles.map(p=>resolveWallet(p,wallets))});await watchdog.load();if(watchdogTimer)watchdog.start();
 const history=new TelemetryHistory({dataDir,source:async()=>{const [system,hashrates]=await Promise.all([telemetry(),manager.hashrates()]);return {system,hashrates,profiles,jobs:manager.status()};}});await history.load();
 let ocSettings=[];try{ocSettings=JSON.parse(await readFile(path.join(dataDir,'oc-settings.json'),'utf8')).map(validateOc);}catch(e){if(e.code!=='ENOENT')throw e;}let ocPresets=[];try{ocPresets=validatePresets(JSON.parse(await readFile(path.join(dataDir,'oc-vbios.json'),'utf8')));}catch(e){if(e.code!=='ENOENT')throw e;}let ocApplied=ocSettings.length===0&&ocPresets.length===0,ocSeeded=false;
 async function saveOc(next){const file=path.join(dataDir,'oc-settings.json');await writeFile(file+'.tmp',JSON.stringify(next,null,2),{mode:0o600});await rename(file+'.tmp',file);ocSettings=next;}
 async function savePresets(next){const file=path.join(dataDir,'oc-vbios.json');await writeFile(file+'.tmp',JSON.stringify(next,null,2),{mode:0o600});await rename(file+'.tmp',file);ocPresets=next;}
 centralConnection.getBackup=async()=>{if(busy||shuttingDown)throw Error('Beállításmódosítás folyamatban.');if(!ocSeeded){const hardware=await telemetry();let next=[...ocSettings];for(const gpu of hardware.gpus||[]){const limit=Number(gpu.limit);if(Number.isInteger(limit)&&limit>0&&!next.some(e=>e.uuid===gpu.uuid&&e.action==='power'))next.push(validateOc({uuid:gpu.uuid,action:'power',value:limit}));}if(process.platform==='linux'){try{const {stdout}=await run('python3',[path.join(root,'scripts/read-oc.py')],{timeout:5000});for(const command of JSON.parse(stdout)){if(!next.some(e=>e.uuid===command.uuid&&['fan','fan-auto'].includes(e.action)))next.push(validateOc(command));}}catch{}}if(next.length!==ocSettings.length)await saveOc(next);await savePresets(migratePresets(ocPresets,hardware.gpus||[],ocSettings));ocSeeded=true;}return validateBackup(structuredClone({schema:1,profiles,wallets,runIds:[...runState.ids],watchdog:{config:watchdog.config,latched:watchdog.latched},oc:ocSettings,ocPresets}));};
 centralConnection.restoreBackup=async(input,options)=>{
  if(typeof options.applyOc!=='boolean'||typeof options.start!=='boolean')throw Error('Add meg a visszaállítási lehetőségeket.');
  const restored=validateBackup(input,{maxThreads:os.cpus().length});if(manager.status().some(j=>['running','starting','stopping'].includes(j.state)))throw Error('Visszaállítás előtt állítsd le a futó minereket.');
  if(watchdog.latched&&!restored.watchdog.config.enabled)throw Error('Aktív hővédelmi tiltást visszaállítás nem kapcsolhat ki.');
  let restoredOc=[];if(options.applyOc){const system=await telemetry();restoredOc=resolvePresetOc(restored.ocPresets,system.gpus||[],restored.oc,true);}
  const keepLatch=watchdog.latched||restored.watchdog.latched;await watchdog.configure(restored.watchdog.config);watchdog.latched=keepLatch;await watchdog.persist();
  for(const id of [...runState.ids])await runState.set(id,false);restorePending.clear();restoreErrors.clear();
  await saveWallets(restored.wallets);await save(restored.profiles);
  if(options.applyOc){for(const command of restoredOc)await ocAction(command);await saveOc(restoredOc);await savePresets(restored.ocPresets);}else{await saveOc([]);await savePresets([]);}ocApplied=true;
  if(options.start){for(const id of restored.runIds){await runState.set(id,true);restorePending.add(id);}setTimeout(()=>{void restoreRunning();},0).unref();}
 };
 async function saveWallets(next){const file=path.join(dataDir,'wallets.json');await writeFile(file+'.tmp',JSON.stringify(next,null,2),{mode:0o600});await rename(file+'.tmp',file);wallets=next;}
 async function save(next){const temp=path.join(dataDir,'profiles.tmp');await writeFile(temp,JSON.stringify(next,null,2),{mode:0o600});await rename(temp,path.join(dataDir,'profiles.json'));profiles=next;}
 async function restoreRunning(){
  if(busy||shuttingDown||powerRequest)return;busy=true;
  try{if(!ocApplied){try{const system=await telemetry();const appliedOc=resolvePresetOc(ocPresets,system.gpus||[],ocSettings,true);for(const command of appliedOc)await ocAction(command);await saveOc(appliedOc);ocApplied=true;restoreErrors.delete('oc');}catch{restoreErrors.set('oc','A mentett OC nem alkalmazható. A bányászat visszaindítása várakozik.');return;}}for(const id of [...restorePending]){
   if(shuttingDown)break;if(!runState.ids.has(id)){restorePending.delete(id);restoreErrors.delete(id);continue;}
   const stored=profiles.find(p=>p.id===id);if(!stored){await runState.set(id,false);restorePending.delete(id);continue;}
   if(manager.active(id)){restorePending.delete(id);restoreErrors.delete(id);continue;}
   try{const p=validateProfile(resolveWallet(stored,wallets));await watchdog.guardStart(p);if(shuttingDown)break;await manager.start(p);restorePending.delete(id);restoreErrors.delete(id);console.log(`[restore] Profil visszaindítva: ${p.name}`);}catch(e){if(restoreErrors.get(id)!==e.message)console.log(`[restore] ${stored.name}: ${e.message}`);restoreErrors.set(id,e.message);}
  }}finally{busy=false;}
 }
 const server=http.createServer(async(req,res)=>{
  const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
  try{
   if(!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host||''))return send(403,{error:'Csak helyi elérés engedélyezett.'});
   let route=req.url,principal=null,historyRange='1h';if(/^\/api\/(?:v1\/)?history(?:\?|$)/.test(route)){const url=new URL(route,'http://localhost');if([...url.searchParams.keys()].some(k=>k!=='range')||url.searchParams.getAll('range').length>1)return send(400,{error:'Érvénytelen előzmény-lekérdezés.'});route=url.pathname;historyRange=url.searchParams.get('range')||'1h';}const versioned=route.startsWith('/api/v1/');
   if(versioned){
    principal=await agentApi.authenticate(req.headers.authorization);
    if(!principal){res.setHeader('WWW-Authenticate','Bearer realm="LocalForge agent"');return send(401,{error:'Érvényes Bearer API-kulcs szükséges.'});}
    const endpoint=route.slice('/api/v1/'.length);
    if(!['GET','POST'].includes(req.method))return send(405,{error:'Csak GET és POST támogatott.'});
    const supported=req.method==='GET'?readRoutes:writeRoutes;
    if(!supported.includes(endpoint))return send(404,{error:'Ismeretlen v1 végpont.'});
    const scope=req.method==='GET'?'read':endpoint==='system-power'?'power':'control';
    if(!agentApi.allowed(principal,scope))return send(403,{error:`Hiányzó API-jogosultság: ${scope}.`});
    if(req.method==='POST')res.once('finish',()=>agentApi.audit({keyId:principal.id,method:req.method,endpoint,status:res.statusCode}));
    route='/api/'+endpoint;
   }
   if(req.method==='GET'&&route==='/api/history'){await history.latest();return send(200,history.query(historyRange));}
   if(req.method==='GET'&&route==='/api/session')return send(200,{token,engines});
   if(!versioned&&req.method==='GET'&&route==='/api/central-connection')return send(200,await centralConnection.status());
   if(versioned&&req.method==='GET'){
    if(route==='/api/node')return send(200,{...agentApi.identity,hostname:os.hostname(),apiVersion:'1',agentVersion});
    if(route==='/api/capabilities')return send(200,{apiVersion:'1',engines,scopes:principal.scopes,endpoints:{GET:readRoutes,POST:writeRoutes},features:{profiles:true,wallets:true,cpuWatchdog:true,nvidiaOc:true,nvidiaFan:true,systemPower:true,amdOc:false,cpuOc:false,history:true},history:{ranges:['1h','3h','6h','12h','1d'],retentionSeconds:86400,resolutionSeconds:{'1h':5,'3h':60,'6h':60,'12h':60,'1d':60}},limitations:['CPU tuning BIOS/UEFI-ben','AMD telemetria és tuning még nincs integrálva','GPU hashrate jelenleg SRBMiner-naplóból']});
    if(route==='/api/profiles')return send(200,{profiles:profiles.map(({password,...p})=>({...p,passwordConfigured:Boolean(password)}))});
    if(route==='/api/wallets')return send(200,{wallets});
    if(route==='/api/watchdog')return send(200,watchdog.status());
    if(route==='/api/logs')return send(200,{jobs:manager.status()});
   }
   if(req.method==='GET'&&route==='/api/status'){const [{system,hashrates,at},versions]=await Promise.all([history.latest(),minerVersions()]);return send(200,{...system,...(versioned?{nodeId:agentApi.identity.id,apiVersion:'1'}:{}),profiles:versioned?profiles.map(({password,...p})=>({...p,passwordConfigured:Boolean(password)})):profiles,wallets,ocSettings,jobs:manager.status(),hashrates,versions,sampledAt:at,powerRequest,watchdog:watchdog.status(),autostart:{ids:[...runState.ids],pending:[...restorePending],errors:Object.fromEntries(restoreErrors)}});}
   if(req.method==='POST'){
    if(!principal&&req.headers['x-local-token']!==token)return send(403,{error:'Érvénytelen munkamenet. Frissítsd az oldalt.'});
    if(busy||shuttingDown||powerRequest)return send(409,{error:'Egy művelet már folyamatban van, vagy a szolgáltatás leáll.'});busy=true;
    try{
     let body='';for await(const chunk of req){body+=chunk;if(body.length>32768)return send(413,{error:'Túl nagy kérés.'});}const data=JSON.parse(body||'{}');
     if(!versioned&&route==='/api/central-connection'){await centralConnection.configure(data);return send(200,{ok:true,...await centralConnection.status()});}
     if(!versioned&&route==='/api/central-restore'){await centralConnection.restore(data);return send(200,{ok:true,...await centralConnection.status()});}
     if(route==='/api/system-power'){
      if(!['poweroff','reboot','reboot-delay'].includes(data.action))throw Error('Ismeretlen gépművelet.');
      powerRequest={action:data.action,requestedAt:Date.now(),executeAt:Date.now()+(data.action==='reboot-delay'?30000:0)};
      try{await powerAction(data.action);}catch(e){powerRequest=null;throw e;}
      return send(200,{ok:true,powerRequest,message:data.action==='poweroff'?'A gép kikapcsol.':data.action==='reboot-delay'?'Újraindítás 30 másodperc múlva.':'A gép újraindul.'});
     }
     if(route==='/api/import-profile')return send(200,importFlightSheet(data,wallets));
     if(route==='/api/wallets'){const w=validateWallet(data);if(wallets.length>=200&&!wallets.some(x=>x.id===w.id))throw Error('Legfeljebb 200 wallet menthető.');if(w.externalId&&wallets.some(x=>x.id!==w.id&&x.externalId===w.externalId))throw Error('Ez a külső wal_id már másik wallethez tartozik.');await saveWallets([...wallets.filter(x=>x.id!==w.id),w]);return send(200,{ok:true});}
     if(route==='/api/wallets/delete'){if(profiles.some(p=>p.walletId===data.id))throw Error('Ezt a walletet profil használja. Előbb módosítsd a profil walletjét.');await saveWallets(wallets.filter(w=>w.id!==data.id));return send(200,{ok:true});}
     if(route==='/api/watchdog'){if(principal&&data.action==='reboot'&&!agentApi.allowed(principal,'power'))return send(403,{error:'Reboot watchdoghoz power jogosultság is szükséges.'});await watchdog.configure(data);return send(200,{ok:true});}
     if(route==='/api/watchdog/rearm'){await watchdog.rearm();return send(200,{ok:true});}
     if(route==='/api/profiles')return send(200,await saveProfile({data,profiles,wallets,manager,watchdog,runState,restorePending,restoreErrors,save}));
     if(route==='/api/delete'){if(manager.active(data.id))throw Error('Előbb állítsd le a profilt.');await runState.set(data.id,false);restorePending.delete(data.id);restoreErrors.delete(data.id);await save(profiles.filter(x=>x.id!==data.id));watchdog.cancelResume(data.id);return send(200,{ok:true});}
     if(route==='/api/start'){const stored=profiles.find(x=>x.id===data.id);if(!stored)throw Error('Nincs ilyen profil.');if(manager.active(data.id))throw Error('Ez a profil már fut.');const p=validateProfile(resolveWallet(stored,wallets));await watchdog.guardStart(p);const previous=runState.ids.has(p.id);await runState.set(p.id,true);try{await manager.start(p);}catch(e){if(!previous)await runState.set(p.id,false);throw e;}restorePending.delete(p.id);restoreErrors.delete(p.id);return send(200,{ok:true});}
     if(route==='/api/stop'){await runState.set(data.id,false);restorePending.delete(data.id);restoreErrors.delete(data.id);watchdog.cancelResume(data.id);await manager.stop(data.id);return send(200,{ok:true});}
     if(route==='/api/oc'){
      if(!/^GPU-[a-f0-9-]{36}$/i.test(data.uuid)||!['power','core','memory','reset','fan','fan-auto','core-offset','memory-offset'].includes(data.action))throw Error('Hibás OC művelet.');
      const noValue=['reset','fan-auto'].includes(data.action);
      if(!noValue&&(!Number.isInteger(data.value)||data.value<(data.action==='core-offset'?-1000:data.action==='memory-offset'?-2000:data.action==='fan'?30:1)||data.value>(data.action==='core-offset'?1000:data.action==='memory-offset'?6000:data.action==='fan'?100:30000)))throw Error('Hibás érték. A kézi ventilátor 30–100% lehet.');
      const system=await telemetry(),gpu=(system.gpus||[]).find(g=>g.uuid===data.uuid);if(!gpu)throw Error('A kártya nem található.');const message=await ocAction(data);let nextOc=updateOc(ocSettings,data);if(data.action==='reset'){const identity=gpuPresetIdentity(gpu);if(identity){const matching=(system.gpus||[]).filter(g=>{const i=gpuPresetIdentity(g);return i&&presetKey(i)===presetKey(identity);}).map(g=>g.uuid);nextOc=nextOc.filter(c=>!(matching.includes(c.uuid)&&['power','core','memory','core-offset','memory-offset'].includes(c.action)));}}await saveOc(nextOc);await savePresets(updatePreset(ocPresets,gpu,data));await history.pending;await history.sample();return send(200,{ok:true,message});
     }return send(404,{error:'Ismeretlen művelet.'});
    }finally{busy=false;}
   }
   if(req.method==='GET'&&['/','/app.js','/style.css'].includes(req.url)){
    const name=req.url==='/'?'index.html':req.url.slice(1),content=await readFile(path.join(root,'public',name));
    res.writeHead(200,{'Content-Type':name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8','Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'",'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});return res.end(content);
   }send(404,{error:'Nincs ilyen oldal.'});
  }catch(e){send(e.status||400,{error:e.message});}
 });let restoreTimer;
 if(historyTimer)server.once('listening',()=>history.start());
 if(autoRestore){server.once('listening',()=>{void restoreRunning().catch(e=>console.error(`[restore] ${e.message}`));});restoreTimer=setInterval(()=>{void restoreRunning().catch(e=>console.error(`[restore] ${e.message}`));},30000);restoreTimer.unref();}
 server.once('listening',()=>centralConnection.start());
 const prepareShutdown=async()=>{shuttingDown=true;centralConnection.close();clearInterval(restoreTimer);watchdog.close();await history.close();while(busy||watchdog.running)await waitForWork(10);await agentApi.auditQueue;};
 server.on('close',prepareShutdown);return {server,manager,watchdog,agentApi,history,restoreRunning,prepareShutdown};
}
export async function hardware(){
 let gpus=[],gpuError=null;
 try{const {stdout}=await run('nvidia-smi',['--query-gpu=index,uuid,name,temperature.gpu,utilization.gpu,power.draw,power.limit,power.min_limit,power.max_limit,power.default_limit,memory.used,memory.total,clocks.gr,clocks.mem,fan.speed,pci.bus_id,driver_version,vbios_version','--format=csv,noheader,nounits'],{timeout:4000,maxBuffer:65536});gpus=stdout.trim().split('\n').filter(Boolean).map(line=>{const a=line.split(',').map(x=>x.trim());return Object.fromEntries(['index','uuid','name','temp','usage','power','limit','min','max','defaultPower','used','total','core','memoryClock','fan','bus','driver','vbios'].map((k,i)=>[k,a[i]]));});}catch{gpuError='NVIDIA telemetria nem érhető el. AMD telemetria még nincs integrálva.';}
 if(os.platform()==='linux'&&gpus.length)try{const {stdout}=await run('python3',[path.join(root,'scripts/nvidia-offsets.py')],{timeout:4000});const offsets=JSON.parse(stdout);gpus=gpus.map(g=>({...g,offsets:offsets.find(o=>o.gpu===Number(g.index))}));}catch{}
 if(os.platform()==='linux')gpus=await Promise.all(gpus.map(async gpu=>({...gpu,...await gpuIdentityCache.read(gpu)})));
 let inventory='';if(os.platform()==='linux')try{inventory=(await run('lspci',['-nn'],{timeout:3000})).stdout.split('\n').filter(x=>/VGA|3D controller|Display controller/.test(x)).join('\n');}catch{}
 return {hostname:os.hostname(),platform:os.platform(),cpu:os.cpus()[0]?.model||'CPU',threads:os.cpus().length,load:os.platform()==='linux'?os.loadavg()[0]:null,memory:{used:os.totalmem()-os.freemem(),total:os.totalmem()},uptime:os.uptime(),gpus,gpuError,inventory,cpuPower:await cpuPowerReader.read()};
}
async function minerVersions(){const result={};for(const [key,file]of [['xmrig','xmrig.version.json'],['update','xmrig-update.json']])try{result[key]=JSON.parse(await readFile(path.join(root,'miners',file),'utf8'));}catch{}return result;}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const {server,manager,prepareShutdown}=await createApp();server.listen(8080,'127.0.0.1',()=>console.log('LocalForge: http://127.0.0.1:8080'));let closing=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{if(closing)return;closing=true;await prepareShutdown();await manager.stopAll();server.close(()=>process.exit());});}
