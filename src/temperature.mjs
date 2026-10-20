import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
const read=async file=>(await readFile(file,'utf8')).trim();
const valid=value=>Number.isFinite(value)&&value>=-20&&value<=150;
export async function cpuTemperature({hwmon='/sys/class/hwmon',thermal='/sys/class/thermal'}={}){
 const sensors=[];
 try{for(const entry of await readdir(hwmon)){
  const folder=path.join(hwmon,entry);let name;try{name=await read(path.join(folder,'name'));}catch{continue;}
  if(!['k10temp','coretemp','zenpower','cpu_thermal'].includes(name))continue;
  for(const file of await readdir(folder)){if(!/^temp\d+_input$/.test(file))continue;
   try{let fault=false;try{fault=await read(path.join(folder,file.replace('_input','_fault')))==='1';}catch{}if(fault)continue;const raw=await read(path.join(folder,file));if(!/^-?\d+$/.test(raw))continue;const value=Number(raw)/1000;if(!valid(value))continue;let label=file.replace('_input','');try{label=await read(path.join(folder,file.replace('_input','_label')));}catch{}sensors.push({source:name,label,celsius:value});}catch{}
  }
 }}catch{}
 if(!sensors.length)try{for(const entry of await readdir(thermal)){if(!entry.startsWith('thermal_zone'))continue;const folder=path.join(thermal,entry);try{const type=await read(path.join(folder,'type'));if(!['x86_pkg_temp','cpu-thermal','cpu_thermal'].includes(type))continue;const raw=await read(path.join(folder,'temp'));if(!/^-?\d+$/.test(raw))continue;const value=Number(raw)/1000;if(valid(value))sensors.push({source:type,label:'CPU',celsius:value});}catch{}}}catch{}
 const hottest=sensors.reduce((max,s)=>(!max||s.celsius>max.celsius)?s:max,null);
 return {available:!!hottest,celsius:hottest?.celsius??null,source:hottest?`${hottest.source} · ${hottest.label}`:null,sensors,checkedAt:new Date().toISOString(),error:hottest?null:'CPU-hőmérséklet nem olvasható. Ellenőrzés SSH-n: sensors; AMD: k10temp, Intel: coretemp.'};
}
