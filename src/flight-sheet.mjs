import {randomUUID} from 'node:crypto';
import {validateProfile,engines} from './miners.mjs';
export function importFlightSheet({sheet,wallet,worker,devices},wallets=[]){
 if(!sheet||!Array.isArray(sheet.items)||sheet.items.length!==1)throw Error('Egy importálásban pontosan egy items-bejegyzés legyen.');
 const item=sheet.items[0],cfg=item?.miner_config;
 const mapped=wallets.find(w=>w.externalId&&w.externalId===String(item?.wal_id));
 const selected=wallets.find(w=>w.id===wallet)||(!wallet?mapped:null);
 if(selected)wallet=selected.address;
 if(!cfg||typeof cfg!=='object'||!Object.hasOwn(engines,item.miner))throw Error('Nem támogatott miner vagy hiányzó miner_config.');
 if(typeof item.pool_ssl!=='boolean')throw Error('A pool_ssl logikai érték legyen.');
 if(cfg.dalgo||cfg.durl||cfg.dual_algo||cfg.dual_url)throw Error('Dual mining importálása még nem támogatott.');
 if(typeof wallet!=='string'||!wallet.trim())throw Error('Add meg a walletcímet vagy poolfiókot. A wal_id külső azonosító, itt nem oldható fel.');
 if(typeof worker!=='string'||!worker.trim())throw Error('Add meg a worker nevét a sablonváltozó helyére.');
 const fill=value=>String(value).replaceAll('%WAL%',wallet.trim()).replaceAll('%WORKER_NAME%',worker);
 const template=cfg.template||'%WAL%';if(typeof template!=='string'||typeof cfg.url!=='string'||typeof cfg.algo!=='string')throw Error('Hibás template, url vagy algo.');
 const p=validateProfile({id:randomUUID(),name:sheet.name||`${item.coin||'GPU'} profil`,engine:item.miner,algorithm:cfg.algo,pool:cfg.url,wallet:fill(template),walletId:selected?.id||'',walletTemplate:template,password:cfg.pass??'x',worker:fill(cfg.worker||'%WORKER_NAME%'),tls:item.pool_ssl,threads:1,devices});
 return {profile:p,note:'Importálva előnézetbe. Ellenőrizd a mezőket, majd mentsd. A wal_id nem került átvételre; a devices a miner saját eszközsorszáma.'};
}
