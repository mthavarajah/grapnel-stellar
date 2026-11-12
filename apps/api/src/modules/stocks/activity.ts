import type {Pool} from 'pg';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {fromAtomic,type CustomerContext} from '@grapnel/contracts';
import {requireBusiness,requireCustomer,success} from '../../lib/context.js';
const symbol=z.enum(['TSLA','AMZN','PLTR','NFLX','AMD']);
export interface StockActivityItem {id:string;kind:'buy'|'sell'|'approval'|'funding';state:string;symbol:string;approval_asset?:string;amount:string|null;paid_amount:string|null;received_amount:string|null;tx_hash:string|null;created_at:string;}
const units=(v:unknown,decimals:number)=>typeof v==='string'&&/^(0|[1-9]\d{0,77})$/.test(v)?fromAtomic(BigInt(v),decimals):null;
/** Durable verified source records, not optimistic fills or locally invented operations. */
export function stockOrderActivity(row:any):StockActivityItem|null{
 const parsed=symbol.safeParse(row.market_id?.split(':')[2]);if(!parsed.success||row.market_id!==`robinhood-testnet:stocks:${parsed.data}`||!['buy','sell'].includes(row.side)||!['approval','swap'].includes(row.kind))return null;
 const i=row.prepared?.intent,p=row.proof,buy=row.side==='buy',confirmed=p?.state==='confirmed'&&p.txHash===row.tx_hash&&/^[1-9]\d*$/.test(p.blockNumber??'')&&/^\d+$/.test(p.confirmations??'')&&BigInt(p.confirmations)>=2n&&(row.kind==='approval'?p.allowanceBaseUnits===i?.amountInBaseUnits:p.amountInBaseUnits===i?.amountInBaseUnits&&typeof p.amountOutBaseUnits==='string'&&/^[1-9]\d*$/.test(p.amountOutBaseUnits)&&typeof i.minimumOutBaseUnits==='string'&&BigInt(p.amountOutBaseUnits)>=BigInt(i.minimumOutBaseUnits)),completed=row.state==='completed'&&confirmed;
 const requested=units(i?.amountInBaseUnits,buy?6:18),received=completed?units(p.amountOutBaseUnits,buy?18:6):null;
 return{id:row.id,kind:row.kind==='approval'?'approval':row.side,state:row.state==='completed'&&!completed?'unknown':row.state,symbol:parsed.data,approval_asset:buy?'USDG':parsed.data,amount:row.kind==='approval'?requested:completed?(buy?received:requested):requested,paid_amount:completed&&row.kind==='swap'?units(p.amountInBaseUnits,buy?6:18):null,received_amount:received,tx_hash:row.tx_hash,created_at:new Date(row.created_at).toISOString()};
}
export async function readStockActivity(pool:Pick<Pool,'query'>,c:CustomerContext,readWallets:(c:CustomerContext)=>Promise<{address:string}[]>){
 const addresses=[...new Set((await readWallets(c)).map(w=>w.address.toLowerCase()))];if(addresses.some(a=>!/^0x[a-f0-9]{40}$/.test(a)))throw Error('Invalid wallet ownership response');if(!addresses.length)return{items:[]};
 const args=[c.businessId,c.customerId,c.walletId,addresses];
 const [orders,grants]=await Promise.all([
  pool.query("SELECT id,kind,market_id,side,state,prepared,proof,tx_hash,created_at FROM robinhood_customer_orders WHERE business_id=$1 AND customer_id=$2 AND wallet_id=$3 AND account_address=ANY($4::text[]) AND signed_transaction IS NOT NULL ORDER BY created_at DESC LIMIT 50",args),
  pool.query("SELECT g.id,g.account_address,g.created_at,jsonb_agg(jsonb_build_object('kind',s.kind,'state',s.state,'proof',s.proof,'tx_hash',s.tx_hash) ORDER BY s.nonce) AS stages FROM robinhood_funding_grants g JOIN robinhood_funding_stages s ON s.grant_id=g.id WHERE g.business_id=$1 AND g.customer_id=$2 AND g.wallet_id=$3 AND g.account_address=ANY($4::text[]) GROUP BY g.id ORDER BY g.created_at DESC LIMIT 10",args)
 ]);
 const items:StockActivityItem[]=orders.rows.map(stockOrderActivity).filter((v):v is StockActivityItem=>v!==null);
 for(const g of grants.rows){const stages=g.stages??[],complete=stages.length===2&&new Set(stages.map((s:any)=>s.kind)).size===2&&stages.every((s:any)=>s.state==='completed'&&s.proof?.confirmed===true&&s.proof.tx_hash===s.tx_hash&&s.proof.network==='robinhood-testnet'&&s.proof.chain_id===46630&&s.proof.recipient===g.account_address&&s.proof.asset===(s.kind==='usdg'?'USDG':'ETH')&&s.proof.amount_base_units===(s.kind==='usdg'?'20000000':'1000000000000000')),failed=stages.some((s:any)=>s.state==='reverted');items.push({id:g.id,kind:'funding',state:complete?'completed':failed?'reverted':'confirming',symbol:'USDG',amount:complete?'20':null,paid_amount:null,received_amount:complete?'0.001':null,tx_hash:stages.find((s:any)=>s.kind==='usdg')?.tx_hash??null,created_at:new Date(g.created_at).toISOString()});}
 return{items:items.sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,50)};
}
export async function registerStockActivityRoute(app:FastifyInstance,d:{pool:Pool;readWallets:(c:CustomerContext)=>Promise<{address:string}[]>}){
 app.get('/v1/trade/stocks/activity',async(request:FastifyRequest,reply)=>{await requireBusiness(request,'trade.stocks');await requireBusiness(request,'capital.wallets');const q=z.object({customer_id:z.string().uuid(),wallet_id:z.string().uuid()}).strict().parse(request.query),c=await requireCustomer(request,q.customer_id,q.wallet_id);reply.header('Cache-Control','private, no-store');return success(request,await readStockActivity(d.pool,c,d.readWallets));});
}
