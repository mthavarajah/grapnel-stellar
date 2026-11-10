import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { z } from 'zod';
import { GrapnelError, NETWORK_PASSPHRASE, WalletInputSchema, AmountSchema, XLM, toAtomic } from '@grapnel/contracts';
import { buildApp } from './app.js';
import { createPool } from './db/index.js';
import { loadConfig } from './lib/config.js';
import { requireBusiness, requireCustomer, success } from './lib/context.js';
import { createPrivyClient, PrivyIdentityVerifier, PrivyWalletSigner } from './adapters/privy/index.js';
import { parseTestnetTransaction, StellarTestnetExecutor, verifySignedAction } from './adapters/stellar/index.js';
import { TestnetFundingAdapter } from './adapters/testnet-funding/index.js';
import { SoroswapSpotAdapter } from './adapters/soroswap/index.js';
import { SpotService } from './modules/spot/service.js';
import { registerSpotRoutes } from './modules/spot/routes.js';
import { WalletService } from './modules/wallets/service.js';
import { FundingService } from './modules/funding/service.js';
import { registerFundingRoutes } from './modules/funding/routes.js';
import { OperationService } from './modules/operations/service.js';
import { OperationWorker, type WorkerChain } from './modules/operations/worker.js';

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
 const app=await buildApp({pool:db,config,identityVerifier:identity,
  verifySignedAction:async(action,signed)=>{verifySignedAction(action,signed);return {txHash:parseTestnetTransaction(signed).hash().toString('hex')};},
  balanceReader:address=>chain.getClassicBalances(address),
  capabilities:{
   'trade.spot':async()=>spot.capability(),
   'capital.wallets':async()=>({execution_status:gate1Passed?'testnet_verified':'blocked',reason:gate1Passed?null:privy?'Privy-signed Testnet payment proof is pending':'PRIVY_APP_ID and PRIVY_APP_SECRET are required',actions:gate1Passed?['provision','balances','test_payment']:[]}),
   'capital.testnet_funding':async()=>({execution_status:'blocked',reason:funding.blockedReason()??'Confirmed funding and return proof required',actions:[]})
  },
  registerAdapters:async app=>{
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
   await registerSpotRoutes(app,{service:new SpotService(spot,db,operations),requireBusiness,requireCustomer,success,readPositions:async customer=>({wallet_holdings:await wallets.balances(customer.businessId,customer.walletId),venue_positions:[]})});
   await registerFundingRoutes(app,{service:new FundingService(funding,operations),requireBusiness,requireCustomer,success});
  }
 });
 app.addHook('onClose',async()=>{if(!pool)await db.end();});
 const workerChain:WorkerChain={
  async lookup(hash){const state=await chain.reconcile(hash);return {state,found:state!=='pending'};},
  async broadcast(envelope){
   const hash=parseTestnetTransaction(envelope).hash().toString('hex');
   const operation=(await db.query('SELECT type FROM operations WHERE tx_hash=$1 AND signed_xdr=$2',[hash,envelope])).rows[0];
   if(!operation || (!gate1Passed && operation.type!=='wallet.test_payment'))throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Gate 1 proof is required before financial provider execution');
   return chain.submit(envelope,'durably-recorded');
  },
  async verifyDeltas(id,hash){
   const op=(await db.query('SELECT * FROM operations WHERE id=$1 AND tx_hash=$2',[id,hash])).rows[0];
   if(!op)return false;
   const tx=await chain.horizon.transactions().transaction(hash).call();if(!tx.successful)return false;
   const parsed=parseTestnetTransaction(op.signed_xdr);const payment=parsed.operations[0];
   if(payment?.type!=='payment'||!payment.asset.isNative())return false;
   const amount=op.request_json.amount;
   if(payment.amount!==amount && toAtomic(payment.amount,7)!==toAtomic(amount,7))return false;
   const effects=await chain.horizon.effects().forTransaction(hash).limit(200).call();
   const credited=effects.records.some(e=>e.type==='account_credited'&&e.account===payment.destination&&e.asset_type==='native'&&toAtomic(e.amount,7)===toAtomic(amount,7));
   const debited=effects.records.some(e=>e.type==='account_debited'&&e.account===parsed.source&&e.asset_type==='native'&&toAtomic(e.amount,7)===toAtomic(amount,7));
   return credited&&debited;
  }
 };
 return {app,config,pool:db,chain,wallets,operations,funding,gate1Passed,worker:new OperationWorker(db,workerChain)};
}
