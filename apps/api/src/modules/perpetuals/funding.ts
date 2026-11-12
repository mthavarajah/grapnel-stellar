import {z} from 'zod';
import type {FastifyInstance} from 'fastify';
import type {PoolClient} from 'pg';
import {Transaction,TransactionBuilder,Keypair,Horizon,rpc,scValToNative} from '@stellar/stellar-sdk';
import {GrapnelError,NETWORK,NETWORK_PASSPHRASE,PreparedActionSchema,XLM,toAtomic,type CustomerContext,type PreparedAction,type ModuleId} from '@grapnel/contracts';
import {lock} from '../../db/index.js';
import {canonicalJson,digest} from '../../lib/crypto.js';
import {requireBusiness,requireCustomer,success} from '../../lib/context.js';
import type {OperationService} from '../operations/service.js';
import type {DeltaVerification} from '../operations/worker.js';
import type {CctpUsdcSetupPreparer,CircleUsdcSetupStatus} from '../../adapters/cctp/setup.js';
import {CCTP_TESTNET as P} from '../../adapters/cctp/registry.js';
import {readStellarRegistry} from '../../adapters/cctp/reader.js';
import {CIRCLE_USDC_ASSET_ID,CIRCLE_USDC_TRUSTLINE_ACTION,CIRCLE_USDC_ALLOWANCE_ACTION,CIRCLE_USDC_TRUSTLINE_LIMIT,CIRCLE_USDC_MAX_SETUP_FEE,circleAllowanceAmount,inspectCircleSetupPrepared} from '../../adapters/cctp/setup-inspection.js';

