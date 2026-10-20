import {readdir,readFile} from 'node:fs/promises';
export class CpuPowerReader {
 constructor({read=readFile,list=readdir,clock=()=>performance.now()}={}){this.previous=new Map();this.readFile=read;this.readdir=list;this.clock=clock;}
 async read(){
  const checkedAt=Date.now(),samples=[];let warming=false;
  try{for(const name of await this.readdir('/sys/class/powercap')){
   if(!/^(intel|amd)-rapl:\d+$/.test(name))continue;
   const base=`/sys/class/powercap/${name}`;
   try{if(!/^package-\d+$/.test((await this.readFile(`${base}/name`,'utf8')).trim()))continue;
    const energy=Number(await this.readFile(`${base}/energy_uj`,'utf8')),range=Number(await this.readFile(`${base}/max_energy_range_uj`,'utf8')),now=this.clock(),old=this.previous.get(name);this.previous.set(name,{energy,now});
    if(!Number.isFinite(energy)||energy<0||!Number.isFinite(range)||range<=0){this.previous.delete(name);continue;}if(!old){warming=true;continue;}const delta=energy>=old.energy?energy-old.energy:energy+range-old.energy,seconds=(now-old.now)/1000;
    if(seconds<=0||seconds>60||delta<0||!Number.isFinite(delta))continue;
    samples.push(delta/1e6/seconds);
   }catch{}
  }}catch{}
  return {available:samples.length>0,watts:samples.length?samples.reduce((a,b)=>a+b,0):null,checkedAt,source:'Linux RAPL · CPU package',error:samples.length?null:warming?'Az első energia-mintára várunk.':'Nincs olvasható CPU package fogyasztásszenzor. A mérés nem tartalmaz becsült TDP-értéket.'};
 }
}
