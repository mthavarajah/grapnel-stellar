import { matchesUnderlyingIdentity, reviewedUnderlyingIdentity } from './underlying-identity.js';
import { z } from 'zod';
import { GrapnelError } from '@grapnel/contracts';
import type { StockCatalogMarket } from './catalog.js';
export type StockHistoryRange = 'live' | '1d' | '1w' | '1m' | '1y' | 'all';
const requests = {
  live: { range: '1d', interval: '1m' }, '1d': { range: '1d', interval: '1m' },
  '1w': { range: '5d', interval: '15m' }, '1m': { range: '1mo', interval: '1d' },
  '1y': { range: '1y', interval: '1d' }, all: { range: 'max', interval: '3mo' },
} as const;
const numeric = z.number().finite().nullable();
const epoch = z.number().int().positive().max(253402300799);
const chartSchema = z.object({ chart: z.object({ error: z.unknown().nullable(), result: z.array(z.object({
  meta: z.object({ symbol: z.string(), currency: z.string(), instrumentType: z.enum(['EQUITY','ETF']),
    longName: z.string().max(200), shortName: z.string().max(200), exchangeName: z.string().max(50), fullExchangeName: z.string().max(100),
    regularMarketTime: epoch.optional(), regularMarketPrice: numeric.optional(),
    regularMarketDayHigh: numeric.optional(), regularMarketDayLow: numeric.optional(),
    regularMarketVolume: numeric.optional(), fiftyTwoWeekHigh: numeric.optional(), fiftyTwoWeekLow: numeric.optional(),
    previousClose: numeric.optional(), chartPreviousClose: numeric.optional(), dataGranularity: z.string(),
  }), timestamp: z.array(epoch).max(25000).optional(), indicators: z.object({ quote: z.array(z.object({
    close: z.array(numeric).max(25000), open: z.array(numeric).max(25000).optional(),
    high: z.array(numeric).max(25000).optional(), low: z.array(numeric).max(25000).optional(),
    volume: z.array(numeric).max(25000).optional(),
  })).max(1) }),
})).max(1).nullable() }) });
export interface StockHistoryDTO {
  market_id: string;
  base_asset_id: string;
  base_symbol: string;
  quote_symbol: string;
  latest_price: string | null;
  as_of: string | null;
  points: { timestamp: string; price: string }[];
  change_absolute: string | null;
  change_percent: string | null;
  price_basis: 'underlying_stock';
  source_url: string;
  observed_at: string;
  interval: string;
  underlying_identity: { symbol: string; long_name: string; short_name: string; instrument_type: string; exchange: string; exchange_name: string; currency: string };
  metrics: { day_high: string | null; day_low: string | null; day_volume: string | null;
    fifty_two_week_high: string | null; fifty_two_week_low: string | null;
    previous_close: string | null; market_time: string | null };
  candles: { timestamp: string; open: string | null; high: string | null; low: string | null;
    close: string; volume: string | null }[];
}
// Provider reference prices are JSON numbers. Serialize their supplied numeric value;
// never use them for token amounts, transaction quotes or token balance calculations.
const decimal = (value: number | null | undefined): string | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1e15) return null;
  const text = String(value);
  if (/^\d+(?:\.\d{1,18})?$/.test(text)) return text;
  return null;
};
const iso = (value: number): string => new Date(value * 1000).toISOString();
const scale = 10n ** 18n;
const atomic = (value: string): bigint => { const [whole, fraction = ''] = value.split('.'); return BigInt(whole!) * scale + BigInt(fraction.padEnd(18, '0')); };
const format = (value: bigint): string => { const negative=value<0n; const v=negative?-value:value; const fraction=(v%scale).toString().padStart(18,'0').replace(/0+$/,'');return `${negative?'-':''}${v/scale}${fraction?'.'+fraction:''}`; };
function changes(first: string | undefined, last: string | undefined): { change_absolute: string | null; change_percent: string | null } {
  if (first === undefined || last === undefined) return { change_absolute: null, change_percent: null };
  const start=atomic(first), difference=atomic(last)-start;
  return { change_absolute: format(difference), change_percent: start===0n?null:format(difference*100n*scale/start) };
}
const unavailable = () => new GrapnelError(503,'PROVIDER_UNAVAILABLE','Underlying stock reference data is unavailable',true,{provider:'yahoo_finance',price_basis:'underlying_stock'});
/** Bound to a catalog-resolved provider identity; class caller performs resolution. */
export async function readUnderlyingStockHistory(candidate: StockCatalogMarket, range: StockHistoryRange,
  options: { fetch?: typeof fetch; now?: () => Date } = {}): Promise<StockHistoryDTO> {
  const selection=requests[range];
  if(!reviewedUnderlyingIdentity(candidate.symbol,candidate.name))throw new GrapnelError(503,'PROVIDER_UNAVAILABLE','Underlying stock identity has not been verified',false,{provider:'yahoo_finance',reason:'UNDERLYING_IDENTITY_UNVERIFIED'});
  if (!selection || !/^[A-Z][A-Z0-9]{0,11}$/.test(candidate.symbol)
    || candidate.market_id!==`sodax:catalog:${candidate.network==='stellar-mainnet'?'mainnet':'testnet'}:${candidate.contract_id}`)
    throw new GrapnelError(422,'VALIDATION_ERROR','Invalid stock catalog or history range');
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(candidate.symbol)}?range=${selection.range}&interval=${selection.interval}`;
  try {
    const response=await (options.fetch??fetch)(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(12_000)});
    if(!response.ok)throw unavailable();
    const body=await response.text();if(body.length>4_000_000)throw unavailable();
    const parsed=chartSchema.parse(JSON.parse(body)); const row=parsed.chart.result?.[0];
    if(parsed.chart.error!==null||!row||row.meta.symbol!==candidate.symbol||row.meta.currency!=='USD'||row.meta.dataGranularity!==selection.interval||!matchesUnderlyingIdentity(candidate.symbol,candidate.name,row.meta))throw unavailable();
    const timestamps=row.timestamp??[], quote=row.indicators.quote[0];
    if(!quote||timestamps.length!==quote.close.length)throw unavailable();
    if([quote.open,quote.high,quote.low,quote.volume].some(values=>values!==undefined&&values.length!==timestamps.length))throw unavailable();
    const now=options.now?.()??new Date();
    const candles=timestamps.flatMap((timestamp,index)=>{
      const close=decimal(quote.close[index]);
      // Keep missing observations as gaps, never forward-fill or fabricate candles.
      if(close===null||timestamp*1000>now.getTime()+60_000)return [];
      if(index>0&&timestamp<=timestamps[index-1]!)throw unavailable();
      return [{timestamp:iso(timestamp),open:decimal(quote.open?.[index]),high:decimal(quote.high?.[index]),
        low:decimal(quote.low?.[index]),close,volume:decimal(quote.volume?.[index])}];
    });
    // Deterministic actual observation sample, retaining first and latest; no interpolation.
    const sampled=candles.length<=1000?candles:Array.from({length:1000},(_,i)=>candles[Math.floor(i*(candles.length-1)/999)]!);
    const points=sampled.map(c=>({timestamp:c.timestamp,price:c.close}));
    const latest=decimal(row.meta.regularMarketPrice);
    const marketTime=row.meta.regularMarketTime;
    const validMarketTime=marketTime!==undefined&&marketTime*1000<=now.getTime()+60_000?iso(marketTime):null;
    // change is over the actual requested chart observations, not a guessed daily change.
    const change=points.length>=2?changes(points[0]?.price,points[points.length-1]?.price):changes(undefined,undefined);
    return {market_id:candidate.market_id,base_asset_id:candidate.market_id,base_symbol:candidate.symbol,quote_symbol:'USD',
      latest_price:validMarketTime&&latest!==null?latest:points.at(-1)?.price??null,
      as_of:validMarketTime&&latest!==null?validMarketTime:points.at(-1)?.timestamp??null,
      points,...change,price_basis:'underlying_stock',source_url:url,observed_at:now.toISOString(),interval:selection.interval,
      underlying_identity:{symbol:row.meta.symbol,long_name:row.meta.longName,short_name:row.meta.shortName,instrument_type:row.meta.instrumentType,exchange:row.meta.exchangeName,exchange_name:row.meta.fullExchangeName,currency:row.meta.currency},
      metrics:{day_high:decimal(row.meta.regularMarketDayHigh),day_low:decimal(row.meta.regularMarketDayLow),day_volume:decimal(row.meta.regularMarketVolume),
        fifty_two_week_high:decimal(row.meta.fiftyTwoWeekHigh),fifty_two_week_low:decimal(row.meta.fiftyTwoWeekLow),
        previous_close:decimal(row.meta.previousClose),market_time:validMarketTime},candles:sampled};
  }catch{throw unavailable();}
}
