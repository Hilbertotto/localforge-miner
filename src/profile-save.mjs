import {randomUUID} from 'node:crypto';
import {validateProfile} from './miners.mjs';
import {resolveWallet} from './wallets.mjs';

export async function saveProfile({data,profiles,wallets,manager,watchdog,runState,restorePending,restoreErrors,save}){
 const mode=data.saveMode??'update';if(!['update','copy'].includes(mode))throw Error('Mentési mód: update vagy copy.');
 const previous=profiles.find(p=>p.id===(mode==='copy'?(data.sourceId||data.id):data.id));
 if(mode==='copy'&&!previous)throw Error('A másolás forrásprofilja nem található.');
 const input={...data,id:mode==='copy'?randomUUID():data.id,password:Object.hasOwn(data,'password')?data.password:previous?.password};
 const profile=validateProfile(resolveWallet(input,wallets));
 const normalize=name=>name.trim().toLocaleLowerCase('hu');
 if(profiles.some(p=>p.id!==profile.id&&normalize(p.name)===normalize(profile.name))){const error=Error('Ezen a néven már van profil. Válassz másik nevet, vagy szerkeszd a meglévő profilt.');error.status=409;throw error;}
 if(profiles.length>=40&&!profiles.some(p=>p.id===profile.id))throw Error('Legfeljebb 40 profil menthető.');
 const running=mode==='update'&&manager.active(profile.id),intent=runState.ids.has(profile.id);
 if(running){manager.checkStart?.(profile,profile.id);await watchdog.guardStart(profile);await runState.set(profile.id,true);}
 const next=mode==='copy'||!previous?[...profiles,profile]:profiles.map(p=>p.id===profile.id?profile:p);
 try{await save(next);}catch(error){if(running&&!intent)await runState.set(profile.id,false);throw error;}
 if(!running)return {ok:true,id:profile.id,mode,applied:false,running:false,message:mode==='copy'?'Új profil mentve. Nem indult el; az eredeti profil nem változott.':'Profil mentve. Nem indult el.'};
 try{
  await manager.stop(profile.id);
  // The temperature may have changed during stop. Never bypass a thermal latch.
  await watchdog.guardStart(profile);
  await manager.start(profile);
  restorePending.delete(profile.id);restoreErrors.delete(profile.id);
  return {ok:true,id:profile.id,mode,applied:true,running:true,message:'Profil mentve; a miner az új beállításokkal visszaindult.'};
 }catch(error){
  let restored=false,rollbackError=null;
  try{
   if(manager.active(profile.id))await manager.stop(profile.id);
   await save(profiles);
   if(!intent)await runState.set(profile.id,false);
   await watchdog.guardStart(previous);await manager.start(resolveWallet(previous,wallets));restored=true;
  }catch(failure){rollbackError=failure;if(runState.ids.has(profile.id)){restorePending.add(profile.id);restoreErrors.set(profile.id,failure.message);}}
  throw Error(`Az új beállítás nem alkalmazható: ${error.message}. ${restored?'A korábbi profil visszaállt és fut.':`A visszaállítás nem sikerült: ${rollbackError?.message||'ismeretlen hiba'}. Ellenőrizd az állapotot; a hővédelmet nem oldottuk fel.`}`);
 }
}
