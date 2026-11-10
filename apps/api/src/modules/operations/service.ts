import { randomUUID } from 'node:crypto';
import { GrapnelError, NETWORK, PreparedActionSchema, type ModuleId, type Operation, type OperationStatus, type PreparedAction } from '@grapnel/contracts';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { lock, transaction } from '../../db/index.js';
import { canonicalJson, digest, secretToken } from '../../lib/crypto.js';
export interface CreateOperationInput {businessId:string;customerId:string;walletId:string;module:ModuleId;type:string;provider:string;route:string;idempotencyKey:string;request:unknown;}
export interface ReservationInput {businessId:string;customerId:string;walletId:string;operationId:string;assetId:string;amountAtomic:bigint;spendableAtomic:bigint;observedAt:Date;expiresAt:Date;}
export interface ReconciliationResult {state:'completed'|'failed'|'pending';deltaVerified?:boolean;result?:Record<string,unknown>;}
export function serializeOperation(row:QueryResultRow,withPrepared=false):Operation {
 const result:Operation={operation_id:row.id,customer_id:row.customer_id,wallet_id:row.wallet_id,module:row.module_code,type:row.type,status:row.state,network:NETWORK,tx_hash:row.tx_hash??null,provider:row.provider,created_at:new Date(row.created_at).toISOString(),updated_at:new Date(row.updated_at).toISOString(),error:row.error_code?{code:row.error_code,message:row.error_message??'Operation failed'}:null};
 if(withPrepared && row.prepared_action)result.prepared_action=PreparedActionSchema.parse(row.prepared_action);
 return result;
}
export class OperationService {
 constructor(public readonly pool:Pool){}
 async get(businessId:string,id:string,withPrepared=false):Promise<Operation>{
  const row=(await this.pool.query('SELECT * FROM operations WHERE business_id=$1 AND id=$2',[businessId,id])).rows[0];
  if(!row)throw new GrapnelError(404,'NOT_FOUND','Operation not found');return serializeOperation(row,withPrepared);
 }
 async createIdempotent(input:CreateOperationInput,prepare?:(client:PoolClient,operationId:string)=>Promise<void>):Promise<{operation:Operation;created:boolean}>{
  if(!input.idempotencyKey || input.idempotencyKey.length>200)throw new GrapnelError(400,'IDEMPOTENCY_KEY_REQUIRED','Idempotency-Key must contain 1–200 characters');
  const requestHash=digest(canonicalJson(input.request));
  return transaction(this.pool,async client=>{
   await lock(client,`idempotency:${input.businessId}:${input.route}:${input.idempotencyKey}`);
   const existing=(await client.query('SELECT operation_id,request_hash FROM idempotency_records WHERE business_id=$1 AND route=$2 AND idempotency_key=$3',[input.businessId,input.route,input.idempotencyKey])).rows[0];
   if(existing){if(existing.request_hash!==requestHash)throw new GrapnelError(409,'IDEMPOTENCY_CONFLICT','This idempotency key was used with a different request');const row=(await client.query('SELECT * FROM operations WHERE business_id=$1 AND id=$2',[input.businessId,existing.operation_id])).rows[0];return {operation:serializeOperation(row),created:false};}
   const wallet=(await client.query('SELECT id FROM wallets WHERE business_id=$1 AND customer_id=$2 AND id=$3',[input.businessId,input.customerId,input.walletId])).rows[0];
   if(!wallet)throw new GrapnelError(404,'NOT_FOUND','Customer wallet not found');
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
   await client.query('UPDATE operations SET state=$3,result_json=$4,last_checked_at=now(),updated_at=now() WHERE business_id=$1 AND id=$2',[businessId,operationId,state,JSON.stringify(result.result??{})]);
   await client.query('UPDATE testnet_funding_transfers SET status=$3,tx_hash=$4 WHERE business_id=$1 AND operation_id=$2',[businessId,operationId,state,row.tx_hash]);
   if(state==='completed'||state==='failed')await client.query("UPDATE balance_reservations SET state='released' WHERE business_id=$1 AND operation_id=$2",[businessId,operationId]);
  });
 }
}
