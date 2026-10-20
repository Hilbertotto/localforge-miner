const factors={h:1,kh:1e3,mh:1e6,gh:1e9,th:1e12,ph:1e15,eh:1e18};
export function normalizeBus(bus){if(typeof bus!=='string')return null;const full=bus.match(/^(?:[0-9a-f]{4,8}:)?([0-9a-f]{1,2}):[0-9a-f]{2}\.[0-7]$/i),short=bus.match(/^[0-9a-f]{1,2}$/i);return full?full[1].toLowerCase().padStart(2,'0'):short?bus.toLowerCase().padStart(2,'0'):null;}
export class GpuLogStats{
 constructor(profile,now=()=>Date.now()){this.profile=profile;this.now=now;this.buffers={};this.devices=new Map();this.reported=null;this.algorithm=null;this.version=null;}
 feed(chunk,stream='stdout'){let text=(this.buffers[stream]||'')+String(chunk);text=text.replace(/\x1b\[[0-9;]*[A-Za-z]/g,'').replace(/\r(?!\n)/g,'\n');const lines=text.split('\n');this.buffers[stream]=lines.pop().slice(-65536);for(const line of lines)this.line(line);}
 line(line){if(this.profile.engine!=='srbminer')return;
  const version=line.match(/SRBMiner-MULTI\s+v?([\d.]+)/i);if(version)this.version=version[1];
  const bus=line.match(/GPU\s*(\d+)\s*:.*\[BUS:\s*([0-9a-f:.]+)\]/i);if(bus){const id=String(Number(bus[1])),old=this.devices.get(id)||{id};this.devices.set(id,{...old,bus:normalizeBus(bus[2])});}
  if(/Statistics\s*\]/i.test(line)){this.algorithm=null;return;}
  const heading=line.match(/\[\s*A(\d+)\s*-\s*([^\]\s]+)\s*\]/i);if(heading){this.algorithm=Number(heading[1])===0?heading[2].toLowerCase():null;return;}
  if(this.algorithm!==this.profile.algorithm.toLowerCase())return;
  const device=line.match(/#\s*(\d+)\s+.+?\s([\d]+(?:[.,]\d+)?)\s*([kMGTPE]?H)\/s\b/i),total=line.match(/\bHashrate\s+([\d]+(?:[.,]\d+)?)\s*([kMGTPE]?H)\/s\b/i);
  const value=match=>Number(match[1].replace(',','.'))*factors[match[2].toLowerCase()];
  if(device){const id=String(Number(device[1]));if(!this.profile.devices.split(',').includes(id))return;const hashrate=value([device[0],device[2],device[3]]);if(Number.isFinite(hashrate)&&hashrate>=0)this.devices.set(id,{...this.devices.get(id),id,hashrate,updatedAt:this.now()});}
  else if(total){const hashrate=value(total);if(Number.isFinite(hashrate)&&hashrate>=0)this.reported={hashrate,updatedAt:this.now()};}
 }
 snapshot(){const now=this.now(),fresh=entry=>entry&&now-entry.updatedAt<=90000&&now>=entry.updatedAt,devices=this.profile.devices.split(',').map(id=>{const d=this.devices.get(id);return {id,bus:d?.bus||null,hashrate:fresh(d)?d.hashrate:null,observedAt:d?.updatedAt?new Date(d.updatedAt).toISOString():null};});const all=devices.every(d=>d.hashrate!==null),total=fresh(this.reported)?this.reported.hashrate:all?devices.reduce((sum,d)=>sum+d.hashrate,0):null;return {available:total!==null||devices.some(d=>d.hashrate!==null),total,devices,algorithm:this.profile.algorithm,version:this.version,source:'SRBMiner statisztikai napló',error:total===null?'Várakozás friss GPU-statisztikára (a miner jellemzően 30 másodpercenként írja).':null};}
}
