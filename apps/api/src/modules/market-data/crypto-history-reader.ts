import {GrapnelError} from '@grapnel/contracts';
import {HISTORY_RANGES,normalizePrice,priceChange,type HistoryRange,type MarketHistory} from './service.js';

const BASE='https://data-api.binance.vision';
export const CRYPTO_REFERENCE_SYMBOLS=['XLM','BTC','ETH','XRP','USDC'] as const;
export type CryptoReferenceSymbol=typeof CRYPTO_REFERENCE_SYMBOLS[number];
export interface CryptoReferenceMarket {asset_id:string;reference_symbol:CryptoReferenceSymbol;}
export interface CryptoReferenceHistory extends MarketHistory {
 price_basis:'underlying_reference';reference_symbol:CryptoReferenceSymbol;related_asset_id:string;
 source_url:string;interval:string;requested_range:HistoryRange;coverage_start:string;coverage_end:string;
}
const WINDOWS:Record<HistoryRange,{interval:string;ms:number;duration:number|null}>={
 live:{interval:'1m',ms:60000,duration:3600000},'1d':{interval:'5m',ms:300000,duration:86400000},
 '1w':{interval:'1h',ms:3600000,duration:604800000},'1m':{interval:'4h',ms:14400000,duration:2592000000},
 '1y':{interval:'1d',ms:86400000,duration:31536000000},all:{interval:'1w',ms:604800000,duration:null},
};
const unavailable=(reason:string):never=>{throw new GrapnelError(503,'CRYPTO_REFERENCE_UNAVAILABLE','Crypto reference history is unavailable',true,{reason});};
type HistoryData=Omit<CryptoReferenceHistory,'market_id'|'related_asset_id'>;
/** Public reference market data only. Never used for Testnet swap execution or wallet valuation.
 * The caller supplies a trusted exact-asset resolver, never a browser-chosen symbol or URL. */
