import {test} from 'node:test';
import assert from 'node:assert/strict';
import {srbAlgorithms} from '../src/srb-algorithms.mjs';
import {engines,validateProfile,command} from '../src/miners.mjs';

test('SRBMiner catalog exposes the installed 66 algorithms and all 34 GPU algorithms',()=>{
 assert.equal(srbAlgorithms.length,66);
 assert.equal(new Set(srbAlgorithms.map(a=>a.id)).size,66);
 assert.equal(engines.srbminer.algorithms.length,34);
 for(const algorithm of engines.srbminer.algorithms){
  const profile=validateProfile({id:'test',name:'Test',engine:'srbminer',algorithm,pool:'pool.example:443',wallet:'account',password:'x',worker:'rig',tls:true,devices:'0'});
  assert.equal(command(profile).args[2],algorithm);
 }
 for(const algorithm of ['quantus','pearlhash','xelishashv3','yespower','xhash'])assert.ok(engines.srbminer.algorithms.includes(algorithm));
 for(const algorithm of ['sha3t','blake3_an','argon2id_exfer'])assert.ok(!srbAlgorithms.some(a=>a.id===algorithm));
 assert.ok(srbAlgorithms.find(a=>a.id==='randomx').cpu);
 assert.ok(!engines.srbminer.algorithms.includes('randomx'));
});
