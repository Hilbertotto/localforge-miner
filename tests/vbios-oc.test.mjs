import {test} from 'node:test';
import assert from 'node:assert/strict';
import {migratePresets,updatePreset,resolvePresetOc} from '../src/vbios-oc.mjs';
const gpu=(uuid,extra={})=>({uuid,vbios:'94.04.57.00.08',pciDeviceId:'10DE:24B0',pciSubsystemId:'10DE:14AD',total:'16376',...extra});
test('VBIOS presets follow compatible replacement cards independent of UUID and slot order',()=>{
 const cards=[gpu('original-a'),gpu('original-b')],commands=cards.map(g=>({uuid:g.uuid,action:'power',value:140}));let presets=migratePresets([],cards,commands);assert.equal(presets.length,1);assert.deepEqual(presets[0].settings,[{action:'power',value:140}]);
 presets=updatePreset(presets,cards[0],{action:'fan',value:80});const resolved=resolvePresetOc(presets,[gpu('new-b'),gpu('new-a')],[],true);assert.equal(resolved.length,4);assert.ok(resolved.some(c=>c.uuid==='new-a'&&c.action==='power'&&c.value===140));
 assert.throws(()=>resolvePresetOc(presets,[gpu('other',{pciDeviceId:'10DE:2206'})],[],true));assert.throws(()=>resolvePresetOc(presets,[gpu('other',{total:10240})],[],true));assert.throws(()=>resolvePresetOc(presets,[gpu('other',{vbios:'95.00.00.00.01'})],[],true));
});
test('migration does not guess between conflicting old card settings; reset clears clock/power template only',()=>{
 const cards=[gpu('a'),gpu('b')];assert.equal(migratePresets([],cards,[{uuid:'a',action:'power',value:130},{uuid:'b',action:'power',value:140}]).length,0);
 let presets=updatePreset([],cards[0],{action:'power',value:140});presets=updatePreset(presets,cards[0],{action:'fan',value:100});presets=updatePreset(presets,cards[0],{action:'reset'});assert.deepEqual(presets[0].settings,[{action:'fan',value:100}]);
});

test('signed offsets retain zero, restore per compatible GPU and reset without losing fan',()=>{let p=updatePreset([],gpu('old'),{action:'core-offset',value:0});p=updatePreset(p,gpu('old'),{action:'memory-offset',value:-200});assert.equal(resolvePresetOc(p,[gpu('new')])[0].value,0);assert.equal(resolvePresetOc(p,[gpu('new')])[1].value,-200);assert.throws(()=>updatePreset(p,gpu('old'),{action:'core-offset',value:1001}));p=updatePreset(p,gpu('old'),{action:'reset'});assert.equal(p[0].settings.length,0);});
