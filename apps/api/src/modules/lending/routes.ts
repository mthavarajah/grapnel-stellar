import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { GrapnelError, LendingInputSchema, AmountSchema, XLM, toAtomic, type WalletBalance } from '@grapnel/contracts';
import { BlendAdapter } from '../../adapters/blend/index.js';
import { BLEND_USDC_ASSET_ID } from '../../adapters/blend/usdc-inspector.js';
import { requireBusiness, requireCustomer, success } from '../../lib/context.js';
import { lock } from '../../db/index.js';
import type { OperationService } from '../operations/service.js';
import {registerBorrowingRoutes} from './borrowing-routes.js';
import type {BorrowingAdapter} from './borrowing.js';

export interface LendingRoutesDependencies {
 adapter:BlendAdapter;operations:OperationService;borrowing?:BorrowingAdapter;
 balanceReader:(address:string)=>Promise<WalletBalance[]>;
}
export interface BlendReservation {assetId:string;amountAtomic:bigint;}
/** Keep Blend's XLM resource fee independent from a classic USDC supply amount. */
export function blendReservationPlan(action:'supply'|'withdraw',assetId:string,amount:string,feeStroops:string):BlendReservation[]{
 if(!/^\d{1,12}$/.test(feeStroops)||BigInt(feeStroops)<=0n)throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','A reviewed Soroban fee is required');
 let amountAtomic:bigint;try{amountAtomic=toAtomic(amount,7);}catch{throw new GrapnelError(422,'INVALID_AMOUNT','Blend amount must use exact seven-decimal precision');}
 if(amountAtomic<=0n)throw new GrapnelError(422,'INVALID_AMOUNT','Blend amount must be positive');const fee=BigInt(feeStroops);
 if(assetId===XLM.id)return[{assetId:XLM.id,amountAtomic:(action==='supply'?amountAtomic:0n)+fee}];
 if(assetId===BLEND_USDC_ASSET_ID)return[...(action==='supply'?[{assetId,amountAtomic}]:[]),{assetId:XLM.id,amountAtomic:fee}];
 throw new GrapnelError(422,'ASSET_MISMATCH','Only verified XLM and classic USDC Blend reserves are supported');
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
 await registerBorrowingRoutes(app,deps);
 for(const action of ['supply','withdraw'] as const){
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
    if(action==='supply'||action==='withdraw'){
     if(body.asset_id!==XLM.id&&body.asset_id!==BLEND_USDC_ASSET_ID)throw new GrapnelError(422,'ASSET_MISMATCH','Only verified XLM and classic USDC Blend reserves are supported');
     const fee=prepared.summary.maxFeeStroops;
     if(!fee || !/^\d+$/.test(fee) || BigInt(fee)<=0n)throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','A reviewed Soroban fee ceiling is required');
     const positions=await deps.adapter.positions(customer);
     const position=positions.find(position=>position.market_id===body.market_id && position.asset_id===body.asset_id && position.pool_contract_id===prepared.summary.contractId);
     if(!position || !Number.isSafeInteger(position.as_of_ledger) || position.as_of_ledger<=0 || !Number.isFinite(Date.parse(position.as_of)) || Date.now()-Date.parse(position.as_of)>30000 || Date.parse(position.as_of)>Date.now()+1000)throw new GrapnelError(409,'POSITION_BASELINE_UNAVAILABLE','A fresh verified Blend collateral baseline is required');
     AmountSchema.parse(position.collateral);
     const balances=await deps.balanceReader(customer.walletAddress),reservationPlan=blendReservationPlan(action,body.asset_id,body.amount,fee);
     for(const reservation of reservationPlan){const balance=balances.find(x=>x.asset_id===reservation.assetId);if(!balance)throw new GrapnelError(409,'BALANCE_UNAVAILABLE',`Confirmed ${reservation.assetId===XLM.id?'XLM':'USDC'} balance is required`);const available=/^0(?:\.0+)?$/.test(balance.spendable)?0n:toAtomic(balance.spendable,7);await deps.operations.reserve(client,{businessId:customer.businessId,customerId:customer.customerId,walletId:customer.walletId,operationId,assetId:reservation.assetId,amountAtomic:reservation.amountAtomic,spendableAtomic:available,observedAt:new Date(balance.as_of),expiresAt:new Date(prepared.authorization.expiresAt)});}
     const balance=balances.find(x=>x.asset_id===body.asset_id)!;
     await client.query("UPDATE operations SET result_json=COALESCE(result_json,'{}'::jsonb)||$3::jsonb WHERE business_id=$1 AND id=$2",[customer.businessId,operationId,JSON.stringify({[action==='withdraw'?'blend_withdraw_baseline':'blend_supply_baseline']:{asset_id:body.asset_id,market_id:body.market_id,pool_contract_id:position.pool_contract_id,reserve_contract_id:position.reserve_contract_id,wallet_address:customer.walletAddress,wallet_amount:balance.wallet_amount,collateral:position.collateral,as_of:balance.as_of,position_as_of:position.as_of,position_ledger:position.as_of_ledger}})]);
    }
    await deps.operations.setPrepared(client,customer.businessId,operationId,prepared);
   });
   reply.code(202);return success(request,result.operation);
  });
 }
}
