import {describe,it,expect,vi} from 'vitest';
import {CryptoReferenceHistoryReader,type CryptoReferenceSymbol} from './crypto-history-reader.js';
import type {HistoryRange} from './service.js';
const NOW=Date.parse('2026-11-12T03:12:20Z');
const milliseconds:Record<string,number>={'1m':60000,'5m':300000,'1h':3600000,'4h':14400000,'1d':86400000,'1w':604800000};
const candle=(open:number,ms:number,price='1.000000000000000001')=>[open,'1','2','0.5',price,'10',open+ms-1,'10',1,'1','1','0'];
function setup(options:{symbol?:CryptoReferenceSymbol;body?:(url:URL,rows:unknown[][])=>unknown;status?:number;identity?:unknown;ticker?:unknown;resolve?:null}={}){
 let now=NOW;const symbol=options.symbol??'XLM';
 const fetcher=vi.fn(async(input:string|URL|Request)=>{const url=new URL(String(input));if(url.pathname.endsWith('exchangeInfo'))return new Response(JSON.stringify(options.identity??{symbols:[{symbol:`${symbol}USDC`,baseAsset:symbol,quoteAsset:'USDC',status:'TRADING'}]}));if(url.pathname.endsWith('/ticker/24hr'))return new Response(JSON.stringify(options.ticker??{symbol:`${symbol}USDC`,lastPrice:'1.000000000000000003',closeTime:now-50}));const ms=milliseconds[url.searchParams.get('interval')!]!,boundary=Math.floor(now/ms)*ms,rows=[candle(boundary-ms*2,ms),candle(boundary-ms,ms,'1.000000000000000002'),candle(boundary,ms,'1.01')];return new Response(JSON.stringify(options.body?options.body(url,rows):rows),{status:options.status??200});}) as unknown as typeof fetch;
 const resolveMarket=vi.fn(async()=>options.resolve===null?null:{asset_id:'stellar-testnet:exact-contract',reference_symbol:symbol});
 return {reader:new CryptoReferenceHistoryReader({resolveMarket,fetcher,now:()=>now}),fetcher,resolveMarket,advance:(ms:number)=>{now+=ms;}};
}
describe('Crypto underlying reference candles, never historical Testnet execution prices',()=>{
 it('preserves exact source decimal closes and actual close timestamps; drops the forming future close',async()=>{
  const {reader,fetcher}=setup(),result=await reader.history('registered-pool','live');
  expect(result).toMatchObject({market_id:'registered-pool',related_asset_id:'stellar-testnet:exact-contract',quote_symbol:'USDC',price_basis:'underlying_reference',reference_symbol:'XLM',interval:'1m',requested_range:'live',latest_price:'1.000000000000000003',change_absolute:'0.000000000000000002'});
  expect(result.points).toHaveLength(3);expect(result.points.some(p=>p.price==='1.01')).toBe(false);expect(result.points[1]!.timestamp).toBe('2026-11-12T03:11:59.999Z');
  expect(fetcher).toHaveBeenCalledTimes(3);expect(String(vi.mocked(fetcher).mock.calls[1]![0])).toContain('https://data-api.binance.vision/api/v3/klines?symbol=XLMUSDC');
 });
 it('requests different real intervals and time windows for every horizon',async()=>{
  const {reader,fetcher}=setup();for(const range of ['live','1d','1w','1m','1y','all'] as HistoryRange[])await reader.history('registered-pool',range);
  const urls=vi.mocked(fetcher).mock.calls.map(([input])=>new URL(String(input))).filter(url=>url.pathname.endsWith('klines'));
  expect(urls.map(url=>url.searchParams.get('interval'))).toEqual(['1m','5m','1h','4h','1d','1w']);
  expect(urls.map(url=>url.searchParams.get('startTime'))).toEqual([...([3600000,86400000,604800000,2592000000,31536000000].map(ms=>String(NOW-ms))),null]);
  expect(urls.every(url=>url.searchParams.get('limit')==='1000')).toBe(true);
 });
 it('does not invent a USDC/USDC exchange market or relabel USDT prices',async()=>{const {reader,fetcher}=setup({symbol:'USDC'});await expect(reader.history('usdc-exact','1d')).rejects.toMatchObject({details:{reason:'SELF_QUOTED_REFERENCE_UNSUPPORTED'}});expect(fetcher).not.toHaveBeenCalled();});
 it('does not resolve unknown assets by their symbol or fetch any source',async()=>{const {reader,fetcher}=setup({resolve:null});await expect(reader.history('unknown-contract','1d')).rejects.toMatchObject({details:{reason:'NO_EXPLICIT_REFERENCE_MAPPING'}});expect(fetcher).not.toHaveBeenCalled();});
 it.each([{symbols:[{symbol:'BTCUSDT',baseAsset:'BTC',quoteAsset:'USDC',status:'TRADING'}]},{symbols:[]},{symbols:[{symbol:'XLMUSDC',baseAsset:'XLM',quoteAsset:'USD',status:'TRADING'}]}])('rejects mismatched exact source pair %j',async identity=>{await expect(setup({identity}).reader.history('registered-pool','live')).rejects.toMatchObject({details:{reason:'SOURCE_SYMBOL_MISMATCH'}});});
 it.each(['future','stale','duplicate','unordered','invalid-price','invalid-close','empty','forming-only'] as const)('rejects %s history rather than filling a flat line',async mode=>{
  const {reader}=setup({body:(_url,rows)=>{if(mode==='empty')return [];if(mode==='forming-only')return [rows[2]];if(mode==='future'){rows[2]![0]=NOW+60000;rows[2]![6]=NOW+119999;}if(mode==='stale')return rows.slice(0,2).map(row=>{row[0]=Number(row[0])-86400000;row[6]=Number(row[6])-86400000;return row;});if(mode==='duplicate')rows[1]=rows[0]!;if(mode==='unordered')rows.reverse();if(mode==='invalid-price')rows[0]![4]=1.1;if(mode==='invalid-close')rows[0]![6]=NOW;return rows;}});
  await expect(reader.history('registered-pool','live')).rejects.toMatchObject({code:'CRYPTO_REFERENCE_UNAVAILABLE'});
 });
 it('coalesces simultaneous calls, caches bounded source windows, and isolates caller market identity',async()=>{
  const {reader,fetcher,advance}=setup();const [a,b]=await Promise.all([reader.history('a','live'),reader.history('b','live')]);expect(a.market_id).toBe('a');expect(b.market_id).toBe('b');expect(fetcher).toHaveBeenCalledTimes(3);
  a.points[0]!.price='99';expect((await reader.history('a','live')).points[0]!.price).not.toBe('99');expect(fetcher).toHaveBeenCalledTimes(3);
  advance(16000);await reader.history('a','live');expect(fetcher).toHaveBeenCalledTimes(5);
 });
 it('backs off source rate limits without returning stale prices or exposing provider data',async()=>{
  const {reader,fetcher}=setup({status:429,body:()=>({secret:'do not expose'})});await expect(reader.history('a','live')).rejects.toMatchObject({code:'PROVIDER_RATE_LIMITED',message:'Crypto reference source rate limit reached'});await expect(reader.history('a','live')).rejects.toMatchObject({code:'PROVIDER_RATE_LIMITED'});expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('normalizes source transport failures and does not fabricate history',async()=>{
  const reader=new CryptoReferenceHistoryReader({resolveMarket:async()=>({asset_id:'exact',reference_symbol:'BTC'}),fetcher:vi.fn(async()=>{throw Error('private upstream body');}),now:()=>NOW});await expect(reader.history('btc','1d')).rejects.toMatchObject({code:'CRYPTO_REFERENCE_UNAVAILABLE',details:{reason:'SOURCE_REQUEST_FAILED'}});
 });
});

it('accepts a genuinely shorter closed candle, including a historical delisting boundary',async()=>{
 const {reader}=setup({body:(_url,rows)=>{rows[0]![6]=Number(rows[0]![0])+30000-1;return rows;}});
 const h=await reader.history('registered-pool','all');expect(h.points).toHaveLength(3);expect(h.quote_symbol).toBe('USDC');
});

it.each([{symbol:'XLMUSDT',lastPrice:'1',closeTime:NOW},{symbol:'XLMUSDC',lastPrice:'1',closeTime:NOW-61000},{symbol:'XLMUSDC',lastPrice:'1',closeTime:NOW+6000},{symbol:'XLMUSDC',lastPrice:'0',closeTime:NOW}])('rejects an incorrect, stale or future current-price observation %j',async ticker=>{
 await expect(setup({ticker}).reader.history('registered-pool','live')).rejects.toMatchObject({details:{reason:'SOURCE_TICKER_INVALID'}});
});


it('uses the current continuous All listing without joining unobserved years or changing source values',async()=>{
 const {reader}=setup({body:(_url,rows)=>{
  const old=candle(Number(rows[0]![0])-200*604800000,604800000,'0.1');
  return [old,...rows];
 }});
 const h=await reader.history('registered-pool','all');
 expect(h.points).toHaveLength(3);expect(h.points.some(p=>p.price==='0.1')).toBe(false);
 expect(h.points[0]!.price).toBe('1.000000000000000001');
 expect(h.coverage).toMatchObject({kind:'continuous_source',first_generated_at:h.points[0]!.timestamp,omitted_observations:1});
 expect(h.change_absolute).toBe('0.000000000000000002');
});
it('retains intact All history without claiming filtered coverage',async()=>{
 const h=await setup().reader.history('registered-pool','all');expect(h.points).toHaveLength(3);expect(h.coverage).toBeUndefined();
});
