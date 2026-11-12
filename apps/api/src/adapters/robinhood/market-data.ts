import {z} from 'zod';
/** Read-only offchain reference prices. This module never creates an executable venue quote. */
export const ROBINHOOD_PRICE_SYMBOLS=['TSLA','AMZN','PLTR','NFLX','AMD'] as const;
export type RobinhoodPriceSymbol=typeof ROBINHOOD_PRICE_SYMBOLS[number];
export type RobinhoodPriceBasis='underlying'|'testnet_token';
const BASE='https://api.robinhood.com/rhj/prices/';
const symbolSchema=z.enum(ROBINHOOD_PRICE_SYMBOLS),decimal=z.string().regex(/^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/);
const quoteSchema=z.object({tokenSymbol:symbolSchema,bid:decimal,ask:decimal,currency:z.literal('USD'),dailyTradingVolume:decimal,isTradingHalt:z.boolean(),generatedAt:z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/)}).passthrough();
const responseSchema=z.object({quotes:z.array(quoteSchema).length(1)}).passthrough();
const atomic=(value:string)=>{const[a,b='']=value.split('.');return BigInt(a!)*10n**18n+BigInt(b.padEnd(18,'0'));};
const format=(value:bigint,decimals:number)=>{const s=value.toString().padStart(decimals+1,'0'),fraction=s.slice(-decimals).replace(/0+$/,'');return s.slice(0,-decimals)+(fraction?'.'+fraction:'');};
export interface RobinhoodMultiplierProof {chainId:46630;symbol:RobinhoodPriceSymbol;tokenAddress:`0x${string}`;multiplierBaseUnits:string;multiplierDecimals:18;blockNumber:string;observedAt:string;oraclePaused?:boolean;}
export interface RobinhoodPriceObservation {
 symbol:RobinhoodPriceSymbol;currency:'USD';bid:string;ask:string;midpoint:string;dailyTradingVolume:string;
 generatedAt:string;observedAt:string;isTradingHalt:boolean;status:'halted'|'current';
 source:'robinhood_official_rest';sourceUrl:string;priceBasis:RobinhoodPriceBasis;
 /** Reference display only; execution must use a separately approved Testnet pool quote. */
 executable:false;destinationChainId:46630|null;multiplier:RobinhoodMultiplierProof|null;
}
export interface RobinhoodHistory {observations:RobinhoodPriceObservation[];coverage:{kind:'observed_only';historicalOhlcAvailable:false;count:number;firstGeneratedAt:string|null;lastGeneratedAt:string|null;truncated:boolean};}
interface Response {ok:boolean;status:number;headers:{get(name:string):string|null};json():Promise<unknown>;}
export interface RobinhoodMarketDataDependencies {
 fetch?:(url:string,init:{method:'GET';signal:AbortSignal;headers:Record<string,string>})=>Promise<Response>;
 now?:()=>number;
 /** Server-reviewed Testnet46630 token registry; never populated from REST mainnet deployments. */
 testnetTokens?:Partial<Record<RobinhoodPriceSymbol,`0x${string}`>>;
 readTestnetMultiplier?:(symbol:RobinhoodPriceSymbol)=>Promise<RobinhoodMultiplierProof>;
}
export class RobinhoodMarketDataError extends Error {constructor(readonly reason:string,readonly retryAt:number|null=null){super(reason);this.name='RobinhoodMarketDataError';}}
interface Cached {at:number;value:RobinhoodPriceObservation;}
export class RobinhoodMarketDataReader {
 private cache=new Map<RobinhoodPriceSymbol,Cached>();private flights=new Map<RobinhoodPriceSymbol,Promise<RobinhoodPriceObservation>>();
 private records=new Map<string,RobinhoodPriceObservation[]>();private truncated=new Set<string>();private retryAt=0;private failures=0;
 private readonly tokens:RobinhoodMarketDataDependencies['testnetTokens'];
 constructor(private readonly deps:RobinhoodMarketDataDependencies={}){this.tokens=structuredClone(deps.testnetTokens??{});}
 private now(){return this.deps.now?.()??Date.now();}
 private validTime(at:string,age:number){const t=Date.parse(at);if(!Number.isFinite(t)||new Date(t).toISOString().slice(0,19)!==at.slice(0,19)||t>this.now()+2000||this.now()-t>age)throw new RobinhoodMarketDataError('STALE_OR_INVALID_SOURCE_TIMESTAMP');return t;}
 private remember(observation:RobinhoodPriceObservation){const key=observation.symbol+':'+observation.priceBasis,rows=this.records.get(key)??[],last=rows.at(-1);
  if(last&&Date.parse(observation.generatedAt)<Date.parse(last.generatedAt))throw new RobinhoodMarketDataError('SOURCE_TIMESTAMP_REGRESSION');
  if(last?.generatedAt===observation.generatedAt){if(last.bid!==observation.bid||last.ask!==observation.ask||last.isTradingHalt!==observation.isTradingHalt)throw new RobinhoodMarketDataError('CONFLICTING_SOURCE_OBSERVATION');return;}
  rows.push(structuredClone(observation));if(rows.length>4096){rows.shift();this.truncated.add(key);}this.records.set(key,rows);
 }
 private async fetchObservation(symbol:RobinhoodPriceSymbol):Promise<RobinhoodPriceObservation>{
  if(this.now()<this.retryAt)throw new RobinhoodMarketDataError('SOURCE_RATE_BACKOFF',this.retryAt);
  const sourceUrl=BASE+symbol;let response:Response;
  try{response=await(this.deps.fetch??fetch)(sourceUrl,{method:'GET',signal:AbortSignal.timeout(10000),headers:{accept:'application/json'}});}catch{this.backoff(null);throw new RobinhoodMarketDataError('SOURCE_NETWORK_UNAVAILABLE',this.retryAt);}
  if(!response.ok){if(response.status===429||response.status>=500)this.backoff(response.headers.get('retry-after'));throw new RobinhoodMarketDataError('SOURCE_HTTP_'+response.status,this.retryAt||null);}
  let value:z.infer<typeof quoteSchema>;try{value=responseSchema.parse(await response.json()).quotes[0]!;}catch{throw new RobinhoodMarketDataError('INVALID_OFFICIAL_PRICE_RESPONSE');}
  if(value.tokenSymbol!==symbol)throw new RobinhoodMarketDataError('SOURCE_SYMBOL_MISMATCH');this.validTime(value.generatedAt,60000);
  const bid=atomic(value.bid),ask=atomic(value.ask);if(bid<=0n||ask<=0n||bid>ask)throw new RobinhoodMarketDataError('INVALID_BID_ASK');
  const observation:RobinhoodPriceObservation={symbol,currency:'USD',bid:format(bid,18),ask:format(ask,18),midpoint:format((bid+ask)*5n,19),dailyTradingVolume:format(atomic(value.dailyTradingVolume),18),generatedAt:value.generatedAt,observedAt:new Date(this.now()).toISOString(),isTradingHalt:value.isTradingHalt,status:value.isTradingHalt?'halted':'current',source:'robinhood_official_rest',sourceUrl,priceBasis:'underlying',executable:false,destinationChainId:null,multiplier:null};
  this.remember(observation);this.failures=0;this.retryAt=0;this.cache.set(symbol,{at:this.now(),value:observation});return observation;
 }
 private backoff(retryAfter:string|null){this.failures++;let delay=Math.min(120000,15000*2**Math.min(this.failures-1,3));if(retryAfter){const n=/^\d+$/.test(retryAfter)?Number(retryAfter)*1000:Date.parse(retryAfter)-this.now();if(Number.isFinite(n))delay=Math.min(300000,Math.max(delay,n));}this.retryAt=this.now()+delay;}
 async read(input:RobinhoodPriceSymbol,options:{basis?:RobinhoodPriceBasis}={}):Promise<RobinhoodPriceObservation>{
  const symbol=symbolSchema.parse(input),basis=options.basis??'underlying';if(basis!=='underlying'&&basis!=='testnet_token')throw new RobinhoodMarketDataError('UNREVIEWED_PRICE_BASIS');
  let raw:RobinhoodPriceObservation;const cached=this.cache.get(symbol);
  if(cached&&this.now()-cached.at<15000){this.validTime(cached.value.generatedAt,60000);raw=cached.value;}else{let flight=this.flights.get(symbol);if(!flight){flight=this.fetchObservation(symbol);this.flights.set(symbol,flight);void flight.finally(()=>{if(this.flights.get(symbol)===flight)this.flights.delete(symbol);}).catch(()=>{});}raw=await flight;}
  if(basis==='underlying')return structuredClone(raw);
  const expected=this.tokens?.[symbol],proof=await this.deps.readTestnetMultiplier?.(symbol);
  if(!expected||!/^0x[a-fA-F0-9]{40}$/.test(expected)||!proof||proof.chainId!==46630||proof.symbol!==symbol||typeof proof.tokenAddress!=='string'||proof.tokenAddress.toLowerCase()!==expected.toLowerCase()||proof.multiplierDecimals!==18||typeof proof.multiplierBaseUnits!=='string'||!/^\d{1,36}$/.test(proof.multiplierBaseUnits)||BigInt(proof.multiplierBaseUnits)<=0n||typeof proof.blockNumber!=='string'||!/^0x[\da-fA-F]+$|^[1-9]\d*$/.test(proof.blockNumber)||BigInt(proof.blockNumber)<=0n||typeof proof.observedAt!=='string'||proof.oraclePaused===true)throw new RobinhoodMarketDataError('VERIFIED_TESTNET_MULTIPLIER_REQUIRED');
  this.validTime(proof.observedAt,30000);const m=BigInt(proof.multiplierBaseUnits),bid=atomic(raw.bid)*m,ask=atomic(raw.ask)*m;
  const result:RobinhoodPriceObservation={...raw,bid:format(bid,36),ask:format(ask,36),midpoint:format((bid+ask)*5n,37),priceBasis:basis,destinationChainId:46630,multiplier:structuredClone(proof)};
  // Corporate action changes at one timestamp must not overwrite an earlier observation.
  this.remember(result);return structuredClone(result);
 }
 history(input:RobinhoodPriceSymbol,basis:RobinhoodPriceBasis='underlying'):RobinhoodHistory{const symbol=symbolSchema.parse(input);if(!['underlying','testnet_token'].includes(basis))throw new RobinhoodMarketDataError('UNREVIEWED_PRICE_BASIS');const key=symbol+':'+basis,observations=structuredClone(this.records.get(key)??[]);return{observations,coverage:{kind:'observed_only',historicalOhlcAvailable:false,count:observations.length,firstGeneratedAt:observations[0]?.generatedAt??null,lastGeneratedAt:observations.at(-1)?.generatedAt??null,truncated:this.truncated.has(key)}};}
}
