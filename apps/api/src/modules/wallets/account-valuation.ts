import {Asset,StrKey} from '@stellar/stellar-sdk';
import {NETWORK_PASSPHRASE,XLM,type AssetIdentity,type CustomerContext,type WalletBalance} from '@grapnel/contracts';
import {valueAssetHoldings,type AssetHolding,type WalletUsdPrice,type WalletValuation} from './valuation.js';

export interface AccountProtocolPosition {
 market_id:string;pool_contract_id:string;reserve_contract_id:string;asset_id:string;
 /** Total supplied value, already including collateral. */
 supplied:string;collateral?:string;borrowed:string;as_of:string;as_of_ledger:number;asset?:AssetIdentity;
}
export interface AccountValuation extends WalletValuation {
 unknown_source_count:number;
 liabilities_usd:string|null;
 priced_liabilities_subtotal_usd:string;
 unpriced_liability_asset_count:number;
 net_equity_usd:string|null;
}
export interface AccountValuationDependencies {
 walletBalances(customer:CustomerContext):Promise<WalletBalance[]>;
 earnPositions(customer:CustomerContext):Promise<AccountProtocolPosition[]>;
 borrowPositions(customer:CustomerContext):Promise<AccountProtocolPosition[]>;
 /** True only when additional protocol holdings are absent or included in the valued sources. */
 additionalSourcesComplete?(customer:CustomerContext):Promise<boolean>;
 priceFor(assetId:string):Promise<WalletUsdPrice|null>;
 assetFor?(assetId:string):AssetIdentity|undefined;
 now?():number;
}
const SCALE=10n**38n;
const amount=(value:unknown):bigint=>{
 if(typeof value!=='string'||value.length>79||!/^(0|[1-9]\d*)(?:\.\d{1,38})?$/.test(value)||value.replace('.','').length>78)throw Error('Invalid source amount');
 const [whole,fraction='']=value.split('.');return BigInt(whole!)*SCALE+BigInt(fraction.padEnd(38,'0'));
};
const format=(value:bigint,decimals=38):string=>{const negative=value<0n;value=negative?-value:value;const scale=10n**BigInt(decimals),fraction=(value%scale).toString().padStart(decimals,'0').replace(/0+$/,'');return `${negative?'-':''}${value/scale}${fraction?'.'+fraction:''}`;};
const fresh=(value:string,now:number)=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&Date.parse(value)<=now+1000&&now-Date.parse(value)<=30000;
function expectedReserve(id:string):string|undefined{
 if(id===XLM.id)return Asset.native().contractId(NETWORK_PASSPHRASE);
 const classic=/^stellar-testnet:classic:([A-Za-z0-9]{1,12}):(G[A-Z2-7]{55})$/.exec(id);
 if(classic)return new Asset(classic[1]!,classic[2]!).contractId(NETWORK_PASSPHRASE);
 const soroban=/^stellar-testnet:soroban:(C[A-Z2-7]{55})$/.exec(id);return soroban?.[1];
}
function metadataFingerprint(asset:AssetIdentity):string{return JSON.stringify([asset.id,asset.network,asset.kind,asset.code,asset.issuer??null,asset.contractId??null,asset.decimals,asset.verified]);}
function mergeHoldings(rows:AssetHolding[]):AssetHolding[]{
 const combined=new Map<string,AssetHolding>();
 for(const row of rows){
  const existing=combined.get(row.asset_id);
  if(!existing){combined.set(row.asset_id,{...row});continue;}
  existing.amount=format(amount(existing.amount)+amount(row.amount));
  if(!existing.asset&&row.asset)existing.asset=row.asset;
  else if(existing.asset&&row.asset&&metadataFingerprint(existing.asset)!==metadataFingerprint(row.asset))existing.asset={...existing.asset,verified:false};
 }
 return [...combined.values()];
}
/** Aggregate account assets without relabeling protocol-held assets as spendable wallet balances. */
export class AccountValuationService {
 constructor(private readonly deps:AccountValuationDependencies){}
 async read(customer:CustomerContext):Promise<AccountValuation>{
  const gross:AssetHolding[]=[],debts:AssetHolding[]=[];
  const sources=await Promise.allSettled([Promise.resolve().then(()=>this.deps.walletBalances(customer)),Promise.resolve().then(()=>this.deps.earnPositions(customer)),Promise.resolve().then(()=>this.deps.borrowPositions(customer))]);
  const now=this.deps.now?.()??Date.now();
  let unknown=0;
  if(this.deps.additionalSourcesComplete){try{if(await this.deps.additionalSourcesComplete(customer)!==true)unknown++;}catch{unknown++;}}
  const wallet=sources[0]!;
  if(wallet.status==='fulfilled'){
   try{
    if(!Array.isArray(wallet.value)||wallet.value.length>1000)throw Error('Invalid wallet snapshot');
    const seen=new Set<string>(),rows:AssetHolding[]=[];
    for(const balance of wallet.value as WalletBalance[]){
     if(!balance||typeof balance.asset_id!=='string'||!balance.asset_id||seen.has(balance.asset_id)||!fresh(balance.as_of,now))throw Error('Invalid wallet row');
     seen.add(balance.asset_id);amount(balance.wallet_amount);
     rows.push({asset_id:balance.asset_id,amount:balance.wallet_amount,asset:balance.asset??this.deps.assetFor?.(balance.asset_id)});
    }
    // Reuse strict amount/metadata rules before allowing this source to affect the gross account value.
    await valueAssetHoldings(rows,async()=>null,now);
    gross.push(...rows);
   }catch{unknown++;}
  }else unknown++;
  const seenPositions=new Set<string>();
  for(const source of sources.slice(1)){
   if(source.status==='rejected'){unknown++;continue;}
   try{
    if(!Array.isArray(source.value)||source.value.length>1000)throw Error('Invalid position snapshot');
    const sourceKeys=new Set<string>(),supplies:AssetHolding[]=[],liabilities:AssetHolding[]=[];
    for(const position of source.value as AccountProtocolPosition[]){
     if(!position||typeof position.asset_id!=='string'||!position.asset_id||!StrKey.isValidContract(position.pool_contract_id)||!StrKey.isValidContract(position.reserve_contract_id)
      ||position.market_id!==`stellar-testnet:blend:${position.pool_contract_id}:${position.reserve_contract_id}`||!Number.isSafeInteger(position.as_of_ledger)||position.as_of_ledger<=0||!fresh(position.as_of,now))throw Error('Invalid position identity');
     const reserve=expectedReserve(position.asset_id);if(reserve&&reserve!==position.reserve_contract_id)throw Error('Position asset/reserve mismatch');
     const key=`${position.pool_contract_id}:${position.reserve_contract_id}`;
     if(sourceKeys.has(key)||seenPositions.has(key))throw Error('Duplicate protocol position');
     sourceKeys.add(key);
     const supplied=amount(position.supplied);amount(position.borrowed);
     if(position.collateral!==undefined&&amount(position.collateral)>supplied)throw Error('Supplied amount must already include collateral');
     const asset=position.asset??this.deps.assetFor?.(position.asset_id);
     supplies.push({asset_id:position.asset_id,amount:position.supplied,asset});
     liabilities.push({asset_id:position.asset_id,amount:position.borrowed,asset});
    }
    await valueAssetHoldings(mergeHoldings(supplies),async()=>null,now);await valueAssetHoldings(mergeHoldings(liabilities),async()=>null,now);
    sourceKeys.forEach(key=>seenPositions.add(key));gross.push(...supplies);debts.push(...liabilities);
   }catch{unknown++;}
  }
  // Both gross assets and debts share the exact same source price observation per identity.
  const cachedPrices=new Map<string,Promise<WalletUsdPrice|null>>();
  const priceFor=(id:string)=>{let result=cachedPrices.get(id);if(!result){result=Promise.resolve().then(()=>this.deps.priceFor(id));cachedPrices.set(id,result);}return result;};
  const valuationTime=this.deps.now?now:undefined;
  const assets=await valueAssetHoldings(mergeHoldings(gross),priceFor,valuationTime),liabilities=await valueAssetHoldings(mergeHoldings(debts),priceFor,valuationTime);
  const total=unknown?null:assets.total_usd,liabilityTotal=unknown?null:liabilities.total_usd;
  const net=total===null||liabilityTotal===null?null:format(amount(total)-amount(liabilityTotal));
  return {...assets,total_usd:total,unknown_source_count:unknown,liabilities_usd:liabilityTotal,priced_liabilities_subtotal_usd:liabilities.priced_subtotal_usd,unpriced_liability_asset_count:liabilities.unpriced_asset_count,net_equity_usd:net};
 }
}
