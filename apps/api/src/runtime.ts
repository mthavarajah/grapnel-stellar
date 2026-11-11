import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { z } from 'zod';
import { GrapnelError, NETWORK_PASSPHRASE, WalletInputSchema, AmountSchema, XLM, toAtomic, fromAtomic, PreparedActionSchema, type CustomerContext, type PreparedAction, type WalletBalance } from '@grapnel/contracts';
import { buildApp } from './app.js';
import { createPool } from './db/index.js';
import { loadConfig } from './lib/config.js';
import { requireBusiness, requireCustomer, success } from './lib/context.js';
import { createPrivyClient, PrivyIdentityVerifier, PrivyWalletSigner } from './adapters/privy/index.js';
import { parseTestnetTransaction, StellarTestnetExecutor, verifySignedAction } from './adapters/stellar/index.js';
import { TestnetFundingAdapter } from './adapters/testnet-funding/index.js';
import { BlendSorobanPreparer } from './adapters/stellar/blend-soroban.js';
import { BlendAdapter, type BlendPosition } from './adapters/blend/index.js';
import { registerLendingRoutes } from './modules/lending/routes.js';
import { SoroswapSpotAdapter } from './adapters/soroswap/index.js';
import { SpotService } from './modules/spot/service.js';
import { registerSpotRoutes } from './modules/spot/routes.js';
import { WalletService } from './modules/wallets/service.js';
import { hasFundingRoundTripProof, verifyNativeTransfer } from './modules/funding/readiness.js';
import { FundingService } from './modules/funding/service.js';
import { registerFundingRoutes } from './modules/funding/routes.js';
import { OperationService } from './modules/operations/service.js';
import { OperationWorker, type WorkerChain, type DeltaVerification } from './modules/operations/worker.js';

