import {readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
export const defaults={enabled:false,threshold:85,action:'stop_cpu',resumeBelow:70,tripSeconds:5,coolSeconds:60};
export function validateWatchdog(p){
 if(!p||typeof p.enabled!=='boolean'||!['stop_cpu','reboot','cooldown'].includes(p.action))throw Error('Hibás watchdog-beállítás.');
 for(const [key,min,max]of [['threshold',40,110],['resumeBelow',25,100],['tripSeconds',0,120],['coolSeconds',10,600]])if(!Number.isInteger(p[key])||p[key]<min||p[key]>max)throw Error(`Hibás érték: ${key} (${min}–${max}).`);
 if(p.resumeBelow>p.threshold-5)throw Error('A visszaindítási hőfok legalább 5 °C-kal legyen a leállítási határ alatt.');
 return Object.fromEntries(Object.keys(defaults).map(k=>[k,p[k]]));
}
export class ThermalWatchdog{
 constructor({dataDir,manager,readTemperature,reboot,getProfiles,now=()=>Date.now()}){Object.assign(this,{dataDir,manager,readTemperature,reboot,getProfiles,now});this.config={...defaults};this.latched=false;this.pending=[];this.events=[];this.temperature={available:false,celsius:null,error:'Még nincs mérés.'};this.hotSince=null;this.coolSince=null;this.resumeGeneration=0;this.running=false;this.locked=false;this.phase='disabled';}
 async load(){try{const saved=JSON.parse(await readFile(path.join(this.dataDir,'watchdog.json'),'utf8'));this.config=validateWatchdog(saved.config);this.latched=saved.latched===true;this.events=Array.isArray(saved.events)?saved.events.slice(-50):[];this.phase=this.latched?'latched':this.config.enabled?'monitoring':'disabled';}catch(e){if(e.code!=='ENOENT')throw Error(`Hibás watchdog-fájl: ${e.message}`);}}
 async persist(){const file=path.join(this.dataDir,'watchdog.json');await writeFile(file+'.tmp',JSON.stringify({config:this.config,latched:this.latched,events:this.events},null,2),{mode:0o600});await rename(file+'.tmp',file);}
 event(message){this.events.push({at:new Date(this.now()).toISOString(),message});this.events=this.events.slice(-50);console.log(`[watchdog] ${message}`);}
 status(){return {config:this.config,temperature:this.temperature,phase:this.phase,latched:this.latched,pending:[...this.pending],events:this.events};}
 async configure(input){if(this.locked||this.running)throw Error('A watchdog műveletet végez. Próbáld újra.');this.locked=true;try{const config=validateWatchdog(input);const t=await this.readTemperature();if(config.enabled&&!t.available)throw Error('Érvényes CPU-hőmérséklet nélkül a watchdog nem kapcsolható be.');const previous=this.config;this.config=config;try{await this.persist();}catch(e){this.config=previous;throw e;}this.temperature=t;this.hotSince=null;this.coolSince=null;this.pending=[];if(!config.enabled)this.latched=false;this.phase=config.enabled?(this.latched?'latched':'monitoring'):'disabled';this.event(config.enabled?`Watchdog bekapcsolva: ${config.threshold} °C, ${config.action}.`:'Watchdog kikapcsolva.');await this.persist();}finally{this.locked=false;}}
 async rearm(){if(this.locked||this.running)throw Error('A watchdog műveletet végez.');this.locked=true;try{const t=await this.readTemperature();this.temperature=t;if(!t.available||t.celsius>this.config.resumeBelow)throw Error('Újraélesítéshez érvényes, a visszaindítási határ alatti hőmérséklet kell.');this.latched=false;this.pending=[];this.hotSince=this.coolSince=null;this.phase=this.config.enabled?'monitoring':'disabled';this.event('Hővédelmi tiltás kézzel feloldva.');await this.persist();}finally{this.locked=false;}}
 cancelResume(id){this.resumeGeneration++;this.pending=this.pending.filter(x=>x!==id);}
 async guardStart(profile){if(!this.config.enabled||profile.engine!=='xmrig')return;if(this.locked||this.latched)throw Error('A CPU-indítást a hővédelem tiltja. Várj a lehűlésre, majd oldd fel a tiltást.');const t=await this.readTemperature();if(this.locked||this.latched)throw Error('A CPU-indítást a hővédelem tiltja.');if(!t.available||t.celsius>=this.config.threshold)throw Error('CPU-indítás tiltva: nincs érvényes hőmérés vagy túl magas a hőfok.');}
 async tick(){
  if(this.running||this.locked)return;this.running=true;
  try{
   this.temperature=await this.readTemperature();const t=this.temperature,c=this.config,now=this.now();if(!c.enabled){this.phase='disabled';return;}
   const jobs=[...this.manager.jobs.entries()].filter(([,j])=>j.child&&j.profile.engine==='xmrig');
   if(this.latched){
    // Védekezés az alkalmazáson belüli versenyhelyzetben indult CPU-folyamat ellen is.
    for(const [id]of jobs)await this.manager.stop(id);
    if(c.action!=='cooldown'||!this.pending.length){this.phase='latched';return;}
    if(!t.available||t.celsius>c.resumeBelow){this.coolSince=null;this.phase='cooling';return;}
    this.coolSince??=now;this.phase='cooling';if(now-this.coolSince<c.coolSeconds*1000)return;
    const generation=this.resumeGeneration,ids=[...this.pending];this.pending=[];this.latched=false;this.phase='monitoring';this.hotSince=this.coolSince=null;await this.persist();
    for(const id of ids){if(generation!==this.resumeGeneration)break;const p=this.getProfiles().find(x=>x.id===id&&x.engine==='xmrig');if(p)try{await this.manager.start(p);this.event(`CPU-profil lehűlés után újraindítva: ${p.name}.`);}catch(e){this.event(`Automatikus indítás sikertelen: ${e.message}`);}}
    await this.persist();return;
   }
   if(!t.available){this.phase='sensor_error';this.hotSince=null;if(jobs.length)await this.trip(jobs,'A CPU-hőmérő nem olvasható; CPU-bányászat leállítva.',false);return;}
   this.phase='monitoring';if(t.celsius<c.threshold){this.hotSince=null;return;}
   this.hotSince??=now;this.phase='hot';if(now-this.hotSince<c.tripSeconds*1000)return;
   // Üresjáratban ne indítsunk rebootot. Új CPU-indítást a guardStart tilt.
   if(jobs.length)await this.trip(jobs,`CPU-hőhatár: ${t.celsius.toFixed(1)} °C ≥ ${c.threshold} °C.`,true);
  }catch(e){this.phase='error';this.event(`Watchdog-hiba: ${e.message}`);try{await this.persist();}catch{} }
  finally{this.running=false;}
 }
 async trip(jobs,message,overheat){this.latched=true;this.phase='latched';this.pending=this.config.action==='cooldown'?jobs.map(([id])=>id):[];this.event(message);let saved=true;try{await this.persist();}catch(e){saved=false;this.event(`A hővédelmi tiltás mentése nem sikerült: ${e.message}`);}for(const [id]of jobs)await this.manager.stop(id);
  if(overheat&&this.config.action==='reboot'){await this.manager.stopAll();if(!saved)throw Error('A reboot elmaradt, mert a tiltás nem menthető; a minerek leálltak.');this.event('Összes kezelt miner leállítva, gép-újraindítás kérve.');await this.persist();await this.reboot();}else{this.event('CPU-miner leállítva.');await this.persist();}}
 start(){if(this.timer)return;this.timer=setInterval(()=>this.tick(),2000);this.timer.unref();void this.tick();}
 close(){clearInterval(this.timer);this.timer=null;}
}
