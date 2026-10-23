import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
export const workerHash=token=>createHash('sha256').update(token).digest('hex');
export function workerCredential(){const code='lfw_'+randomBytes(32).toString('hex');return {code,workerHash:workerHash(code)};}
export function matchesWorker(rig,authorization){if(typeof authorization!=='string'||!/^Bearer lfw_[a-f0-9]{64}$/.test(authorization)||typeof rig.workerHash!=='string')return false;return timingSafeEqual(Buffer.from(workerHash(authorization.slice(7)),'hex'),Buffer.from(rig.workerHash,'hex'));}
export class WorkerChannel{
 constructor(){this.live=new Map();this.pending=new Map();}
 poll(rig,input){
  const now=Date.now(),previous=this.live.get(rig.id);this.live.set(rig.id,{seenAt:now,status:input.status||previous?.status,statusAt:input.status?now:previous?.statusAt});
  for(const result of input.results||[]){const job=this.pending.get(result.id);if(!job||job.rigId!==rig.id||!job.delivered)continue;clearTimeout(job.timer);this.pending.delete(result.id);result.ok?job.resolve(result.data):job.reject(Error('A miner elutasította a műveletet.'));}
  const commands=[];for(const [id,job] of this.pending)if(!input.handshake&&job.rigId===rig.id&&!job.delivered){job.delivered=true;commands.push({id,route:job.route,method:job.method,body:job.body});}
  return {workerId:rig.id,commands};
 }
 request(rig,route,method,body){
  const live=this.live.get(rig.id);if(!live||Date.now()-live.seenAt>15000)throw Error('A munkás még nem csatlakozott vagy offline.');
  if(route==='status'&&method==='GET'){if(!live.status||Date.now()-live.statusAt>45000)throw Error('Nincs friss minerállapot.');return Promise.resolve(live.status);}
  if([...this.pending.values()].filter(j=>j.rigId===rig.id).length>=16)throw Error('Túl sok függő művelet.');
  return new Promise((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{this.pending.delete(id);reject(Error('A munkás válasza nem érkezett meg. A művelet eredménye bizonytalan; ellenőrizd az állapotot.'));},15000);timer.unref();this.pending.set(id,{rigId:rig.id,route,method,body,resolve,reject,timer,delivered:false});});
 }
 close(){for(const job of this.pending.values()){clearTimeout(job.timer);job.reject(Error('A központ leállt.'));}this.pending.clear();}
}