/** A flag or credentials alone cannot establish a passed signing gate. */
export async function hasGate1Proof(chain:StellarTestnetExecutor):Promise<boolean> {
 try {
  const evidence=JSON.parse(await readFile(new URL('../../../evidence/testnet.json',import.meta.url),'utf8'));
  const proof=evidence.gate1;
  if(proof?.signer!=='privy_stellar' || proof.auth_tests_passed!==true || proof.intent_verified!==true || !/^[a-f0-9]{64}$/.test(proof.tx_hash??''))return false;
  const tx=await chain.horizon.transactions().transaction(proof.tx_hash).call();
  return tx.successful===true && tx.source_account===proof.wallet_address;
 }catch{return false;}
}
export async function createRuntime(pool?:Pool) {
 const config=loadConfig();
 const db=pool??createPool(config.databaseUrl);
 const chain=new StellarTestnetExecutor({network:config.network,passphrase:config.networkPassphrase,rpcUrl:process.env.STELLAR_RPC_URL,horizonUrl:process.env.STELLAR_HORIZON_URL,maxFeeStroops:'10000'});
 const privy=createPrivyClient();
 const identity=new PrivyIdentityVerifier(privy);
 const signer=new PrivyWalletSigner(privy,async(customerId,userId)=>!!(await db.query('SELECT 1 FROM customers WHERE id=$1 AND privy_user_id=$2',[customerId,userId])).rowCount);
 const wallets=new WalletService(db,identity,chain,signer);
 const operations=new OperationService(db);
 const gate1Passed=await hasGate1Proof(chain);
 const funding=new TestnetFundingAdapter({network:config.network,networkPassphrase:NETWORK_PASSPHRASE,treasurySecret:process.env.DEMO_TREASURY_SECRET,enabled:process.env.TESTNET_FUNDING_ENABLED==='true',gate1Passed,maxPerCustomerAtomic:BigInt(process.env.TESTNET_FUNDING_MAX_PER_CUSTOMER_ATOMIC??'250000000'),maxPerTenantAtomic:BigInt(process.env.TESTNET_FUNDING_MAX_PER_TENANT_ATOMIC??'1000000000'),maxGlobalAtomic:BigInt(process.env.TESTNET_FUNDING_MAX_GLOBAL_ATOMIC??'2000000000')});
 const spot=new SoroswapSpotAdapter({network:config.network,networkPassphrase:NETWORK_PASSPHRASE,apiKey:process.env.SOROSWAP_API_KEY,gate1Passed});
 const soroban=new BlendSorobanPreparer({network:config.network,passphrase:NETWORK_PASSPHRASE,rpcUrl:process.env.STELLAR_RPC_URL,gate1Passed});
 const blend=new BlendAdapter({network:config.network,passphrase:NETWORK_PASSPHRASE,rpcUrl:process.env.STELLAR_RPC_URL,gate1Passed},{prepareAndSimulate:input=>soroban.prepare(input)});
 let fundingVerified=false;let fundingProofAt=0;let fundingProofRunning=false;
 const readFundingReadiness=async()=>{
  if(!await hasGate1Proof(chain))return {execution_status:'blocked' as const,reason:'GATE_1_SIGNING_PROOF_REQUIRED',actions:[]};
  const reason=funding.blockedReason();
  if(reason)return {execution_status:'blocked' as const,reason,actions:[]};
  if(!fundingProofRunning && Date.now()-fundingProofAt>30000){fundingProofRunning=true;void hasFundingRoundTripProof(db,funding.treasuryAddress!,proof=>verifyNativeTransfer(chain,proof)).then(value=>{fundingVerified=value;}).catch(()=>{fundingVerified=false;}).finally(()=>{fundingProofAt=Date.now();fundingProofRunning=false;});}
  return {execution_status:fundingVerified?'testnet_verified' as const:'blocked' as const,reason:fundingVerified?null:'Confirmed treasury grant and customer return evidence is required; initial acceptance runs through the restricted API',actions:fundingVerified?['fund','return']:[]};
 };
 let blendReadiness:{execution_status:'blocked'|'discovery_only';reason:string;actions:string[]}={execution_status:'blocked',reason:'Current Blend readiness probe is pending; financial execution remains gated',actions:[]};
 let blendProbeAt=0;let blendProbeRunning=false;
 const readBlendReadiness=async()=>{
  if(!blendProbeRunning && Date.now()-blendProbeAt>30000){
   blendProbeRunning=true;
   void blend.capabilities().then(value=>{blendReadiness=value;}).catch(()=>{blendReadiness={execution_status:'blocked',reason:'Current Blend Testnet reads are unavailable',actions:[]};}).finally(()=>{blendProbeAt=Date.now();blendProbeRunning=false;});
  }
  return blendReadiness;
 };
 const app=await buildApp({pool:db,config,identityVerifier:identity,
  verifySignedAction:async(action,signed)=>{if(action.summary.action==='blend.supply')await soroban.verifyForSubmission(action,signed);else verifySignedAction(action,signed);return {txHash:parseTestnetTransaction(signed).hash().toString('hex')};},
  balanceReader:address=>chain.getClassicBalances(address),
  capabilities:{
   'capital.lending':readBlendReadiness,
   'trade.spot':async()=>spot.capability(),
   'capital.wallets':async()=>{const current=await hasGate1Proof(chain);return {execution_status:current?'testnet_verified':'blocked',reason:current?null:privy?'Privy-signed Testnet payment proof is pending':'PRIVY_APP_ID and PRIVY_APP_SECRET are required',actions:current?['provision','balances','test_payment']:[]};},
   'capital.testnet_funding':readFundingReadiness
  },
  registerAdapters:async app=>{
   // Revalidate the actual chain proof for every new provider intent. A
   // startup snapshot must not survive a Testnet reset or unavailable proof.
   app.addHook('preHandler',async request=>{
    if(request.method!=='POST')return;
    const path=request.url.split('?')[0]!;
    const module=path.startsWith('/v1/capital/testnet/')?'capital.testnet_funding':path.startsWith('/v1/capital/lending/')?'capital.lending':path.startsWith('/v1/trade/')?'trade.spot':null;
    if(!module)return;
    await requireBusiness(request,module);
    if(!await hasGate1Proof(chain))throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Current Gate 1 chain proof is required before financial provider execution');
   });
   app.post('/v1/capital/wallets',async request=>{const business=await requireBusiness(request,'capital.wallets');const body=WalletInputSchema.parse(request.body);return success(request,await wallets.provision(business.businessId,body.customer_id,body.privy_identity_proof));});
   app.get('/v1/capital/wallets/:id',async request=>{const b=await requireBusiness(request,'capital.wallets');return success(request,await wallets.get(b.businessId,(request.params as {id:string}).id));});
   app.get('/v1/capital/wallets/:id/balances',async request=>{const b=await requireBusiness(request,'capital.wallets');return success(request,await wallets.balances(b.businessId,(request.params as {id:string}).id));});
   // Restricted signing-gate payment: customer authorizes a maximum 1 XLM to the fixed Testnet treasury.
   app.post('/v1/capital/wallets/:id/test-payment',async(request,reply)=>{
    const b=await requireBusiness(request,'capital.wallets');
    const body=z.object({customer_id:z.string().uuid(),amount:AmountSchema}).strict().parse(request.body);
    const id=(request.params as {id:string}).id;
    const customer=await requireCustomer(request,body.customer_id,id);
    if(!funding.treasuryAddress)throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Testnet treasury recipient is not configured');
    let amount:bigint;try{amount=toAtomic(body.amount,7);}catch{throw new GrapnelError(422,'INVALID_AMOUNT','A positive amount with at most seven decimals is required');}
    if(amount>10000000n)throw new GrapnelError(422,'INVALID_AMOUNT','Signing-gate payment is limited to 1 Testnet XLM');
    const result=await operations.createIdempotent({businessId:b.businessId,customerId:customer.customerId,walletId:id,module:'capital.wallets',type:'wallet.test_payment',provider:'stellar_privy',route:'/v1/capital/wallets/:id/test-payment',idempotencyKey:String(request.headers['idempotency-key']??''),request:{wallet_id:id,...body}},async(client,operationId)=>{
     const balances=await chain.getClassicBalances(customer.walletAddress);const balance=balances.find(x=>x.asset_id===XLM.id);
     const prepared=await chain.preparePayment({operationId,customerId:customer.customerId,walletAddress:customer.walletAddress,recipient:funding.treasuryAddress!,asset:XLM,amount:body.amount,action:'wallet.test_payment'});
     await operations.reserve(client,{businessId:b.businessId,customerId:customer.customerId,walletId:id,operationId,assetId:XLM.id,amountAtomic:amount,spendableAtomic:balance&& !/^0(?:\.0+)?$/.test(balance.spendable)?toAtomic(balance.spendable,7):0n,observedAt:new Date(balance?.as_of??0),expiresAt:new Date(prepared.summary.expiresAt)});
     await operations.setPrepared(client,b.businessId,operationId,prepared);
    });
    return reply.code(202).send(success(request,result.operation));
   });
   await registerLendingRoutes(app,{adapter:blend,operations,balanceReader:address=>chain.getClassicBalances(address)});
   await registerSpotRoutes(app,{service:new SpotService(spot,db,operations),requireBusiness,requireCustomer,success,readPositions:async customer=>({wallet_holdings:await wallets.balances(customer.businessId,customer.walletId),venue_positions:[]})});
   await registerFundingRoutes(app,{service:new FundingService(funding,operations),requireBusiness,requireCustomer,success});
  }
 });
 app.addHook('onClose',async()=>{if(!pool)await db.end();});
 const workerChain=createRuntimeWorkerChain({pool:db,chain,blend,soroban,gate1Passed,verifyGate1:()=>hasGate1Proof(chain)});
 return {app,config,pool:db,chain,wallets,operations,funding,gate1Passed,worker:new OperationWorker(db,workerChain)};
}


