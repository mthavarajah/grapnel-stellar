import {z} from 'zod';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {GrapnelError,LendingInputSchema,NETWORK,toAtomic,type CustomerContext,type PreparedAction,type WalletBalance} from '@grapnel/contracts';
import type {OperationService} from '../operations/service.js';
import {requireBusiness,requireCustomer,success} from '../../lib/context.js';
import {lock} from '../../db/index.js';
import {BORROW_POOL_ID,borrowingReservationPlan,createBorrowBaseline,type BorrowingAction,type BorrowingAdapter} from './borrowing.js';

export interface BorrowingRoutesDependencies {borrowing?:BorrowingAdapter;operations:OperationService;balanceReader:(address:string)=>Promise<WalletBalance[]>;}
function required(deps:BorrowingRoutesDependencies):BorrowingAdapter{
 if(!deps.borrowing)throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','The verified borrowing adapter is unavailable',false,{reason:'BORROWING_INSPECTOR_REQUIRED'});
 return deps.borrowing;
}
const sameAmount=(left:string|undefined,right:string)=>{try{return !!left&&toAtomic(left,7)===toAtomic(right,7);}catch{return false;}};
const actionSummary=(action:BorrowingAction)=>action==='collateral_supply'?'blend.borrow_collateral_supply':action==='collateral_withdraw'?'blend.borrow_collateral_withdraw':`blend.${action}`;
function exactPrepared(prepared:PreparedAction,action:BorrowingAction,customer:CustomerContext,operationId:string,request:z.infer<typeof LendingInputSchema>):void{
 const summary=prepared.summary,expiry=Date.parse(prepared.authorization.expiresAt);
 if(prepared.network!==NETWORK||prepared.operationId!==operationId||prepared.customerId!==customer.customerId||prepared.walletAddress!==customer.walletAddress||summary.action!==actionSummary(action)
  ||summary.contractId!==BORROW_POOL_ID||summary.recipient!==customer.walletAddress||summary.fromAssetId!==request.asset_id||!sameAmount(summary.amount,request.amount)
  ||!Number.isFinite(expiry)||expiry<=Date.now()||expiry>Date.now()+120000||Date.parse(summary.expiresAt)!==expiry)
  throw new GrapnelError(403,'PREPARED_ACTION_MISMATCH','Borrowing action differs from the exact requested pool, customer, asset or amount');
}
export async function registerBorrowingRoutes(app:FastifyInstance,deps:BorrowingRoutesDependencies):Promise<void>{
 app.get('/v1/capital/lending/borrowing',async request=>{
  await requireBusiness(request,'capital.lending');
  const query=z.object({customer_id:z.string().uuid(),wallet_id:z.string().uuid().optional()}).strict().parse(request.query);
  const customer=await requireCustomer(request,query.customer_id,query.wallet_id);
  return success(request,await required(deps).read(customer));
 });
 const actions:[BorrowingAction,string][]=[['borrow','/v1/capital/lending/borrow'],['repay','/v1/capital/lending/repay'],['collateral_supply','/v1/capital/lending/borrowing/collateral/supply'],['collateral_withdraw','/v1/capital/lending/borrowing/collateral/withdraw']];
 for(const [action,path] of actions)app.post(path,async(request,reply)=>{
  await requireBusiness(request,'capital.lending');
  const body=LendingInputSchema.parse(request.body),customer=await requireCustomer(request,body.customer_id,body.wallet_id),adapter=required(deps);
  const idempotencyKey=typeof request.headers['idempotency-key']==='string'?request.headers['idempotency-key']:'';
  const result=await deps.operations.createIdempotent({businessId:customer.businessId,customerId:customer.customerId,walletId:customer.walletId,module:'capital.lending',type:actionSummary(action),provider:'blend',route:path,idempotencyKey,request:body},async(client,operationId)=>{
   await lock(client,`borrowing:${customer.businessId}:${customer.walletId}:${BORROW_POOL_ID}`);
   const pending=await client.query("SELECT id FROM operations WHERE business_id=$1 AND wallet_id=$2 AND module_code='capital.lending' AND id<>$3 AND state NOT IN ('completed','failed','rejected','expired') LIMIT 1",[customer.businessId,customer.walletId,operationId]);
   if(pending.rowCount)throw new GrapnelError(409,'POSITION_BUSY','An earlier lending operation awaits reconciliation');
   const input={operationId,marketId:body.market_id,assetId:body.asset_id,amount:body.amount};
   let prepared:PreparedAction;
   if(action==='borrow'||action==='repay')prepared=await adapter.prepare(action,input,customer);
   else {
    if(!adapter.prepareCollateral)throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Verified collateral setup is unavailable');
    prepared=await adapter.prepareCollateral(action==='collateral_supply'?'supply':'withdraw',input,customer);
   }
   exactPrepared(prepared,action,customer,operationId,body);
   const fee=prepared.summary.maxFeeStroops;
   const plan=borrowingReservationPlan(action,body.asset_id,body.amount,fee??'');
   const positions=await adapter.positions(customer),matches=positions.filter(p=>p.market_id===body.market_id&&p.asset_id===body.asset_id&&p.pool_contract_id===BORROW_POOL_ID);
   if(matches.length!==1)throw new GrapnelError(409,'POSITION_BASELINE_UNAVAILABLE','A unique verified borrowing position baseline is required');
   const balances=await deps.balanceReader(customer.walletAddress),baseline=createBorrowBaseline(matches[0]!,balances,customer.walletAddress);
   if(action==='repay'&&toAtomic(body.amount,7)>(/^0(?:\.0+)?$/.test(baseline.borrowed)?0n:toAtomic(baseline.borrowed,7)))baseline.repay_all=true;
   for(const item of plan){
    const matches=balances.filter(balance=>balance.asset_id===item.assetId&&balance.source==='stellar_horizon_testnet');
    if(matches.length!==1)throw new GrapnelError(409,'BALANCE_UNAVAILABLE','A unique confirmed fee and principal balance is required');
    const balance=matches[0]!,available=/^0(?:\.0+)?$/.test(balance.spendable)?0n:toAtomic(balance.spendable,7);
    await deps.operations.reserve(client,{businessId:customer.businessId,customerId:customer.customerId,walletId:customer.walletId,operationId,assetId:item.assetId,amountAtomic:item.amountAtomic,spendableAtomic:available,observedAt:new Date(balance.as_of),expiresAt:new Date(prepared.authorization.expiresAt)});
   }
   await client.query("UPDATE operations SET result_json=COALESCE(result_json,'{}'::jsonb)||$3::jsonb WHERE business_id=$1 AND id=$2",[customer.businessId,operationId,JSON.stringify({blend_borrowing_baseline:baseline})]);
   await deps.operations.setPrepared(client,customer.businessId,operationId,prepared);
  });
  reply.code(202);return success(request,result.operation);
 });
}
