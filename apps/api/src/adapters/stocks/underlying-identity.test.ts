import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { matchesUnderlyingIdentity, reviewedUnderlyingIdentity } from './underlying-identity.js';
import { projectStockCatalog } from './catalog.js';
import { readUnderlyingStockHistory } from './history.js';
const probes=JSON.parse(readFileSync(new URL('./evidence/underlying-identity-probes.json',import.meta.url),'utf8'));
const registry=JSON.parse(readFileSync(new URL('./evidence/sodax-registry.json',import.meta.url),'utf8'));
describe('reviewed stock company identity — actual first-party metadata fixtures',()=>{
 it('requires reviewed full identity for every actual provider catalog entry',()=>{
  expect(probes).toHaveLength(42);
  const rows=projectStockCatalog(registry);expect(rows).toHaveLength(42);
  for(const probe of probes){expect(probe.http_status).toBe(200);expect(matchesUnderlyingIdentity(probe.provider_symbol,probe.provider_name,probe.meta)).toBe(true);}
  expect(rows.every(row=>row.price_supported&&row.history_available&&row.underlying_identity_status==='reviewed')).toBe(true);
 });
 it('rejects ticker reuse for the former SPCX ETF rather than returning another company price',()=>{
  const probe=probes.find((r:any)=>r.provider_symbol==='SPCX');
  expect(probe.meta).toMatchObject({longName:'Space Exploration Technologies Corp.',instrumentType:'EQUITY',exchangeName:'NMS'});
  expect(matchesUnderlyingIdentity('SPCX','SpaceX Class A',{...probe.meta,longName:'The SPAC and New Issue ETF',shortName:'The SPAC and New Issue ETF',instrumentType:'ETF'})).toBe(false);
 });
 it('binds SKHY to actual Nasdaq SK hynix equity metadata, never a guessed Korean ticker or currency',()=>{
  const probe=probes.find((r:any)=>r.provider_symbol==='SKHY');
  expect(matchesUnderlyingIdentity('SKHY',probe.provider_name,{...probe.meta,symbol:'000660.KS',currency:'KRW'})).toBe(false);
  expect(matchesUnderlyingIdentity('SKHY',probe.provider_name,{...probe.meta,longName:'Unrelated Holdings'})).toBe(false);
 });
 it('rejects another name, asset class, exchange, missing long name or truncated-name-only matches',()=>{
  const p=probes.find((r:any)=>r.provider_symbol==='AAPL');
  for(const overrides of [{longName:'Apple Hospitality REIT, Inc.'},{instrumentType:'ETF'},{exchangeName:'NYQ'},{fullExchangeName:'NYSE'},{longName:undefined},{shortName:'Another Company'}])
   expect(matchesUnderlyingIdentity('AAPL','Apple',{...p.meta,...overrides})).toBe(false);
 });
 it('does not allow callers to alter the reviewed mapping or guess unsupported symbols',()=>{
  expect(reviewedUnderlyingIdentity('UNKNOWN','Unknown Company')).toBeUndefined();
  const a=reviewedUnderlyingIdentity('AAPL','Apple')!;a.longNames=['Wrong Name'];
  expect(reviewedUnderlyingIdentity('AAPL','Apple')?.longNames).toEqual(['Apple Inc.']);
 });
 it('rejects an unreviewed provider identity before any quote-source fetch',async()=>{
  const candidate={...projectStockCatalog(registry)[0]!,name:'Unknown product'};
  const fetcher=vi.fn();await expect(readUnderlyingStockHistory(candidate,'1d',{fetch:fetcher})).rejects.toMatchObject({statusCode:503,details:{reason:'UNDERLYING_IDENTITY_UNVERIFIED'}});expect(fetcher).not.toHaveBeenCalled();
 });
 it('enforces exact identity again on each actual history response',async()=>{
  const chart=JSON.parse(readFileSync(new URL('./research/yahoo-aapl-chart.json',import.meta.url),'utf8'));
  const candidate=projectStockCatalog(registry).find(row=>row.symbol==='AAPL')!;
  chart.chart.result[0].meta.longName='Another Corporation';
  const fetcher=vi.fn(async()=>new Response(JSON.stringify(chart))) as typeof fetch;
  await expect(readUnderlyingStockHistory(candidate,'1m',{fetch:fetcher})).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
 });
});
