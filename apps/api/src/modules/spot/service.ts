import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { GrapnelError, type CustomerContext, type Operation, type PreparedAction } from '@grapnel/contracts';
import { SoroswapSpotAdapter, type SpotQuote } from '../../adapters/soroswap/index.js';
interface CreateInput {businessId:string;customerId:string;walletId:string;module:'trade.spot';type:string;provider:string;route:string;idempotencyKey:string;request:unknown;}
export interface SpotOperationStore {
  createIdempotent(input:CreateInput,prepare:(client:PoolClient,operationId:string)=>Promise<void>):Promise<{operation:Operation;created:boolean}>;
  setPrepared(client:PoolClient,businessId:string,id:string,prepared:PreparedAction):Promise<void>;
}
/** Must reserve exact input plus fee asset against fresh authoritative balances,
 * active reservations, and per-wallet sequence conflicts in the same DB transaction. */
export type ReserveQuoteSpend=(client:PoolClient,operationId:string,quote:SpotQuote,customer:CustomerContext,prepared:PreparedAction)=>Promise<void>;
export interface SpotQuoteRequest {customer_id:string;market_id:string;exact_in:{asset_id:string;amount:string};slippage_bps:number;}
export interface SpotOrderRequest {customer_id:string;wallet_id:string;quote_id:string;}
const lock=async(client:PoolClient,key:string)=>{await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[key]);};
const idempotency=(value:string)=>{if(!value||value.length>200)throw new GrapnelError(400,'IDEMPOTENCY_KEY_REQUIRED','A bounded Idempotency-Key is required');};
function quoteHash(input:SpotQuoteRequest):string {
 return createHash('sha256').update(JSON.stringify([input.customer_id,input.market_id,input.exact_in.asset_id,input.exact_in.amount,input.slippage_bps])).digest('hex');
}
function publicQuote(quote:SpotQuote):Omit<SpotQuote,'provider_quote'|'amount_in_atomic'|'expected_out_atomic'|'min_out_atomic'> {
 const {provider_quote:_,amount_in_atomic:_a,expected_out_atomic:_b,min_out_atomic:_c,...view}=quote;return view;
}
export class SpotService {
 constructor(readonly adapter:SoroswapSpotAdapter,private readonly pool:Pool,private readonly operations:SpotOperationStore,private readonly reserve?:ReserveQuoteSpend){}
 async quote(request:SpotQuoteRequest,customer:CustomerContext,key:string) {
  idempotency(key);
  if(request.customer_id!==customer.customerId)throw new GrapnelError(404,'NOT_FOUND','Customer not found');
  const client=await this.pool.connect();
  try {
   await client.query('BEGIN');
   await lock(client,`spot:quote:${customer.businessId}:${key}`);
   const existing=(await client.query("SELECT provider_quote_json_redacted FROM trade_quotes WHERE business_id=$1 AND provider='soroswap' AND provider_quote_json_redacted->>'grapnel_idempotency_key'=$2",[customer.businessId,key])).rows[0]?.provider_quote_json_redacted;
   if(existing) {
    if(existing.request_hash!==quoteHash(request))throw new GrapnelError(409,'IDEMPOTENCY_CONFLICT','Quote idempotency key was used with a different request');
    await client.query('COMMIT');return publicQuote(existing.quote as SpotQuote);
   }
   const owner=(await client.query('SELECT id FROM customers WHERE business_id=$1 AND id=$2 AND privy_user_id=$3',[customer.businessId,customer.customerId,customer.privyUserId])).rows[0];
   if(!owner)throw new GrapnelError(404,'NOT_FOUND','Verified customer not found');
   const quote=await this.adapter.quote({quoteId:randomUUID(),marketId:request.market_id,assetId:request.exact_in.asset_id,amount:request.exact_in.amount,slippageBps:request.slippage_bps});
   await client.query('INSERT INTO trade_quotes(id,business_id,customer_id,market_id,provider,exact_in_asset_id,amount_in_atomic,expected_out_atomic,min_out_atomic,expires_at,provider_quote_json_redacted) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[quote.quote_id,customer.businessId,customer.customerId,quote.market_id,'soroswap',quote.asset_in_id,quote.amount_in_atomic,quote.expected_out_atomic,quote.min_out_atomic,quote.expires_at,JSON.stringify({grapnel_idempotency_key:key,request_hash:quoteHash(request),quote})]);
   await client.query('COMMIT');return publicQuote(quote);
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }
 async createOrder(request:SpotOrderRequest,customer:CustomerContext,key:string) {
  idempotency(key);
  if(request.customer_id!==customer.customerId||request.wallet_id!==customer.walletId)throw new GrapnelError(404,'NOT_FOUND','Customer wallet not found');
  if(!this.reserve)throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Spot reservation and chain inspector integration is required',false,{reason:'SPOT_RESERVATION_REQUIRED'});
  return this.operations.createIdempotent({businessId:customer.businessId,customerId:customer.customerId,walletId:customer.walletId,module:'trade.spot',type:'spot.swap',provider:'soroswap',route:'/v1/trade/orders',idempotencyKey:key,request},async(client,operationId)=>{
   const row=(await client.query('SELECT * FROM trade_quotes WHERE business_id=$1 AND customer_id=$2 AND id=$3 FOR UPDATE',[customer.businessId,customer.customerId,request.quote_id])).rows[0];
   if(!row)throw new GrapnelError(404,'NOT_FOUND','Quote not found');
   if(new Date(row.expires_at).getTime()<=Date.now())throw new GrapnelError(409,'QUOTE_EXPIRED','Quote expired; request a new quote');
   if((await client.query('SELECT id FROM orders WHERE business_id=$1 AND customer_id=$2 AND quote_id=$3 LIMIT 1',[customer.businessId,customer.customerId,request.quote_id])).rowCount)throw new GrapnelError(409,'QUOTE_ALREADY_USED','A quote can prepare only one order');
   const quote=row.provider_quote_json_redacted?.quote as SpotQuote|undefined;
   if(!quote||quote.quote_id!==request.quote_id||quote.market_id!==row.market_id||quote.amount_in_atomic!==row.amount_in_atomic||quote.expected_out_atomic!==row.expected_out_atomic||quote.min_out_atomic!==row.min_out_atomic)throw new GrapnelError(409,'QUOTE_INVALID','Stored immutable quote does not match authoritative columns');
   const prepared=await this.adapter.prepare(quote,customer,operationId);
   await this.reserve!(client,operationId,quote,customer,prepared);
   await this.operations.setPrepared(client,customer.businessId,operationId,prepared);
   // Use operation UUID as order UUID; clients can GET either endpoint without a second identifier.
   await client.query("INSERT INTO orders(id,business_id,customer_id,operation_id,quote_id,market_id,status) VALUES($1,$2,$3,$1,$4,$5,'awaiting_customer_authorization')",[operationId,customer.businessId,customer.customerId,request.quote_id,row.market_id]);
  });
 }
 async order(businessId:string,id:string) {
  const row=(await this.pool.query('SELECT o.id,o.operation_id,o.market_id,p.state AS status,p.tx_hash,o.actual_in_atomic,o.actual_out_atomic FROM orders o JOIN operations p ON p.business_id=o.business_id AND p.id=o.operation_id WHERE o.business_id=$1 AND o.id=$2',[businessId,id])).rows[0];
  if(!row)throw new GrapnelError(404,'NOT_FOUND','Order not found');
  // Actual fills are unavailable until provider-specific delta reconciliation updates them.
  return {...row,actual_in_atomic:row.status==='completed'?row.actual_in_atomic:null,actual_out_atomic:row.status==='completed'?row.actual_out_atomic:null};
 }
}
