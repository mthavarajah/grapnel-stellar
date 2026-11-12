import{z}from'zod';
import type{PerpetualExecutionStatus}from'../../../modules/perpetuals/execution-contract.js';
import type{HyperliquidExecutionDependencies}from'./types.js';
import{decimal,signedDecimal,units,normalize,fromUnits,fail,type ExecutionPayload}from'./guards.js';
import{info,position}from'./reads.js';
export const unknown=(clientOrderId:string,rawStatus='RECONCILIATION_PROOF_REQUIRED'):PerpetualExecutionStatus=>({state:'unknown',orderId:null,clientOrderId,filledSize:'0',averagePrice:null,fillIds:[],rawStatus});
const order=z.object({coin:z.string(),side:z.enum(['A','B']),limitPx:decimal,sz:decimal,origSz:decimal,oid:z.number().int().positive().safe(),cloid:z.string(),timestamp:z.number().int().positive().safe(),reduceOnly:z.boolean(),orderType:z.string()}).passthrough();
const fill=z.object({coin:z.string(),px:decimal,sz:decimal,side:z.enum(['A','B']),time:z.number().int().positive().safe(),startPosition:signedDecimal,hash:z.string().regex(/^0x[a-fA-F0-9]{64}$/),oid:z.number().int().positive().safe(),tid:z.number().int().nonnegative().safe(),cloid:z.string().optional()}).passthrough();
export async function inspectSettlement(d:HyperliquidExecutionDependencies,p:ExecutionPayload):Promise<PerpetualExecutionStatus>{
 const i=p.intent,now=d.now?.()??Date.now(),[statusRaw,fillsRaw,current]=await Promise.all([info(d,{type:'orderStatus',user:i.accountAddress,oid:i.clientOrderId}),info(d,{type:'userFillsByTime',user:i.accountAddress,startTime:p.before.observedAt,endTime:now,aggregateByTime:false}),position(d,i as never)]);
 if(z.object({status:z.literal('unknownOid')}).strict().safeParse(statusRaw).success)return unknown(i.clientOrderId,'UNKNOWN_CLIENT_ORDER_ID');
 const status=z.object({status:z.literal('order'),order:z.object({order,status:z.string(),statusTimestamp:z.number().int().positive().safe()}).passthrough()}).strict().parse(statusRaw),o=status.order.order,stage=status.order.status;
 if(o.coin!==i.providerSymbol||o.side!==(i.side==='buy'?'B':'A')||normalize(o.limitPx)!==normalize(i.limitPrice)||normalize(o.origSz)!==normalize(i.size)||o.cloid!==i.clientOrderId||o.reduceOnly!==i.reduceOnly||o.orderType!=='Limit'||o.timestamp<i.nonce||o.timestamp>p.wire.expiresAfter||status.order.statusTimestamp<o.timestamp||status.order.statusTimestamp>now+1000)return fail('PROVIDER_ORDER_IDENTITY_MISMATCH');
 const all=z.array(fill).max(1999).parse(fillsRaw),matched=all.filter(f=>f.oid===o.oid||f.cloid===i.clientOrderId),ids=new Set<number>();let cumulative=0n,weighted=0n,expected=units(p.before.size,p.market.szDecimals,true);const requested=units(i.size,p.market.szDecimals),side=i.side==='buy'?1n:-1n;
 if(all.some(f=>f.coin===i.providerSymbol&&f.time>=p.before.observedAt&&!matched.includes(f)))return fail('CONCURRENT_POSITION_CHANGE');
 matched.sort((a,b)=>a.time-b.time||a.tid-b.tid);
 for(const f of matched){if(f.coin!==i.providerSymbol||f.oid!==o.oid||f.cloid!==undefined&&f.cloid!==i.clientOrderId||f.side!==o.side||f.time<i.nonce||f.time>p.wire.expiresAfter||f.time>now+1000||ids.has(f.tid)||units(f.startPosition,p.market.szDecimals,true)!==expected)return fail('EXACT_FILL_CAUSALITY');ids.add(f.tid);const size=units(f.sz,p.market.szDecimals),price=units(f.px,18),limit=units(i.limitPrice,18);if(size<=0n||price<=0n||i.side==='buy'&&price>limit||i.side==='sell'&&price<limit)return fail('APPROVED_FILL_LIMIT');cumulative+=size;weighted+=price*size;expected+=side*size;if(cumulative>requested)return fail('EXCESS_FILL_SIZE');}
 if(units(current.size,p.market.szDecimals,true)!==expected||current.leverageType!==p.before.leverageType)return fail('ACTUAL_POSITION_DELTA_REQUIRED');
 const common={orderId:String(o.oid),clientOrderId:i.clientOrderId,filledSize:fromUnits(cumulative,p.market.szDecimals),averagePrice:cumulative?fromUnits(weighted/cumulative,18):null,fillIds:[...ids].map(String),rawStatus:stage};
 if(stage==='filled')return cumulative===requested?{...common,state:'filled'}:unknown(i.clientOrderId,'FULL_FILL_PROOF_REQUIRED');
 if(stage==='open')return unknown(i.clientOrderId,'IOC_NOT_TERMINAL_NO_RESTING_SUPPORT');
 if(stage==='canceled'||stage.endsWith('Canceled'))return{...common,state:cumulative?'cancelled':'no_fill',rawStatus:cumulative?'PARTIAL_IOC_'+stage:stage};
 if(stage.endsWith('Rejected')||stage==='rejected')return cumulative?unknown(i.clientOrderId,'REJECTED_ORDER_HAS_FILLS'):{...common,state:stage==='iocCancelRejected'?'no_fill':'rejected'};
 return unknown(i.clientOrderId,'UNRECOGNIZED_TERMINAL_STATUS');
}
