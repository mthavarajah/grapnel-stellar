import { PoolV2, PoolContractV2, RequestType, TokenMetadata, type Pool, type PoolUser, type Reserve } from '@blend-capital/blend-sdk';
import { Account, Address, Asset, Contract, StrKey, TransactionBuilder, rpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import { GrapnelError, NETWORK, NETWORK_PASSPHRASE, XLM, fromAtomic, toAtomic, type AssetIdentity, type ChainAction, type CustomerContext, type PreparedAction } from '@grapnel/contracts';

export const BLEND_REGISTRY_URL = 'https://raw.githubusercontent.com/blend-capital/blend-utils/main/testnet.contracts.json';
export interface BlendConfig { network:string;passphrase:string;rpcUrl?:string;gate1Passed?:boolean; }
export interface BlendReadDependencies {
 fetcher?:typeof fetch;
 loadPool?:(poolId:string)=>Promise<Pool>;
 loadToken?:(tokenId:string)=>Promise<TokenMetadata>;
 tokenBalance?:(tokenId:string,owner:string)=>Promise<{amount:bigint;ledger:number}>;
 verifyNetwork?:()=>Promise<void>;
 prepareAndSimulate?:(input:ChainAction)=>Promise<PreparedAction>;
}
export interface BlendMarket {
 market_id:string;provider:'blend';network:typeof NETWORK;pool_contract_id:string;pool_name:string;
 reserve_contract_id:string;asset_id:string;asset:AssetIdentity;pool_status:number;
 supply_apy_variable:number|null;borrow_apy_variable:number|null;available_liquidity:string|null;
 total_supplied:string;total_borrowed:string;as_of:string;as_of_ledger:number;
 execution_status:'blocked'|'discovery_only';executable:false;reason:string;
}
export interface BlendPosition {
 market_id:string;pool_contract_id:string;reserve_contract_id:string;asset_id:string;
 supplied:string;collateral:string;borrowed:string;wallet_spendable:false;
 supply_apy_variable:number|null;health_factor:null;as_of_ledger:number;as_of:string;
 readiness:'discovery_only';
}
export interface BlendIntent {action:'supply'|'withdraw';poolId:string;reserveId:string;walletAddress:string;amountAtomic:bigint;}
interface Snapshot {pool:Pool;markets:BlendMarket[];observedAt:number;}
const unavailable=(reason:string,message='Blend Testnet execution is unavailable'):never=>{throw new GrapnelError(409,'EXECUTION_UNAVAILABLE',message,false,{reason});};
const providerFailure=(message:string):never=>{throw new GrapnelError(503,'BLEND_UNAVAILABLE',message,true);};
const apy=(value:number):number|null=>Number.isFinite(value)&&value>=0?value:null;
function bounded<T>(promise:Promise<T>,ms=15000):Promise<T>{
 let timer:ReturnType<typeof setTimeout>;
 return Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new GrapnelError(503,'BLEND_UNAVAILABLE','Blend read timed out',true)),ms);})]).finally(()=>clearTimeout(timer));
}
/** Build only a locally declared, single collateral request. Never accept provider/caller XDR. */
export function buildBlendOperation(intent:BlendIntent):string {
 if(!StrKey.isValidContract(intent.poolId)||!StrKey.isValidContract(intent.reserveId)||!StrKey.isValidEd25519PublicKey(intent.walletAddress)||intent.amountAtomic<=0n||intent.amountAtomic>=(1n<<127n))throw new GrapnelError(422,'INVALID_BLEND_INTENT','Invalid exact Blend intent');
 return new PoolContractV2(intent.poolId).submit({from:intent.walletAddress,spender:intent.walletAddress,to:intent.walletAddress,requests:[{request_type:intent.action==='supply'?RequestType.SupplyCollateral:RequestType.WithdrawCollateral,address:intent.reserveId,amount:intent.amountAtomic}]});
}
/** Strict pre-simulation inspector: compares complete op including recipient/amount/request/auth bytes. */
export function inspectBlendOperation(operationXdr:string,intent:BlendIntent):void {
 try {
  const actual=xdr.Operation.fromXDR(operationXdr,'base64');
  const expected=xdr.Operation.fromXDR(buildBlendOperation(intent),'base64');
  if(actual.toXDR('base64')!==expected.toXDR('base64'))throw new Error('mismatch');
 }catch{throw new GrapnelError(403,'BLEND_INTENT_MISMATCH','Blend operation does not match the exact approved request');}
}

