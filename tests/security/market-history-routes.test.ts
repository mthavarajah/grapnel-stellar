import {createRequire} from 'node:module';
import {afterEach,describe,expect,it,vi} from 'vitest';
import type {buildApp} from '../../apps/api/src/app.js';
type FastifyInstance=Awaited<ReturnType<typeof buildApp>>;
import {registerMarketHistoryRoutes,type MarketHistoryRouteDependencies} from '../../apps/api/src/modules/market-data/routes.js';
import {GrapnelError,type ModuleId} from '../../packages/contracts/src/index.js';
const require=createRequire(new URL('../../apps/api/package.json',import.meta.url));
const Fastify=require('fastify') as ()=>FastifyInstance;
const bearer={authorization:'Bearer isolated-history-fixture'};
const ids={spot:'stellar-testnet:soroswap:XLM:USDC',perps:'hyperliquid-testnet:perps:0',stocks:'sodax:catalog:mainnet:CAZSFDNSSR2RKJ2LIIB2Y4G4WOSYYKC4646EUJ63PQLDDHOVQYZ4HDTK'};
const apps:FastifyInstance[]=[];
async function fixture(){
 const app=Fastify();apps.push(app);
 app.setErrorHandler((error,_request,reply)=>{const e=error as Error&{statusCode?:number;code?:string};return reply.code(e.statusCode??(e.name==='ZodError'?422:500)).send({error:{code:e.code??'VALIDATION_ERROR'}});});
 const enabled=new Set<ModuleId>(['trade.spot','trade.perps','trade.stocks']);
 const requireBusiness=vi.fn<MarketHistoryRouteDependencies['requireBusiness']>(async(request,module)=>{
  if(request.headers.authorization!==bearer.authorization)throw new GrapnelError(401,'INVALID_API_KEY','Fixture key denied');
  if(!enabled.has(module))throw new GrapnelError(403,'MODULE_NOT_ENABLED','Fixture module denied');
  return {businessId:'isolated-tenant'};
 });
 const spot=vi.fn<MarketHistoryRouteDependencies['spot']>(async(id,range)=>({market_id:id,range,source:'spot-fixture'}));
 const perps=vi.fn<MarketHistoryRouteDependencies['perps']>(async(id,range)=>({market_id:id,range,source:'perps-fixture'}));
 const stocks=vi.fn<MarketHistoryRouteDependencies['stocks']>(async(id,range)=>({market_id:id,range,source:'stocks-fixture'}));
 await registerMarketHistoryRoutes(app,{requireBusiness,success:(_request,data)=>({data}),spot,perps,stocks});await app.ready();
 return {app,enabled,requireBusiness,spot,perps,stocks};
}
afterEach(async()=>{await Promise.all(apps.splice(0).map(app=>app.close()));});
// These are isolated HTTP dispatch/ordering tests. They make no external HTTP calls,
// persist no prices and cannot produce transactions or execution evidence.
describe('market history is read-only and enforces the selected market module',()=>{
 it.each(['spot','perps','stocks'] as const)('dispatches exact URL-decoded %s ID and timeframe to only its reader',async category=>{
  const h=await fixture(),id=ids[category];const response=await h.app.inject({url:`/v1/trade/markets/${encodeURIComponent(id)}/history?range=1w`,headers:bearer});
  expect(response.statusCode).toBe(200);expect(response.json().data).toEqual({market_id:id,range:'1w',source:category+'-fixture'});
  expect(h.requireBusiness).toHaveBeenCalledExactlyOnceWith(expect.anything(),'trade.'+category);expect(h[category]).toHaveBeenCalledExactlyOnceWith(id,'1w');
  for(const other of ['spot','perps','stocks'] as const)if(other!==category)expect(h[other]).not.toHaveBeenCalled();
 });
 it.each(['spot','perps','stocks'] as const)('denies unauthenticated %s history before provider reads',async category=>{
  const h=await fixture();const response=await h.app.inject({url:`/v1/trade/markets/${encodeURIComponent(ids[category])}/history?range=1d`});
  expect(response.statusCode).toBe(401);expect(h.spot).not.toHaveBeenCalled();expect(h.perps).not.toHaveBeenCalled();expect(h.stocks).not.toHaveBeenCalled();
 });
 it.each(['perps','stocks'] as const)('does not use Spot entitlement as authority for disabled %s history',async category=>{
  const h=await fixture();h.enabled.delete(('trade.'+category) as ModuleId);
  const response=await h.app.inject({url:`/v1/trade/markets/${encodeURIComponent(ids[category])}/history`,headers:bearer});expect(response.statusCode).toBe(403);expect(h[category]).not.toHaveBeenCalled();expect(h.spot).not.toHaveBeenCalled();
 });
 it.each(['live','1d','1w','1m','1y','all'])('preserves each permitted stock reference timeframe %s without implying a Testnet trade',async range=>{
  const h=await fixture();h.enabled.delete('trade.spot');h.enabled.delete('trade.perps');
  const response=await h.app.inject({url:`/v1/trade/markets/${encodeURIComponent(ids.stocks)}/history?range=${range}`,headers:bearer});expect(response.statusCode).toBe(200);expect(h.stocks).toHaveBeenCalledExactlyOnceWith(ids.stocks,range);expect(response.json().data.executable).toBeUndefined();
 });
 it('defaults to live and propagates a provider error without inventing empty history',async()=>{
  const h=await fixture();h.perps.mockRejectedValueOnce(new GrapnelError(503,'HISTORY_UNAVAILABLE','Fixture provider failure',true));
  const response=await h.app.inject({url:`/v1/trade/markets/${encodeURIComponent(ids.perps)}/history`,headers:bearer});expect(h.perps).toHaveBeenCalledExactlyOnceWith(ids.perps,'live');expect(response.statusCode).toBe(503);expect(response.json().data).toBeUndefined();
 });
 it.each(['1h','year','', '1d&extra=ignored'])('rejects unsupported or extra query input %j before reading prices',async range=>{
  const h=await fixture();const response=await h.app.inject({url:`/v1/trade/markets/${encodeURIComponent(ids.perps)}/history?range=${range}`,headers:bearer});expect(response.statusCode).toBe(422);expect(h.perps).not.toHaveBeenCalled();
 });
 it.each(['unknown:BTC','sodax:catalog:mainnet:not-a-contract','stellar-mainnet:noether:BTC-PERP','stellar-testnet:noether:../BTC-PERP','stellar-testnet:noether:BTC-PERP'])('rejects an unrecognized market identity %s',async id=>{
  const h=await fixture();const response=await h.app.inject({url:`/v1/trade/markets/${encodeURIComponent(id)}/history`,headers:bearer});expect(response.statusCode).toBe(404);expect(h.requireBusiness).not.toHaveBeenCalled();expect(h.spot).not.toHaveBeenCalled();expect(h.perps).not.toHaveBeenCalled();expect(h.stocks).not.toHaveBeenCalled();
 });
});
