import { GrapnelError } from '@grapnel/contracts';
import { priceChange,type HistoryRange } from '../market-data/service.js';
import type { StockSymbol } from '../../adapters/robinhood/registry.js';
const periods:Record<HistoryRange,{range:string;interval:string}>={live:{range:'1d',interval:'1m'},'1d':{range:'1d',interval:'5m'},'1w':{range:'5d',interval:'30m'},'1m':{range:'1mo',interval:'1h'},'1y':{range:'1y',interval:'1d'},all:{range:'max',interval:'1mo'}};
const numeric=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const decimal=(v:unknown):string|null=>numeric(v)&&v>=0&&!String(v).includes('e')?String(v):null;
/** Display-only public equity history. Never used for token settlement or valuation. */
export class EquityHistoryReader {
 private cache=new Map<string,{at:number;value:any}>();private flights=new Map<string,Promise<any>>();
 constructor(private deps:{fetch?:typeof fetch;now?:()=>number}={}){}
 async read(symbol:StockSymbol,range:HistoryRange){
  if(!['TSLA','AMZN','PLTR','NFLX','AMD'].includes(symbol)||!periods[range])throw new GrapnelError(422,'INVALID_HISTORY_RANGE','Unknown stock or timeframe');
  const key=symbol+':'+range,now=this.deps.now?.()??Date.now(),cached=this.cache.get(key);
  if(cached&&now-cached.at<(range==='live'?15000:60000))return structuredClone(cached.value);
  let flight=this.flights.get(key);if(!flight){flight=this.load(symbol,range).then(value=>{this.cache.set(key,{at:this.deps.now?.()??Date.now(),value});return value;});this.flights.set(key,flight);void flight.finally(()=>this.flights.delete(key)).catch(()=>{});}
  return structuredClone(await flight);
 }
 private async load(symbol:StockSymbol,range:HistoryRange){
  const config=periods[range],url=`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${config.range}&interval=${config.interval}&includePrePost=false`;
  const response=await(this.deps.fetch??fetch)(url,{signal:AbortSignal.timeout(8000),headers:{accept:'application/json'}});
  if(!response.ok)throw new GrapnelError(503,'MARKET_HISTORY_UNAVAILABLE','Stock reference history is updating',true);
  const json=await response.json(),result=json?.chart?.result?.[0],meta=result?.meta,quote=result?.indicators?.quote?.[0];
  if(json?.chart?.error||meta?.symbol!==symbol||meta.currency!=='USD'||meta.instrumentType!=='EQUITY'||!Array.isArray(result.timestamp)||!Array.isArray(quote?.close)||result.timestamp.length!==quote.close.length)throw new GrapnelError(503,'MARKET_HISTORY_INVALID','Stock reference history could not be validated',true);
  const now=this.deps.now?.()??Date.now();
  let points:{timestamp:string;price:string}[]=result.timestamp.flatMap((time:unknown,i:number)=>{
   const price=decimal(quote.close[i]);return numeric(time)&&time>0&&time*1000<=now+2000&&price&&Number(price)>0?[{timestamp:new Date(time*1000).toISOString(),price}]:[];
  }).sort((a:any,b:any)=>a.timestamp.localeCompare(b.timestamp)).filter((p:any,i:number,all:any[])=>!i||p.timestamp!==all[i-1].timestamp);
  const marketPrice=decimal(meta.regularMarketPrice),marketTime=meta.regularMarketTime;
  if(marketPrice&&Number(marketPrice)>0&&numeric(marketTime)&&marketTime*1000<=now+2000&&marketTime*1000>Date.parse(points.at(-1)?.timestamp??''))points.push({timestamp:new Date(marketTime*1000).toISOString(),price:marketPrice});
  if(range==='live'&&points.length){const end=Date.parse(points.at(-1)!.timestamp);points=points.filter(p=>Date.parse(p.timestamp)>=end-3600000);}
  if(!points.length)throw new GrapnelError(503,'MARKET_HISTORY_UNAVAILABLE','No stock reference observations were returned',true);
  const latest=points.at(-1)!,first=points[0]!;
  return {quote_symbol:'USD',latest_price:latest.price,as_of:latest.timestamp,points,...priceChange(first.price,latest.price),source:'yahoo_finance',source_url:url,interval:config.interval,requested_range:range,price_basis:'underlying_reference',reference_price_type:'last_trade',reference_symbol:symbol,
   coverage:{kind:'provider_available',first_generated_at:first.timestamp,complete_requested_range:false,observation_count:points.length,historical_ohlc_available:true},
   metrics:{day_high:decimal(meta.regularMarketDayHigh),day_low:decimal(meta.regularMarketDayLow),day_volume:decimal(meta.regularMarketVolume),fifty_two_week_high:decimal(meta.fiftyTwoWeekHigh),fifty_two_week_low:decimal(meta.fiftyTwoWeekLow),previous_close:decimal(meta.previousClose??meta.regularMarketPreviousClose),market_time:numeric(meta.regularMarketTime)?new Date(meta.regularMarketTime*1000).toISOString():null}};
 }
}
