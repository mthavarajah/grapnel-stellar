import {GrapnelError} from '@grapnel/contracts';
import {StrKey} from '@stellar/stellar-sdk';
const commodityCodes=new Set(['XAUM','PAXG','XAUT','WTGOLD','GOLD','XAU','XAG','SILVER','GLD','SLV','USO']);
export interface CommodityCatalogObservation {
 code:string;contract_id:string|null;source_network:'testnet'|'mainnet'|'unverified';
 executable:false;reason:'MAINNET_ASSET_NOT_TESTNET'|'ASSET_LIST_NETWORK_UNVERIFIED'|'ISSUER_AND_LIVE_TESTNET_ROUTE_PROOF_REQUIRED';
}
/** Screen catalog hints only. A ticker, valid contract syntax, price or provider
 * `verified` flag never establishes commodity backing, chain liveness or execution. */
export function screenCommodityCatalog(body:unknown):CommodityCatalogObservation[]{
 if(!body||typeof body!=='object'||Array.isArray(body)||!('assets'in body)||!Array.isArray(body.assets))throw new GrapnelError(502,'PROVIDER_INVALID_RESPONSE','Commodity catalog requires an explicit network and asset list');
 const source_network='network'in body&&body.network==='testnet'?'testnet':'network'in body&&body.network==='mainnet'?'mainnet':'unverified';
 return body.assets.flatMap((asset:unknown)=>{
  if(!asset||typeof asset!=='object'||!('code'in asset)||typeof asset.code!=='string'||!commodityCodes.has(asset.code.toUpperCase()))return [];
  const contract_id='contract'in asset&&typeof asset.contract==='string'&&StrKey.isValidContract(asset.contract)?asset.contract:null;
  return [{code:asset.code,contract_id,source_network,executable:false as const,reason:source_network==='mainnet'?'MAINNET_ASSET_NOT_TESTNET' as const:source_network==='unverified'?'ASSET_LIST_NETWORK_UNVERIFIED' as const:'ISSUER_AND_LIVE_TESTNET_ROUTE_PROOF_REQUIRED' as const}];
 });
}
