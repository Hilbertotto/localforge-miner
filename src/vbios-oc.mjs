const actions=['power','core','memory','fan','fan-auto','core-offset','memory-offset'];
const family=action=>action.startsWith('fan')?'fan':action;
export function gpuPresetIdentity(gpu){
 if(typeof gpu.vbios!=='string'||! /^[0-9a-f.]{4,64}$/i.test(gpu.vbios)||! /^[0-9a-f]{4}:[0-9a-f]{4}$/i.test(gpu.pciDeviceId||'')||! /^[0-9a-f]{4}:[0-9a-f]{4}$/i.test(gpu.pciSubsystemId||'')||!Number.isInteger(Number(gpu.total))||Number(gpu.total)<1)return null;
 return {vbios:gpu.vbios.toUpperCase(),pciDeviceId:gpu.pciDeviceId.toUpperCase(),pciSubsystemId:gpu.pciSubsystemId.toUpperCase(),memoryMiB:Math.round(Number(gpu.total)/256)*256};
}
export const presetKey=identity=>[identity.vbios,identity.pciDeviceId,identity.pciSubsystemId,identity.memoryMiB].join('|');
export function validatePresets(input=[]){
 if(!Array.isArray(input)||input.length>64)throw Error('Hibás VBIOS OC-tár.');
 return input.map(p=>{const identity=gpuPresetIdentity({...p,total:p.memoryMiB});if(!identity||!Array.isArray(p.settings)||p.settings.length>6)throw Error('Hibás VBIOS OC-sablon.');const seen=new Set();const settings=p.settings.map(s=>{if(!actions.includes(s.action)||seen.has(family(s.action))||(s.action!=='fan-auto'&&(!Number.isInteger(s.value)||s.value<(s.action==='core-offset'?-1000:s.action==='memory-offset'?-2000:s.action==='fan'?30:1)||s.value>(s.action==='core-offset'?1000:s.action==='memory-offset'?6000:s.action==='fan'?100:30000))))throw Error('Hibás VBIOS OC-érték.');seen.add(family(s.action));return {action:s.action,...(s.action==='fan-auto'?{}:{value:s.value})};});return {...identity,settings};});
}
export function updatePreset(presets,gpu,command){
 const identity=gpuPresetIdentity(gpu);if(!identity)return presets;const key=presetKey(identity),old=presets.find(p=>presetKey(p)===key),settings=(old?.settings||[]).filter(s=>command.action==='reset'?!['power','core','memory','core-offset','memory-offset'].includes(s.action):family(s.action)!==family(command.action));
 if(command.action!=='reset')settings.push({action:command.action,...(command.action==='fan-auto'?{}:{value:command.value})});
 return validatePresets([...presets.filter(p=>presetKey(p)!==key),{...identity,settings}]);
}
export function migratePresets(presets,gpus,commands){
 let next=[...presets];const groups=new Map();for(const gpu of gpus){const identity=gpuPresetIdentity(gpu);if(!identity)continue;const key=presetKey(identity);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(gpu);}
 for(const group of groups.values()){const identity=gpuPresetIdentity(group[0]),existing=next.find(p=>presetKey(p)===presetKey(identity));for(const kind of ['power','core','memory','fan','core-offset','memory-offset']){if(existing?.settings.some(s=>family(s.action)===kind))continue;const matches=group.map(g=>commands.find(c=>c.uuid===g.uuid&&family(c.action)===kind));if(matches.every(Boolean)&&matches.every(c=>c.action===matches[0].action&&c.value===matches[0].value))next=updatePreset(next,group[0],matches[0]);}}
 return next;
}
export function resolvePresetOc(presets,gpus,fallback=[],strict=false){
 const commands=[];for(const preset of validatePresets(presets)){const matches=gpus.filter(g=>{const identity=gpuPresetIdentity(g);return identity&&presetKey(identity)===presetKey(preset);});if(strict&&preset.settings.length&&!matches.length)throw Error('A mentett VBIOS-hoz és hardvertípushoz nincs illeszkedő GPU.');for(const gpu of matches)for(const setting of preset.settings)commands.push({uuid:gpu.uuid,...setting});}
 for(const command of fallback){if(commands.some(c=>c.uuid===command.uuid&&family(c.action)===family(command.action)))continue;if(gpus.some(g=>g.uuid===command.uuid))commands.push(command);else if(strict&&!presets.length)throw Error('A mentett GPU nem található.');}
 return commands;
}
