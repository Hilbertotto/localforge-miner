import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {AppUpdates,newerVersion} from '../src/app-updates.mjs';
test('stable version comparison does not offer downgrade or equal version',()=>{assert(newerVersion('v0.4.0','0.3.0'));assert(!newerVersion('v0.3.0','0.4.0'));assert(!newerVersion('v0.4.0','0.4.0'));assert.throws(()=>newerVersion('main','0.4.0'));});
test('check and apply require a complete stable release; errors cannot trigger a root update',async t=>{const dataDir=await mkdtemp(path.join(os.tmpdir(),'lf-updates-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));let starts=0,release={tag_name:'v0.4.0',assets:[{name:'localforge-v0.4.0.tar.gz'},{name:'SHA256SUMS'}]};const updates=new AppUpdates({dataDir,current:'0.3.0',fetcher:async()=>({ok:true,json:async()=>release}),startUpdate:async()=>starts++,stateFile:path.join(dataDir,'absent')});assert.equal((await updates.check()).available,true);await updates.apply();assert.equal(starts,1);release={...release,prerelease:true};assert((await updates.check()).error);await assert.rejects(updates.apply());assert.equal(starts,1);});
