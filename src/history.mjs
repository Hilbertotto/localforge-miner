import {appendFile,readFile,readdir,unlink} from 'node:fs/promises';
import path from 'node:path';

const DAY=86400000;
const numeric=v=>v!==null&&v!==undefined&&String(v).trim()!==''&&Number.isFinite(Number(v))?Number(v):null;
export function historyRecord({system,hashrates,profiles,jobs},at){
 const running=profiles.filter(p=>jobs.some(j=>j.id===p.id&&['running','starting','stopping'].includes(j.state)));
 const cpu=running.find(p=>p.engine==='xmrig'),gpu=running.filter(p=>p.engine!=='xmrig'),algorithms=[...new Set(gpu.map(p=>p.algorithm))].sort();
 const rates=gpu.map(p=>hashrates[p.id]?.available===false?null:numeric(hashrates[p.id]?.total));
 const gpus=system.gpus||[],powers=gpus.map(g=>numeric(g.power));
 return {at,cpuHash:cpu&&hashrates[cpu.id]?.available!==false?numeric(hashrates[cpu.id]?.total):null,gpuHash:gpu.length&&algorithms.length===1&&rates.every(v=>v!==null)?rates.reduce((a,b)=>a+b,0):null,cpuKey:cpu?.algorithm||null,gpuKey:algorithms.join(','),cpuPower:system.cpuPower?.available?numeric(system.cpuPower.watts):null,gpuPower:gpus.length&&powers.every(v=>v!==null)?powers.reduce((a,b)=>a+b,0):null,temperatures:Object.fromEntries(gpus.map(g=>[g.uuid,numeric(g.temp)]))};
}
export class TelemetryHistory{
 constructor({dataDir,source,now=()=>Date.now(),intervalMs=5000}){Object.assign(this,{dataDir,source,now,intervalMs});this.records=[];this.current=null;this.error=null;this.closed=false;this.pending=null;}
 async load(){
  const now=this.now(),days=[new Date(now-DAY).toISOString().slice(0,10),new Date(now).toISOString().slice(0,10)];
  for(const day of days)try{for(const line of (await readFile(path.join(this.dataDir,`history-${day}.jsonl`),'utf8')).split('\n')){try{const r=JSON.parse(line);if(Number.isFinite(r.at)&&r.at>=now-DAY&&r.at<=now)this.records.push(r);}catch{}}}catch(e){if(e.code!=='ENOENT')this.error='Az előzményfájl nem olvasható.';}
  this.records.sort((a,b)=>a.at-b.at);this.records=this.records.filter((r,i,a)=>!i||r.at!==a[i-1].at);
 }
 async sample(){
  if(this.closed)return this.current;if(this.pending)return this.pending;
  this.pending=(async()=>{try{
   const current=await this.source();if(this.closed)return this.current;
   const at=this.now(),record=historyRecord(current,at);this.current={...current,at};
   this.records=this.records.filter(r=>r.at>=at-DAY);if(!this.records.length||at-this.records.at(-1).at>=this.intervalMs*.8){
    const file=path.join(this.dataDir,`history-${new Date(at).toISOString().slice(0,10)}.jsonl`);
    // Each line starts with a newline so a truncated final line after power loss
    // cannot swallow the first valid measurement after boot.
    try{await appendFile(file,'\n'+JSON.stringify(record),{mode:0o600});this.error=null;}catch{this.error='Az előzmények lemezre mentése sikertelen.';}
    this.records.push(record);
   }
   const day=new Date(at).toISOString().slice(0,10);if(this.cleanedDay!==day){this.cleanedDay=day;const keep=new Set([day,new Date(at-DAY).toISOString().slice(0,10)]);try{for(const name of await readdir(this.dataDir))if(/^history-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)&&!keep.has(name.slice(8,18)))await unlink(path.join(this.dataDir,name));}catch{this.error='A régi előzmények törlése sikertelen.';}}
   return this.current;
  }catch{this.error='A telemetria mintavétele sikertelen.';return this.current;}finally{this.pending=null;}})();return this.pending;
 }
 start(){if(this.timer||this.closed)return;void this.sample();this.timer=setInterval(()=>void this.sample(),this.intervalMs);this.timer.unref();}
 async latest(){if(!this.current||this.now()-this.current.at>=this.intervalMs)await this.sample();if(!this.current)throw Error(this.error||'Még nincs telemetria.');return this.current;}
 query(range){
  if(!['1h','1d'].includes(range))throw Error('Időtáv: 1h vagy 1d.');
  const end=this.now(),duration=range==='1h'?3600000:DAY,start=end-duration,stepMs=range==='1h'?5000:60000;
  const records=this.records.filter(r=>r.at>=start&&r.at<=end),buckets=[];
  for(const r of records){const key=Math.floor(r.at/stepMs),last=buckets.at(-1);if(last?.key===key)last.values.push(r);else buckets.push({key,values:[r]});}
  // One day uses minute averages, with nulls and algorithm changes kept as gaps.
  const compact=range==='1h'?records:buckets.map(({values})=>{const last=values.at(-1),result={...last,temperatures:{}};for(const key of ['cpuHash','gpuHash','cpuPower','gpuPower']){const source=key==='cpuHash'?'cpuKey':key==='gpuHash'?'gpuKey':null;const valid=values.every(r=>numeric(r[key])!==null&&(!source||r[source]===last[source]));result[key]=valid?values.reduce((sum,r)=>sum+r[key],0)/values.length:null;}return result;});
  return {range,start,end,stepMs,records:compact,error:this.error};
 }
 async close(){this.closed=true;clearInterval(this.timer);await this.pending;}
}