const base='/v1/trade/perpetuals/funding',provider='circle-cctp';
const identity=z.object({customer_id:z.string().uuid(),wallet_id:z.string().uuid(),asset_class:z.enum(['perps','stocks']).default('perps')});
const trustlineBody=identity.strict(),allowanceBody=identity.extend({amount:z.string().max(50)}).strict();
const moduleFor=(category:'perps'|'stocks'):ModuleId=>category==='stocks'?'trade.stocks':'trade.perps';
const invalid=(message='Circle setup differs from its exact durable customer approval'):never=>{throw new GrapnelError(403,'CIRCLE_SETUP_BINDING_INVALID',message);};
const unavailable=(reason:string):never=>{throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Circle USDC setup is unavailable',false,{reason});};
const atomic=(value:string):bigint=>/^0(?:\.0+)?$/.test(value)?0n:toAtomic(value,7);
const same=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b);
export type CircleSetupPort=Pick<CctpUsdcSetupPreparer,'readStatus'|'prepareTrustline'|'prepareAllowance'>;
function statusMatches(value:CircleUsdcSetupStatus,customer:CustomerContext,now:number):void{
 const age=now-Date.parse(value.as_of);
 if(value.network!==NETWORK||value.business_id!==customer.businessId||value.customer_id!==customer.customerId||value.wallet_id!==customer.walletId||value.wallet_address!==customer.walletAddress||value.asset_id!==CIRCLE_USDC_ASSET_ID||value.issuer!==P.stellar.issuer||value.contract_id!==P.stellar.usdc||value.decimals!==7||!Number.isFinite(age)||age<0||age>30000||!Number.isSafeInteger(value.as_of_ledger)||value.as_of_ledger<=0||!/^\d{1,20}$/.test(value.source_sequence)||!/^\d{1,20}$/.test(value.additional_reserve_stroops)||!/^\d{1,20}$/.test(value.base_reserve_stroops))return invalid('Circle setup requires exact fresh canonical wallet observations');
 atomic(value.native_spendable_before_reservations);
}
async function activeReservations(client:Pick<PoolClient,'query'>,customer:CustomerContext,assetId:string,operationId:string):Promise<bigint>{
 const row=(await client.query("SELECT COALESCE(sum(amount_atomic),0)::text AS amount FROM balance_reservations WHERE business_id=$1 AND customer_id=$2 AND wallet_id=$3 AND asset_id=$4 AND operation_id<>$5 AND state='active'",[customer.businessId,customer.customerId,customer.walletId,assetId,operationId])).rows[0];return BigInt(row.amount);
}
export interface PerpetualFundingRouteDependencies {operations:OperationService;setup:CircleSetupPort;verifyGate1:()=>Promise<boolean>;now?:()=>number;}
/** Only trustline and bounded approval setup; this never burns, mints, bridges or credits a trading balance. */
export async function registerPerpetualFundingRoutes(app:FastifyInstance,deps:PerpetualFundingRouteDependencies):Promise<void>{
 const now=deps.now??Date.now;
 for(const kind of ['trustline','allowance'] as const)app.post(base+'/'+kind,async(request,reply)=>{
  const body=kind==='trustline'?trustlineBody.parse(request.body):allowanceBody.parse(request.body),module=moduleFor(body.asset_class);
  await requireBusiness(request,module);const customer=await requireCustomer(request,body.customer_id,body.wallet_id);
  if(!await deps.verifyGate1())return unavailable('CURRENT_CUSTOMER_SIGNING_PROOF_REQUIRED');
  const key=z.string().regex(/^[\x21-\x7e]{1,200}$/).safeParse(request.headers['idempotency-key']);if(!key.success)throw new GrapnelError(400,'IDEMPOTENCY_KEY_REQUIRED','A unique setup request identifier is required');
  const amount=kind==='allowance'?circleAllowanceAmount((body as z.infer<typeof allowanceBody>).amount):null;
  const result=await deps.operations.createIdempotent({businessId:customer.businessId,customerId:customer.customerId,walletId:customer.walletId,module,type:kind==='trustline'?CIRCLE_USDC_TRUSTLINE_ACTION:CIRCLE_USDC_ALLOWANCE_ACTION,provider,route:base+'/'+kind,idempotencyKey:key.data,request:body},async(client,operationId)=>{
   await lock(client,`wallet:${customer.businessId}:${customer.walletId}:${XLM.id}`);
   const baseline=await deps.setup.readStatus(customer);statusMatches(baseline,customer,now());
   if(kind==='allowance'){
    await lock(client,`wallet:${customer.businessId}:${customer.walletId}:${CIRCLE_USDC_ASSET_ID}`);
    if(!baseline.trustline_exists||baseline.trustline_authorized!==true||baseline.spendable_before_reservations===null||atomic(baseline.spendable_before_reservations)-await activeReservations(client,customer,CIRCLE_USDC_ASSET_ID,operationId)<amount!)throw new GrapnelError(409,'INSUFFICIENT_AVAILABLE_BALANCE','Confirmed unreserved canonical Circle USDC is required for this exact approval');
   }
   const expiresAt=new Date(Math.floor(now()/1000)*1000+90000).toISOString();
   const prepared=PreparedActionSchema.parse(kind==='trustline'?await deps.setup.prepareTrustline({operationId,customer,expiresAt}):await deps.setup.prepareAllowance({operationId,customer,expiresAt,amountStellarAtomic:amount!.toString(),maxFeeStroops:CIRCLE_USDC_MAX_SETUP_FEE.toString()}));
   const tx=parse(prepared.unsignedXdr);inspectCircleSetupPrepared(prepared,tx,{customerId:customer.customerId,walletAddress:customer.walletAddress,expectedSequence:BigInt(baseline.source_sequence)+1n,now:now()});
   if(prepared.operationId!==operationId||prepared.summary.action!==(kind==='trustline'?CIRCLE_USDC_TRUSTLINE_ACTION:CIRCLE_USDC_ALLOWANCE_ACTION)||kind==='allowance'&&atomic(prepared.summary.amount??'0')!==amount)return invalid();
   if(kind==='trustline'&&baseline.trustline_exists)return unavailable('CIRCLE_TRUSTLINE_ALREADY_EXISTS');
   const reserve=kind==='trustline'?BigInt(baseline.additional_reserve_stroops):0n,fee=BigInt(prepared.summary.maxFeeStroops??'0');
   if(fee<=0n||fee>CIRCLE_USDC_MAX_SETUP_FEE||kind==='trustline'&&reserve!==BigInt(baseline.base_reserve_stroops))return invalid();
   await deps.operations.reserve(client,{businessId:customer.businessId,customerId:customer.customerId,walletId:customer.walletId,operationId,assetId:XLM.id,amountAtomic:reserve+fee,spendableAtomic:atomic(baseline.native_spendable_before_reservations),observedAt:new Date(baseline.as_of),expiresAt:new Date(prepared.authorization.expiresAt)});
   await client.query("UPDATE operations SET result_json=COALESCE(result_json,'{}'::jsonb)||$3::jsonb WHERE business_id=$1 AND customer_id=$4 AND wallet_id=$5 AND id=$2",[customer.businessId,operationId,JSON.stringify({circle_setup_baseline:baseline,bridge_completed:false}),customer.customerId,customer.walletId]);
   await deps.operations.setPrepared(client,customer.businessId,operationId,prepared);
  });return reply.code(202).send(success(request,result.operation));
 });
}
function parse(envelope:string):Transaction{const tx=TransactionBuilder.fromXDR(envelope,NETWORK_PASSPHRASE);if(!(tx instanceof Transaction))return invalid();return tx;}
export interface CircleSetupChain {
 verifyLiveNetwork():Promise<void>;
 server:Pick<rpc.Server,'getAccount'|'getLatestLedger'|'simulateTransaction'|'sendTransaction'|'getTransaction'|'getLedgerEntries'>;
 horizon:Pick<Horizon.Server,'transactions'>;
}
export interface CircleSetupExecutionDependencies extends PerpetualFundingRouteDependencies {chain:CircleSetupChain;verifyRegistry?:()=>Promise<unknown>;}
/** Internal callbacks consume only server-stored operations; caller input never supplies execution proof. */
export class CircleSetupExecutionBridge{
 private now:()=>number;
 constructor(private readonly d:CircleSetupExecutionDependencies){this.now=d.now??Date.now;}
 private async load(id:string,signedXdr:string,historical=false){
  const row=(await this.d.operations.pool.query('SELECT o.*,w.stellar_address,c.privy_user_id FROM operations o JOIN wallets w ON w.business_id=o.business_id AND w.customer_id=o.customer_id AND w.id=o.wallet_id JOIN customers c ON c.business_id=o.business_id AND c.id=o.customer_id WHERE o.id=$1',[id])).rows[0];
  if(!row||row.id!==id||row.network!==NETWORK||row.provider!==provider||typeof row.privy_user_id!=='string'||!row.privy_user_id.startsWith('did:privy:'))return invalid();
  const trustline=row.type===CIRCLE_USDC_TRUSTLINE_ACTION;if(!trustline&&row.type!==CIRCLE_USDC_ALLOWANCE_ACTION)return invalid();
  const request=trustline?trustlineBody.parse(row.request_json):allowanceBody.parse(row.request_json),action=PreparedActionSchema.parse(row.prepared_action),customer:CustomerContext={businessId:row.business_id,customerId:row.customer_id,walletId:row.wallet_id,walletAddress:row.stellar_address,privyUserId:row.privy_user_id};
  const baseline=row.result_json?.circle_setup_baseline as CircleUsdcSetupStatus|undefined;
  if(request.customer_id!==row.customer_id||request.wallet_id!==row.wallet_id||row.module_code!==moduleFor(request.asset_class)||action.operationId!==id||action.customerId!==row.customer_id||action.walletAddress!==row.stellar_address||action.summary.action!==row.type||row.approved_intent_hash!==digest(canonicalJson(action.summary))||row.xdr_hash!==digest(action.unsignedXdr)||!baseline)return invalid();
  statusMatches(baseline,customer,Date.parse(baseline.as_of));
  if(trustline?baseline.trustline_exists:!baseline.trustline_exists||baseline.trustline_authorized!==true||circleAllowanceAmount((request as z.infer<typeof allowanceBody>).amount)!==circleAllowanceAmount(action.summary.amount??''))return invalid();
  const unsigned=parse(action.unsignedXdr),signed=parse(signedXdr),hash=signed.hash().toString('hex');
  inspectCircleSetupPrepared(action,unsigned,{customerId:customer.customerId,walletAddress:customer.walletAddress,expectedSequence:BigInt(baseline.source_sequence)+1n,now:historical?Date.parse(action.authorization.expiresAt)-1:this.now()});
  if(signed.signatures.length!==1||unsigned.toEnvelope().v1().tx().toXDR('base64')!==signed.toEnvelope().v1().tx().toXDR('base64')||hash!==action.signingHashHex)return invalid();
  const key=Keypair.fromPublicKey(customer.walletAddress),signature=signed.signatures[0]!;if(!key.signatureHint().equals(signature.hint())||!key.verify(signed.hash(),signature.signature()))return invalid();
  return{row,request,action,customer,baseline,signed,hash,trustline};
 }
 async verifyForSubmission(action:PreparedAction,signedXdr:string):Promise<void>{
  const bound=await this.load(action.operationId,signedXdr);if(!same(bound.action,action))return invalid();
  const {row,customer,hash,signed,baseline,trustline}=bound;
  if(row.state==='awaiting_customer_authorization'){if(row.tx_hash||row.signed_xdr)return invalid();}
  else if(row.state!=='submitted'||row.tx_hash!==hash||row.signed_xdr!==signedXdr)return invalid();
  if(!await this.d.verifyGate1())return unavailable('CURRENT_CUSTOMER_SIGNING_PROOF_REQUIRED');
  const entitled=(await this.d.operations.pool.query("SELECT module_code FROM business_modules WHERE business_id=$1 AND module_code=ANY($2::module_code[]) AND enabled=true",[customer.businessId,[row.module_code,'capital.wallets']])).rows;
  if(![row.module_code,'capital.wallets'].every(m=>entitled.some(r=>r.module_code===m)))throw new GrapnelError(403,'MODULE_NOT_ENABLED','Current wallet and product entitlements are required');
  await this.d.chain.verifyLiveNetwork();await(this.d.verifyRegistry??readStellarRegistry)();
  const status=await this.d.setup.readStatus(customer);statusMatches(status,customer,this.now());
  const reserve=trustline?BigInt(status.additional_reserve_stroops):0n,fee=BigInt(signed.fee);
  if(BigInt(status.source_sequence)+1n!==BigInt(signed.sequence)||BigInt((await this.d.chain.server.getAccount(customer.walletAddress)).sequenceNumber())+1n!==BigInt(signed.sequence)||trustline&&(status.trustline_exists||status.base_reserve_stroops!==baseline.base_reserve_stroops||status.additional_reserve_stroops!==baseline.additional_reserve_stroops)||!trustline&&(!status.trustline_exists||status.trustline_authorized!==true))return invalid();
  if(atomic(status.native_spendable_before_reservations)-await activeReservations(this.d.operations.pool,customer,XLM.id,row.id)<reserve+fee)throw new GrapnelError(409,'INSUFFICIENT_AVAILABLE_BALANCE','Current unreserved XLM is insufficient for the exact setup');
  const holds=(await this.d.operations.pool.query("SELECT asset_id,amount_atomic::text AS amount FROM balance_reservations WHERE business_id=$1 AND customer_id=$2 AND wallet_id=$3 AND operation_id=$4 AND state='active'",[customer.businessId,customer.customerId,customer.walletId,row.id])).rows;
  if(holds.length!==1||holds[0].asset_id!==XLM.id||BigInt(holds[0].amount)!==reserve+fee)return invalid();
  if(!trustline){
   if(status.spendable_before_reservations===null||atomic(status.spendable_before_reservations)-await activeReservations(this.d.operations.pool,customer,CIRCLE_USDC_ASSET_ID,row.id)<circleAllowanceAmount(action.summary.amount??''))return invalid();
   const ledger=await this.d.chain.server.getLatestLedger();inspectCircleSetupPrepared(action,parse(action.unsignedXdr),{customerId:customer.customerId,walletAddress:customer.walletAddress,expectedSequence:BigInt(signed.sequence),currentLedger:ledger.sequence,now:this.now()});
   const sim=await this.d.chain.server.simulateTransaction(signed,undefined,'enforce');
   if(!rpc.Api.isSimulationSuccess(sim)||rpc.Api.isSimulationRestore(sim)||!sim.result||sim.result.retval.switch().name!=='scvVoid'||!/^[0-9]{1,12}$/.test(sim.minResourceFee)||!Number.isSafeInteger(sim.latestLedger)||sim.latestLedger<ledger.sequence||sim.latestLedger>ledger.sequence+12)return unavailable('CIRCLE_ALLOWANCE_SIMULATION_UNAVAILABLE');
   const approved=signed.toEnvelope().v1().tx().ext().sorobanData().resources(),actual=sim.transactionData.build().resources(),op=signed.operations[0];
   if(op.type!=='invokeHostFunction'||actual.footprint().toXDR('base64')!==approved.footprint().toXDR('base64')||actual.instructions()>approved.instructions()||actual.diskReadBytes()>approved.diskReadBytes()||actual.writeBytes()>approved.writeBytes()||BigInt(sim.minResourceFee)+100n>fee||sim.result.auth.map(a=>a.toXDR('base64')).join(':')!==(op.auth??[]).map(a=>a.toXDR('base64')).join(':'))return invalid();
  }
 }
 async broadcast(action:PreparedAction,signedXdr:string):Promise<{txHash:string}>{
  await this.verifyForSubmission(action,signedXdr);const bound=await this.load(action.operationId,signedXdr);if(bound.row.state!=='submitted')return invalid();
  const claim=await this.d.operations.pool.query("UPDATE operations SET result_json=COALESCE(result_json,'{}'::jsonb)||jsonb_build_object('circle_setup_send_claim',$6::text),updated_at=now() WHERE business_id=$1 AND customer_id=$2 AND wallet_id=$3 AND id=$4 AND tx_hash=$6 AND signed_xdr=$5 AND state='submitted' AND result_json->>'circle_setup_send_claim' IS NULL RETURNING id",[bound.customer.businessId,bound.customer.customerId,bound.customer.walletId,action.operationId,signedXdr,bound.hash]);
  if(claim.rowCount!==1)return unavailable('CIRCLE_SETUP_SEND_ALREADY_CLAIMED');
  try{const sent=await this.d.chain.server.sendTransaction(bound.signed);if(sent.hash!==bound.hash)throw new GrapnelError(502,'PROVIDER_INVALID','Circle setup submission hash differs from its signed envelope');if(sent.status==='ERROR')throw new GrapnelError(409,'CHAIN_REJECTED','The network rejected Circle USDC setup');if(!['PENDING','DUPLICATE'].includes(sent.status))return unavailable('CIRCLE_SETUP_SUBMISSION_UNCERTAIN');return{txHash:bound.hash};}
  catch(error){if(error instanceof GrapnelError)throw error;throw new GrapnelError(503,'SUBMISSION_UNCERTAIN','Reconcile the retained Circle setup hash before any retry',true,{tx_hash:bound.hash});}
 }
 async verifyDeltas(id:string,hash:string):Promise<DeltaVerification>{
  try{
   const record=(await this.d.operations.pool.query('SELECT signed_xdr FROM operations WHERE id=$1 AND tx_hash=$2',[id,hash])).rows[0];if(!record?.signed_xdr)return{verified:false,result:{reason:'CIRCLE_SETUP_HASH_UNAVAILABLE',bridge_completed:false}};
   const b=await this.load(id,record.signed_xdr,true);if(b.row.tx_hash!==hash||b.hash!==hash||!['submitted','confirming','recovery_required','completed'].includes(b.row.state))return invalid();
   await this.d.chain.verifyLiveNetwork();
   let ledger:number;
   if(b.trustline){const tx=await this.d.chain.horizon.transactions().transaction(hash).call();if(!tx.successful||tx.hash!==hash||tx.envelope_xdr!==record.signed_xdr||tx.source_account!==b.customer.walletAddress||tx.source_account_sequence!==b.signed.sequence||String(tx.fee_charged)!==b.signed.fee)return invalid();ledger=tx.ledger_attr;}
   else{const tx=await this.d.chain.server.getTransaction(hash);if(tx.status!=='SUCCESS'||tx.txHash!==hash||tx.envelopeXdr.toXDR('base64')!==record.signed_xdr||tx.resultXdr.result().switch().name!=='txSuccess')return invalid();ledger=tx.ledger;}
   if(!Number.isSafeInteger(ledger)||ledger<=0)return invalid();
   const after=await this.d.setup.readStatus(b.customer);statusMatches(after,b.customer,this.now());if(after.as_of_ledger<ledger||BigInt(after.source_sequence)<BigInt(b.signed.sequence)||!after.trustline_exists||after.trustline_authorized!==true)return invalid();
   const proof:Record<string,unknown>={verified:true,operation:b.row.type,tx_hash:hash,ledger,asset_id:CIRCLE_USDC_ASSET_ID,wallet_address:b.customer.walletAddress,bridge_completed:false};
   if(b.trustline){if(after.trustline_limit!==CIRCLE_USDC_TRUSTLINE_LIMIT||b.baseline.trustline_exists)return invalid();proof.trustline_created=true;proof.limit=after.trustline_limit;}
   else{
    const amount=circleAllowanceAmount(b.action.summary.amount??''),expiration=Number(b.action.summary.allowanceExpirationLedger),data=b.signed.toEnvelope().v1().tx().ext().sorobanData(),key=data.resources().footprint().readWrite()[0]!,entries=await this.d.chain.server.getLedgerEntries(key);
    if(entries.latestLedger<ledger||entries.latestLedger>=expiration||entries.entries.length!==1)return invalid();const entry=entries.entries[0]!;
    if(entry.key.toXDR('base64')!==key.toXDR('base64')||entry.val.switch().name!=='contractData'||entry.lastModifiedLedgerSeq!==ledger)return invalid();
    const stored=entry.val.contractData(),value:unknown=scValToNative(stored.val());
    if(stored.contract().toXDR('base64')!==key.contractData().contract().toXDR('base64')||stored.durability().name!=='temporary'||!same(stored.key().toXDR('base64'),key.contractData().key().toXDR('base64'))||!value||typeof value!=='object'||Array.isArray(value))return invalid();
    const fields=stored.val().switch().name==='scvMap'?stored.val().map():null;if(!fields||fields.length!==2||fields[0]!.key().switch().name!=='scvSymbol'||fields[0]!.key().sym().toString()!=='amount'||fields[0]!.val().switch().name!=='scvI128'||fields[1]!.key().switch().name!=='scvSymbol'||fields[1]!.key().sym().toString()!=='expiration_ledger'||fields[1]!.val().switch().name!=='scvU32')return invalid();
    const v=value as Record<string,unknown>;if(Object.keys(v).sort().join(',')!=='amount,expiration_ledger'||v.amount!==amount||v.expiration_ledger!==expiration||after.allowance_read_available!==true||after.allowance_atomic!==amount.toString())return invalid();
    proof.allowance_atomic=amount.toString();proof.allowance_expiration_ledger=expiration;proof.spender=P.stellar.messenger;
   }
   return{verified:true,result:{circle_setup_verification:proof,bridge_completed:false}};
  }catch{return{verified:false,result:{reason:'CIRCLE_SETUP_EVIDENCE_UNAVAILABLE',bridge_completed:false}};}
 }
}