export class CryptoReferenceHistoryReader {
 private readonly fetcher:typeof fetch;private readonly now:()=>number;
 private readonly cache=new Map<string,{until:number;data:HistoryData}>();
 private readonly pending=new Map<string,Promise<HistoryData>>();
 private readonly failures=new Map<string,{until:number;error:GrapnelError}>();
 private readonly identities=new Map<CryptoReferenceSymbol,number>();
 constructor(private readonly deps:{resolveMarket:(marketId:string)=>Promise<CryptoReferenceMarket|null>;fetcher?:typeof fetch;now?:()=>number}){this.fetcher=deps.fetcher??fetch;this.now=deps.now??Date.now;}
 async history(marketId:string,range:HistoryRange):Promise<CryptoReferenceHistory>{
  if(typeof marketId!=='string'||!marketId.length||marketId.length>200||!HISTORY_RANGES.includes(range))throw new GrapnelError(422,'INVALID_HISTORY_RANGE','A registered market and history range are required');
  const market=await this.deps.resolveMarket(marketId);
  if(!market||!market.asset_id||!CRYPTO_REFERENCE_SYMBOLS.includes(market.reference_symbol))return unavailable('NO_EXPLICIT_REFERENCE_MAPPING');
  const key=`${market.reference_symbol}:${range}`,now=this.now(),hit=this.cache.get(key);
  if(hit&&hit.until>now)return {...structuredClone(hit.data),market_id:marketId,related_asset_id:market.asset_id};
  const failed=this.failures.get(key);if(failed&&failed.until>now)throw failed.error;
  let task=this.pending.get(key);
  if(!task){task=this.read(market.reference_symbol,range).then(data=>{this.cache.set(key,{until:this.now()+(range==='live'?15000:60000),data});this.failures.delete(key);return data;}).catch(error=>{const safe=error instanceof GrapnelError?error:new GrapnelError(503,'CRYPTO_REFERENCE_UNAVAILABLE','Crypto reference history is unavailable',true);this.failures.set(key,{until:this.now()+(safe.code==='PROVIDER_RATE_LIMITED'?60000:5000),error:safe});throw safe;}).finally(()=>{this.pending.delete(key);});this.pending.set(key,task);}
  return {...structuredClone(await task),market_id:marketId,related_asset_id:market.asset_id};
 }
 private async request(url:URL):Promise<unknown>{
  let response:Response;try{response=await this.fetcher(url,{signal:AbortSignal.timeout(12000),redirect:'error'});}catch{return unavailable('SOURCE_REQUEST_FAILED');}
  if(response.status===429||response.status===418)throw new GrapnelError(429,'PROVIDER_RATE_LIMITED','Crypto reference source rate limit reached',true);
  if(!response.ok)return unavailable('SOURCE_RESPONSE_FAILED');
  try{return await response.json();}catch{return unavailable('SOURCE_INVALID_JSON');}
 }
 private async read(symbol:CryptoReferenceSymbol,range:HistoryRange):Promise<HistoryData>{
  const pair=`${symbol}USDT`,now=this.now(),window=WINDOWS[range];
  // Kline arrays do not echo a symbol. Check the exact exchange identity before interpreting them.
  if((this.identities.get(symbol)??0)<=now){
   const url=new URL('/api/v3/exchangeInfo',BASE);url.searchParams.set('symbol',pair);
   const body=await this.request(url) as {symbols?:{symbol?:unknown;baseAsset?:unknown;quoteAsset?:unknown;status?:unknown}[]};
   if(!body||!Array.isArray(body.symbols)||body.symbols.length!==1||body.symbols[0]?.symbol!==pair||body.symbols[0].baseAsset!==symbol||body.symbols[0].quoteAsset!=='USDT'||body.symbols[0].status!=='TRADING')return unavailable('SOURCE_SYMBOL_MISMATCH');
   this.identities.set(symbol,this.now()+3600000);
  }
  const end=this.now(),url=new URL('/api/v3/klines',BASE);url.searchParams.set('symbol',pair);url.searchParams.set('interval',window.interval);url.searchParams.set('limit','1000');url.searchParams.set('endTime',String(end));
  const since=window.duration===null?null:end-window.duration;if(since!==null)url.searchParams.set('startTime',String(since));
  const body=await this.request(url);if(!Array.isArray(body)||!body.length||body.length>1000)return unavailable('SOURCE_HISTORY_EMPTY');
  const points:{timestamp:string;price:string}[]=[];let previous=-1;
  for(const row of body){
   if(!Array.isArray(row)||row.length!==12||!Number.isSafeInteger(row[0])||!Number.isSafeInteger(row[6]))return unavailable('SOURCE_CANDLE_INVALID');
   const open=row[0] as number,close=row[6] as number;
   if(open<0||open<=previous||open>end+5000||close!==open+window.ms-1||(since!==null&&open<since-window.ms))return unavailable('SOURCE_CANDLE_TIMESTAMP_INVALID');
   previous=open;
   // A forming candle's close timestamp is in the future. Never attribute its latest price to that future time.
   if(close>end)continue;
   let price:string;try{price=normalizePrice(row[4]);}catch{return unavailable('SOURCE_CANDLE_PRICE_INVALID');}
   points.push({timestamp:new Date(close).toISOString(),price});
  }
  const latest=points.at(-1);if(!latest||points.length<2)return unavailable('SOURCE_HISTORY_EMPTY');
  if(end-Date.parse(latest.timestamp)>window.ms*2+5000)return unavailable('SOURCE_HISTORY_STALE');
  return {quote_symbol:'USDT',latest_price:latest.price,as_of:latest.timestamp,points,...priceChange(points[0]!.price,latest.price),price_basis:'underlying_reference',reference_symbol:symbol,source_url:url.toString(),interval:window.interval,requested_range:range,coverage_start:points[0]!.timestamp,coverage_end:latest.timestamp};
 }
}
