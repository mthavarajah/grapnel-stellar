import {invalid,unsigned} from './policy.js';
/** Private durable snapshots retain integer types without exposing protocol records to the browser. */
export function encodePrivate(value:unknown):unknown{return JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='bigint'?{$bigint:v.toString()}:v));}
export function decodePrivate(value:unknown):unknown{
 if(Array.isArray(value))return value.map(decodePrivate);
 if(value&&typeof value==='object'){
  const row=value as Record<string,unknown>;
  if(Object.keys(row).length===1&&Object.hasOwn(row,'$bigint'))return unsigned(row.$bigint);
  if(row.type==='Buffer'&&Array.isArray(row.data)){
   if(row.data.length!==32||row.data.some(v=>!Number.isInteger(v)||v<0||v>255))return invalid('PRIVATE_BUFFER');return Buffer.from(row.data as number[]);
  }
  return Object.fromEntries(Object.entries(row).map(([k,v])=>[k,decodePrivate(v)]));
 }
 return value;
}