/** Live reads are enabled; financial execution remains behind Gate 1 and reviewed Soroban integration. */
export class BlendAdapter {
 private readonly fetcher:typeof fetch;
 private readonly server:rpc.Server;
 private readonly network:{rpc:string;passphrase:string};
 private cachedSnapshot?:Snapshot;
 private loadingSnapshot?:Promise<Snapshot>;
 constructor(readonly config:BlendConfig,private readonly deps:BlendReadDependencies={}) {
  if(config.network!=='testnet'||config.passphrase!==NETWORK_PASSPHRASE||(config.rpcUrl&&config.rpcUrl!=='https://soroban-testnet.stellar.org'))throw new GrapnelError(400,'NETWORK_MISMATCH','Blend is restricted to official Stellar Testnet');
  this.network={rpc:config.rpcUrl??'https://soroban-testnet.stellar.org',passphrase:NETWORK_PASSPHRASE};
  this.server=new rpc.Server(this.network.rpc);this.fetcher=deps.fetcher??fetch;
 }
 async verifyNetwork():Promise<void>{
  if(this.deps.verifyNetwork)return this.deps.verifyNetwork();
  if((await bounded(this.server.getNetwork())).passphrase!==NETWORK_PASSPHRASE)throw new GrapnelError(400,'NETWORK_MISMATCH','Blend RPC does not report Testnet');
 }
 private async registry():Promise<{poolId:string;ids:Record<string,string>}> {
  let response:Response;
  try{response=await this.fetcher(BLEND_REGISTRY_URL,{signal:AbortSignal.timeout(12000)});}catch{return providerFailure('Official Blend Testnet registry unavailable');}
  if(!response.ok)return providerFailure('Official Blend Testnet registry unavailable');
  let body:{ids?:Record<string,string>};try{body=await response.json();}catch{return providerFailure('Invalid official Blend registry response');}
  if(!body.ids?.TestnetV2||!StrKey.isValidContract(body.ids.TestnetV2)||body.ids.XLM!==Asset.native().contractId(NETWORK_PASSPHRASE))return providerFailure('Blend registry has invalid Testnet pool or native asset mapping');
  return {poolId:body.ids.TestnetV2,ids:body.ids};
 }
 private async balance(tokenId:string,owner:string):Promise<{amount:bigint;ledger:number}> {
  if(this.deps.tokenBalance)return this.deps.tokenBalance(tokenId,owner);
  // Read-only simulation. Source is a valid zero account; no customer signer or network broadcast occurs.
  const transaction=new TransactionBuilder(new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF','0'),{fee:'100',networkPassphrase:NETWORK_PASSPHRASE}).addOperation(new Contract(tokenId).call('balance',Address.fromString(owner).toScVal())).setTimeout(30).build();
  const simulation=await bounded(this.server.simulateTransaction(transaction));
  if(!rpc.Api.isSimulationSuccess(simulation)||!simulation.result)return providerFailure('Cannot read Blend reserve token balance');
  const amount=scValToNative(simulation.result.retval);
  if(typeof amount!=='bigint'||amount<0n)return providerFailure('Invalid Blend token balance');
  return {amount,ledger:simulation.latestLedger};
 }
 private async snapshot():Promise<Snapshot> {
  if(this.cachedSnapshot && Date.now()-this.cachedSnapshot.observedAt<10000)return this.cachedSnapshot;
  this.loadingSnapshot??=this.loadSnapshot().then(snapshot=>{this.cachedSnapshot=snapshot;return snapshot;}).finally(()=>{this.loadingSnapshot=undefined;});
  return this.loadingSnapshot;
 }
 private async loadSnapshot():Promise<Snapshot> {
  await this.verifyNetwork();const registry=await this.registry();
  let pool:Pool;try{pool=await bounded(this.deps.loadPool?this.deps.loadPool(registry.poolId):PoolV2.load(this.network,registry.poolId));}catch(error){if(error instanceof GrapnelError)throw error;return providerFailure('Current Blend Testnet pool could not be loaded; contracts may have expired or reset');}
  if(pool.id!==registry.poolId)return providerFailure('Blend returned a different pool');
  const observedAt=Date.now();
  const markets=await Promise.all([...pool.reserves.values()].map(async reserve=>{
   const token=await bounded(this.deps.loadToken?this.deps.loadToken(reserve.assetId):TokenMetadata.load(this.network,reserve.assetId));
   if(token.decimals!==reserve.config.decimals||token.decimals<0||token.decimals>38)return providerFailure('Blend reserve and token decimals disagree');
   let asset:AssetIdentity;
   if(token.asset?.isNative()) {
    if(reserve.assetId!==Asset.native().contractId(NETWORK_PASSPHRASE))return providerFailure('Blend native token contract mapping mismatch');
    asset={...XLM,contractId:reserve.assetId,sourceUrl:BLEND_REGISTRY_URL};
   }else if(token.asset){
    const code=token.asset.getCode();const issuer=token.asset.getIssuer();
    if(token.asset.contractId(NETWORK_PASSPHRASE)!==reserve.assetId)return providerFailure('Blend classic issuer/SAC mapping mismatch');
    asset={id:`stellar-testnet:classic:${code}:${issuer}`,network:NETWORK,kind:'classic',code,issuer,contractId:reserve.assetId,decimals:token.decimals,verified:true,sourceUrl:BLEND_REGISTRY_URL};
   }else asset={id:`stellar-testnet:soroban:${reserve.assetId}`,network:NETWORK,kind:'soroban',code:token.symbol,contractId:reserve.assetId,decimals:token.decimals,verified:true,sourceUrl:BLEND_REGISTRY_URL};
   let liquidity:{amount:bigint;ledger:number}|null=null;try{liquidity=await this.balance(reserve.assetId,pool.id);}catch{/* Unknown liquidity remains explicit and blocks writes. */}
   const reason=!this.config.gate1Passed?'GATE_1_SIGNING_PROOF_REQUIRED':'SOROBAN_SIMULATION_AUTH_AND_SUBMISSION_PROOF_REQUIRED';
   return {market_id:`stellar-testnet:blend:${pool.id}:${reserve.assetId}`,provider:'blend' as const,network:NETWORK,pool_contract_id:pool.id,pool_name:pool.metadata.name,reserve_contract_id:reserve.assetId,asset_id:asset.id,asset,pool_status:pool.metadata.status,supply_apy_variable:apy(reserve.estSupplyApy),borrow_apy_variable:apy(reserve.estBorrowApy),available_liquidity:liquidity?fromAtomic(liquidity.amount,asset.decimals):null,total_supplied:fromAtomic(reserve.totalSupply(),asset.decimals),total_borrowed:fromAtomic(reserve.totalLiabilities(),asset.decimals),as_of:new Date(observedAt).toISOString(),as_of_ledger:Math.max(reserve.latestLedger,pool.metadata.latestLedger,liquidity?.ledger??0),execution_status:'discovery_only' as const,executable:false as const,reason};
  }));
  return {pool,markets,observedAt};
 }
 async markets():Promise<BlendMarket[]>{return (await this.snapshot()).markets;}
 async capabilities():Promise<{execution_status:'discovery_only'|'blocked';reason:string;actions:string[]}> {
  try{await this.snapshot();return {execution_status:'discovery_only',reason:!this.config.gate1Passed?'Live pool reads work; Gate 1 customer signing proof is required':'Live pool reads work; Soroban simulation/auth/submission proof is required',actions:[]};}
  catch{return {execution_status:'blocked',reason:'Current official Blend Testnet pool data is unavailable',actions:[]};}
 }
 private normalizePosition(pool:Pool,user:PoolUser,reserve:Reserve,market:BlendMarket):BlendPosition {
  return {market_id:market.market_id,pool_contract_id:pool.id,reserve_contract_id:reserve.assetId,asset_id:market.asset_id,supplied:fromAtomic(user.getSupply(reserve)+user.getCollateral(reserve),reserve.config.decimals),collateral:fromAtomic(user.getCollateral(reserve),reserve.config.decimals),borrowed:fromAtomic(user.getLiabilities(reserve),reserve.config.decimals),wallet_spendable:false,supply_apy_variable:market.supply_apy_variable,health_factor:null,as_of_ledger:market.as_of_ledger,as_of:market.as_of,readiness:'discovery_only'};
 }
 async positions(customer:CustomerContext):Promise<BlendPosition[]> {
  if(!StrKey.isValidEd25519PublicKey(customer.walletAddress))throw new GrapnelError(422,'INVALID_WALLET','Expected a verified Stellar customer wallet');
  const {pool,markets}=await this.snapshot();
  let user:PoolUser;try{user=await bounded(pool.loadUser(customer.walletAddress));}catch{return providerFailure('Current customer Blend positions could not be loaded');}
  return markets.map(market=>this.normalizePosition(pool,user,pool.reserves.get(market.reserve_contract_id)!,market));
 }
 async prepare(action:'supply'|'withdraw'|'borrow'|'repay',input:{operationId:string;marketId:string;assetId:string;amount:string},customer:CustomerContext):Promise<PreparedAction> {
  if(action==='borrow'||action==='repay')return unavailable('BORROW_REPAY_NOT_VERIFIED');
  if(!this.config.gate1Passed)return unavailable('GATE_1_SIGNING_PROOF_REQUIRED');
  const {pool,markets}=await this.snapshot();const market=markets.find(m=>m.market_id===input.marketId);
  if(!market)throw new GrapnelError(404,'NOT_FOUND','Verified Blend market not found');
  if(market.asset_id!==input.assetId)throw new GrapnelError(422,'ASSET_MISMATCH','Asset must match the exact verified reserve');
  if(input.assetId!==XLM.id)return unavailable('ONLY_NATIVE_XLM_RESERVE_BUILDER_REVIEWED');
  let amount:bigint;try{amount=toAtomic(input.amount,market.asset.decimals);}catch{throw new GrapnelError(422,'INVALID_AMOUNT','Amount precision must match the reserve');}
  const reserve=pool.reserves.get(market.reserve_contract_id)!;
  if(pool.metadata.status!==0||!('enabled' in reserve.config)||reserve.config.enabled!==true)return unavailable('POOL_OR_RESERVE_NOT_ACTIVE');
  if(Date.now()-Date.parse(market.as_of)>15000)return unavailable('POOL_SNAPSHOT_STALE');
  if(action==='supply'&&'supply_cap' in reserve.config&&typeof reserve.config.supply_cap==='bigint'&&reserve.totalSupply()+amount>reserve.config.supply_cap)return unavailable('RESERVE_SUPPLY_CAP_EXCEEDED');
  const intent:BlendIntent={action,poolId:pool.id,reserveId:reserve.assetId,walletAddress:customer.walletAddress,amountAtomic:amount};
  const operationXdr=buildBlendOperation(intent);inspectBlendOperation(operationXdr,intent);
  if(action==='withdraw'){
   const user=await bounded(pool.loadUser(customer.walletAddress));
   if([...user.positions.liabilities.values()].some(amount=>amount>0n))return unavailable('WITHDRAW_WITH_DEBT_REQUIRES_VERIFIED_RISK_ESTIMATOR');
   if(user.getCollateral(reserve)<amount)throw new GrapnelError(409,'INSUFFICIENT_POSITION','Withdrawal exceeds confirmed collateral position');
   if(market.available_liquidity===null||/^0(?:\.0+)?$/.test(market.available_liquidity)||toAtomic(market.available_liquidity,market.asset.decimals)<amount)return unavailable('WITHDRAW_LIQUIDITY_UNAVAILABLE');
  }
  // Pre-simulation op inspection is complete. Nested auth/footprint/fees and simulation output
  // still require the canonical reviewed executor; never expose this unsimulated op as signable.
  if(!this.deps.prepareAndSimulate)return unavailable('SOROBAN_INSPECTOR_REQUIRED');
  const expiresAt=new Date(Date.now()+120000).toISOString();
  return this.deps.prepareAndSimulate({operationId:input.operationId,customerId:customer.customerId,walletAddress:customer.walletAddress,operationXdr,allowedContracts:[pool.id,reserve.assetId],summary:{action:`blend.${action}`,fromAssetId:market.asset_id,amount:input.amount,contractId:pool.id,recipient:customer.walletAddress,expiresAt}});
 }
}
