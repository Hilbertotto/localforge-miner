import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
export function pciAddress(value){const m=typeof value==='string'&&value.match(/^([0-9a-f]{4,8}):([0-9a-f]{2}):([0-9a-f]{2})\.([0-7])$/i);if(!m||parseInt(m[1],16)>65535)return null;return `${parseInt(m[1],16).toString(16).padStart(4,'0')}:${m[2]}:${m[3]}.${m[4]}`.toLowerCase();}
const hex=value=>/^0x[0-9a-f]{4}$/i.test(value?.trim())?value.trim().slice(2).toUpperCase():null;
export async function readGpuIdentity(bus,{pciRoot='/sys/bus/pci/devices',reader=readFile}={}){
 const address=pciAddress(bus),missing={pciDeviceId:null,pciSubsystemId:null,memoryType:null,memoryVendor:null,biosHash:null};if(!address)return missing;
 const directory=path.join(pciRoot,address),text=async name=>{try{return (await reader(path.join(directory,name),'utf8')).trim();}catch{return null;}};
 const [vendor,device,subvendor,subdevice,memoryVendor]=await Promise.all(['vendor','device','subsystem_vendor','subsystem_device','mem_info_vram_vendor'].map(text));
 let biosHash=null;try{const rom=await reader(path.join(directory,'rom'));if(rom.length>=512&&rom.length<=4*1024*1024&&rom[0]===0x55&&rom[1]===0xaa)biosHash=createHash('sha256').update(rom).digest('hex');}catch{}
 return {...missing,pciDeviceId:hex(vendor)&&hex(device)?`${hex(vendor)}:${hex(device)}`:null,pciSubsystemId:hex(subvendor)&&hex(subdevice)?`${hex(subvendor)}:${hex(subdevice)}`:null,memoryVendor:memoryVendor&&memoryVendor!=='unknown'?memoryVendor:null,biosHash};
}
export class GpuIdentityCache{
 constructor(){this.cache=new Map();}
 async read(gpu){const key=gpu.uuid+'|'+gpu.bus,old=this.cache.get(key);if(old&&Date.now()-old.at<60000)return old.value;const value=await readGpuIdentity(gpu.bus);this.cache.set(key,{at:Date.now(),value});return value;}
}
