import {readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {validateBackup} from '../src/worker-backup.mjs';
export class BackupStore{
 constructor(directory,encrypt,decrypt){Object.assign(this,{directory,encrypt,decrypt});}
 file(id){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Hibás munkásazonosító.');return path.join(this.directory,'worker-backup-'+id+'.json');}
 async versions(id){try{return JSON.parse(await readFile(this.file(id),'utf8')).versions;}catch(e){if(e.code==='ENOENT')return [];throw e;}}
 summary(version){if(!version)return null;const {cipher,digest,...publicData}=version;return publicData;}
 async latest(id){return (await this.versions(id))[0]||null;}
 async put(id,input){const backup=validateBackup(input),text=JSON.stringify(backup),digest=createHash('sha256').update(text).digest('hex'),versions=await this.versions(id);if(versions[0]?.digest===digest)return this.summary(versions[0]);const version={id:randomUUID(),createdAt:new Date().toISOString(),digest,cipher:this.encrypt(text),profiles:backup.profiles.length,wallets:backup.wallets.length,oc:backup.oc.length};const file=this.file(id);await writeFile(file+'.tmp',JSON.stringify({schema:1,versions:[version,...versions].slice(0,3)},null,2),{mode:0o600});await rename(file+'.tmp',file);return this.summary(version);}
 decode(version){return validateBackup(JSON.parse(this.decrypt(version.cipher)));}
}
