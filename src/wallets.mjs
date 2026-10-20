export function validateWallet(w){
 const clean=(v,max)=>typeof v==='string'&&v.length<=max&&!/[\x00-\x1f]/.test(v);
 if(!w||typeof w.id!=='string'||!/^[-\w]{1,64}$/.test(w.id)||!clean(w.name,80)||!w.name.trim()||!clean(w.coin,32)||!w.coin.trim()||!clean(w.address,512)||!w.address.trim()||w.address.startsWith('-')||/%[A-Z_]+%/.test(w.address))throw Error('Adj meg nevet, coint/hálózatot és walletcímet vagy poolfiókot.');
 const externalId=w.externalId??'';if(typeof externalId!=='string'||!/^\d{0,32}$/.test(externalId))throw Error('A külső wal_id csak számjegyeket tartalmazhat.');
 return {id:w.id,name:w.name.trim(),coin:w.coin.trim(),address:w.address.trim(),externalId};
}
export function resolveWallet(profile,wallets){
 if(!profile.walletId)return profile;const wallet=wallets.find(w=>w.id===profile.walletId);if(!wallet)throw Error('A profilhoz tartozó wallet nem található.');
 const template=profile.walletTemplate||'%WAL%';return {...profile,wallet:template.replaceAll('%WAL%',wallet.address).replaceAll('%WORKER_NAME%',profile.worker)};
}
