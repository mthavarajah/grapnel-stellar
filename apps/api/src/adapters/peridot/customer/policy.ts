import {createHash} from 'node:crypto';
import {GrapnelError,NETWORK,toAtomic,type CustomerContext} from '@grapnel/contracts';
import {canonicalJson} from '../../../lib/crypto.js';
import type {MarginTerms} from '../../../modules/margin/types.js';
import {PERIDOT_BASE,PERIDOT_COLLATERAL,PERIDOT_MARKET_ID,PERIDOT_POOL_ID,PERIDOT_TESTNET_PINS as P} from '../config.js';

export const PERIDOT_RECEIPT_ID=`stellar-testnet:soroban:${P.mock_usdt_vault.address}`;
export const PERIDOT_CUSTOMER_POLICY={
 pinsHash:createHash('sha256').update(canonicalJson(P)).digest('hex'),
 policyVersion:'peridot-testnet-long-2x-1mock-v1',
} as const;
export const REQUIRED_CUSTOMER_STEPS=['vault_deposit','margin_transfer','open_begin','open_swap','open_activate','open_cancel','close_prepare','close_swap','close_finish','close_cancel','margin_return','vault_withdraw'] as const;
export const fail=(reason:string):never=>{throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Verified Margin execution is unavailable',false,{reason});};
export const invalid=(reason:string):never=>{throw new GrapnelError(403,'MARGIN_CUSTOMER_INTENT_MISMATCH','The Margin action differs from its exact customer intent',false,{reason});};
export function unsigned(value:unknown,positive=false):bigint {
 if(typeof value!=='string'||!/^(0|[1-9]\d{0,37})$/.test(value))return invalid('INVALID_ATOMIC');
 const n=BigInt(value);if(positive&&n===0n)return invalid('ZERO_AMOUNT');return n;
}
export function validateCustomerTerms(terms:MarginTerms,customer:CustomerContext):void {
 if(!customer.privyUserId.startsWith('did:privy:')||terms.network!==NETWORK||terms.provider!=='peridot'||terms.marketId!==PERIDOT_MARKET_ID||terms.poolId!==PERIDOT_POOL_ID||terms.marginAssetId!==PERIDOT_COLLATERAL.id||terms.baseAssetId!==PERIDOT_BASE.id||terms.receiptAssetId!==PERIDOT_RECEIPT_ID||terms.direction!=='long'||terms.leverage!==2||terms.slippageBps!==50||terms.maxFeeStroops!=='10000000'||terms.depositMaxFeeStroops!=='80000000'||terms.pinsHash!==PERIDOT_CUSTOMER_POLICY.pinsHash||terms.policyVersion!==PERIDOT_CUSTOMER_POLICY.policyVersion||unsigned(terms.collateralAtomic,true)>10000000n)return invalid('SERVER_POLICY');
}
export function createCustomerTerms(input:{market_id:string;direction:'long'|'short';leverage:number;amount:string;slippage_bps:number},customer:CustomerContext):MarginTerms {
 let amount:bigint;try{amount=toAtomic(input.amount,7);}catch{return invalid('AMOUNT');}
 const terms:MarginTerms={network:NETWORK,provider:'peridot',marketId:input.market_id,poolId:PERIDOT_POOL_ID,marginAssetId:PERIDOT_COLLATERAL.id,baseAssetId:PERIDOT_BASE.id,receiptAssetId:PERIDOT_RECEIPT_ID,direction:input.direction,leverage:input.leverage as MarginTerms['leverage'],collateralAtomic:amount.toString(),slippageBps:input.slippage_bps,maxFeeStroops:'10000000',depositMaxFeeStroops:'80000000',...PERIDOT_CUSTOMER_POLICY};
 validateCustomerTerms(terms,customer);return terms;
}
