/** Asset presentation aggregation only. No balance, price or dollar peg is inferred. */
import {formatTokenAmount,ZENEX_USDC_ID} from '@grapnel/contracts';
import {ROBINHOOD_CUSTOMER} from './robinhood-customer';
export type AssetBalanceRow={asset_id:string;asset?:{id:string;code:string;name?:string;verified?:boolean;kind?:string;network?:string;decimals?:number};wallet_amount:string|null;reserved?:string|null;spendable?:string|null;network_label?:string;feature_label?:string;balance_verified?:boolean;value_usd?:string|null;valuation_basis?:string|null};
export type AssetBalanceValuation={assets?:{asset_id:string;wallet_amount:string;value_usd:string|null}[]}|null;
export type GroupedAssetSource=AssetBalanceRow&{code:string;label:string;name?:string;wallet_amount:string|null;reserved:string|null;spendable:string|null;value_usd:string|null;conflicted:boolean};
export type GroupedAsset={key:string;code:string;label:string;name?:string;expandable:boolean;children:GroupedAssetSource[];wallet_amount:string|null;reserved:string|null;spendable:string|null;value_usd:string|null;known_wallet_amount:string|null;unknown_wallet_count:number};
const GMX_SG='arbitrum-sepolia:erc20:0x3253a335e7bffb4790aa4c25c4250d206e9b9773';
const MAX_DIGITS=100;
function normalize(value:unknown,decimals=18):string|null{
 if(typeof value!=='string'||value.length>MAX_DIGITS||!/^\d+(?:\.\d+)?$/.test(value)||!Number.isInteger(decimals)||decimals<0||decimals>38)return null;
 const [whole,fraction='']=value.split('.'),tail=fraction.replace(/0+$/,'');if(tail.length>decimals)return null;return BigInt(whole!).toString()+(tail?'.'+tail:'');
}
function units(value:string,scale:number):bigint{const [whole,tail='']=value.split('.');return BigInt(whole!)*10n**BigInt(scale)+BigInt(tail.padEnd(scale,'0')||'0');}
function decimal(value:bigint,scale:number):string{const raw=value.toString().padStart(scale+1,'0');return normalize(scale?raw.slice(0,-scale)+'.'+raw.slice(-scale):raw,scale)!;}
function sum(values:(string|null)[]):string|null{if(!values.length||values.some(value=>value===null))return null;const known=values as string[],scale=Math.max(...known.map(v=>v.split('.')[1]?.length??0));return decimal(known.reduce((total,v)=>total+units(v,scale),0n),scale);}
const metadata=(row:AssetBalanceRow)=>row.asset?.id===row.asset_id?row.asset:undefined;
const precision=(row:AssetBalanceRow)=>metadata(row)?.decimals??18;
const exactSg=(row:AssetBalanceRow)=>(row.asset_id.toLowerCase()===GMX_SG||row.asset_id.toLowerCase().startsWith(GMX_SG+':'))||metadata(row)?.code==='USDC.SG';
function code(row:AssetBalanceRow):string{if(exactSg(row))return 'USDC.SG';const asset=metadata(row);if(asset?.code?.trim())return asset.code.trim();if(row.asset_id==='stellar-testnet:native:XLM')return 'XLM';const classic=/^stellar-testnet:classic:([^:]+):/.exec(row.asset_id);return classic?.[1]??'Asset';}
function identityKey(row:AssetBalanceRow):string{const a=metadata(row);return JSON.stringify(a?{id:a.id,code:a.code,verified:a.verified===true,kind:a.kind??null,network:a.network??null,decimals:a.decimals??null}:null);}
function valuationFor(row:AssetBalanceRow,amount:string|null,valuation?:AssetBalanceValuation):string|null{
 if(amount===null)return null;
 // Explicit server accounting basis for the pinned Robinhood Testnet settlement token.
 if(row.balance_verified===true&&metadata(row)?.verified===true&&(row.asset_id==='robinhood-testnet:erc20:0x7e955252e15c84f5768b83c41a71f9eba181802f'||row.asset_id===GMX_SG)&&row.valuation_basis==='testnet_settlement_unit'&&normalize(row.value_usd,38)===amount)return amount;
 if(row.balance_verified===true&&metadata(row)?.verified===true&&row.valuation_basis==='testnet_pool_sell_quote'&&Object.values(ROBINHOOD_CUSTOMER.stocks).some(stock=>row.asset_id===`robinhood-testnet:erc20:${stock.address}`))return normalize(row.value_usd,6);
 const matches=valuation?.assets?.filter(v=>v.asset_id===row.asset_id&&normalize(v.wallet_amount,precision(row))===amount)??[];if(!matches.length)return null;
 const values=matches.map(v=>normalize(v.value_usd,38));return values.every(value=>value!==null&&value===values[0])?values[0]!:null;
}
const labels=(rows:AssetBalanceRow[],key:'network_label'|'feature_label')=>[...new Set(rows.map(r=>r[key]?.trim()).filter((v):v is string=>!!v))].join(' · ')||undefined;
/** A repeated source ID is a repeated observation, never an additional holding. */
export function buildGroupedAssets(balances:AssetBalanceRow[],valuation?:AssetBalanceValuation):GroupedAsset[]{
 const byId=new Map<string,AssetBalanceRow[]>();for(const row of balances){if(typeof row.asset_id!=='string'||!row.asset_id||row.asset_id.length>2048)continue;const rows=byId.get(row.asset_id)??[];rows.push(row);byId.set(row.asset_id,rows);}
 const sources:GroupedAssetSource[]=[];
 for(const rows of byId.values()){
  const first=rows[0]!,withMetadata=rows.find(row=>metadata(row))??first,canonical=(r:AssetBalanceRow)=>[normalize(r.wallet_amount,precision(r)),normalize(r.reserved,precision(r)),normalize(r.spendable,precision(r))];
  const values=rows.map(canonical),nonemptyMetadata=rows.filter(row=>metadata(row)),badIdentity=rows.some(r=>r.asset&&r.asset.id!==r.asset_id),conflicted=badIdentity||values.some(v=>JSON.stringify(v)!==JSON.stringify(values[0]))||nonemptyMetadata.some(r=>identityKey(r)!==identityKey(nonemptyMetadata[0]!));
  const a=metadata(withMetadata),symbol=code(withMetadata),name=a?.verified===true?a.name?.trim()||undefined:undefined,[amount,reserved,spendable]=conflicted?[null,null,null]:values[0]!;
  sources.push({...withMetadata,network_label:labels(rows,'network_label'),feature_label:labels(rows,'feature_label'),code:symbol,label:symbol,name,wallet_amount:amount!,reserved:reserved!,spendable:spendable!,value_usd:conflicted?null:valuationFor(withMetadata,amount!,valuation),conflicted});
 }
 const groups:GroupedAsset[]=[],usdc:GroupedAssetSource[]=[];
 const add=(children:GroupedAssetSource[],expandable:boolean)=>{const first=children[0]!,known=children.flatMap(row=>row.wallet_amount===null?[]:[row.wallet_amount]);groups.push({key:expandable?'group:USDC':first.asset_id,code:expandable?'USDC':first.code,label:expandable?'USDC':first.label,name:expandable?undefined:first.name,expandable,children,wallet_amount:sum(children.map(r=>r.wallet_amount)),reserved:sum(children.map(r=>r.reserved)),spendable:sum(children.map(r=>r.spendable)),value_usd:sum(children.map(r=>r.value_usd)),known_wallet_amount:known.length?sum(known):null,unknown_wallet_count:children.length-known.length});};
 for(const row of sources){const a=metadata(row);if(a?.verified===true&&a.code==='USDC'&&!exactSg(row))usdc.push(row);else add([row],false);}
 if(usdc.length)add(usdc,true);return groups.sort((a,b)=>a.expandable!==b.expandable?(a.expandable?-1:1):a.code.localeCompare(b.code)||a.key.localeCompare(b.key));
}
export function groupedAmount(value:string|null|undefined):string{if(value==null)return '—';const display=formatTokenAmount(value);return display==='Unavailable'?'—':display;}
/** Round source-provided USD values to cents with bigint; never Number or a symbol peg. */
export function groupedUsd(value:string|null):string{const canonical=normalize(value,38);if(canonical===null)return '—';const scale=canonical.split('.')[1]?.length??0,power=10n**BigInt(scale),cents=(units(canonical,scale)*100n+power/2n)/power,whole=(cents/100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,',');return '$'+whole+'.'+(cents%100n).toString().padStart(2,'0');}
export function groupedSourceLabel(row:GroupedAssetSource):string{if(row.asset_id===ZENEX_USDC_ID)return "Stellar · Perpetuals collateral";const network=row.network_label??({ 'stellar-testnet':'Stellar','hyperevm-testnet':'HyperEVM','arbitrum-sepolia':'Arbitrum Sepolia','robinhood-testnet':'Robinhood'}as Record<string,string>)[row.asset?.network??'']??(row.asset_id.startsWith('stellar-testnet:')?'Stellar':'Network');return network+(row.feature_label?' · '+row.feature_label:'');}
