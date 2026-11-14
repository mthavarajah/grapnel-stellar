import {STANDALONE_SPOT_ASSETS,isApprovedStandaloneAssetId,standaloneAssetId,isApprovedSpotDirection} from '../../adapters/soroswap/direct-assets.js';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {GrapnelError, XLM, toAtomic, type WalletBalance} from '@grapnel/contracts';
import {USDC_ISSUER} from '../../adapters/soroswap/inspector.js';
import type {ReservationInput} from '../operations/service.js';
import type {ReserveQuoteSpend} from './service.js';
export const SPOT_USDC_ID=`stellar-testnet:classic:USDC:${USDC_ISSUER}`;
const allowedAssets=[XLM.id,SPOT_USDC_ID,...STANDALONE_SPOT_ASSETS.map(r=>standaloneAssetId(r.contract))] as [string,...string[]];
const nonNative=(id:string)=>id===SPOT_USDC_ID||isApprovedStandaloneAssetId(id);
const validSource=(b:WalletBalance)=>b.source===(isApprovedStandaloneAssetId(b.asset_id)?'stellar_rpc_testnet':'stellar_horizon_testnet');
const amount=z.string().regex(/^(0|[1-9]\d*)(\.\d{1,7})?$/);
export const SpotBaselineSchema=z.object({asset_in_id:z.enum(allowedAssets),asset_out_id:z.enum(allowedAssets),market_id:z.string().min(1),wallet_address:z.string().min(1),amount_in_atomic:z.string().regex(/^[1-9]\d*$/),min_out_atomic:z.string().regex(/^[1-9]\d*$/),wallet_in_amount:amount,wallet_out_amount:amount,as_of:z.string().datetime(),max_fee_stroops:z.string().regex(/^[1-9]\d*$/),signing_hash_hex:z.string().regex(/^[a-f0-9]{64}$/)}).strict().refine(value=>isApprovedSpotDirection(value.asset_in_id,value.asset_out_id));
export type SpotBaseline=z.infer<typeof SpotBaselineSchema>;
const atomic=(v:string)=>/^0(?:\.0+)?$/.test(v)?0n:toAtomic(v,7);
/** Reservations and actual wallet baselines are atomic with the durable prepared order. */
export function createSpotReservation(operations:{reserve(client:PoolClient,input:ReservationInput):Promise<void>},read:(address:string)=>Promise<WalletBalance[]>):ReserveQuoteSpend {
 return async(client,operationId,quote,customer,prepared)=>{
  if(!isApprovedSpotDirection(quote.asset_in_id,quote.asset_out_id)||prepared.operationId!==operationId||prepared.customerId!==customer.customerId||prepared.walletAddress!==customer.walletAddress||prepared.summary.action!=='spot.swap'||prepared.summary.fromAssetId!==quote.asset_in_id||prepared.summary.toAssetId!==quote.asset_out_id||prepared.summary.amount!==quote.amount_in||prepared.summary.minReceive!==quote.min_receive)throw new GrapnelError(403,'INTENT_MISMATCH','Spot input/output and exact prepared intent differ');
  const fee=prepared.summary.maxFeeStroops;if(!fee||!/^\d+$/.test(fee)||BigInt(fee)<=0n||BigInt(fee)>10000000n)throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Reviewed spot fee is required');
  const balances=await read(customer.walletAddress),native=balances.find(b=>b.asset_id===XLM.id),incoming=balances.find(b=>b.asset_id===quote.asset_in_id),outgoing=balances.find(b=>b.asset_id===quote.asset_out_id);
  if(!native||!incoming||!outgoing)throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Current exact swap and network-fee balances are required',false,{reason:'EXACT_SWAP_BALANCES_REQUIRED'});
  const now=Date.now();for(const b of [native,incoming,outgoing])if(!validSource(b)||!Number.isFinite(Date.parse(b.as_of))||now-Date.parse(b.as_of)>15000||Date.parse(b.as_of)>now+1000)throw new GrapnelError(409,'BALANCE_STALE','Current independently observed Testnet balances are required');
  const baseline=SpotBaselineSchema.parse({asset_in_id:quote.asset_in_id,asset_out_id:quote.asset_out_id,market_id:quote.market_id,wallet_address:customer.walletAddress,amount_in_atomic:quote.amount_in_atomic,min_out_atomic:quote.min_out_atomic,wallet_in_amount:incoming.wallet_amount,wallet_out_amount:outgoing.wallet_amount,as_of:new Date(Math.min(...[native,incoming,outgoing].map(b=>Date.parse(b.as_of)))).toISOString(),max_fee_stroops:fee,signing_hash_hex:prepared.signingHashHex});
  await operations.reserve(client,{businessId:customer.businessId,customerId:customer.customerId,walletId:customer.walletId,operationId,assetId:XLM.id,amountAtomic:(quote.asset_in_id===XLM.id?BigInt(quote.amount_in_atomic):0n)+BigInt(fee),spendableAtomic:atomic(native.spendable),observedAt:new Date(native.as_of),expiresAt:new Date(prepared.authorization.expiresAt)});
  if(quote.asset_in_id!==XLM.id)await operations.reserve(client,{businessId:customer.businessId,customerId:customer.customerId,walletId:customer.walletId,operationId,assetId:quote.asset_in_id,amountAtomic:BigInt(quote.amount_in_atomic),spendableAtomic:atomic(incoming.spendable),observedAt:new Date(incoming.as_of),expiresAt:new Date(prepared.authorization.expiresAt)});
  await client.query("UPDATE operations SET result_json=COALESCE(result_json,'{}'::jsonb)||$3::jsonb WHERE business_id=$1 AND id=$2",[customer.businessId,operationId,JSON.stringify({spot_swap_baseline:baseline})]);
 };
}
/** RPC success is a separate precondition. Both observed deltas must match the same signed swap. */
export function inspectSpotDeltas(input:{baseline:unknown;walletAddress:string;signingHash:string;balances:WalletBalance[];feeStroops:string;confirmedLedger:number}):{verified:boolean;result:Record<string,unknown>} {
 const no=(reason:string)=>({verified:false,result:{spot_swap_verification:{verified:false,reason}}});
 try{
  const b=SpotBaselineSchema.parse(input.baseline);if(b.wallet_address!==input.walletAddress||b.signing_hash_hex!==input.signingHash||!/^\d+$/.test(input.feeStroops)||BigInt(input.feeStroops)>BigInt(b.max_fee_stroops)||!Number.isSafeInteger(input.confirmedLedger)||input.confirmedLedger<=0)return no('SWAP_BASELINE_OR_FEE_MISMATCH');
  const incoming=input.balances.find(x=>x.asset_id===b.asset_in_id),outgoing=input.balances.find(x=>x.asset_id===b.asset_out_id);if(!incoming||!outgoing)return no('EXACT_SWAP_BALANCES_UNAVAILABLE');
  const now=Date.now();for(const after of [incoming,outgoing])if(!validSource(after)||!Number.isFinite(Date.parse(after.as_of))||Date.parse(after.as_of)<Date.parse(b.as_of)||now-Date.parse(after.as_of)>30000||Date.parse(after.as_of)>now+1000)return no('STALE_SWAP_OBSERVATION');
  const debit=atomic(b.wallet_in_amount)-atomic(incoming.wallet_amount),credit=atomic(outgoing.wallet_amount)-atomic(b.wallet_out_amount)+(b.asset_out_id===XLM.id?BigInt(input.feeStroops):0n);
  if(debit!==BigInt(b.amount_in_atomic)+(b.asset_in_id===XLM.id?BigInt(input.feeStroops):0n)||credit<BigInt(b.min_out_atomic))return no('SWAP_BALANCE_DELTAS_NOT_CONFIRMED');
  return {verified:true,result:{spot_swap_verification:{verified:true,asset_in_id:b.asset_in_id,asset_out_id:b.asset_out_id,actual_in_atomic:b.amount_in_atomic,actual_out_atomic:credit.toString(),wallet_in_before:b.wallet_in_amount,wallet_in_after:incoming.wallet_amount,wallet_out_before:b.wallet_out_amount,wallet_out_after:outgoing.wallet_amount,fee_stroops:input.feeStroops,confirmed_ledger:input.confirmedLedger,observed_at:new Date(now).toISOString()}}};
 }catch{return no('INVALID_SWAP_OBSERVATION');}
}
