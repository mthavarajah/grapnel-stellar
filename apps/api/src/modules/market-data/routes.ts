import {z} from 'zod';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {GrapnelError,type ModuleId} from '@grapnel/contracts';

const rangeSchema=z.enum(['live','1d','1w','1m','1y','all']);
export type MarketHistoryRange=z.infer<typeof rangeSchema>;
export interface MarketHistoryRouteDependencies {
 requireBusiness(request:FastifyRequest,module:ModuleId):Promise<unknown>;
 success(request:FastifyRequest,data:unknown):unknown;
 spot(id:string,range:MarketHistoryRange):Promise<unknown>;
 perps(id:string,range:MarketHistoryRange):Promise<unknown>;
 stocks(id:string,range:MarketHistoryRange):Promise<unknown>;
}
/** Public price reads remain tenant-entitled, including mainnet catalog metadata.
 * This dispatch has no transaction or execution adapter dependency. */
export async function registerMarketHistoryRoutes(app:FastifyInstance,deps:MarketHistoryRouteDependencies):Promise<void>{
 app.get('/v1/trade/markets/:id/history',async request=>{
  const {id}=z.object({id:z.string().min(1).max(200)}).parse(request.params);
  const category=/^robinhood-testnet:stocks:(?:TSLA|AMZN|PLTR|NFLX|AMD)$/.test(id)?'stocks'
   :/^hyperliquid-testnet:stocks:(?:0|[1-9]\d{0,8})$/.test(id)?'stocks'
   :/^hyperliquid-testnet:perps:(?:0|[1-9]\d{0,8})$/.test(id)?'perps'
   :/^sodax:catalog:(?:mainnet|testnet):C[A-Z2-7]{55}$/.test(id)?'stocks'
   :id.startsWith('stellar-testnet:soroswap:')?'spot':null;
  if(!category)throw new GrapnelError(404,'NOT_FOUND','Market not found');
  await deps.requireBusiness(request,`trade.${category}`);
  const {range}=z.object({range:rangeSchema.default('live')}).strict().parse(request.query);
  return deps.success(request,await deps[category](id,range));
 });
}
