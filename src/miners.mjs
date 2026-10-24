import {srbAlgorithms} from './srb-algorithms.mjs';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {readCpu} from './hashrate.mjs';
import {GpuLogStats} from './gpu-hashrate.mjs';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
export const engines={xmrig:{label:'XMRig · CPU',kind:'cpu',algorithms:['rx/0','ghostrider','cn-heavy/xhv']},lolminer:{label:'lolMiner · GPU',kind:'gpu',algorithms:['ETCHASH','AUTOLYKOS2','BEAM-III']},srbminer:{label:'SRBMiner · GPU',kind:'gpu',algorithms:['pearlhash',...srbAlgorithms.filter(a=>a.id!=='pearlhash'&&(a.amd||a.nvidia||a.intel)).map(a=>a.id)],algorithmDetails:srbAlgorithms}};
export function validateProfile(p,{maxThreads=os.cpus().length}={}){
 const str=(x,max)=>typeof x==='string'&&x.length<=max&&!/[\x00-\x1f]/.test(x);
 if(!p||!str(p.id,64)||!/^[-\w]{1,64}$/.test(p.id)||!str(p.name,80)||!p.name.trim()||!Object.hasOwn(engines,p.engine))throw Error('Hibás profilnév vagy bányászprogram.');
 if(!engines[p.engine].algorithms.includes(p.algorithm))throw Error('Nem támogatott algoritmus.');
 if(!str(p.pool,256)||!/^([a-zA-Z0-9.-]+|\[[a-fA-F0-9:]+\]):[0-9]{1,5}$/.test(p.pool)||Number(p.pool.split(':').at(-1))<1||Number(p.pool.split(':').at(-1))>65535)throw Error('Pool formátum: host:port.');
 if(!str(p.wallet,512)||!p.wallet.trim()||p.wallet.startsWith('-')||!str(p.password,128)||p.password.startsWith('-')||!/^[-\w.]{1,64}$/.test(p.worker)||p.worker.startsWith('-')||typeof p.tls!=='boolean')throw Error('Hibás wallet, pooljelszó vagy worker.');
 if(p.engine==='xmrig'&&(!Number.isInteger(p.threads)||p.threads<1||p.threads>maxThreads))throw Error(`CPU szálak: 1–${maxThreads}.`);
 if(/%[A-Z_]+%/.test(p.wallet))throw Error('A walletben fel nem oldott sablonváltozó van.');
 if(engines[p.engine].kind==='gpu'&&!/^\d{1,2}(,\d{1,2})*$/.test(p.devices))throw Error('Miner eszközazonosítók: például 0,1.');
 const walletId=p.walletId??'',walletTemplate=p.walletTemplate??'%WAL%';if(typeof walletId!=='string'||!/^[-\w]{0,64}$/.test(walletId)||!str(walletTemplate,512)||/%[A-Z_]+%/.test(walletTemplate.replaceAll('%WAL%','').replaceAll('%WORKER_NAME%','')))throw Error('Hibás wallet-hivatkozás vagy sablon.');
 return {id:p.id,name:p.name,engine:p.engine,algorithm:p.algorithm,pool:p.pool,wallet:p.wallet,walletId,walletTemplate,password:p.password,worker:p.worker,tls:p.tls,threads:p.engine==='xmrig'?p.threads:1,devices:engines[p.engine].kind==='gpu'?[...new Set(p.devices.split(','))].join(','):''};
}
export function command(p,api){
 if(p.engine==='xmrig')return {file:process.env.XMRIG_PATH||'xmrig',args:['--algo',p.algorithm,'--url',p.pool,'--user',p.wallet,'--pass',p.password||'x','--rig-id',p.worker,'--threads',String(p.threads),'--no-color',...(p.tls?['--tls']:[]),...(api?['--http-host','127.0.0.1','--http-port','18088','--http-access-token',api.token,'--api-id',api.id]:[])]};
 if(p.engine==='srbminer')return {file:process.env.SRBMINER_PATH||'SRBMiner-MULTI',args:['--disable-cpu','--algorithm',p.algorithm,'--pool',p.pool,'--wallet',p.wallet,'--password',p.password||'x','--worker',p.worker,'--gpu-id',p.devices,'--tls',String(p.tls),'--gpu-disable-oc']};
 return {file:process.env.LOLMINER_PATH||'lolMiner',args:['--algo',p.algorithm,'--pool',`${p.tls?'stratum+ssl://':''}${p.pool}`,'--user',p.wallet,'--pass',p.password||'x','--worker',p.worker,'--devices',p.devices,'--watchdog','exit']};
}
export class Manager{
 constructor(spawnProcess=spawn){this.spawnProcess=spawnProcess;this.jobs=new Map();}
 active(id){return !!this.jobs.get(id)?.child;}
 status(){return [...this.jobs.entries()].map(([id,j])=>({id,state:j.state,pid:j.child?.pid||null,started:j.started,logs:j.logs}));}
 async hashrates(){const result={};await Promise.all([...this.jobs.entries()].filter(([,j])=>j.child).map(async([id,j])=>{const child=j.child;const reading=j.api?await readCpu(j.api):j.gpuStats?.snapshot();if(j.child===child&&reading)result[id]=reading;}));return result;}
 checkStart(input,ignoreId=null){
  const p=validateProfile(input);if(this.active(p.id)&&p.id!==ignoreId)throw Error('Ez a profil már fut.');
  for(const [id,j]of this.jobs.entries())if(j.child&&id!==ignoreId){
   if(j.profile.engine==='xmrig'&&p.engine==='xmrig')throw Error('Egyszerre egy CPU-profil futhat.');
   if(engines[j.profile.engine].kind==='gpu'&&engines[p.engine].kind==='gpu'){
    if(j.profile.engine!==p.engine)throw Error('Különböző GPU-minerek eszközsorrendje eltérhet. Előbb állítsd le a másik GPU-minert.');
    if(p.devices.split(',').some(x=>j.profile.devices.split(',').includes(x)))throw Error('Ezt a GPU-eszközt már másik profil használja.');
   }
  }
  return p;
 }
 async start(input){
  const p=this.checkStart(input);
  const api=p.engine==='xmrig'?{token:randomBytes(32).toString('hex'),id:randomBytes(8).toString('hex')}:null;
  let cwd;if(this.workDir){cwd=path.join(this.workDir,p.id);await mkdir(cwd,{recursive:true,mode:0o700});}
  const c=command(p,api),j={profile:p,api,gpuStats:p.engine==='srbminer'?new GpuLogStats(p):null,state:'starting',started:new Date().toISOString(),logs:[],child:null};this.jobs.set(p.id,j);
  const log=s=>{let text=String(s).replace(/\x1b\[[0-9;]*m/g,'');for(const secret of [p.wallet,p.password,api?.token].filter(x=>x?.length>2))text=text.split(secret).join('[rejtve]');j.logs.push(`${new Date().toISOString()} ${text.slice(0,4000)}`);j.logs=j.logs.slice(-150);};
  const child=this.spawnProcess(c.file,c.args,{cwd,stdio:['ignore','pipe','pipe']});j.child=child;
  child.stdout.on('data',b=>{j.gpuStats?.feed(b,'stdout');log(b);});child.stderr.on('data',b=>{j.gpuStats?.feed(b,'stderr');log(b);});
  child.on('exit',(code,signal)=>{j.child=null;j.state=code===0||signal==='SIGTERM'?'stopped':'error';log(`Kilépés: ${code??signal}`);});
  await new Promise((resolve,reject)=>{child.once('spawn',()=>{j.state='running';log('Bányászprogram elindult.');resolve();});child.once('error',e=>{j.child=null;j.state='error';log(e.message);reject(Error(`Nem indítható: ${c.file}. Telepítsd a minert, vagy ellenőrizd az elérési útját.`));});});
 }
 async stop(id){const j=this.jobs.get(id);if(!j?.child)return;const child=j.child;j.state='stopping';await new Promise(resolve=>{const timer=setTimeout(()=>child.kill('SIGKILL'),8000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');});}
 async stopAll(){await Promise.all([...this.jobs.keys()].map(id=>this.stop(id)));}
}
