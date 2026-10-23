import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pciAddress,readGpuIdentity} from '../src/gpu-identity.mjs';
test('PCI subsystem pair is vendor:device and is matched by full normalized bus address',async()=>{
 const rom=Buffer.alloc(512);rom[0]=0x55;rom[1]=0xaa;
 const files={vendor:'0x10de',device:'0x2482',subsystem_vendor:'0x1569',subsystem_device:'0x3901',mem_info_vram_vendor:'micron',rom};
 const identity=await readGpuIdentity('00000000:25:00.0',{pciRoot:'/pci',reader:async file=>{assert.ok(file.startsWith(path.join('/pci','0000:25:00.0')));return files[path.basename(file)];}});
 assert.equal(identity.pciSubsystemId,'1569:3901');assert.equal(identity.pciDeviceId,'10DE:2482');assert.equal(identity.memoryVendor,'micron');assert.equal(identity.memoryType,null);assert.equal(identity.biosHash,createHash('sha256').update(rom).digest('hex'));
});
test('missing ROM or unsupported metadata stays unavailable and paths cannot escape PCI root',async()=>{
 const identity=await readGpuIdentity('0000:26:00.0',{reader:async()=>{throw Error('EACCES');}});assert.equal(identity.biosHash,null);assert.equal(identity.pciSubsystemId,null);
 assert.equal(pciAddress('../../etc/passwd'),null);assert.equal(pciAddress('00010000:25:00.0'),null);let called=false;await readGpuIdentity('../../etc/passwd',{reader:async()=>{called=true;}});assert.equal(called,false);
});
