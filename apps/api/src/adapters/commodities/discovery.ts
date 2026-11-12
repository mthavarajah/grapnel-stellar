import {Asset,StrKey} from '@stellar/stellar-sdk';
import {GrapnelError,NETWORK,NETWORK_PASSPHRASE,type AssetIdentity} from '@grapnel/contracts';
const native=Asset.native().contractId(NETWORK_PASSPHRASE);
/** Lead-reviewed server configuration only; never accept these values from an API caller. */
export interface ApprovedCommodityCandidate {
 asset:AssetIdentity;issuerProvenanceUrl:string;issuerRightsDescription:string;
 expectedWasmHash?:string;allowedRouteContracts:readonly string[];
}
export interface CommodityContractObservation {
 contractId:string;code:string;decimals:number;issuer?:string;executableType:'stellar_asset'|'wasm';wasmHash?:string;ledger:number;observedAt:string;
}
export interface CommodityQuoteObservation {
 inputContract:string;outputContract:string;amountInAtomic:string;expectedOutAtomic:string;minOutAtomic:string;
 routeContracts:string[];observedAt:string;expiresAt:string;
}
/** Trusted read-only server callbacks. No wallet, signing or broadcasting interface is exposed. */
export interface CommodityDiscoveryReads {
 readNetworkPassphrase():Promise<string>;
 readContract(contractId:string):Promise<CommodityContractObservation>;
 quoteExactIn(input:{assetIn:string;assetOut:string;amountAtomic:'10000000';slippageBps:50}):Promise<CommodityQuoteObservation>;
}
export interface CommodityCandidateDiscovery {
 asset:AssetIdentity;network:typeof NETWORK;execution_status:'blocked'|'discovery_only';executable:false;reason:string;
 live_ledger?:number;observed_at?:string;issuer_provenance_url:string;issuer_rights_description:string;
 liquidity_quote?:{amount_in_atomic:string;expected_out_atomic:string;min_out_atomic:string;expires_at:string};
}
const fail=(message:string):never=>{throw new GrapnelError(422,'COMMODITY_REGISTRY_INVALID',message);};
const fresh=(value:string,age:number,now:number)=>Number.isFinite(Date.parse(value))&&Date.parse(value)<=now+1000&&now-Date.parse(value)<=age;
const atomic=(value:string)=>typeof value==='string'&&/^[1-9]\d{0,77}$/.test(value)?BigInt(value):0n;
const https=(value:string)=>{try{return new URL(value).protocol==='https:';}catch{return false;}};
/** Live discovery can establish contract/quote availability only. It cannot grant
 * execution: unsigned invocation inspection, simulation and chain proof are separate gates. */
export class CommodityDiscovery {
 private readonly candidates:readonly ApprovedCommodityCandidate[];
 constructor(candidates:readonly ApprovedCommodityCandidate[]=[]){
  if(candidates.length>8)fail('Commodity registry must be a finite reviewed list');
  const seen=new Set<string>();
  for(const candidate of candidates){
   const a=candidate.asset;
   if(a.network!==NETWORK||!a.verified||a.kind==='native'||!a.contractId||!StrKey.isValidContract(a.contractId)||!Number.isInteger(a.decimals)||a.decimals<0||a.decimals>38||!https(a.sourceUrl)||!https(candidate.issuerProvenanceUrl)||!candidate.issuerRightsDescription.trim()||seen.has(a.contractId))fail('Commodity identity or first-party provenance is missing');
   if(a.kind==='classic'){
    if(!a.issuer||!StrKey.isValidEd25519PublicKey(a.issuer)||a.contractId!==new Asset(a.code,a.issuer).contractId(NETWORK_PASSPHRASE)||a.id!==`${NETWORK}:classic:${a.code}:${a.issuer}`)fail('Classic commodity issuer/SAC identity differs from Testnet registry');
   }else if(a.id!==`${NETWORK}:soroban:${a.contractId}`||!candidate.expectedWasmHash||!/^[a-f0-9]{64}$/.test(candidate.expectedWasmHash))fail('Soroban commodity requires exact Testnet identity and reviewed executable hash');
   if(!candidate.allowedRouteContracts.length||candidate.allowedRouteContracts.length>8||candidate.allowedRouteContracts.some(c=>!StrKey.isValidContract(c)))fail('Commodity route contracts must be explicitly reviewed');
   seen.add(a.contractId!);
  }
  this.candidates=structuredClone(candidates);
 }
 async discover(reads:CommodityDiscoveryReads,now?:number):Promise<CommodityCandidateDiscovery[]>{
  // Read the clock after each provider response: a slow network call must not
  // make a newly observed ledger or quote look like it came from the future.
  const currentTime=()=>now??Date.now();
  if(!this.candidates.length)return [];
  if(await reads.readNetworkPassphrase()!==NETWORK_PASSPHRASE)throw new GrapnelError(400,'NETWORK_MISMATCH','Commodity discovery RPC must report Stellar Testnet');
  return Promise.all(this.candidates.map(async candidate=>{
   const a=candidate.asset;const base={asset:structuredClone(a),network:NETWORK,executable:false as const,issuer_provenance_url:candidate.issuerProvenanceUrl,issuer_rights_description:candidate.issuerRightsDescription};
   try{
    const contract=await reads.readContract(a.contractId!);
    if(contract.contractId!==a.contractId||contract.code!==a.code||contract.decimals!==a.decimals||!Number.isSafeInteger(contract.ledger)||contract.ledger<=0||!fresh(contract.observedAt,15000,currentTime())||a.kind==='classic'&&(contract.executableType!=='stellar_asset'||contract.issuer!==a.issuer)||a.kind==='soroban'&&(contract.executableType!=='wasm'||contract.wasmHash!==candidate.expectedWasmHash))return {...base,execution_status:'blocked' as const,reason:'COMMODITY_LIVE_CONTRACT_OR_IDENTITY_MISMATCH'};
    const quote=await reads.quoteExactIn({assetIn:native,assetOut:a.contractId!,amountAtomic:'10000000',slippageBps:50});
    const out=atomic(quote.expectedOutAtomic),minimum=atomic(quote.minOutAtomic);const expiry=Date.parse(quote.expiresAt),quoteNow=currentTime();
    const allowed=new Set([native,a.contractId!,...candidate.allowedRouteContracts]);
    if(quote.inputContract!==native||quote.outputContract!==a.contractId||quote.amountInAtomic!=='10000000'||out<=0n||minimum<=0n||minimum>out||minimum<(out*9950n+9999n)/10000n||!fresh(quote.observedAt,15000,quoteNow)||!Number.isFinite(expiry)||expiry<=quoteNow||expiry>quoteNow+60000||quote.routeContracts.length<2||quote.routeContracts[0]!==native||quote.routeContracts.at(-1)!==a.contractId||quote.routeContracts.some(c=>!allowed.has(c)))return {...base,execution_status:'blocked' as const,reason:'COMMODITY_EXACT_TESTNET_LIQUIDITY_UNVERIFIED'};
    return {...base,execution_status:'discovery_only' as const,reason:'COMMODITY_EXECUTION_INSPECTION_AND_CHAIN_PROOF_REQUIRED',live_ledger:contract.ledger,observed_at:contract.observedAt,liquidity_quote:{amount_in_atomic:quote.amountInAtomic,expected_out_atomic:quote.expectedOutAtomic,min_out_atomic:quote.minOutAtomic,expires_at:quote.expiresAt}};
   }catch{return {...base,execution_status:'blocked' as const,reason:'COMMODITY_PROVIDER_READ_UNAVAILABLE'};}
  }));
 }
}
