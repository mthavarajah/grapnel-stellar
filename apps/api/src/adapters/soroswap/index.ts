import {isVerifiedSpotProof,type VerifiedSpotProof} from '../../modules/spot/proof.js';
import { assertCanonicalSwapTransformation,USDC_ISSUER,USDC_SAC } from './inspector.js';
import { StrKey } from '@stellar/stellar-sdk';
import { GrapnelError, NETWORK, NETWORK_PASSPHRASE, PreparedActionSchema, fromAtomic, toAtomic, type AssetIdentity, type CustomerContext, type PreparedAction } from '@grapnel/contracts';

export interface SpotMarket {
  id:string; asset_in:AssetIdentity; asset_out:AssetIdentity; protocols:string[];
  route_verified_at:string|null; execution_verified_at:string|null;
}
export interface SpotQuote {
  quote_id:string; market_id:string; asset_in_id:string; asset_out_id:string;
  amount_in:string; expected_out:string; min_receive:string; expires_at:string;
  amount_in_atomic:string; expected_out_atomic:string; min_out_atomic:string;
  slippage_bps:number; provider:'soroswap'; network:typeof NETWORK;
  provider_quote:Record<string,unknown>;
}
export interface SpotConfig {
  network:string; networkPassphrase:string; apiKey?:string; baseUrl?:string;
  gate1Passed:boolean; markets?:SpotMarket[]; quoteTtlMs?:number;
}
/** Must inspect contracts, invocation/auth trees, token amounts/recipients/minimums,
 * fee/sequence/timebounds, footprint and simulation before returning PreparedAction. */
