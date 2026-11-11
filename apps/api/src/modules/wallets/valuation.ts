import {AssetIdentitySchema,GrapnelError,NETWORK,XLM,type WalletBalance} from '@grapnel/contracts';
import {StrKey} from '@stellar/stellar-sdk';

export interface WalletUsdPrice {value:string;as_of:string;}
export interface WalletValuation {
 total_usd:string|null;
 priced_subtotal_usd:string;
 unpriced_asset_count:number;
 /** Time this valuation was calculated; each admitted source price was no more than five minutes old. */
 as_of:string;
}
const USD_DECIMALS=18;
const USD_SCALE=10n**18n;
const invalid=():never=>{throw new GrapnelError(502,'PROVIDER_INVALID_RESPONSE','Wallet valuation requires unique exact asset balances and valid nonnegative amounts');};
const decimal=/^(0|[1-9]\d*)(?:\.(\d+))?$/;
interface ParsedAmount {whole:string;fraction:string;positive:boolean;}
function parseAmount(value:unknown):ParsedAmount {
 if(typeof value!=='string'||value.length>79)return invalid();
 const match=decimal.exec(value);
 if(!match||match[2]&&match[2].length>38)return invalid();
 const whole=match[1]!,fraction=match[2]??'';
 if(whole.length+fraction.length>78)return invalid();
 return {whole,fraction,positive:BigInt(whole+fraction)>0n};
}
function classicParts(id:string):{code:string;issuer:string}|null{
 const match=/^stellar-testnet:classic:([a-zA-Z0-9]{1,12}):(G[A-Z2-7]{55})$/.exec(id);
 return match&&StrKey.isValidEd25519PublicKey(match[2]!)?{code:match[1]!,issuer:match[2]!}:null;
}
/** Identity metadata is authoritative only when it verifies the exact balance identity. */
function assetDecimals(balance:WalletBalance):number|null{
 const classic=classicParts(balance.asset_id);
 if(balance.asset===undefined)return balance.asset_id===XLM.id||classic?7:null;
 const result=AssetIdentitySchema.safeParse(balance.asset);
 if(!result.success)return null;
 const asset=result.data;
 if(!asset.verified||asset.network!==NETWORK||asset.id!==balance.asset_id)return null;
 if(asset.kind==='native')return asset.id===XLM.id&&asset.code==='XLM'&&asset.decimals===7?7:null;
 if(asset.kind==='classic')return classic&&asset.code===classic.code&&asset.issuer===classic.issuer&&asset.decimals===7?7:null;
 return asset.contractId&&StrKey.isValidContract(asset.contractId)&&asset.id===`stellar-testnet:soroban:${asset.contractId}`?asset.decimals:null;
}
function priceAtomic(price:WalletUsdPrice|null,now:number):bigint|null{
 if(!price||typeof price.value!=='string'||price.value.length>79||typeof price.as_of!=='string')return null;
 const parsed=decimal.exec(price.value),at=Date.parse(price.as_of);
 if(!parsed||(parsed[2]?.length??0)>USD_DECIMALS||parsed[1]!.length+(parsed[2]?.length??0)>78
  ||!Number.isFinite(at)||at>now+1000||now-at>300000)return null;
 const amount=BigInt(parsed[1]!+(parsed[2]??'').padEnd(USD_DECIMALS,'0'));
 return amount>0n&&amount.toString().length<=78?amount:null;
}
function formatUsd(value:bigint):string{
 const whole=value/USD_SCALE,fraction=(value%USD_SCALE).toString().padStart(USD_DECIMALS,'0').replace(/0+$/,'');
 return fraction?`${whole}.${fraction}`:whole.toString();
}
/** Wallet holdings only. Missing pricing never silently becomes a zero price or a dollar peg. */
export async function valueWalletBalances(
 balances:WalletBalance[],priceFor:(assetId:string)=>Promise<WalletUsdPrice|null>,now=Date.now(),
):Promise<WalletValuation>{
 if(!Number.isSafeInteger(now)||!Number.isFinite(new Date(now).getTime()))return invalid();
 const seen=new Set<string>();
 const entries=balances.map(balance=>{
  if(!balance||typeof balance.asset_id!=='string'||!balance.asset_id||balance.asset_id.length>200||seen.has(balance.asset_id))return invalid();
  seen.add(balance.asset_id);
  const parsed=parseAmount(balance.wallet_amount),decimals=assetDecimals(balance);
  let atoms:bigint|null=null;
  if(decimals!==null){
   if(parsed.fraction.length>decimals)return invalid();
   atoms=BigInt(parsed.whole+parsed.fraction.padEnd(decimals,'0'));
   if(atoms.toString().length>78)return invalid();
  }
  return {assetId:balance.asset_id,positive:parsed.positive,decimals,atoms};
 });
 let next=0,subtotal=0n,unpriced=0;
 async function work():Promise<void>{
  while(next<entries.length){
   const entry=entries[next++]!;
   if(!entry.positive)continue;
   if(entry.decimals===null||entry.atoms===null){unpriced++;continue;}
   let price:bigint|null=null;
   try{price=priceAtomic(await priceFor(entry.assetId),now);}catch{/* An unavailable source is unpriced, never zero. */}
   if(price===null){unpriced++;continue;}
   subtotal+=entry.atoms*price/(10n**BigInt(entry.decimals));
  }
 }
 await Promise.all(Array.from({length:Math.min(8,entries.length)},()=>work()));
 const value=formatUsd(subtotal);
 return {total_usd:unpriced?null:value,priced_subtotal_usd:value,unpriced_asset_count:unpriced,as_of:new Date(now).toISOString()};
}