const zeroAtomic=(value:string):bigint=>/^0(?:\.0+)?$/.test(value)?0n:toAtomic(value,7);
const fresh=(date:string,maximumAge:number,now:number):boolean=>Number.isFinite(Date.parse(date))&&now-Date.parse(date)<=maximumAge&&Date.parse(date)<=now+1000;
export interface SupplyBaseline {asset_id:string;market_id:string;pool_contract_id:string;reserve_contract_id:string;wallet_address:string;wallet_amount:string;collateral:string;as_of:string;position_as_of:string;position_ledger:number;}
const baselineSchema=z.object({asset_id:z.literal(XLM.id),market_id:z.string(),pool_contract_id:z.string(),reserve_contract_id:z.string(),wallet_address:z.string(),wallet_amount:AmountSchema,collateral:AmountSchema,as_of:z.string().datetime(),position_as_of:z.string().datetime(),position_ledger:z.number().int().positive()}).strict();
/** RPC success plus the exact inspected invocation is required before these observations are used. */
export function inspectSupplyDeltas(input:{baseline:unknown;request:{asset_id?:unknown;market_id?:unknown;amount?:unknown};walletAddress:string;positions:BlendPosition[];balances:WalletBalance[];confirmedLedger:number;now?:number}):DeltaVerification {
 const unverified=(reason:string):DeltaVerification=>({verified:false,result:{blend_supply_verification:{verified:false,reason,observed_at:new Date(input.now??Date.now()).toISOString()}}});
 try{
  const parsed=baselineSchema.safeParse(input.baseline);if(!parsed.success)return unverified('MISSING_VERIFIED_BASELINE');
  const baseline=parsed.data;const now=input.now??Date.now();
  if(input.request.asset_id!==XLM.id || input.request.market_id!==baseline.market_id || input.walletAddress!==baseline.wallet_address || typeof input.request.amount!=='string')return unverified('SUPPLY_BASELINE_MISMATCH');
  if(!Number.isSafeInteger(input.confirmedLedger)||input.confirmedLedger<=0)return unverified('CONFIRMED_LEDGER_REQUIRED');
  const position=input.positions.find(position=>position.market_id===baseline.market_id&&position.asset_id===XLM.id&&position.pool_contract_id===baseline.pool_contract_id&&position.reserve_contract_id===baseline.reserve_contract_id);
  const balance=input.balances.find(balance=>balance.asset_id===XLM.id&&balance.source==='stellar_horizon_testnet');
  if(!position||!balance)return unverified('MISSING_POST_CHAIN_OBSERVATION');
  if(!Number.isSafeInteger(position.as_of_ledger)||position.as_of_ledger<=0||!fresh(position.as_of,30000,now)||!fresh(balance.as_of,15000,now)||Date.parse(position.as_of)<Date.parse(baseline.position_as_of)||Date.parse(balance.as_of)<Date.parse(baseline.as_of)||position.as_of_ledger<input.confirmedLedger||position.as_of_ledger<baseline.position_ledger)return unverified('POST_CHAIN_OBSERVATION_STALE');
  const amount=toAtomic(input.request.amount,7);
  const beforeCollateral=zeroAtomic(baseline.collateral),afterCollateral=zeroAtomic(position.collateral);
  const beforeWallet=zeroAtomic(baseline.wallet_amount),afterWallet=zeroAtomic(balance.wallet_amount);
  const collateralDelta=afterCollateral-beforeCollateral,walletDebit=beforeWallet-afterWallet;
  // Blend b-token conversion may round supplied units. Confirm actual collateral growth,
  // the exact atomic invocation, and a real wallet debit covering the requested asset.
  if(collateralDelta<=0n||walletDebit<amount)return unverified('SUPPLY_POSITION_OR_WALLET_DELTA_MISSING');
  return {verified:true,result:{blend_supply_verification:{verified:true,asset_id:XLM.id,market_id:baseline.market_id,pool_contract_id:baseline.pool_contract_id,reserve_contract_id:baseline.reserve_contract_id,requested_atomic:amount.toString(),collateral_before:baseline.collateral,collateral_after:position.collateral,collateral_delta:fromAtomic(collateralDelta,7),wallet_before:baseline.wallet_amount,wallet_after:balance.wallet_amount,wallet_debit:fromAtomic(walletDebit,7),confirmed_ledger:input.confirmedLedger,observed_ledger:position.as_of_ledger,position_as_of:position.as_of,wallet_as_of:balance.as_of,observed_at:new Date(now).toISOString()}}};
 }catch{return unverified('INVALID_SUPPLY_OBSERVATION');}
}
export interface RuntimeWorkerDependencies {pool:Pool;chain:StellarTestnetExecutor;blend:Pick<BlendAdapter,'positions'>;soroban:Pick<BlendSorobanPreparer,'verifyForSubmission'>;gate1Passed:boolean;verifyGate1?:()=>Promise<boolean>;}
/** No network send exists outside the durable worker's recorded hash/envelope path. */
export function createRuntimeWorkerChain(deps:RuntimeWorkerDependencies):WorkerChain {
 const {pool,chain,blend,soroban,gate1Passed}=deps;
 return {
  async lookup(hash){const state=await chain.reconcile(hash);return {state,found:state!=='pending'};},
  async broadcast(envelope){
   const parsed=parseTestnetTransaction(envelope);const hash=parsed.hash().toString('hex');
   const operation=(await pool.query('SELECT o.*,w.stellar_address,c.privy_user_id FROM operations o JOIN wallets w ON w.business_id=o.business_id AND w.customer_id=o.customer_id AND w.id=o.wallet_id JOIN customers c ON c.business_id=o.business_id AND c.id=o.customer_id WHERE o.tx_hash=$1 AND o.signed_xdr=$2',[hash,envelope])).rows[0];
   if(!operation || (operation.type!=='wallet.test_payment' && (!gate1Passed || !await (deps.verifyGate1?.()??Promise.resolve(false)))))throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Gate 1 proof is required before financial provider execution');
   if(operation.type==='blend.supply'){
    if(operation.module_code!=='capital.lending'||operation.provider!=='blend'||typeof operation.privy_user_id!=='string'||!operation.privy_user_id.startsWith('did:privy:'))throw new GrapnelError(403,'INTENT_MISMATCH','Stored operation is not an approved Blend supply');
    const action=PreparedActionSchema.parse(operation.prepared_action);
    if(action.operationId!==operation.id||action.customerId!==operation.customer_id||action.walletAddress!==operation.stellar_address||operation.request_json.asset_id!==XLM.id||action.summary.fromAssetId!==XLM.id||zeroAtomic(action.summary.amount??'')!==toAtomic(operation.request_json.amount,7))throw new GrapnelError(403,'INTENT_MISMATCH','Stored supply and customer approval do not match');
    await soroban.verifyForSubmission(action,envelope);
    await chain.verifyLiveNetwork();
    try{
     const sent=await chain.server.sendTransaction(parsed);
     if(sent.hash!==hash)throw new GrapnelError(502,'PROVIDER_INVALID','RPC transaction hash mismatch');
     if(sent.status==='ERROR')throw new GrapnelError(409,'CHAIN_REJECTED','Stellar rejected the inspected supply transaction');
     if(sent.status==='TRY_AGAIN_LATER')throw new GrapnelError(503,'SUBMISSION_UNCERTAIN','Reconcile the persisted transaction hash before any retry',true,{tx_hash:hash});
     if(!['PENDING','DUPLICATE'].includes(sent.status))throw new GrapnelError(503,'SUBMISSION_UNCERTAIN','Unexpected RPC submission state; reconcile the stored hash',true,{tx_hash:hash});
     return {txHash:hash};
    }catch(error){if(error instanceof GrapnelError)throw error;throw new GrapnelError(503,'SUBMISSION_UNCERTAIN','Reconcile the persisted transaction hash before any retry',true,{tx_hash:hash});}
   }
   if(!['wallet.test_payment','testnet.fund','testnet.return'].includes(operation.type))throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','No reviewed submission path exists for this operation');
   return chain.submit(envelope,operation.id);
  },
  async verifyDeltas(id,hash){
   const op=(await pool.query('SELECT o.*,w.stellar_address,c.privy_user_id FROM operations o JOIN wallets w ON w.business_id=o.business_id AND w.customer_id=o.customer_id AND w.id=o.wallet_id JOIN customers c ON c.business_id=o.business_id AND c.id=o.customer_id WHERE o.id=$1 AND o.tx_hash=$2',[id,hash])).rows[0];
   if(!op)return false;
   if(op.type==='blend.supply'){
    if(op.module_code!=='capital.lending'||op.provider!=='blend'||typeof op.privy_user_id!=='string'||!op.privy_user_id.startsWith('did:privy:'))return false;
    const confirmed=await chain.server.getTransaction(hash);
    if(confirmed.status!=='SUCCESS')return false;
    const action=PreparedActionSchema.parse(op.prepared_action);
    if(action.operationId!==op.id||action.customerId!==op.customer_id||action.walletAddress!==op.stellar_address||action.summary.action!=='blend.supply'||action.summary.fromAssetId!==XLM.id||op.request_json.asset_id!==XLM.id||zeroAtomic(action.summary.amount??'')!==toAtomic(op.request_json.amount,7))return false;
    const customer:CustomerContext={businessId:op.business_id,customerId:op.customer_id,walletId:op.wallet_id,walletAddress:op.stellar_address,privyUserId:op.privy_user_id};
    try{
     const [positions,balances]=await Promise.all([blend.positions(customer),chain.getClassicBalances(customer.walletAddress)]);
     return inspectSupplyDeltas({baseline:op.result_json?.blend_supply_baseline,request:op.request_json,walletAddress:customer.walletAddress,positions,balances,confirmedLedger:confirmed.ledger});
    }catch{return {verified:false,result:{blend_supply_verification:{verified:false,reason:'LIVE_SUPPLY_RECONCILIATION_UNAVAILABLE'}}};}
   }
   const tx=await chain.horizon.transactions().transaction(hash).call();if(!tx.successful)return false;
   const parsed=parseTestnetTransaction(op.signed_xdr);const payment=parsed.operations[0];
   if(payment?.type!=='payment'||!payment.asset.isNative())return false;
   const amount=op.request_json.amount;
   if(payment.amount!==amount&&toAtomic(payment.amount,7)!==toAtomic(amount,7))return false;
   const effects=await chain.horizon.effects().forTransaction(hash).limit(200).call();
   const credited=effects.records.some(e=>e.type==='account_credited'&&e.account===payment.destination&&e.asset_type==='native'&&toAtomic(e.amount,7)===toAtomic(amount,7));
   const debited=effects.records.some(e=>e.type==='account_debited'&&e.account===parsed.source&&e.asset_type==='native'&&toAtomic(e.amount,7)===toAtomic(amount,7));
   return credited&&debited;
  }
 };
}
