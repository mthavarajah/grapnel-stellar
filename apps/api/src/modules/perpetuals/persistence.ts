import {createHash} from 'node:crypto';
import {z} from 'zod';
import {Keypair} from '@stellar/stellar-sdk';
import type {Pool,PoolClient,QueryResultRow} from 'pg';
import {GrapnelError} from '@grapnel/contracts';
import {transaction,lock} from '../../db/index.js';
import {accountSchema,intentSchema,payloadSchema,assertScope,assertPrecision,assertPositionIntent,orderAction,typedData,inspectArtifact,stable,hash,units} from '../../adapters/hyperliquid/execution/guards.js';
import type {ApprovedPerpetualIntent,BoundPerpetualAccount,SignedPerpetualAction,PerpetualExecutionStatus} from './execution-contract.js';
import type {PerpetualWorkflowStore,PerpetualScope,PerpetualAccount,PerpetualChallenge,PendingPerpetualOrder} from './workflow-contract.js';

const scopeSchema=z.object({businessId:z.string().uuid(),customerId:z.string().uuid(),walletId:z.string().uuid(),stellarAddress:z.string().regex(/^G[A-Z2-7]{55}$/)}).strict();
const hexHash=z.string().regex(/^[a-f0-9]{64}$/);
const lowerAddress=z.string().regex(/^0x[0-9a-f]{40}$/);
const unsignedPayloadSchema=payloadSchema.extend({wire:payloadSchema.shape.wire.omit({signature:true})});
const artifactFields={network:z.literal('hyperliquid-testnet'),accountAddress:lowerAddress,operationId:z.string().uuid(),nonce:z.number().int().positive().safe(),clientOrderId:z.string().regex(/^0x[a-f0-9]{32}$/),intentHash:hexHash};
const unsignedSchema=z.object({...artifactFields,payload:unsignedPayloadSchema,typedData:z.unknown()}).strict();
const signedSchema=z.object({...artifactFields,payload:payloadSchema}).strict();
const resultSchema=z.object({state:z.enum(['unknown','open','filled','cancelled','rejected','no_fill']),orderId:z.string().min(1).max(200).nullable(),clientOrderId:z.string().regex(/^0x[a-f0-9]{32}$/),filledSize:z.string().regex(/^(0|[1-9]\d{0,29})(\.\d{1,18})?$/),averagePrice:z.string().regex(/^(0|[1-9]\d{0,29})(\.\d{1,18})?$/).nullable(),fillIds:z.array(z.string().min(1).max(200)).max(1000),rawStatus:z.string().max(500)}).strict();
const reject=(code:string,message:string,status=409):never=>{throw new GrapnelError(status,code,message);};
const sha=(message:string)=>createHash('sha256').update(message,'utf8').digest('hex');
const iso=(date:Date|string)=>new Date(date).toISOString();
const scopeArgs=(scope:PerpetualScope)=>[scope.businessId,scope.customerId,scope.walletId,scope.stellarAddress];
const scoped=(alias:string)=>`${alias}.business_id=$1 AND ${alias}.customer_id=$2 AND ${alias}.wallet_id=$3 AND ${alias}.stellar_address=$4`;
const walletJoin=(alias:string)=>`JOIN wallets w ON w.business_id=${alias}.business_id AND w.customer_id=${alias}.customer_id AND w.id=${alias}.wallet_id AND w.stellar_address=${alias}.stellar_address AND w.network='stellar-testnet'`;
function copied<T>(value:T):T{stable(value);return structuredClone(value);}
function parseScope(scope:PerpetualScope):PerpetualScope{return scopeSchema.parse(copied(scope));}
function same(left:unknown,right:unknown){return stable(left)===stable(right);}
function binding(scope:PerpetualScope,row:QueryResultRow):BoundPerpetualAccount{return {...scope,accountAddress:row.account_address,signingKeyRef:row.signing_key_ref};}
function accountRow(scope:PerpetualScope,row:QueryResultRow):PerpetualAccount{return {...binding(scope,row),id:row.id,createdAt:iso(row.created_at)};}
function challengeRow(scope:PerpetualScope,row:QueryResultRow):PerpetualChallenge{return {id:row.id,scope,accountAddress:row.account_address,message:row.message,digest:row.digest,expiresAt:iso(row.expires_at)};}
function orderRow(scope:PerpetualScope,row:QueryResultRow):PendingPerpetualOrder{return {id:row.id,scope,accountId:row.account_id,idempotencyKey:row.idempotency_key,requestHash:row.request_hash,intent:row.intent,approvalMessage:row.approval_message,approvalDigest:row.approval_digest,unsignedAction:row.unsigned_action,signedAction:row.signed_action,payloadHash:row.payload_hash,state:row.state,result:row.result,createdAt:iso(row.created_at),customerSignature:row.customer_signature??null,approvedAt:row.approved_at?iso(row.approved_at):null};}
function accountMessage(challenge:PerpetualChallenge):string{return 'Grapnel Perpetuals account binding\n'+stable({version:1,network:'hyperliquid-testnet',challengeId:challenge.id,...challenge.scope,accountAddress:challenge.accountAddress,expiresAt:challenge.expiresAt});}
function approvalMessage(scope:PerpetualScope,intent:ApprovedPerpetualIntent):string{const {customerApprovalHash:_approval,network:_network,...fields}=intent;return 'Grapnel Perpetuals order approval\n'+stable({version:1,network:'hyperliquid-testnet',...fields,stellarAddress:scope.stellarAddress});}
function validateAccount(scope:PerpetualScope,account:BoundPerpetualAccount):void{
 accountSchema.parse(account);lowerAddress.parse(account.accountAddress);
 for(const key of ['businessId','customerId','walletId','stellarAddress'] as const)if(account[key]!==scope[key])reject('PERPETUAL_SCOPE_MISMATCH','Perpetual account does not match the customer wallet',403);
 if(account.signingKeyRef!==`customer-wallet:${account.accountAddress}`)reject('PERPETUAL_ACCOUNT_MISMATCH','A customer-owned wallet reference is required');
}
function validateIntent(scope:PerpetualScope,intent:ApprovedPerpetualIntent):void{
 intentSchema.parse(intent);z.string().uuid().parse(intent.operationId);lowerAddress.parse(intent.accountAddress);
 if(intent.businessId!==scope.businessId||intent.customerId!==scope.customerId||intent.walletId!==scope.walletId)reject('PERPETUAL_SCOPE_MISMATCH','Order does not match the customer wallet',403);
 if(![`hyperliquid-testnet:perps:${intent.assetIndex}`,`hyperliquid-testnet:stocks:${intent.assetIndex}`].includes(intent.marketId)||units(intent.size,18)<=0n||units(intent.limitPrice,18)<=0n)reject('PERPETUAL_INTENT_MISMATCH','Invalid exact Testnet order intent');
}
function validateUnsigned(unsigned:unknown,intent:ApprovedPerpetualIntent,account:BoundPerpetualAccount){
 const parsed=unsignedSchema.parse(unsigned),p=parsed.payload;
 assertScope(p.intent as ApprovedPerpetualIntent,p.account as BoundPerpetualAccount,account);assertPrecision(p.intent as ApprovedPerpetualIntent,p.market);assertPositionIntent(p.intent as ApprovedPerpetualIntent,p.market,p.before);
 if(!same(p.intent,intent)||parsed.operationId!==intent.operationId||parsed.accountAddress!==intent.accountAddress||parsed.nonce!==intent.nonce||parsed.clientOrderId!==intent.clientOrderId||parsed.intentHash!==hash({intent,account})||p.wire.nonce!==intent.nonce||p.wire.expiresAfter!==Date.parse(intent.expiresAt)||!same(p.wire.action,orderAction(intent))||p.market.symbol!==intent.providerSymbol||p.market.assetIndex!==intent.assetIndex||p.market.dex!==intent.dex||!same(parsed.typedData,typedData(orderAction(intent),intent.nonce,Date.parse(intent.expiresAt))))reject('PERPETUAL_UNSIGNED_MISMATCH','Unsigned action does not match the stored exact intent');
 return parsed;
}
function validApproval(scope:PerpetualScope,row:QueryResultRow):boolean{
 if(!/^[a-f0-9]{128}$/.test(row.customer_signature??'')||row.approval_message!==approvalMessage(scope,row.intent)||row.approval_digest!==sha(row.approval_message)||row.intent.customerApprovalHash!==row.approval_digest||!row.approved_at)return false;
 try{return Keypair.fromPublicKey(scope.stellarAddress).verify(Buffer.from(row.approval_digest,'hex'),Buffer.from(row.customer_signature,'hex'));}catch{return false;}
}
/** Database durability only. This class never signs, sends or makes provider requests. */
export class PgPerpetualWorkflowStore implements PerpetualWorkflowStore{
 constructor(private readonly pool:Pool){}
 private async write<T>(fn:(client:PoolClient)=>Promise<T>):Promise<T>{try{return await transaction(this.pool,fn);}catch(error){if((error as {code?:string}).code==='23505')return reject('PERPETUAL_UNIQUENESS_CONFLICT','Account, nonce, order identifier or idempotency key has already been assigned');throw error;}}
 private async wallet(client:PoolClient,scope:PerpetualScope):Promise<void>{const found=await client.query("SELECT id FROM wallets WHERE business_id=$1 AND customer_id=$2 AND id=$3 AND stellar_address=$4 AND network='stellar-testnet' FOR KEY SHARE",scopeArgs(scope));if(!found.rowCount)reject('NOT_FOUND','Customer wallet not found',404);}
 private async storedAccount(client:PoolClient,scope:PerpetualScope,id?:string):Promise<QueryResultRow|null>{const found=await client.query(`SELECT a.* FROM perpetual_accounts a ${walletJoin('a')} WHERE ${scoped('a')}${id?' AND a.id=$5':''} FOR UPDATE OF a`,[...scopeArgs(scope),...id?[id]:[]]);return found.rows[0]??null;}
 private async storedOrder(client:PoolClient,scope:PerpetualScope,id:string):Promise<QueryResultRow>{const found=await client.query(`SELECT o.* FROM perpetual_orders o ${walletJoin('o')} WHERE ${scoped('o')} AND o.id=$5 FOR UPDATE OF o`,[...scopeArgs(scope),id]);if(!found.rows[0])return reject('NOT_FOUND','Perpetual order not found',404);return found.rows[0];}
 async challenge(value:PerpetualChallenge):Promise<void>{
  const copy=copied(value),scope=parseScope(copy.scope);z.string().uuid().parse(copy.id);lowerAddress.parse(copy.accountAddress);hexHash.parse(copy.digest);z.string().datetime().parse(copy.expiresAt);
  if(copy.message!==accountMessage(copy)||copy.digest!==sha(copy.message)||Date.parse(copy.expiresAt)<=Date.now())reject('PERPETUAL_CHALLENGE_MISMATCH','Binding challenge does not match its exact customer scope');
  await this.write(async client=>{await this.wallet(client,scope);await client.query('INSERT INTO perpetual_challenges(id,business_id,customer_id,wallet_id,stellar_address,account_address,message,digest,expires_at) VALUES($5,$1,$2,$3,$4,$6,$7,$8,$9)',[...scopeArgs(scope),copy.id,copy.accountAddress,copy.message,copy.digest,copy.expiresAt]);});
 }
 async getChallenge(scope:PerpetualScope,id:string):Promise<PerpetualChallenge|null>{
  const s=parseScope(scope);z.string().uuid().parse(id);const result=await this.pool.query(`SELECT c.* FROM perpetual_challenges c ${walletJoin('c')} WHERE ${scoped('c')} AND c.id=$5 AND c.consumed_at IS NULL AND c.expires_at>now()`,[...scopeArgs(s),id]);return result.rows[0]?challengeRow(s,result.rows[0]):null;
 }
 async bind(scope:PerpetualScope,challengeId:string,account:PerpetualAccount):Promise<PerpetualAccount>{
  const s=parseScope(scope),copy=copied(account);z.string().uuid().parse(copy.id);z.string().uuid().parse(challengeId);const {id:_id,createdAt:_createdAt,...bound}=copy;validateAccount(s,bound);z.string().datetime().parse(copy.createdAt);
  return this.write(async client=>{
   await this.wallet(client,s);await lock(client,`perpetual-account:${s.businessId}:${s.customerId}:${s.walletId}`);
   const found=await client.query(`SELECT c.* FROM perpetual_challenges c ${walletJoin('c')} WHERE ${scoped('c')} AND c.id=$5 AND c.consumed_at IS NULL AND c.expires_at>now() FOR UPDATE OF c`,[...scopeArgs(s),challengeId]);const challenge=found.rows[0];
   if(!challenge||challenge.account_address!==copy.accountAddress)reject('PERPETUAL_CHALLENGE_INVALID','Binding challenge is expired, consumed, foreign or mismatched',403);
   const existing=await this.storedAccount(client,s);
   if(existing&&(existing.account_address!==copy.accountAddress||existing.signing_key_ref!==copy.signingKeyRef))reject('PERPETUAL_ACCOUNT_REBIND_DENIED','The customer wallet already has a different perpetual account');
   const row=existing??(await client.query('INSERT INTO perpetual_accounts(id,business_id,customer_id,wallet_id,stellar_address,account_address,signing_key_ref) VALUES($5,$1,$2,$3,$4,$6,$7) RETURNING *',[...scopeArgs(s),copy.id,copy.accountAddress,copy.signingKeyRef])).rows[0];
   await client.query(`UPDATE perpetual_challenges c SET consumed_at=now() WHERE ${scoped('c')} AND c.id=$5`,[...scopeArgs(s),challengeId]);return accountRow(s,row);
  });
 }
 async account(scope:PerpetualScope):Promise<PerpetualAccount|null>{const s=parseScope(scope);const result=await this.pool.query(`SELECT a.* FROM perpetual_accounts a ${walletJoin('a')} WHERE ${scoped('a')}`,scopeArgs(s));return result.rows[0]?accountRow(s,result.rows[0]):null;}
 async createOrder(order:PendingPerpetualOrder):Promise<PendingPerpetualOrder>{
  const copy=copied(order),s=parseScope(copy.scope);z.string().uuid().parse(copy.id);z.string().uuid().parse(copy.accountId);validateIntent(s,copy.intent);hexHash.parse(copy.requestHash);hexHash.parse(copy.approvalDigest);z.string().min(1).max(200).parse(copy.idempotencyKey);z.string().datetime().parse(copy.createdAt);
  if(copy.id!==copy.intent.operationId||copy.approvalMessage!==approvalMessage(s,copy.intent)||copy.approvalDigest!==sha(copy.approvalMessage)||copy.intent.customerApprovalHash!==copy.approvalDigest||copy.state!=='preparing'||copy.unsignedAction!==null||copy.signedAction!==null||copy.payloadHash!==null||copy.result!==null||copy.customerSignature!=null||copy.approvedAt!=null)reject('PERPETUAL_ORDER_MISMATCH','Only a new exact server-prepared order can be created');
  return this.write(async client=>{
   await this.wallet(client,s);await lock(client,`perpetual-idempotency:${s.businessId}:${s.customerId}:${s.walletId}:${copy.idempotencyKey}`);
   const replay=(await client.query(`SELECT o.* FROM perpetual_orders o ${walletJoin('o')} WHERE ${scoped('o')} AND o.idempotency_key=$5 FOR UPDATE OF o`,[...scopeArgs(s),copy.idempotencyKey])).rows[0];
   if(replay){if(replay.request_hash!==copy.requestHash)reject('IDEMPOTENCY_CONFLICT','Idempotency key was used with a different order request');return orderRow(s,replay);}
   if(Date.parse(copy.intent.expiresAt)<=Date.now())reject('PERPETUAL_ORDER_EXPIRED','The prepared order has expired');
   const account=await this.storedAccount(client,s,copy.accountId);if(!account||account.account_address!==copy.intent.accountAddress)reject('NOT_FOUND','Perpetual account not found',404);
   await lock(client,`perpetual-account-pending:${account.account_address}`);
   const pending=await client.query("SELECT id FROM perpetual_orders WHERE account_address=$1 AND nonce<>$2 AND client_order_id<>$3 AND (state IN ('approved','sending','unknown') OR state IN ('preparing','awaiting_approval') AND (intent->>'expiresAt')::timestamptz>now()) LIMIT 1",[account.account_address,copy.intent.nonce,copy.intent.clientOrderId]);
   if(pending.rowCount)reject('PERPETUAL_ORDER_PENDING','Check your previous order before reviewing another trade');
   const row=(await client.query('INSERT INTO perpetual_orders(id,business_id,customer_id,wallet_id,stellar_address,account_id,idempotency_key,request_hash,intent,approval_message,approval_digest,account_address,nonce,client_order_id,state) VALUES($5,$1,$2,$3,$4,$6,$7,$8,$9,$10,$11,$12,$13,$14,\'preparing\') RETURNING *',[...scopeArgs(s),copy.id,copy.accountId,copy.idempotencyKey,copy.requestHash,JSON.stringify(copy.intent),copy.approvalMessage,copy.approvalDigest,copy.intent.accountAddress,copy.intent.nonce,copy.intent.clientOrderId])).rows[0];return orderRow(s,row);
  });
 }
 async order(scope:PerpetualScope,id:string):Promise<PendingPerpetualOrder|null>{const s=parseScope(scope);z.string().uuid().parse(id);const result=await this.pool.query(`SELECT o.* FROM perpetual_orders o ${walletJoin('o')} WHERE ${scoped('o')} AND o.id=$5`,[...scopeArgs(s),id]);return result.rows[0]?orderRow(s,result.rows[0]):null;}
 async recordApproval(scope:PerpetualScope,id:string,stellarSignature:string):Promise<void>{
  const s=parseScope(scope);z.string().uuid().parse(id);
  if(!/^[a-f0-9]{128}$/.test(stellarSignature))reject('PERPETUAL_APPROVAL_INVALID','A canonical 64-byte Stellar signature is required',403);
  await this.write(async client=>{const row=await this.storedOrder(client,s,id);
   if(!validApproval(s,{...row,customer_signature:stellarSignature,approved_at:new Date()}))reject('PERPETUAL_APPROVAL_INVALID','Customer signature does not approve this exact stored order',403);
   if(row.customer_signature){if(row.customer_signature!==stellarSignature||!validApproval(s,row))reject('PERPETUAL_APPROVAL_IMMUTABLE','Customer approval cannot be replaced');return;}
   if(row.state!=='awaiting_approval'||!row.unsigned_action||Date.parse(row.intent.expiresAt)<=Date.now()||row.send_claimed_at!==null)reject('PERPETUAL_STATE_INVALID','Order can no longer accept customer approval');
   await client.query(`UPDATE perpetual_orders o SET customer_signature=$6,approved_at=now(),updated_at=now() WHERE ${scoped('o')} AND o.id=$5`,[...scopeArgs(s),id,stellarSignature]);
  });
 }
 async saveUnsigned(scope:PerpetualScope,id:string,unsigned:unknown):Promise<void>{
  const s=parseScope(scope),copy=copied(unsigned);z.string().uuid().parse(id);
  await this.write(async client=>{const row=await this.storedOrder(client,s,id),account=await this.storedAccount(client,s,row.account_id);if(!account)reject('NOT_FOUND','Perpetual account not found',404);validateUnsigned(copy,row.intent,binding(s,account!));
   if(row.unsigned_action){if(!same(row.unsigned_action,copy))reject('PERPETUAL_ARTIFACT_IMMUTABLE','Unsigned action cannot be replaced');return;}
   if(row.state!=='preparing'||row.signed_action||Date.parse(row.intent.expiresAt)<=Date.now())reject('PERPETUAL_STATE_INVALID','Order can no longer accept an unsigned action');
   await client.query(`UPDATE perpetual_orders o SET unsigned_action=$6,state='awaiting_approval',updated_at=now() WHERE ${scoped('o')} AND o.id=$5`,[...scopeArgs(s),id,JSON.stringify(copy)]);
  });
 }
 async saveSigned(scope:PerpetualScope,id:string,action:SignedPerpetualAction,payloadHash:string):Promise<void>{
  const s=parseScope(scope),copy=copied(action);z.string().uuid().parse(id);hexHash.parse(payloadHash);signedSchema.parse(copy);
  await this.write(async client=>{const row=await this.storedOrder(client,s,id),account=await this.storedAccount(client,s,row.account_id);if(!account)reject('NOT_FOUND','Perpetual account not found',404);
   if(!validApproval(s,row))reject('PERPETUAL_APPROVAL_REQUIRED','Exact persisted customer approval is required',403);
   if(!row.unsigned_action||row.reserved_at===null||row.intent_hash!==copy.intentHash||payloadHash!==hash(copy.payload))reject('PERPETUAL_SIGNED_MISMATCH','An exact reserved unsigned action must precede its signature');
   const unsigned=validateUnsigned(row.unsigned_action,row.intent,binding(s,account!));const checked=await inspectArtifact(copy,binding(s,account!));const {signature:_signature,...wire}=checked.wire;
   const unsignedCopy={network:copy.network,accountAddress:copy.accountAddress,operationId:copy.operationId,nonce:copy.nonce,clientOrderId:copy.clientOrderId,intentHash:copy.intentHash,payload:{...checked,wire},typedData:unsigned.typedData};
   if(!same(unsignedCopy,row.unsigned_action))reject('PERPETUAL_SIGNED_MISMATCH','Signed payload differs from the stored exact unsigned action');
   if(row.signed_action){if(!same(row.signed_action,copy)||row.payload_hash!==payloadHash)reject('PERPETUAL_ARTIFACT_IMMUTABLE','Signed action cannot be replaced');return;}
   if(row.state!=='awaiting_approval'||row.send_claimed_at!==null||Date.parse(row.intent.expiresAt)<=Date.now())reject('PERPETUAL_STATE_INVALID','Order can no longer accept customer approval');
   await client.query(`UPDATE perpetual_orders o SET signed_action=$6,payload_hash=$7,state='approved',updated_at=now() WHERE ${scoped('o')} AND o.id=$5`,[...scopeArgs(s),id,JSON.stringify(copy),payloadHash]);
  });
 }
 async reserveIntent(scope:PerpetualScope,intent:ApprovedPerpetualIntent,account:BoundPerpetualAccount,intentHash:string):Promise<boolean>{
  const s=parseScope(scope),i=copied(intent),a=copied(account);validateIntent(s,i);validateAccount(s,a);hexHash.parse(intentHash);
  if(intentHash!==hash({intent:i,account:a}))reject('PERPETUAL_INTENT_MISMATCH','Intent hash does not match exact account and order');
  return this.write(async client=>{const row=await this.storedOrder(client,s,i.operationId),stored=await this.storedAccount(client,s,row.account_id);
   if(!stored||!same(binding(s,stored),a)||!same(row.intent,i)||row.account_address!==a.accountAddress)reject('PERPETUAL_INTENT_MISMATCH','Reservation does not match the stored order and bound account');
   if(row.reserved_at!==null||!['preparing','awaiting_approval'].includes(row.state)||Date.parse(i.expiresAt)<=Date.now())return false;
   await client.query(`UPDATE perpetual_orders o SET reserved_at=now(),intent_hash=$6,updated_at=now() WHERE ${scoped('o')} AND o.id=$5`,[...scopeArgs(s),i.operationId,intentHash]);return true;
  });
 }
 async loadPrepared(scope:PerpetualScope,id:string,intentHash:string):Promise<SignedPerpetualAction|null>{const s=parseScope(scope);z.string().uuid().parse(id);hexHash.parse(intentHash);const result=await this.pool.query(`SELECT o.signed_action FROM perpetual_orders o ${walletJoin('o')} WHERE ${scoped('o')} AND o.id=$5 AND o.intent_hash=$6 AND o.signed_action IS NOT NULL AND o.reserved_at IS NOT NULL`,[...scopeArgs(s),id,intentHash]);return result.rows[0]?.signed_action??null;}
 async claimSend(scope:PerpetualScope,id:string,intentHash:string,payloadHash:string):Promise<boolean>{
  const s=parseScope(scope);z.string().uuid().parse(id);hexHash.parse(intentHash);hexHash.parse(payloadHash);
  return this.write(async client=>{const row=await this.storedOrder(client,s,id);if(!validApproval(s,row))reject('PERPETUAL_APPROVAL_REQUIRED','Exact persisted customer approval is required',403);if(row.intent_hash!==intentHash||row.payload_hash!==payloadHash||!row.signed_action||hash(row.signed_action.payload)!==payloadHash)reject('PERPETUAL_SIGNED_MISMATCH','Send claim does not match the exact persisted signed action');
   if(row.send_claimed_at!==null||row.reserved_at===null||row.state!=='approved'||Date.parse(row.intent.expiresAt)<=Date.now())return false;
   await client.query(`UPDATE perpetual_orders o SET send_claimed_at=now(),state='sending',updated_at=now() WHERE ${scoped('o')} AND o.id=$5`,[...scopeArgs(s),id]);return true;
  });
 }
 async saveResult(scope:PerpetualScope,id:string,result:PerpetualExecutionStatus):Promise<void>{
  const s=parseScope(scope),copy=resultSchema.parse(copied(result));z.string().uuid().parse(id);
  await this.write(async client=>{const row=await this.storedOrder(client,s,id);if(!row.signed_action||row.client_order_id!==copy.clientOrderId)reject('PERPETUAL_RESULT_MISMATCH','Result does not match the persisted signed order');
   const filled=units(copy.filledSize,18),size=units(row.intent.size,18);
   if(filled>size||new Set(copy.fillIds).size!==copy.fillIds.length||filled>0n&&(!copy.orderId||!copy.averagePrice||units(copy.averagePrice,18)<=0n||copy.fillIds.length===0)||filled===0n&&(copy.averagePrice!==null||copy.fillIds.length>0)||copy.state==='filled'&&filled!==size||copy.state==='no_fill'&&filled!==0n)reject('PERPETUAL_RESULT_MISMATCH','Result fill quantities or identifiers are inconsistent');
   if(['filled','cancelled','rejected','no_fill'].includes(row.state)){if(same(row.result,copy)||copy.state==='unknown')return;reject('PERPETUAL_RESULT_IMMUTABLE','A terminal provider result cannot be replaced');}
   if(copy.state!=='unknown'&&row.send_claimed_at===null)reject('PERPETUAL_SEND_CLAIM_REQUIRED','A durable send claim is required before a terminal result');
   const state=copy.state==='open'?'sending':copy.state;
   // Never update reserved_at, send_claimed_at, the signed snapshot, nonce or cloid.
   await client.query(`UPDATE perpetual_orders o SET result=$6,state=$7,updated_at=now() WHERE ${scoped('o')} AND o.id=$5`,[...scopeArgs(s),id,JSON.stringify(copy),state]);
  });
 }
}
