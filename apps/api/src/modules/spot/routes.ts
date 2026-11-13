import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { GrapnelError, OrderInputSchema, QuoteInputSchema, type CustomerContext, type ModuleId } from '@grapnel/contracts';
import type { SpotService } from './service.js';
export interface SpotRouteDependencies {
 service:SpotService;
 refreshReadiness?():Promise<void>;
 requireBusiness(request:FastifyRequest,module:ModuleId):Promise<{businessId:string}>;
 requireCustomer(request:FastifyRequest,customerId:string,walletId?:string):Promise<CustomerContext>;
 success(request:FastifyRequest,data:unknown):unknown;
 readPositions?(customer:CustomerContext):Promise<unknown>;
 readDiscoveryMarket?(id:string):Promise<unknown>;
 readDiscoveryMarkets?(category:'stocks'|'perps'):Promise<unknown[]>;
}
const key=(request:FastifyRequest)=>typeof request.headers['idempotency-key']==='string'?request.headers['idempotency-key']:'';
export async function registerSpotRoutes(app:FastifyInstance,deps:SpotRouteDependencies):Promise<void> {
 app.get('/v1/trade/markets',async request=>{
  const query=z.object({asset_class:z.enum(['crypto_spot','stocks','perps']).default('crypto_spot')}).parse(request.query);
  const module:ModuleId=query.asset_class==='crypto_spot'?'trade.spot':`trade.${query.asset_class}`;
  await deps.requireBusiness(request,module);
  if(query.asset_class==='crypto_spot')await deps.refreshReadiness?.();
  return deps.success(request,query.asset_class==='crypto_spot'?deps.service.adapter.markets():await deps.readDiscoveryMarkets?.(query.asset_class)??[]);
 });
 app.get<{Params:{id:string}}>('/v1/trade/markets/:id',async request=>{
  if(request.params.id==='zenex-testnet:perps:XLM'||/^gmx-testnet:perps:(?:ETH|BTC|CRV|XAU|XAG|XPT)$/.test(request.params.id)||/^hyperliquid-testnet:(?:perps|stocks):(?:0|[1-9]\d{0,8})$/.test(request.params.id)||/^robinhood-testnet:stocks:(?:TSLA|AMZN|PLTR|NFLX|AMD)$/.test(request.params.id)){
   await deps.requireBusiness(request,request.params.id.includes(':stocks:')?'trade.stocks':'trade.perps');
   if(!deps.readDiscoveryMarket)throw new GrapnelError(404,'NOT_FOUND','Market not found');
   return deps.success(request,await deps.readDiscoveryMarket(request.params.id));
  }
  await deps.requireBusiness(request,'trade.spot');
  await deps.refreshReadiness?.();
  const market=deps.service.adapter.markets().find(m=>m.market_id===request.params.id);
  if(!market)throw new GrapnelError(404,'NOT_FOUND','Spot market not found');
  return deps.success(request,market);
 });
 app.post('/v1/trade/quotes',async request=>{
  await deps.requireBusiness(request,'trade.spot');const body=QuoteInputSchema.parse(request.body);
  const customer=await deps.requireCustomer(request,body.customer_id);
  await deps.refreshReadiness?.();
  return deps.success(request,await deps.service.quote(body,customer,key(request)));
 });
 app.post('/v1/trade/orders',async(request,reply)=>{
  await deps.requireBusiness(request,'trade.spot');const body=OrderInputSchema.parse(request.body);
  const customer=await deps.requireCustomer(request,body.customer_id,body.wallet_id);
  await deps.refreshReadiness?.();
  const result=await deps.service.createOrder(body,customer,key(request));
  return reply.code(202).send(deps.success(request,result.operation));
 });
 app.get('/v1/trade/positions',async request=>{
  await deps.requireBusiness(request,'trade.spot');
  const query=z.object({customer_id:z.string().uuid()}).parse(request.query);
  const customer=await deps.requireCustomer(request,query.customer_id);
  if(!deps.readPositions)throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Verified wallet holdings reader is required',false,{reason:'SPOT_POSITIONS_READER_REQUIRED'});
  return deps.success(request,await deps.readPositions(customer));
 });
 app.get<{Params:{id:string}}>('/v1/trade/orders/:id',async request=>{
  const business=await deps.requireBusiness(request,'trade.spot');
  return deps.success(request,await deps.service.order(business.businessId,request.params.id));
 });
}