export type SpotXdrInspector = (input:{unsignedXdr:string;quote:SpotQuote;market:SpotMarket;customer:CustomerContext;operationId:string})=>Promise<PreparedAction>;
const unavailable=(reason:string):never=>{throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','No verified Stellar Testnet spot execution is available',false,{reason});};
const invalid=(message:string):never=>{throw new GrapnelError(502,'PROVIDER_INVALID_RESPONSE',message);};
const atomic=(value:unknown):bigint=>{
  // JSON numbers may already have lost protocol precision; accept decimal strings only.
  if(typeof value!=='string'||!/^\d{1,78}$/.test(value))return invalid('Provider returned an invalid atomic amount');
  return BigInt(value);
};
const record=(value:unknown):Record<string,unknown>=>{
  if(!value||typeof value!=='object'||Array.isArray(value))return invalid('Provider returned an invalid object');
  return value as Record<string,unknown>;
};
const KNOWN_PROTOCOLS=new Set(['sdex','soroswap','phoenix','aqua','comet','sushi']);
export class SoroswapSpotAdapter {
  private readonly baseUrl:string;
  readonly quoteTtlMs:number;
  private readonly registry:Map<string,SpotMarket>;
  private readonly proof=new Map<string,VerifiedSpotProof>();
  constructor(readonly config:SpotConfig,private readonly fetcher:typeof fetch=fetch,private readonly inspect?:SpotXdrInspector) {
    if(config.network!=='testnet'||config.networkPassphrase!==NETWORK_PASSPHRASE)throw new GrapnelError(400,'NETWORK_MISMATCH','Only explicit Stellar Testnet is supported');
    this.baseUrl=(config.baseUrl??'https://api.soroswap.finance').replace(/\/$/,'');
    if(new URL(this.baseUrl).protocol!=='https:')throw new GrapnelError(400,'PROVIDER_CONFIGURATION_INVALID','Soroswap must use HTTPS');
    this.quoteTtlMs=config.quoteTtlMs??30000;
    if(this.quoteTtlMs<=0||this.quoteTtlMs>60000)throw new GrapnelError(400,'PROVIDER_CONFIGURATION_INVALID','Quote TTL must be at most sixty seconds');
    this.registry=new Map((config.markets??[]).map(m=>[m.id,{...m,execution_verified_at:null}]));
    for(const m of this.registry.values())this.validateMarket(m);
  }
  private validateMarket(m:SpotMarket):void {
    if(!m.id||m.asset_in.id===m.asset_out.id||!m.protocols.length||m.protocols.some(p=>!KNOWN_PROTOCOLS.has(p)))throw new GrapnelError(422,'ASSET_UNVERIFIED','Invalid Testnet market registry');
    for(const asset of [m.asset_in,m.asset_out]) {
      if(asset.network!==NETWORK||!asset.verified||!asset.contractId||!StrKey.isValidContract(asset.contractId))throw new GrapnelError(422,'ASSET_UNVERIFIED','Spot assets require independently verified exact Testnet contracts');
      if(!Number.isInteger(asset.decimals)||asset.decimals<0||asset.decimals>38)throw new GrapnelError(422,'ASSET_UNVERIFIED','Invalid asset decimals');
    }
  }
  clearExecutionProof():void {this.proof.clear();for(const m of this.registry.values())m.execution_verified_at=null;}
  invalidateRoute():void {this.clearExecutionProof();for(const m of this.registry.values())m.route_verified_at=null;}
  refreshVerifiedMarket(market:SpotMarket):void {this.validateMarket(market);this.registry.set(market.id,{...market,execution_verified_at:null});}
  applyVerifiedExecution(value:VerifiedSpotProof):void {if(!isVerifiedSpotProof(value))return;const market=this.registry.get(value.market_id);if(!market||market.asset_in.id!==value.asset_in_id||market.asset_out.id!==value.asset_out_id||!market.route_verified_at)return;this.proof.set(market.id,value);market.execution_verified_at=value.verified_at;}
  private verified(m:SpotMarket):boolean {return isVerifiedSpotProof(this.proof.get(m.id))&&!!this.config.apiKey&&this.config.gate1Passed&&!!this.inspect&&!!m.route_verified_at;}
  capability() {
    if([...this.registry.values()].some(m=>this.verified(m)))return {module:'trade.spot' as const,provider:'soroswap',execution_status:'testnet_verified' as const,reason:null,actions:['quote','order']};
    const reason=!this.config.apiKey?'PROVIDER_ACCESS_REQUIRED':!this.config.gate1Passed?'GATE_1_SIGNING_PROOF_REQUIRED':!this.inspect?'SOROSWAP_XDR_INSPECTOR_REQUIRED':'SOROSWAP_SWAP_CHAIN_PROOF_REQUIRED';
    return {module:'trade.spot' as const,provider:'soroswap',execution_status:'blocked' as const,reason,actions:[] as string[]};
  }
  markets() {
    return [...this.registry.values()].map(m=>({market_id:m.id,provider:'soroswap',network:NETWORK,asset_class:'crypto_spot',asset_in_id:m.asset_in.id,asset_out_id:m.asset_out.id,preparation_available:Boolean(this.config.apiKey&&this.config.gate1Passed&&this.inspect&&m.route_verified_at),executable:this.verified(m),execution_status:this.verified(m)?'testnet_verified':'discovery_only',reason:this.verified(m)?null:this.capability().reason,as_of:m.route_verified_at}));
  }
  market(id:string):SpotMarket {
    const found=this.registry.get(id);if(!found)throw new GrapnelError(404,'NOT_FOUND','Verified spot market not found');return found;
  }
  private async request(path:string,body?:unknown):Promise<unknown> {
    if(!this.config.apiKey) return unavailable('PROVIDER_ACCESS_REQUIRED');
    let response:Response;
    try {response=await this.fetcher(`${this.baseUrl}${path}`,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${this.config.apiKey}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(12000)});}
    catch {throw new GrapnelError(503,'PROVIDER_UNAVAILABLE','Soroswap request timed out or failed',true);}
    if(response.status===401||response.status===403)return unavailable('PROVIDER_ACCESS_REQUIRED');
    if(response.status===428){
      let prerequisite:Record<string,unknown>={};try{prerequisite=await response.json() as Record<string,unknown>;}catch{/* never expose an opaque provider payload */}
      const data=prerequisite.actionData as Record<string,unknown>|undefined;
      const requested=body as {from?:unknown;quote?:{assetOut?:unknown}}|undefined;
      if(path==='/quote/build?network=testnet'&&prerequisite.action==='CREATE_TRUSTLINE'&&prerequisite.errorCode===13&&data?.assetCode==='USDC'&&data.assetIssuer===USDC_ISSUER&&data.signer===requested?.from&&requested?.quote?.assetOut===USDC_SAC)return unavailable('USDC_TRUSTLINE_REQUIRED');
      return unavailable('UNINSPECTED_PROVIDER_PREREQUISITE');
    }
    if(response.status===429)throw new GrapnelError(429,'PROVIDER_RATE_LIMITED','Soroswap rate limit reached',true);
    if([400,404,409,422].includes(response.status))return unavailable('NO_TESTNET_LIQUIDITY_OR_ROUTE');
    if(!response.ok)throw new GrapnelError(503,'PROVIDER_UNAVAILABLE','Soroswap request failed',true);
    try{return await response.json();}catch{return invalid('Soroswap returned invalid JSON');}
  }
  async protocols():Promise<string[]> {
    const result=await this.request('/protocols?network=testnet');
    if(!Array.isArray(result)||result.some(p=>typeof p!=='string'||!KNOWN_PROTOCOLS.has(p)))return invalid('Unknown Testnet protocol response');
    return result as string[];
  }
  async assetList():Promise<{network:'testnet';assets:unknown[]}> {
    const result=record(await this.request('/asset-list?name=soroswap'));
    // SDK v0.5.0 asset-list has no network parameter. Never infer Testnet from the client default.
    if(result.network!=='testnet'||!Array.isArray(result.assets))return unavailable('ASSET_LIST_TESTNET_NETWORK_UNVERIFIED');
    return {network:'testnet',assets:result.assets};
  }
  async quote(input:{quoteId:string;marketId:string;assetId:string;amount:string;slippageBps:number}):Promise<SpotQuote> {
    if(!this.config.apiKey)return unavailable('PROVIDER_ACCESS_REQUIRED');
    if(!this.registry.size)return unavailable('SOROSWAP_MARKET_REGISTRY_REQUIRED');
    const market=this.market(input.marketId);
    if(input.assetId!==market.asset_in.id)throw new GrapnelError(422,'ASSET_MISMATCH','Exact input asset does not match market');
    let amount:bigint;try{amount=toAtomic(input.amount,market.asset_in.decimals);}catch{throw new GrapnelError(422,'INVALID_AMOUNT','Invalid positive amount or precision');}
    if(!Number.isInteger(input.slippageBps)||input.slippageBps<0||input.slippageBps>500)throw new GrapnelError(422,'INVALID_SLIPPAGE','Slippage must be between zero and 500 basis points');
    const protocols=await this.protocols();
    if(market.protocols.some(p=>!protocols.includes(p)))return unavailable('TESTNET_PROTOCOL_UNAVAILABLE');
    // Soroswap floors its minimum to an atomic unit. Request a tighter
    // provider tolerance so that its rounded minimum can still satisfy the
    // customer's original strict (ceiling) bound; validation below is unchanged.
    const providerSlippageBps=Math.max(0,input.slippageBps-1);
    const response=record(await this.request('/quote?network=testnet',{assetIn:market.asset_in.contractId,assetOut:market.asset_out.contractId,amount:amount.toString(),tradeType:'EXACT_IN',protocols:market.protocols,slippageBps:providerSlippageBps}));
    if(response.tradeType!=='EXACT_IN'||response.assetIn!==market.asset_in.contractId||response.assetOut!==market.asset_out.contractId||atomic(response.amountIn)!==amount)return invalid('Quote input asset, amount, or trade type mismatch');
    const out=atomic(response.amountOut),minimum=atomic(response.otherAmountThreshold);
    if(out<=0n||minimum<=0n||minimum>out||minimum<(out*BigInt(10000-input.slippageBps)+9999n)/10000n)return invalid('Quote output violates approved slippage');
    if(response.gaslessTrustline!==undefined||response.trustlineInfo!==undefined||response.platformFee!==undefined)return unavailable('UNINSPECTED_TRUSTLINE_OR_FEE_ROUTE');
    if(!Array.isArray(response.routePlan)||!response.routePlan.length)return unavailable('NO_TESTNET_LIQUIDITY_OR_ROUTE');
    for(const route of response.routePlan) {
      const swap=record(record(route).swapInfo);
      if(typeof swap.protocol!=='string'||!market.protocols.includes(swap.protocol)||!Array.isArray(swap.path)||swap.path.length<2||swap.path[0]!==market.asset_in.contractId||swap.path.at(-1)!==market.asset_out.contractId||swap.path.some(c=>typeof c!=='string'||!StrKey.isValidContract(c)))return invalid('Provider route differs from approved Testnet market');
    }
    return {quote_id:input.quoteId,market_id:market.id,asset_in_id:market.asset_in.id,asset_out_id:market.asset_out.id,amount_in:fromAtomic(amount,market.asset_in.decimals),expected_out:fromAtomic(out,market.asset_out.decimals),min_receive:fromAtomic(minimum,market.asset_out.decimals),expires_at:new Date(Date.now()+this.quoteTtlMs).toISOString(),amount_in_atomic:amount.toString(),expected_out_atomic:out.toString(),min_out_atomic:minimum.toString(),slippage_bps:input.slippageBps,provider:'soroswap',network:NETWORK,provider_quote:response};
  }
  async prepare(quote:SpotQuote,customer:CustomerContext,operationId:string):Promise<PreparedAction> {
    if(Date.parse(quote.expires_at)<=Date.now())throw new GrapnelError(409,'QUOTE_EXPIRED','The stored quote has expired');
    if(!this.config.gate1Passed)return unavailable('GATE_1_SIGNING_PROOF_REQUIRED');
    if(!this.inspect)return unavailable('SOROSWAP_XDR_INSPECTOR_REQUIRED');
    if(!StrKey.isValidEd25519PublicKey(customer.walletAddress))throw new GrapnelError(422,'INVALID_WALLET','Invalid customer Stellar address');
    const market=this.market(quote.market_id);
    if(quote.network!==NETWORK||quote.asset_in_id!==market.asset_in.id||quote.asset_out_id!==market.asset_out.id)return invalid('Stored quote asset mismatch');
    const response=record(await this.request('/quote/build?network=testnet',{quote:quote.provider_quote,from:customer.walletAddress,to:customer.walletAddress}));
    if(typeof response.xdr!=='string'||!response.xdr.length)return invalid('Soroswap returned no transaction');
    const action=PreparedActionSchema.parse(await this.inspect({unsignedXdr:response.xdr,quote,market,customer,operationId}));
    assertCanonicalSwapTransformation(response.xdr,action);
    if(action.customerId!==customer.customerId||action.walletAddress!==customer.walletAddress||action.operationId!==operationId||action.network!==NETWORK||action.summary.fromAssetId!==quote.asset_in_id||action.summary.toAssetId!==quote.asset_out_id||action.summary.amount!==quote.amount_in||action.summary.minReceive!==quote.min_receive||Date.parse(action.summary.expiresAt)>Date.parse(quote.expires_at))throw new GrapnelError(403,'PREPARED_ACTION_MISMATCH','Inspected action does not match immutable quote');
    return action;
  }
}
