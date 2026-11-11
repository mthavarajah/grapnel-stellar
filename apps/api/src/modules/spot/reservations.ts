import type {PoolClient} from 'pg';
import {z} from 'zod';
import {GrapnelError, XLM, toAtomic, type WalletBalance} from '@grapnel/contracts';
import {USDC_ISSUER} from '../../adapters/soroswap/inspector.js';
import type {ReservationInput} from '../operations/service.js';
import type {ReserveQuoteSpend} from './service.js';
export const SPOT_USDC_ID=`stellar-testnet:classic:USDC:${USDC_ISSUER}`;
const amount=z.string().regex(/^(0|[1-9]\d*)(\.\d{1,7})?$/);
export const SpotBaselineSchema=z.object({asset_in_id:z.literal(XLM.id),asset_out_id:z.literal(SPOT_USDC_ID),market_id:z.string().min(1),wallet_address:z.string().min(1),amount_in_atomic:z.string().regex(/^[1-9]\d*$/),min_out_atomic:z.string().regex(/^[1-9]\d*$/),wallet_in_amount:amount,wallet_out_amount:amount,as_of:z.string().datetime(),max_fee_stroops:z.string().regex(/^[1-9]\d*$/),signing_hash_hex:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type SpotBaseline=z.infer<typeof SpotBaselineSchema>;
const atomic=(v:string)=>/^0(?:\.0+)?$/.test(v)?0n:toAtomic(v,7);
/** Reservations and actual wallet baselines are atomic with the durable prepared order. */
export function createSpotReservation(operations:{reserve(client:PoolClient,input:ReservationInput):Promise<void>},read:(address:string)=>Promise<WalletBalance[]>):ReserveQuoteSpend {
 return async(client,operationId,quote,customer,prepared)=>{
  if(quote.asset_in_id!==XLM.id||quote.asset_out_id!==SPOT_USDC_ID||prepared.operationId!==operationId||prepared.customerId!==customer.customerId||prepared.walletAddress!==customer.walletAddress||prepared.summary.action!=='spot.swap'||prepared.summary.fromAssetId!==XLM.id||prepared.summary.toAssetId!==SPOT_USDC_ID||prepared.summary.amount!==quote.amount_in||prepared.summary.minReceive!==quote.min_receive)throw new GrapnelError(403,'INTENT_MISMATCH','Spot input/output and exact prepared intent differ');
  const fee=prepared.summary.maxFeeStroops;if(!fee||!/^\d+$/.test(fee)||BigInt(fee)<=0n||BigInt(fee)>10000000n)throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Reviewed spot fee is required');
  const balances=await read(customer.walletAddress),native=balances.find(b=>b.asset_id===XLM.id),usdc=balances.find(b=>b.asset_id===SPOT_USDC_ID);
  if(!native||!usdc)throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Current exact XLM and USDC trustline balances are required',false,{reason:'USDC_TRUSTLINE_REQUIRED'});
  const now=Date.now();for(const b of [native,usdc])if(b.source!=='stellar_horizon_testnet'||!Number.isFinite(Date.parse(b.as_of))||now-Date.parse(b.as_of)>15000||Date.parse(b.as_of)>now+1000)throw new GrapnelError(409,'BALANCE_STALE','Current independently observed Testnet balances are required');
  const baseline=SpotBaselineSchema.parse({asset_in_id:XLM.id,asset_out_id:SPOT_USDC_ID,market_id:quote.market_id,wallet_address:customer.walletAddress,amount_in_atomic:quote.amount_in_atomic,min_out_atomic:quote.min_out_atomic,wallet_in_amount:native.wallet_amount,wallet_out_amount:usdc.wallet_amount,as_of:native.as_of,max_fee_stroops:fee,signing_hash_hex:prepared.signingHashHex});
  await operations.reserve(client,{businessId:customer.businessId,customerId:customer.customerId,walletId:customer.walletId,operationId,assetId:XLM.id,amountAtomic:BigInt(quote.amount_in_atomic)+BigInt(fee),spendableAtomic:atomic(native.spendable),observedAt:new Date(native.as_of),expiresAt:new Date(prepared.authorization.expiresAt)});
  await client.query("UPDATE operations SET result_json=COALESCE(result_json,'{}'::jsonb)||$3::jsonb WHERE business_id=$1 AND id=$2",[customer.businessId,operationId,JSON.stringify({spot_swap_baseline:baseline})]);
 };
}
/** RPC success is a separate precondition. Both observed deltas must match the same signed swap. */
export function inspectSpotDeltas(input:{baseline:unknown;walletAddress:string;signingHash:string;balances:WalletBalance[];feeStroops:string;confirmedLedger:number}):{verified:boolean;result:Record<string,unknown>} {
 const no=(reason:string)=>({verified:false,result:{spot_swap_verification:{verified:false,reason}}});
 try{
  const b=SpotBaselineSchema.parse(input.baseline);if(b.wallet_address!==input.walletAddress||b.signing_hash_hex!==input.signingHash||!/^\d+$/.test(input.feeStroops)||BigInt(input.feeStroops)>BigInt(b.max_fee_stroops)||!Number.isSafeInteger(input.confirmedLedger)||input.confirmedLedger<=0)return no('SWAP_BASELINE_OR_FEE_MISMATCH');
  const native=input.balances.find(x=>x.asset_id===XLM.id),usdc=input.balances.find(x=>x.asset_id===SPOT_USDC_ID);if(!native||!usdc)return no('EXACT_SWAP_BALANCES_UNAVAILABLE');
  const now=Date.now();for(const after of [native,usdc])if(after.source!=='stellar_horizon_testnet'||!Number.isFinite(Date.parse(after.as_of))||Date.parse(after.as_of)<Date.parse(b.as_of)||now-Date.parse(after.as_of)>30000||Date.parse(after.as_of)>now+1000)return no('STALE_SWAP_OBSERVATION');
  const debit=atomic(b.wallet_in_amount)-atomic(native.wallet_amount),credit=atomic(usdc.wallet_amount)-atomic(b.wallet_out_amount);
  if(debit!==BigInt(b.amount_in_atomic)+BigInt(input.feeStroops)||credit<BigInt(b.min_out_atomic))return no('SWAP_BALANCE_DELTAS_NOT_CONFIRMED');
  return {verified:true,result:{spot_swap_verification:{verified:true,asset_in_id:XLM.id,asset_out_id:SPOT_USDC_ID,actual_in_atomic:b.amount_in_atomic,actual_out_atomic:credit.toString(),wallet_in_before:b.wallet_in_amount,wallet_in_after:native.wallet_amount,wallet_out_before:b.wallet_out_amount,wallet_out_after:usdc.wallet_amount,fee_stroops:input.feeStroops,confirmed_ledger:input.confirmedLedger,observed_at:new Date(now).toISOString()}}};
 }catch{return no('INVALID_SWAP_OBSERVATION');}
}
