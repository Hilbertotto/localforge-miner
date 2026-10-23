import {randomUUID} from 'node:crypto';
import {validateWallet,resolveWallet} from '../src/wallets.mjs';
import {validateProfile,engines} from '../src/miners.mjs';
export {engines};
const normalize=name=>name.trim().toLocaleLowerCase('hu');
export const emptyLibrary=()=>({wallets:[],profiles:[],assignments:[]});
export function publicLibrary(library,farmId){return {wallets:library.wallets.filter(w=>w.farmId===farmId),profiles:library.profiles.filter(p=>p.farmId===farmId).map(({passwordCipher,...p})=>({...p,passwordConfigured:true})),assignments:library.assignments.filter(a=>a.farmId===farmId),engines};}
export function saveFarmWallet(library,farmId,input){
 const previous=input.id?library.wallets.find(w=>w.id===input.id&&w.farmId===farmId):null;
 if(input.id&&!previous)throw Error('Ismeretlen farmwallet.');
 const wallet={...validateWallet({...input,id:previous?.id||randomUUID()}),farmId,revision:(previous?.revision||0)+1};
 if(library.wallets.some(w=>w.farmId===farmId&&w.id!==wallet.id&&(normalize(w.name)===normalize(wallet.name)||(wallet.externalId&&wallet.externalId===w.externalId))))throw Error('Létező walletnév vagy külső azonosító.');
 if(library.wallets.filter(w=>w.farmId===farmId).length>=200&&!previous)throw Error('Legfeljebb 200 wallet lehet egy farmban.');
 return {...library,wallets:previous?library.wallets.map(w=>w.id===wallet.id?wallet:w):[...library.wallets,wallet]};
}
export function saveFarmProfile(library,farmId,input,encrypt,decrypt){
 const previous=input.id?library.profiles.find(p=>p.id===input.id&&p.farmId===farmId):null;if(input.id&&!previous)throw Error('Ismeretlen flight sheet.');
 const wallets=library.wallets.filter(w=>w.farmId===farmId);if(!wallets.some(w=>w.id===input.walletId))throw Error('Válassz walletet ebből a farmból.');
 const worker=input.worker||'%WORKER_NAME%',password=input.password===undefined?(previous?decrypt(previous.passwordCipher):'x'):input.password;
 const profile=validateProfile(resolveWallet({...input,id:previous?.id||randomUUID(),password,worker:worker==='%WORKER_NAME%'?'rig-01':worker},wallets),{maxThreads:1024});
 if(library.profiles.some(p=>p.farmId===farmId&&p.id!==profile.id&&normalize(p.name)===normalize(profile.name)))throw Error('Létező flight sheet név.');
 if(library.profiles.filter(p=>p.farmId===farmId).length>=200&&!previous)throw Error('Legfeljebb 200 flight sheet lehet egy farmban.');
 const {password:secret,...clean}=profile;
 const stored={...clean,worker,farmId,passwordCipher:encrypt(secret),revision:(previous?.revision||0)+1,updatedAt:new Date().toISOString()};
 return {...library,profiles:previous?library.profiles.map(p=>p.id===stored.id?stored:p):[...library.profiles,stored]};
}
export function removeFarmItem(library,farmId,kind,id){
 if(!['wallets','profiles'].includes(kind)||!library[kind].some(item=>item.farmId===farmId&&item.id===id))throw Error('Ismeretlen bejegyzés.');
 if(kind==='wallets'&&library.profiles.some(p=>p.walletId===id))throw Error('Ezt a walletet flight sheet használja. Előbb módosítsd a flight sheetet.');
 return {...library,[kind]:library[kind].filter(item=>!(item.farmId===farmId&&item.id===id))};
}
export function deployment(library,farmId,profileId,rig,decrypt){
 const stored=library.profiles.find(p=>p.id===profileId&&p.farmId===farmId);if(!stored||rig.farmId!==farmId)throw Error('A flight sheet és a munkás ugyanahhoz a farmhoz tartozzon.');
 const wallet=library.wallets.find(w=>w.id===stored.walletId&&w.farmId===farmId);if(!wallet)throw Error('A wallet nem található.');
 const worker=stored.worker==='%WORKER_NAME%'?rig.name.replace(/[^\w.-]/g,'_').replace(/^-+/,'_').slice(0,64):stored.worker;
 const resolved=resolveWallet({...stored,worker,password:decrypt(stored.passwordCipher)},[wallet]);
 // The worker needs a self-contained snapshot, not a reference to a central-only wallet ID.
 const profile=validateProfile({...resolved,walletId:'',walletTemplate:'%WAL%'},{maxThreads:1024});
 return {profile,assignment:{farmId,rigId:rig.id,profileId,profileRevision:stored.revision,walletRevision:wallet.revision,appliedAt:new Date().toISOString()}};
}
