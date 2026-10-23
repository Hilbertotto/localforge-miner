import {randomBytes,randomUUID,createHash,scryptSync,timingSafeEqual} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const digest=value=>createHash('sha256').update(value).digest('hex');
export const publicUser=({id,name,email})=>({id,name,email});
export function passwordRecord(password){if(typeof password!=='string'||password.length<12||password.length>256)throw Error('A jelszó 12–256 karakter legyen.');const salt=randomBytes(16).toString('hex');return {salt,hash:scryptSync(password,salt,32).toString('hex')};}
export function passwordMatches(password,record){return typeof password==='string'&&password.length<=256&&timingSafeEqual(scryptSync(password,record.salt,32),Buffer.from(record.hash,'hex'));}
export function registration(input){
 const email=typeof input.email==='string'?input.email.trim().toLowerCase():'';
 if(email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Érvényes e-mail-cím szükséges.');
 if(typeof input.name!=='string'||!input.name.trim()||input.name.length>80||/[\x00-\x1f]/.test(input.name))throw Error('Név szükséges, legfeljebb 80 karakterrel.');
 const token=randomBytes(32).toString('hex');
 return {user:{id:randomUUID(),name:input.name.trim(),email,createdAt:new Date().toISOString(),...passwordRecord(input.password),verified:false,verificationHash:digest(token),verificationExpires:Date.now()+86400000},token};
}
export function verifyUser(users,token){
 if(typeof token!=='string'||! /^[a-f0-9]{64}$/.test(token))throw Error('Érvénytelen megerősítő link.');
 const user=users.find(u=>u.verificationHash===digest(token)&&u.verificationExpires>Date.now()&&!u.verified&&!u.suspended&&!u.deletedAt);
 if(!user)throw Error('A megerősítő link lejárt vagy már felhasználtad.');
 const {verificationHash,verificationExpires,...verified}=user;return {...verified,verified:true};
}
export function smtpMailer(env=process.env){
 if(!env.LOCALFORGE_SMTP_HOST||!env.LOCALFORGE_SMTP_FROM||!env.LOCALFORGE_CENTRAL_URL)return null;
 const base=new URL(env.LOCALFORGE_CENTRAL_URL);if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash)throw Error('Hibás központi URL.');
 return async({email,name,token})=>{
  const payload={host:env.LOCALFORGE_SMTP_HOST,port:Number(env.LOCALFORGE_SMTP_PORT||587),mode:env.LOCALFORGE_SMTP_MODE||'starttls',username:env.LOCALFORGE_SMTP_USER||'',password:env.LOCALFORGE_SMTP_PASSWORD||'',sender:env.LOCALFORGE_SMTP_FROM,email,name,url:new URL('/?verify='+token,base).href};
  await new Promise((resolve,reject)=>{const child=spawn(env.LOCALFORGE_PYTHON||(process.platform==='win32'?'python':'python3'),[fileURLToPath(new URL('./send-mail.py',import.meta.url))],{stdio:['pipe','ignore','ignore'],windowsHide:true});child.on('error',()=>reject(Error('A levélküldő nem indítható.')));child.on('exit',code=>code===0?resolve():reject(Error('A megerősítő e-mail küldése sikertelen.')));child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(payload));});
 };
}
