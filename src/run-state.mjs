import {readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
export class RunState{
 constructor(dataDir){this.file=path.join(dataDir,'running-profiles.json');this.ids=new Set();}
 async load(){try{const saved=JSON.parse(await readFile(this.file,'utf8'));if(saved.schema!==1||!Array.isArray(saved.ids)||saved.ids.some(id=>typeof id!=='string'||!/^[-\w]{1,64}$/.test(id)))throw Error('Hibás formátum.');this.ids=new Set(saved.ids);}catch(e){if(e.code!=='ENOENT')throw Error(`A visszaindítási állapot nem olvasható: ${e.message}`);}}
 async set(id,enabled){if(this.ids.has(id)===enabled)return;const next=new Set(this.ids);if(enabled)next.add(id);else next.delete(id);await writeFile(this.file+'.tmp',JSON.stringify({schema:1,ids:[...next]},null,2),{mode:0o600});await rename(this.file+'.tmp',this.file);this.ids=next;}
}
