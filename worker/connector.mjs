import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const reads=['node','capabilities','status','profiles','wallets','watchdog','logs','history'];
const writes=['profiles','delete','start','stop','wallets','wallets/delete','import-profile','watchdog','watchdog/rearm','oc','system-power'];
export function validateConfig(c){
 const url=new URL(c.server);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('Hibás szervercím.');
 if(!/^lfw_[a-f0-9]{64}$/.test(c.code)||typeof c.name!=='string'||!c.name.trim()||c.name.length>80||!/^lf_[a-f0-9]{64}$/.test(c.agentToken))throw Error('Hibás munkásbeállítás.');
 return {...c,server:url.origin};
}
export async function connectorTick(config,state,fetcher=fetch){
 const local=async(route,method='GET',body)=>{const response=await fetcher('http://127.0.0.1:8080/api/v1/'+route,{method,headers:{Authorization:'Bearer '+config.agentToken,'Content-Type':'application/json'},body:method==='POST'?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(6000)});const text=await response.text();if(text.length>3*1024*1024)throw Error('Túl nagy agentválasz.');const data=JSON.parse(text);if(!response.ok)throw Error('Agent elutasította a kérést.');return data;};
 if(!state.nodeId){const identity=await local('node');state.nodeId=identity.id;}
 let status;if(Date.now()-(state.statusAt||0)>10000){try{status=await local('status');state.statusAt=Date.now();}catch{state.statusAt=0;}}
 const response=await fetcher(config.server+'/api/worker/poll',{method:'POST',headers:{Authorization:'Bearer '+config.code,'Content-Type':'application/json'},body:JSON.stringify({name:config.name,nodeId:state.nodeId,status,results:state.results||[],backup:state.backup,restoreComplete:state.restoreComplete}),redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('A központ nem elérhető vagy elutasította a munkást.');
 const {commands,backupSummary,recoveryPending}=await response.json();state.results=[];state.backupSummary=backupSummary;state.recoveryPending=recoveryPending;
 if(!Array.isArray(commands)||commands.length>16)throw Error('Hibás központi válasz.');
 for(const job of commands){if(state.completed.has(job.id)){state.results.push(state.completed.get(job.id));continue;}let result;try{const url=new URL(job.route,'http://agent/'),route=url.pathname.slice(1);if((job.method==='GET'&&!reads.includes(route))||(job.method==='POST'&&!writes.includes(route))||!['GET','POST'].includes(job.method)||url.origin!=='http://agent'||(url.search&&!(route==='history'&&/^\?range=1[hd]$/.test(url.search))))throw Error('Tiltott művelet.');result={id:job.id,ok:true,data:await local(route+url.search,job.method,job.body)};}catch{result={id:job.id,ok:false};}state.completed.set(job.id,result);if(state.completed.size>100)state.completed.delete(state.completed.keys().next().value);state.results.push(result);state.statusAt=0;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const config=validateConfig(JSON.parse(await readFile(process.env.LOCALFORGE_WORKER_CONFIG||'/etc/localforge-worker/config.json','utf8'))),state={completed:new Map()};let stopped=false;process.on('SIGTERM',()=>{stopped=true;});process.on('SIGINT',()=>{stopped=true;});console.log('LocalForge munkáscsatlakozó elindult.');
 while(!stopped){try{await connectorTick(config,state);}catch{console.error('Kapcsolódás sikertelen; újrapróbálkozás.');}await new Promise(r=>setTimeout(r,2000));}
}
