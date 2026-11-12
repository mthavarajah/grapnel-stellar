import {z} from 'zod';
import {GrapnelError} from '@grapnel/contracts';
import {HL_INFO,HL_RPC,type ExecutionTransport} from '../../adapters/hyperliquid/execution/types.js';
import {freshReceipt} from '../../adapters/hyperliquid/execution/guards.js';
const decimal=z.string().max(80).regex(/^(0|[1-9]\d*)(\.\d+)?$/),signed=z.string().max(80).regex(/^-?(0|[1-9]\d*)(\.\d+)?$/);
const position=z.object({type:z.literal('oneWay'),position:z.object({coin:z.string().max(128),szi:signed,entryPx:decimal.nullable(),unrealizedPnl:signed,leverage:z.object({value:z.number().int().positive(),type:z.enum(['cross','isolated'])}).passthrough()}).passthrough()});
const state=z.object({time:z.number().int().safe(),withdrawable:decimal,marginSummary:z.object({accountValue:decimal}).passthrough(),assetPositions:z.array(position).max(10000)}).passthrough();
/** Customer-owned account data only; source balances are not CCTP completion. */
export class PerpetualAccountReader {
 constructor(private transport:ExecutionTransport,private now=Date.now){}
 async read(address:`0x${string}`){
  const request={jsonrpc:'2.0' as const,id:1 as const,method:'eth_chainId' as const,params:[] as []};
  const network=freshReceipt(await this.transport.rpc(HL_RPC,request),HL_RPC,request,this.now());
  if(!z.object({jsonrpc:z.literal('2.0'),id:z.literal(1),result:z.literal('0x3e6')}).strict().safeParse(network).success)throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','The trading network could not be verified');
  const rows=await Promise.all(['','xyz'].map(async dex=>{
   const query={type:'clearinghouseState',user:address,...dex?{dex}:{}};
   const parsed=state.parse(freshReceipt(await this.transport.info(HL_INFO,query),HL_INFO,query,this.now()));
   if(parsed.time>this.now()+1000||this.now()-parsed.time>5000)throw new GrapnelError(503,'PROVIDER_UNAVAILABLE','Trading balances are out of date');
   return {dex,withdrawable:parsed.withdrawable,accountValue:parsed.marginSummary.accountValue,positions:parsed.assetPositions.map(row=>({symbol:row.position.coin,size:row.position.szi,entry_price:row.position.entryPx,unrealized_pnl:row.position.unrealizedPnl,leverage:row.position.leverage.value}))};
  }));
  return {network:'hyperliquid-testnet' as const,venues:rows,positions:rows.flatMap(row=>row.positions),as_of:new Date(this.now()).toISOString()};
 }
}
