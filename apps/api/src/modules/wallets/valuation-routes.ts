import {z} from 'zod';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {CustomerContext,ModuleId,WalletBalance} from '@grapnel/contracts';
import {valueWalletBalances,type WalletUsdPrice} from './valuation.js';
export interface WalletValuationRouteDependencies {
 requireBusiness(request:FastifyRequest,module:ModuleId):Promise<unknown>;
 requireCustomer(request:FastifyRequest,customerId:string,walletId?:string):Promise<CustomerContext>;
 success(request:FastifyRequest,data:unknown):unknown;
 balances(customer:CustomerContext):Promise<WalletBalance[]>;
 priceFor(assetId:string):Promise<WalletUsdPrice|null>;
}
export async function registerWalletValuationRoutes(app:FastifyInstance,deps:WalletValuationRouteDependencies):Promise<void>{
 app.get('/v1/capital/wallets/:id/valuation',async request=>{
  await deps.requireBusiness(request,'capital.wallets');
  const {id}=z.object({id:z.string().uuid()}).parse(request.params);
  const {customer_id}=z.object({customer_id:z.string().uuid()}).strict().parse(request.query);
  const customer=await deps.requireCustomer(request,customer_id,id);
  const valuation=await valueWalletBalances(await deps.balances(customer),assetId=>deps.priceFor(assetId));
  return deps.success(request,{wallet_id:customer.walletId,...valuation});
 });
}

import type {AccountValuation} from './account-valuation.js';
export interface AccountValuationRouteDependencies {
 requireBusiness(request:FastifyRequest,module:ModuleId):Promise<unknown>;
 requireCustomer(request:FastifyRequest,customerId:string,walletId?:string):Promise<CustomerContext>;
 success(request:FastifyRequest,data:unknown):unknown;
 readAccount(customer:CustomerContext):Promise<AccountValuation>;
}
export async function registerAccountValuationRoutes(app:FastifyInstance,deps:AccountValuationRouteDependencies):Promise<void>{
 app.get('/v1/portfolio/valuation',async request=>{
  await deps.requireBusiness(request,'capital.wallets');
  const {customer_id,wallet_id}=z.object({customer_id:z.string().uuid(),wallet_id:z.string().uuid()}).strict().parse(request.query);
  const customer=await deps.requireCustomer(request,customer_id,wallet_id);
  return deps.success(request,{wallet_id:customer.walletId,...await deps.readAccount(customer)});
 });
}
