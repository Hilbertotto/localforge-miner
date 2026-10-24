import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';

test('miner creates valid unique wallet/profile IDs without secure-context randomUUID',async()=>{
 const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 const helper=source.split('\n')[0];
 const create=runInNewContext(helper+';newLocalId',{crypto:{getRandomValues:array=>webcrypto.getRandomValues(array)}});
 const ids=Array.from({length:100},()=>create());
 assert.equal(new Set(ids).size,100);
 for(const id of ids)assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 assert.ok(source.includes('f.elements.id.value=w?.id||newLocalId()'));
 assert.ok(source.includes('f.elements.id.value=p?.id||newLocalId()'));
});
