import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
export const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export const secretToken=()=>randomBytes(32).toString('base64url');
export const constantEqual=(left:string,right:string)=>timingSafeEqual(Buffer.from(digest(left),'hex'),Buffer.from(digest(right),'hex'));
export const csrfToken=(token:string,secret:string)=>createHmac('sha256',secret).update('grapnel-owner-csrf:'+token).digest('base64url');
export function canonicalJson(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';
 if(value && typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonicalJson(v)).join(',')+'}';
 return JSON.stringify(value);
}
