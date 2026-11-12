import{z}from'zod';
import{GrapnelError}from'@grapnel/contracts';
import{HL_RPC,HL_INFO,HL_EXCHANGE,type ExecutionTransport,type ReadReceipt}from'./types.js';
import{address,cloid,decimal,stable,units,wireSchema}from'./guards.js';
const MAX_RESPONSE=1024*1024,MAX_REQUEST=64*1024,TIMEOUT=15000;
const transportError=()=>new GrapnelError(503,'HYPERLIQUID_TESTNET_TRANSPORT_UNAVAILABLE','The Testnet execution source is unavailable',true,{});
const dex=z.literal('xyz').optional(),user=address;
const infoSchema=z.union([
 z.object({type:z.literal('perpDexs')}).strict(),
 z.object({type:z.literal('metaAndAssetCtxs'),dex}).strict(),
 z.object({type:z.literal('clearinghouseState'),user,dex}).strict(),
 z.object({type:z.literal('activeAssetData'),user,coin:z.string().min(1).max(100)}).strict(),
 z.object({type:z.literal('orderStatus'),user,oid:cloid}).strict(),
 z.object({type:z.literal('userFillsByTime'),user,startTime:z.number().int().nonnegative().safe(),endTime:z.number().int().nonnegative().safe(),aggregateByTime:z.literal(false)}).strict(),
]);
const exchangeSchema=wireSchema.extend({action:z.object({type:z.literal('order'),orders:z.array(z.object({a:z.number().int().nonnegative().safe(),b:z.boolean(),p:decimal,s:decimal,r:z.boolean(),t:z.object({limit:z.object({tif:z.literal('Ioc')}).strict()}).strict(),c:cloid}).strict()).length(1),grouping:z.literal('na')}).strict()}).strict();
/** Explicit opt-in HTTP transport; construction does nothing and never broadcasts automatically. */
export class HyperliquidTestnetHttpTransport implements ExecutionTransport{
 constructor(private readonly options:{fetch?:typeof fetch;now?:()=>number}={}){}
 private async post(endpoint:typeof HL_RPC|typeof HL_INFO|typeof HL_EXCHANGE,request:unknown):Promise<ReadReceipt>{
  const body=JSON.stringify(request);if(Buffer.byteLength(body,'utf8')>MAX_REQUEST)throw transportError();
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(transportError());},TIMEOUT);});
  try{return await Promise.race([timeout,(async()=>{
   const response=await(this.options.fetch??globalThis.fetch)(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body,redirect:'error',cache:'no-store',signal:controller.signal});
   if(!response.ok||response.redirected||response.url!==endpoint||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??''))throw transportError();
   const length=response.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||BigInt(length)>BigInt(MAX_RESPONSE)))throw transportError();
   const reader=response.body?.getReader();if(!reader)throw transportError();const chunks:Uint8Array[]=[];let count=0;
   try{for(;;){const {done,value}=await reader.read();if(done)break;count+=value.byteLength;if(count>MAX_RESPONSE){await reader.cancel();throw transportError();}chunks.push(value);}}finally{reader.releaseLock();}
   const parsed:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&('error'in parsed||'status'in parsed&&(parsed as{status?:unknown}).status==='err'))throw transportError();
   return{endpoint,request:structuredClone(request),receivedAt:this.options.now?.()??Date.now(),body:parsed};
  })()]);}catch{throw transportError();}finally{if(timer)clearTimeout(timer);controller.abort();}
 }
 async rpc(endpoint:typeof HL_RPC,request:{jsonrpc:'2.0';id:1;method:'eth_chainId';params:[]}):Promise<ReadReceipt>{
  if(endpoint!==HL_RPC||stable(request)!==stable({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]}))throw transportError();return this.post(HL_RPC,structuredClone(request));
 }
 async info(endpoint:typeof HL_INFO,request:Record<string,unknown>):Promise<ReadReceipt>{
  if(endpoint!==HL_INFO||!infoSchema.safeParse(request).success)throw transportError();if(request.type==='userFillsByTime'&&(Number(request.endTime)<Number(request.startTime)||Number(request.endTime)>(this.options.now?.()??Date.now())+1000))throw transportError();return this.post(HL_INFO,structuredClone(request));
 }
 async exchange(endpoint:typeof HL_EXCHANGE,request:unknown):Promise<unknown>{
  const parsed=exchangeSchema.safeParse(request);if(endpoint!==HL_EXCHANGE||!parsed.success||units(parsed.data.action.orders[0]!.p,18)<=0n||units(parsed.data.action.orders[0]!.s,18)<=0n||parsed.data.expiresAfter<=(this.options.now?.()??Date.now())||parsed.data.nonce>(this.options.now?.()??Date.now())+1000||(this.options.now?.()??Date.now())-parsed.data.nonce>60000||parsed.data.expiresAfter>parsed.data.nonce+60000)throw transportError();
  return(await this.post(HL_EXCHANGE,structuredClone(request))).body;
 }
}
