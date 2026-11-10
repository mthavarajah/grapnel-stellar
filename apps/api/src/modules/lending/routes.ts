import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { GrapnelError, LendingInputSchema, XLM, toAtomic, type WalletBalance } from '@grapnel/contracts';
import { BlendAdapter } from '../../adapters/blend/index.js';
import { requireBusiness, requireCustomer, success } from '../../lib/context.js';
import { lock } from '../../db/index.js';
import type { OperationService } from '../operations/service.js';

export interface LendingRoutesDependencies {
 adapter:BlendAdapter;operations:OperationService;
 balanceReader:(address:string)=>Promise<WalletBalance[]>;
}
/** All write requests use the frozen core identity, durable idempotency and reservations. */
export async function registerLendingRoutes(app:FastifyInstance,deps:LendingRoutesDependencies):Promise<void> {
 app.get('/v1/capital/lending/markets',async request=>{
  await requireBusiness(request,'capital.lending');
  return success(request,await deps.adapter.markets());
 });
 app.get('/v1/capital/lending/positions',async request=>{
  await requireBusiness(request,'capital.lending');
  const {customer_id}=z.object({customer_id:z.string().uuid()}).parse(request.query);
  const customer=await requireCustomer(request,customer_id);
  return success(request,await deps.adapter.positions(customer));
 });
 for(const action of ['supply','withdraw','borrow','repay'] as const){
  app.post(`/v1/capital/lending/${action}`,async(request,reply)=>{
   await requireBusiness(request,'capital.lending');
   const body=LendingInputSchema.parse(request.body);
   const customer=await requireCustomer(request,body.customer_id,body.wallet_id);
   const idempotencyKey=request.headers['idempotency-key'];
   const result=await deps.operations.createIdempotent({businessId:customer.businessId,customerId:customer.customerId,walletId:customer.walletId,module:'capital.lending',type:`blend.${action}`,provider:'blend',route:`/v1/capital/lending/${action}`,idempotencyKey:typeof idempotencyKey==='string'?idempotencyKey:'',request:body},async(client,operationId)=>{
    // Serialize all actions on this pool/position. Unknown/pending transactions retain their hold.
    await lock(client,`lending:${customer.businessId}:${customer.walletId}:${body.market_id}`);
    const pending=await client.query("SELECT id FROM operations WHERE business_id=$1 AND wallet_id=$2 AND module_code='capital.lending' AND id<>$3 AND request_json->>'market_id'=$4 AND state NOT IN ('completed','failed','rejected','expired') LIMIT 1",[customer.businessId,customer.walletId,operationId,body.market_id]);
    if(pending.rowCount)throw new GrapnelError(409,'POSITION_BUSY','An earlier position operation awaits reconciliation');
    const prepared=await deps.adapter.prepare(action,{operationId,marketId:body.market_id,assetId:body.asset_id,amount:body.amount},customer);
    if(action==='supply'){
     if(body.asset_id!==XLM.id)throw new GrapnelError(422,'ASSET_MISMATCH','Only the verified native XLM reserve is supported for preparation');
     const balance=(await deps.balanceReader(customer.walletAddress)).find(balance=>balance.asset_id===XLM.id);
     if(!balance)throw new GrapnelError(409,'BALANCE_UNAVAILABLE','Confirmed native XLM balance is required');
     const available=/^0(?:\.0+)?$/.test(balance.spendable)?0n:toAtomic(balance.spendable,7);
     // Balance reader excludes native reserve and conservative fee; core subtracts active reservations.
     await deps.operations.reserve(client,{businessId:customer.businessId,customerId:customer.customerId,walletId:customer.walletId,operationId,assetId:XLM.id,amountAtomic:toAtomic(body.amount,7),spendableAtomic:available,observedAt:new Date(balance.as_of),expiresAt:new Date(prepared.authorization.expiresAt)});
    }
    await deps.operations.setPrepared(client,customer.businessId,operationId,prepared);
   });
   reply.code(202);return success(request,result.operation);
  });
 }
}
