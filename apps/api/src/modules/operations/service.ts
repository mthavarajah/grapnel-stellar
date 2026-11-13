import { randomUUID } from 'node:crypto';
import { GrapnelError, NETWORK, PreparedActionSchema,fromAtomic,toAtomic, type ModuleId, type Operation, type OperationStatus, type PreparedAction } from '@grapnel/contracts';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { lock, transaction } from '../../db/index.js';
import { canonicalJson, digest, secretToken } from '../../lib/crypto.js';
export interface CreateOperationInput {businessId:string;customerId:string;walletId:string;module:ModuleId;type:string;provider:string;route:string;idempotencyKey:string;request:unknown;}
export interface ReservationInput {businessId:string;customerId:string;walletId:string;operationId:string;assetId:string;amountAtomic:bigint;spendableAtomic:bigint;observedAt:Date;expiresAt:Date;}
export interface ReconciliationResult {state:'completed'|'failed'|'pending';deltaVerified?:boolean;result?:Record<string,unknown>;}
export function serializeOperation(row:QueryResultRow,withPrepared=false):Operation {
 const result:Operation={operation_id:row.id,customer_id:row.customer_id,wallet_id:row.wallet_id,module:row.module_code,type:row.type,status:row.state,network:NETWORK,tx_hash:row.tx_hash??null,provider:row.provider,created_at:new Date(row.created_at).toISOString(),updated_at:new Date(row.updated_at).toISOString(),error:row.error_code?{code:row.error_code,message:row.error_message??'Operation failed'}:null};
 const financialTypes=['wallet.test_payment','testnet.fund','testnet.return','blend.supply','blend.withdraw','blend.borrow','blend.repay','blend.borrow_collateral_supply','blend.borrow_collateral_withdraw','spot.swap'];
 if(financialTypes.includes(row.type)){
  const amount=row.request_json?.amount??row.prepared_action?.summary?.amount;
  const asset=row.request_json?.asset_id??row.prepared_action?.summary?.fromAssetId;
  if(typeof amount==='string'&&/^(0|[1-9]\d*)(\.\d+)?$/.test(amount)&&amount.length<=100)result.display_amount=amount;
  if(typeof asset==='string')result.display_asset_id=asset;
  if(row.type==='blend.repay'&&row.state==='completed'){
   delete result.display_amount;
   const proof=row.result_json?.blend_borrowing_verification;
   try{if(proof?.verified===true&&proof.operation==='repay'&&proof.tx_hash===row.tx_hash&&proof.asset_id===asset&&/^[0-9]{1,38}$/.test(proof.repay_incoming_atomic)&&/^[0-9]{1,38}$/.test(proof.repay_refund_atomic)){
    const incoming=BigInt(proof.repay_incoming_atomic),refund=BigInt(proof.repay_refund_atomic);
    if(incoming===toAtomic(amount,7)&&refund>=0n&&refund<incoming)result.display_amount=fromAtomic(incoming-refund,7);
   }}catch{/* A completed repayment without exact settlement evidence has no invented amount. */}
  }
 }
 if(row.provider==='zenex'){
  const p=row.prepared_action?.summary?.perpetual;
  if(['zenex.open','zenex.close'].includes(row.type)&&p?.market_id==='zenex-testnet:perps:XLM'&&typeof p.is_long==='boolean'&&typeof p.size_usd==='string'&&/^(0|[1-9]\d*)(\.\d+)?$/.test(p.size_usd)){result.display_side=p.is_long?'long':'short';result.display_amount=p.size_usd;result.display_asset_id=row.prepared_action.summary.fromAssetId;}
  if(row.type==='zenex.faucet'&&row.state==='completed'&&row.result_json?.zenex?.verified===true){result.display_amount=row.result_json.zenex.amount;result.display_asset_id=row.result_json.zenex.asset_id;}
 }
 if(withPrepared && row.prepared_action)result.prepared_action=PreparedActionSchema.parse(row.prepared_action);
 return result;
}
export class OperationService {
 constructor(public readonly pool:Pool){}
 async get(businessId:string,id:string,withPrepared=false):Promise<Operation>{
  await this.expireUnsignedActions(businessId,id);
  const row=(await this.pool.query('SELECT * FROM operations WHERE business_id=$1 AND id=$2',[businessId,id])).rows[0];
  if(!row)throw new GrapnelError(404,'NOT_FOUND','Operation not found');return serializeOperation(row,withPrepared);
 }
 /** Release only expired, never-submitted approvals. An uncertain signed send always retains its hold. */
 async expireUnsignedActions(businessId?:string,operationId?:string):Promise<number>{
  return transaction(this.pool,async client=>{
   const rows=(await client.query(`SELECT id,business_id FROM operations
    WHERE state='awaiting_customer_authorization' AND tx_hash IS NULL AND signed_xdr IS NULL
     AND (prepared_action->'authorization'->>'expiresAt')::timestamptz<=now()
     AND ($1::uuid IS NULL OR business_id=$1) AND ($2::uuid IS NULL OR id=$2)
    ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 100`,[businessId??null,operationId??null])).rows;
   for(const row of rows){
    await client.query("UPDATE operations SET state='expired',error_code='ACTION_EXPIRED',error_message='Unsigned customer approval expired; request a new action',updated_at=now() WHERE business_id=$1 AND id=$2",[row.business_id,row.id]);
    await client.query("UPDATE balance_reservations SET state='released' WHERE business_id=$1 AND operation_id=$2 AND state='active'",[row.business_id,row.id]);
    await client.query("UPDATE wallet_authorizations SET status='expired' WHERE business_id=$1 AND operation_id=$2 AND consumed_at IS NULL AND status='pending'",[row.business_id,row.id]);
    await client.query("UPDATE testnet_funding_transfers SET status='expired' WHERE business_id=$1 AND operation_id=$2",[row.business_id,row.id]);
   }
   return rows.length;
  });
 }
 async createIdempotent(input:CreateOperationInput,prepare?:(client:PoolClient,operationId:string)=>Promise<void>):Promise<{operation:Operation;created:boolean}>{
  if(!input.idempotencyKey || input.idempotencyKey.length>200)throw new GrapnelError(400,'IDEMPOTENCY_KEY_REQUIRED','Idempotency-Key must contain 1–200 characters');
  const requestHash=digest(canonicalJson(input.request));
  await this.expireUnsignedActions(input.businessId);
  return transaction(this.pool,async client=>{
   await lock(client,`idempotency:${input.businessId}:${input.route}:${input.idempotencyKey}`);
   const existing=(await client.query('SELECT operation_id,request_hash FROM idempotency_records WHERE business_id=$1 AND route=$2 AND idempotency_key=$3',[input.businessId,input.route,input.idempotencyKey])).rows[0];
   if(existing){if(existing.request_hash!==requestHash)throw new GrapnelError(409,'IDEMPOTENCY_CONFLICT','This idempotency key was used with a different request');const row=(await client.query('SELECT * FROM operations WHERE business_id=$1 AND id=$2',[input.businessId,existing.operation_id])).rows[0];return {operation:serializeOperation(row),created:false};}
   const wallet=(await client.query('SELECT id FROM wallets WHERE business_id=$1 AND customer_id=$2 AND id=$3',[input.businessId,input.customerId,input.walletId])).rows[0];
   if(!wallet)throw new GrapnelError(404,'NOT_FOUND','Customer wallet not found');
   await lock(client,`wallet:${input.businessId}:${input.walletId}`);
   const pending=(await client.query("SELECT id,provider,type FROM operations WHERE business_id=$1 AND wallet_id=$2 AND state NOT IN ('completed','failed','rejected','expired') LIMIT 1",[input.businessId,input.walletId])).rows[0];
   if(pending&&!(input.type==='zenex.cancel'&&input.provider==='zenex'&&pending.provider==='zenex'&&['zenex.open','zenex.close'].includes(pending.type)))throw new GrapnelError(409,'WALLET_OPERATION_PENDING','Finish the pending wallet action before preparing another',false,{operation_id:pending.id});
   const operationId=randomUUID();
   await client.query("INSERT INTO operations(id,business_id,customer_id,wallet_id,module_code,type,state,request_json,provider) VALUES($1,$2,$3,$4,$5,$6,'accepted',$7,$8)",[operationId,input.businessId,input.customerId,input.walletId,input.module,input.type,JSON.stringify(input.request),input.provider]);
   await client.query('INSERT INTO idempotency_records(business_id,route,idempotency_key,request_hash,operation_id) VALUES($1,$2,$3,$4,$5)',[input.businessId,input.route,input.idempotencyKey,requestHash,operationId]);
   if(prepare)await prepare(client,operationId);
   return {operation:serializeOperation((await client.query('SELECT * FROM operations WHERE business_id=$1 AND id=$2',[input.businessId,operationId])).rows[0]),created:true};
  });
 }
 async reserve(client:PoolClient,input:ReservationInput):Promise<void>{
  if(input.amountAtomic<=0n || input.spendableAtomic<0n)throw new GrapnelError(422,'INVALID_AMOUNT','Amount must be positive');
  if(Date.now()-input.observedAt.getTime()>15000 || input.observedAt.getTime()>Date.now()+1000)throw new GrapnelError(409,'BALANCE_STALE','A fresh onchain balance is required');
  await lock(client,`wallet:${input.businessId}:${input.walletId}:${input.assetId}`);
  // Expired uncertain/submitted reservations remain active until chain reconciliation.
  const total=(await client.query("SELECT COALESCE(sum(amount_atomic),0)::text AS amount FROM balance_reservations WHERE business_id=$1 AND wallet_id=$2 AND asset_id=$3 AND state='active'",[input.businessId,input.walletId,input.assetId])).rows[0].amount;
  if(BigInt(total)+input.amountAtomic>input.spendableAtomic)throw new GrapnelError(409,'INSUFFICIENT_AVAILABLE_BALANCE','Amount exceeds confirmed unreserved spendable balance');
  await client.query('INSERT INTO balance_reservations(business_id,customer_id,wallet_id,asset_id,operation_id,amount_atomic,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[input.businessId,input.customerId,input.walletId,input.assetId,input.operationId,input.amountAtomic.toString(),input.expiresAt]);
 }
 async setPrepared(client:PoolClient,businessId:string,operationId:string,prepared:PreparedAction):Promise<void>{
  PreparedActionSchema.parse(prepared);
  const row=(await client.query('SELECT * FROM operations WHERE business_id=$1 AND id=$2 FOR UPDATE',[businessId,operationId])).rows[0];
  if(!row || row.customer_id!==prepared.customerId || prepared.operationId!==operationId)throw new GrapnelError(403,'PREPARED_ACTION_MISMATCH','Prepared action identity mismatch');
  const wallet=(await client.query('SELECT stellar_address FROM wallets WHERE business_id=$1 AND id=$2',[businessId,row.wallet_id])).rows[0];
  if(wallet.stellar_address!==prepared.walletAddress || Date.parse(prepared.authorization.expiresAt)<=Date.now())throw new GrapnelError(403,'PREPARED_ACTION_MISMATCH','Prepared wallet or expiry mismatch');
  if(!['accepted','preparing','validating'].includes(row.state))throw new GrapnelError(409,'OPERATION_STATE_INVALID','Operation cannot be prepared in its current state');
  await client.query("UPDATE operations SET state='awaiting_customer_authorization',prepared_action=$3,approved_intent_hash=$4,xdr_hash=$5,updated_at=now() WHERE business_id=$1 AND id=$2",[businessId,operationId,JSON.stringify(prepared),digest(canonicalJson(prepared.summary)),digest(prepared.unsignedXdr)]);
 }
 async issueAuthorization(businessId:string,operationId:string):Promise<{prepared_action:PreparedAction;customer_action_token:string}>{
  return transaction(this.pool,async client=>{
   const row=(await client.query('SELECT * FROM operations WHERE business_id=$1 AND id=$2 FOR UPDATE',[businessId,operationId])).rows[0];
   if(!row)throw new GrapnelError(404,'NOT_FOUND','Operation not found');
   if(row.state!=='awaiting_customer_authorization')throw new GrapnelError(409,'OPERATION_STATE_INVALID','Operation is not awaiting authorization');
   const prepared=PreparedActionSchema.parse(row.prepared_action);
   if(Date.parse(prepared.authorization.expiresAt)<=Date.now())throw new GrapnelError(409,'AUTHORIZATION_EXPIRED','Prepared action has expired');
   const token=secretToken();
   await client.query("UPDATE wallet_authorizations SET status='superseded' WHERE business_id=$1 AND operation_id=$2 AND status='pending'",[businessId,operationId]);
   await client.query('INSERT INTO wallet_authorizations(business_id,customer_id,wallet_id,operation_id,intent_hash,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[businessId,row.customer_id,row.wallet_id,operationId,digest(canonicalJson(prepared)),digest(token),prepared.authorization.expiresAt]);
   return {prepared_action:prepared,customer_action_token:token};
  });
 }
 async authorize(input:{businessId:string;operationId:string;customerId:string;token:string;signedXdr:string;verify:(action:PreparedAction,signedXdr:string)=>Promise<{txHash:string}>}):Promise<Operation>{
  await this.expireUnsignedActions(input.businessId,input.operationId);
  return transaction(this.pool,async client=>{
   const row=(await client.query('SELECT * FROM operations WHERE business_id=$1 AND id=$2 FOR UPDATE',[input.businessId,input.operationId])).rows[0];
   if(!row || row.customer_id!==input.customerId)throw new GrapnelError(404,'NOT_FOUND','Operation not found');
   if(row.state!=='awaiting_customer_authorization')throw new GrapnelError(409,'OPERATION_STATE_INVALID','Operation is not awaiting authorization');
   const prepared=PreparedActionSchema.parse(row.prepared_action);
   const authorization=(await client.query("SELECT id,intent_hash FROM wallet_authorizations WHERE business_id=$1 AND operation_id=$2 AND token_hash=$3 AND consumed_at IS NULL AND status='pending' AND expires_at>now() FOR UPDATE",[input.businessId,input.operationId,digest(input.token)])).rows[0];
   if(!authorization || authorization.intent_hash!==digest(canonicalJson(prepared)) || Date.parse(prepared.authorization.expiresAt)<=Date.now())throw new GrapnelError(403,'CUSTOMER_AUTH_INVALID','Authorization expired, consumed, or does not match action');
   const verified=await input.verify(prepared,input.signedXdr);
   if(!/^[a-f0-9]{64}$/.test(verified.txHash))throw new GrapnelError(502,'INVALID_TRANSACTION_HASH','Signer returned an invalid transaction hash');
   await client.query("UPDATE wallet_authorizations SET consumed_at=now(),status='consumed' WHERE id=$1",[authorization.id]);
   // Persist the deterministic hash/envelope before any network send; worker alone broadcasts.
   await client.query("UPDATE operations SET state='preparing',signed_xdr=$3,tx_hash=$4,updated_at=now() WHERE business_id=$1 AND id=$2",[input.businessId,input.operationId,input.signedXdr,verified.txHash]);
   await client.query("INSERT INTO worker_jobs(operation_id,job_type) VALUES($1,'broadcast') ON CONFLICT DO NOTHING",[input.operationId]);
   return serializeOperation((await client.query('SELECT * FROM operations WHERE business_id=$1 AND id=$2',[input.businessId,input.operationId])).rows[0]);
  });
 }
 async recordReconciliation(businessId:string,operationId:string,result:ReconciliationResult):Promise<void>{
  await transaction(this.pool,async client=>{
   const row=(await client.query('SELECT * FROM operations WHERE business_id=$1 AND id=$2 FOR UPDATE',[businessId,operationId])).rows[0];
   if(!row?.tx_hash)throw new GrapnelError(409,'CHAIN_PROOF_REQUIRED','A submitted transaction hash is required');
   if(['completed','failed','rejected','expired'].includes(row.state))return;
   const state:OperationStatus=result.state==='completed'?(result.deltaVerified?'completed':'confirming'):result.state==='failed'?'failed':'confirming';
   await client.query("UPDATE operations SET state=$3,result_json=COALESCE(result_json,'{}'::jsonb)||$4::jsonb,last_checked_at=now(),updated_at=now() WHERE business_id=$1 AND id=$2",[businessId,operationId,state,JSON.stringify(result.result??{})]);
   await client.query('UPDATE testnet_funding_transfers SET status=$3,tx_hash=$4 WHERE business_id=$1 AND operation_id=$2',[businessId,operationId,state,row.tx_hash]);
   if(state==='completed'||state==='failed')await client.query("UPDATE balance_reservations SET state='released' WHERE business_id=$1 AND operation_id=$2",[businessId,operationId]);
  });
 }
}
