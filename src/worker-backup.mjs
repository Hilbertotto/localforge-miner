import {validateProfile} from './miners.mjs';
import {validateWallet,resolveWallet} from './wallets.mjs';
import {validateWatchdog} from './watchdog.mjs';
import {validatePresets} from './vbios-oc.mjs';
export function validateOc(input){
 if(!input||!/^GPU-[a-f0-9-]{36}$/i.test(input.uuid)||!['power','core','memory','fan','fan-auto','core-offset','memory-offset'].includes(input.action))throw Error('Hibás mentett OC-beállítás.');
 if(input.action!=='fan-auto'&&(!Number.isInteger(input.value)||input.value<(input.action==='core-offset'?-1000:input.action==='memory-offset'?-2000:input.action==='fan'?30:1)||input.value>(input.action==='core-offset'?1000:input.action==='memory-offset'?6000:input.action==='fan'?100:30000)))throw Error('Hibás OC-érték.');
 return {uuid:input.uuid,action:input.action,...(input.action==='fan-auto'?{}:{value:input.value})};
}
export function validateBackup(input,{maxThreads=1024}={}){
 if(!input||input.schema!==1||!Array.isArray(input.profiles)||input.profiles.length>40||!Array.isArray(input.wallets)||input.wallets.length>200||!Array.isArray(input.runIds)||!Array.isArray(input.oc)||input.oc.length>320)throw Error('Hibás munkásmentés.');
 const wallets=input.wallets.map(validateWallet),profiles=input.profiles.map(p=>validateProfile(resolveWallet(p,wallets),{maxThreads}));
 if(new Set(wallets.map(w=>w.id)).size!==wallets.length||new Set(profiles.map(p=>p.id)).size!==profiles.length||input.runIds.some(id=>!profiles.some(p=>p.id===id)))throw Error('Hibás mentett profilhivatkozás.');
 if(profiles.some((p,i)=>profiles.some((q,j)=>i!==j&&p.name.trim().toLowerCase()===q.name.trim().toLowerCase())))throw Error('Ismétlődő profilnevek.');
 return {schema:1,profiles,wallets,runIds:[...new Set(input.runIds)],watchdog:{config:validateWatchdog(input.watchdog?.config),latched:input.watchdog?.latched===true},oc:input.oc.map(validateOc),ocPresets:validatePresets(input.ocPresets)};
}
export function updateOc(entries,command){
 let next=entries.filter(e=>!(e.uuid===command.uuid&&(command.action==='reset'?['power','core','memory','core-offset','memory-offset'].includes(e.action):['fan','fan-auto','core-offset','memory-offset'].includes(command.action)?['fan','fan-auto','core-offset','memory-offset'].includes(e.action):e.action===command.action)));
 if(command.action!=='reset')next.push(validateOc(command));return next;
}
