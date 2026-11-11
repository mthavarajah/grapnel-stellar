import {z} from 'zod';
import type {FastifyInstance} from 'fastify';
import {GrapnelError,MarginCollateralFundingQuoteInputSchema,MarginCollateralFundingInputSchema,MarginCollateralFundingQuoteSchema,NETWORK,PreparedActionSchema,XLM,toAtomic,type CustomerContext,type PreparedAction} from '@grapnel/contracts';
import {PERIDOT_COLLATERAL,PERIDOT_TESTNET_PINS} from '../../adapters/peridot/config.js';
import {requireBusiness,requireCustomer,success} from '../../lib/context.js';
import type {OperationService} from '../operations/service.js';
import type {DeltaVerification} from '../operations/worker.js';
import type {MarginPreparation} from '../margin/types.js';

export const MARGIN_COLLATERAL_SWAP='margin.collateral_swap';
export const MarginCollateralQuoteInputSchema=MarginCollateralFundingQuoteInputSchema;
export const MarginCollateralSwapInputSchema=MarginCollateralFundingInputSchema;
export const MarginCollateralQuoteSchema=MarginCollateralFundingQuoteSchema.extend({from_asset_id:z.literal(XLM.id),to_asset_id:z.literal(PERIDOT_COLLATERAL.id)}).strict();
export type MarginCollateralQuote=z.infer<typeof MarginCollateralQuoteSchema>;
export interface MarginCollateralFundingAdapter {
 quoteCollateral(input:{amount:string},customer:CustomerContext):Promise<MarginCollateralQuote>;
 prepareCollateralSwap(input:{operationId:string;amount:string;minimumOutputAtomic:string},customer:CustomerContext):Promise<MarginPreparation>;
 verifyCollateralSwap(input:{prepared:PreparedAction;baseline:Record<string,unknown>},signedXdr:string,customer:CustomerContext):Promise<void>;
 readFundingEvidence(input:{prepared:PreparedAction;baseline:Record<string,unknown>;txHash:string},customer:CustomerContext):Promise<DeltaVerification>;
}
export interface MarginFundingDependencies {operations:OperationService;adapter?:MarginCollateralFundingAdapter;ready?:()=>Promise<boolean>;}
const unavailable=():never=>{throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Verified Margin collateral funding is unavailable',false,{reason:'MARGIN_ROUND_TRIP_PROOF_REQUIRED'});};
const exactAmount=(value:string|undefined,expected:bigint)=>{try{return toAtomic(value??'',7)===expected;}catch{return false;}};
async function provider(deps:MarginFundingDependencies){if(!deps.adapter||!deps.ready||await deps.ready()!==true)return unavailable();return deps.adapter;}
function exactQuote(value:unknown,amount:string):MarginCollateralQuote{
 const quote=MarginCollateralQuoteSchema.parse(value),expected=BigInt(quote.expected_out_atomic),minimum=BigInt(quote.minimum_out_atomic),expiry=Date.parse(quote.expires_at),now=Date.now();
 if(BigInt(quote.amount_in_atomic)!==toAtomic(amount,7)||minimum<(expected*995n+999n)/1000n||minimum>expected||expiry<=now||expiry>now+120000)throw new GrapnelError(502,'INVALID_MARGIN_QUOTE','Collateral quote differs from the exact amount or approved limits');
 return quote;
}
/** Independent collateral acquisition; no workflow or borrowed position is created. */
export async function registerMarginFundingRoutes(app:FastifyInstance,deps:MarginFundingDependencies):Promise<void>{
 app.post('/v1/trade/margin/collateral/quote',async request=>{
  await requireBusiness(request,'trade.perps');const body=MarginCollateralQuoteInputSchema.parse(request.body),customer=await requireCustomer(request,body.customer_id,body.wallet_id),adapter=await provider(deps);
  return success(request,exactQuote(await adapter.quoteCollateral({amount:body.amount},customer),body.amount));
 });
 app.post('/v1/trade/margin/collateral/swap',async(request,reply)=>{
  await requireBusiness(request,'trade.perps');const body=MarginCollateralSwapInputSchema.parse(request.body),customer=await requireCustomer(request,body.customer_id,body.wallet_id),adapter=await provider(deps);
  const key=z.string().regex(/^[\x21-\x7e]{1,200}$/).safeParse(request.headers['idempotency-key']);if(!key.success)throw new GrapnelError(400,'IDEMPOTENCY_KEY_REQUIRED','Idempotency-Key must contain1–200 visible ASCII characters');
  const result=await deps.operations.createIdempotent({businessId:customer.businessId,customerId:customer.customerId,walletId:customer.walletId,module:'trade.perps',provider:'peridot',type:MARGIN_COLLATERAL_SWAP,route:'/v1/trade/margin/collateral/swap',idempotencyKey:key.data,request:{...body,wallet_id:customer.walletId}},async(client,operationId)=>{
   const quote=exactQuote(await adapter.quoteCollateral({amount:body.amount},customer),body.amount),minimum=BigInt(body.minimum_output_atomic);
   if(minimum<BigInt(quote.minimum_out_atomic)||minimum>BigInt(quote.expected_out_atomic))throw new GrapnelError(409,'QUOTE_EXPIRED','Get a fresh collateral quote before continuing');
   const result=await adapter.prepareCollateralSwap({operationId,amount:body.amount,minimumOutputAtomic:body.minimum_output_atomic},customer),prepared=PreparedActionSchema.parse(result.prepared),s=prepared.summary,expiry=Date.parse(prepared.authorization.expiresAt);
   let fee:bigint;try{fee=BigInt(s.maxFeeStroops??'');}catch{throw new GrapnelError(403,'PREPARED_ACTION_MISMATCH','A valid collateral fee ceiling is required');}
   if(prepared.operationId!==operationId||prepared.customerId!==customer.customerId||prepared.walletAddress!==customer.walletAddress||prepared.network!==NETWORK||s.action!==MARGIN_COLLATERAL_SWAP||s.fromAssetId!==XLM.id||s.toAssetId!==PERIDOT_COLLATERAL.id||s.contractId!==PERIDOT_TESTNET_PINS.aquarius_pool.address||s.recipient!==customer.walletAddress||!exactAmount(s.amount,toAtomic(body.amount,7))||!exactAmount(s.minReceive,minimum)||fee<=0n||fee>10000000n||expiry<=Date.now()||expiry>Date.now()+120000||Date.parse(s.expiresAt)!==expiry)throw new GrapnelError(403,'PREPARED_ACTION_MISMATCH','Prepared collateral swap differs from the exact approved customer intent');
   const total=toAtomic(body.amount,7)+fee;
   if(result.reservations.length!==1||result.reservations[0]!.assetId!==XLM.id||result.reservations[0]!.amountAtomic!==total)throw new GrapnelError(403,'MARGIN_RESERVATION_MISMATCH','Reserve only the exact native collateral input plus its fee');
   const reservation=result.reservations[0]!;await deps.operations.reserve(client,{...reservation,businessId:customer.businessId,customerId:customer.customerId,walletId:customer.walletId,operationId,expiresAt:new Date(expiry)});
   await client.query("UPDATE operations SET result_json=COALESCE(result_json,'{}'::jsonb)||$3::jsonb WHERE business_id=$1 AND id=$2",[customer.businessId,operationId,JSON.stringify({margin_collateral_swap_baseline:result.baseline})]);
   await deps.operations.setPrepared(client,customer.businessId,operationId,prepared);
  });
  return reply.code(202).send(success(request,result.operation));
 });
}
