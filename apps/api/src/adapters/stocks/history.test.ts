import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { projectStockCatalog } from './catalog.js';
import { readUnderlyingStockHistory } from './history.js';
import { StocksTestnetDiscovery } from './index.js';
import { Networks } from '@stellar/stellar-sdk';
const registry=JSON.parse(readFileSync(new URL('./evidence/sodax-registry.json',import.meta.url),'utf8'));
const candidate=projectStockCatalog(registry).find(row=>row.symbol==='AAPL')!;
const source=()=>JSON.parse(readFileSync(new URL('./research/yahoo-aapl-chart.json',import.meta.url),'utf8'));
const now=()=>new Date('2026-11-11T19:00:00.000Z');
const reply=(data:unknown):typeof fetch=>vi.fn(async()=>new Response(JSON.stringify(data))) as typeof fetch;
describe('underlying stock history, not token prices or execution',()=>{
 it('uses actual source OHLCV, explicit underlying basis and source timestamps',async()=>{
  const fetcher=reply(source());const r=await readUnderlyingStockHistory(candidate,'1m',{fetch:fetcher,now});
  expect(r).toMatchObject({market_id:candidate.market_id,base_asset_id:candidate.market_id,base_symbol:'AAPL',quote_symbol:'USD',price_basis:'underlying_stock',interval:'1d',latest_price:'355.155'});
  expect(r.points).toHaveLength(23);expect(r.candles[0]).toMatchObject({open:'338.2200012207031',volume:'25900600'});
  expect(r.metrics).toMatchObject({day_high:'355.33',day_low:'349.325',day_volume:'17345965',fifty_two_week_high:'355.38',fifty_two_week_low:'243.42',previous_close:null});
  expect(r.as_of).toBe(new Date(1794422564*1000).toISOString());
  expect(fetcher).toHaveBeenCalledWith('https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1mo&interval=1d',expect.objectContaining({method:'GET',redirect:'error'}));
  expect(r).not.toHaveProperty('executable');
 });
 it('keeps gaps and null metrics without inventing a price or change',async()=>{
  const f=source();const row=f.chart.result[0];row.timestamp=row.timestamp.slice(0,2);row.indicators.quote=[{close:[null,12]}];row.meta.regularMarketPrice=null;delete row.meta.regularMarketTime;delete row.meta.regularMarketDayHigh;
  const r=await readUnderlyingStockHistory(candidate,'1m',{fetch:reply(f),now});
  expect(r.points).toHaveLength(1);expect(r.latest_price).toBe('12');expect(r.change_absolute).toBeNull();expect(r.change_percent).toBeNull();expect(r.metrics.day_high).toBeNull();expect(r.candles[0]?.open).toBeNull();
 });
 it('rejects symbol/network source mismatch, malformed series, interval mismatch and provider refusal',async()=>{
  for(const mutate of [(r:any)=>r.meta.symbol='TSLA',(r:any)=>r.meta.currency='EUR',(r:any)=>r.meta.dataGranularity='1m',(r:any)=>r.timestamp.push(r.timestamp[0]),(r:any)=>r.timestamp.reverse()]){
   const f=source();mutate(f.chart.result[0]);await expect(readUnderlyingStockHistory(candidate,'1m',{fetch:reply(f),now})).rejects.toMatchObject({statusCode:503,code:'PROVIDER_UNAVAILABLE'});
  }
  const refuse=vi.fn(async()=>new Response('sensitive provider refusal',{status:403})) as typeof fetch;
  await expect(readUnderlyingStockHistory(candidate,'1m',{fetch:refuse,now})).rejects.toMatchObject({message:'Underlying stock reference data is unavailable'});expect(refuse).toHaveBeenCalledTimes(1);
 });
 it.each([['live','1d','1m'],['1d','1d','1m'],['1w','5d','15m'],['1m','1mo','1d'],['1y','1y','1d'],['all','max','3mo']] as const)('bounds %s to actual provider %s/%s',async(range,sourceRange,interval)=>{
  const f=source();f.chart.result[0].meta.dataGranularity=interval;const fetcher=reply(f);
  await readUnderlyingStockHistory(candidate,range,{fetch:fetcher,now});
  expect(fetcher).toHaveBeenCalledWith(expect.stringContaining(`?range=${sourceRange}&interval=${interval}`),expect.anything());
 });
 it('retains first and latest among at most1000 actual observations',async()=>{
  const f=source();const row=f.chart.result[0];const start=row.timestamp[0];row.timestamp=Array.from({length:1200},(_,i)=>start+i*60);row.indicators.quote=[{close:Array.from({length:1200},(_,i)=>10+i/10)}];
  const r=await readUnderlyingStockHistory(candidate,'1m',{fetch:reply(f),now});
  expect(r.points).toHaveLength(1000);expect(r.points[0]?.price).toBe('10');expect(r.points.at(-1)?.price).toBe('129.9');expect(r.change_absolute).toBe('119.9');expect(r.change_percent).toBe('1199');
 });
 it('sanitizes catalog source failures without advertising stale eligibility',async()=>{
  const adapter=new StocksTestnetDiscovery({network:'testnet',networkPassphrase:Networks.TESTNET},async()=>new Response('provider private response',{status:403}));
  await expect(adapter.catalog()).rejects.toMatchObject({statusCode:503,code:'PROVIDER_UNAVAILABLE',message:'Stock catalog is unavailable'});
 });
 it('resolves exact catalog ID, caches metadata/history and never accepts an arbitrary ticker',async()=>{
  const issuer=candidate.issuer;const tokens={stellar:registry.candidates.map((c:any)=>({symbol:c.symbol,name:c.name,address:c.contract_id,decimals:c.decimals,chainKey:'stellar',isRwa:true}))};
  const config={version:27,supportedChains:['stellar'],spokeChainConfig:{stellar:{horizonRpcUrl:'https://horizon.stellar.org',trustlineConfigs:registry.candidates.map((c:any)=>({assetCode:c.symbol,assetIssuer:issuer,contractId:c.contract_id}))}}};
  const fetcher=vi.fn(async(input:string|URL|Request)=>new Response(JSON.stringify(String(input).includes('/chart/')?source():String(input).endsWith('/config/all')?config:tokens))) as typeof fetch;
  const adapter=new StocksTestnetDiscovery({network:'testnet',networkPassphrase:Networks.TESTNET},fetcher);
  const rows=await adapter.catalog();await adapter.catalog();expect(fetcher).toHaveBeenCalledTimes(2);
  await expect(adapter.history('AAPL','1m')).rejects.toMatchObject({statusCode:404});expect(fetcher).toHaveBeenCalledTimes(2);
  const r=await adapter.history(candidate.market_id,'1m');r.points.length=0;
  expect((await adapter.history(candidate.market_id,'1m')).points.length).toBeGreaterThan(0);expect(fetcher).toHaveBeenCalledTimes(3);
  rows.length=0;expect((await adapter.catalog()).length).toBe(42);
 });
});
