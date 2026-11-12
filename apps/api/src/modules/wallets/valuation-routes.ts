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
  const balances=await deps.balances(customer),prices=new Map<string,Promise<WalletUsdPrice|null>>();
  const priceFor=(id:string)=>{let value=prices.get(id);if(!value){value=deps.priceFor(id);prices.set(id,value);}return value;};
  const valuation=await valueWalletBalances(balances,priceFor);
  const assets=[];
  for(const balance of balances){const value=await valueWalletBalances([balance],priceFor);assets.push({asset_id:balance.asset_id,wallet_amount:balance.wallet_amount,value_usd:value.total_usd});}
  return deps.success(request,{wallet_id:customer.walletId,...valuation,assets});
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
