const rate=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
export function normalizeCpu(summary,backends){
 if(!Array.isArray(backends))throw Error('Hibás XMRig backend-válasz.');
 const cpu=backends.find(b=>b.type==='cpu');
 if(!cpu)throw Error('Nincs CPU backend az API-válaszban.');
 const total=summary.hashrate?.total;
 return {available:true,version:typeof summary.version==='string'?summary.version:null,algorithm:summary.algo||null,total:rate(total?.[0]),average60:rate(total?.[1]),average15m:rate(total?.[2]),accepted:rate(summary.results?.shares_good),submitted:rate(summary.results?.shares_total),threads:(Array.isArray(cpu.threads)?cpu.threads:[]).map((thread,index)=>({index,affinity:Number.isInteger(thread.affinity)&&thread.affinity>=0?thread.affinity:null,hashrate:rate(thread.hashrate?.[0]),average60:rate(thread.hashrate?.[1]),average15m:rate(thread.hashrate?.[2])}))};
}
export async function readCpu(api,fetcher=fetch){
 const get=async endpoint=>{const r=await fetcher(`http://127.0.0.1:18088/2/${endpoint}`,{headers:{Authorization:`Bearer ${api.token}`},signal:AbortSignal.timeout(1800)});if(!r.ok)throw Error(`XMRig API: HTTP ${r.status}`);return r.json();};
 try{const [summary,backends]=await Promise.all([get('summary'),get('backends')]);if(summary.id!==api.id)throw Error('Másik XMRig-példány használja az API-portot.');return normalizeCpu(summary,backends);}catch(e){return {available:false,error:`A hashrate még nem érhető el: ${e.message}`,total:null,threads:[]};}
}
