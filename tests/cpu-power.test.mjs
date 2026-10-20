import test from 'node:test';
import assert from 'node:assert/strict';
import {CpuPowerReader} from '../src/cpu-power.mjs';
test('CPU energia két mintájából watt, számláló átfordulása kezelve',async()=>{
 let energy=900000000,time=0;
 const reader=new CpuPowerReader({list:async()=>['intel-rapl:0','intel-rapl:0:0'],clock:()=>time,read:async file=>file.endsWith('/name')?'package-0':file.endsWith('/max_energy_range_uj')?'1000000000':String(energy)});
 assert.equal((await reader.read()).watts,null);energy=400000000;time=5000;const result=await reader.read();assert.equal(result.available,true);assert.equal(result.watts,100);
});
test('hiányzó vagy érvénytelen CPU-szenzor nem ad hamis nullás vagy NaN fogyasztást',async()=>{
 const missing=new CpuPowerReader({list:async()=>{throw Error('unavailable');}});assert.equal((await missing.read()).watts,null);
 const invalid=new CpuPowerReader({list:async()=>['intel-rapl:0'],read:async p=>p.endsWith('/name')?'package-0':'N/A'});await invalid.read();assert.equal((await invalid.read()).available,false);
});
