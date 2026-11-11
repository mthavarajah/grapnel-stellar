import {NETWORK,fromAtomic,type CustomerContext,type PreparedAction} from '@grapnel/contracts';
import type {MarginStepContext} from '../../../modules/margin/types.js';
import {PERIDOT_BASE,PERIDOT_TESTNET_PINS as P} from '../config.js';
import {PeridotQaOpenSwapPreparer,inspectQaOpenSwapTransaction,type QaPreparedOpenSwap} from '../execution/open-swap.js';
import {PeridotQaOpenCancelPreparer,inspectQaOpenCancelTransaction,type QaPreparedOpenCancel} from '../execution/open-cancel.js';
import type {PeridotCustomerChain} from './chain.js';
import type {CustomerPhaseBindings,PhasePrepared} from './bindings.js';
import {openSwapEvidence,openCancelEvidence} from './phase-evidence.js';
import {PERIDOT_RECEIPT_ID,unsigned} from './policy.js';
function action(context:MarginStepContext,helper:PhasePrepared,customer:CustomerContext):PreparedAction {
 return{operationId:context.operationId,customerId:customer.customerId,network:NETWORK,walletAddress:customer.walletAddress,unsignedXdr:helper.unsignedXdr,signingHashHex:helper.signingHashHex,summary:{action:context.step==='open_swap'?'margin.open_swap':'margin.open_cancel',fromAssetId:PERIDOT_RECEIPT_ID,...(context.step==='open_swap'?{toAssetId:PERIDOT_BASE.id}:{}),amount:fromAtomic(unsigned(context.workflow.receiptAtomic,true),6),recipient:context.step==='open_swap'?P.margin.address:customer.walletAddress,contractId:P.margin.address,maxFeeStroops:helper.feeStroops,expiresAt:helper.expiresAt},authorization:{method:'privy_stellar',expiresAt:helper.expiresAt}};
}
export function reviewedPositionBindings(chain:PeridotCustomerChain):CustomerPhaseBindings {
 const swap=new PeridotQaOpenSwapPreparer(chain.server,chain.now),cancel=new PeridotQaOpenCancelPreparer(chain.server,chain.now);
 return{
  open_swap:{prepare:async(c,u)=>({...await swap.prepare({step:'open_swap',walletAddress:u.walletAddress,positionId:unsigned(c.workflow.positionId,true).toString()})}),verify:async(p,x)=>swap.verifySigned(p as unknown as QaPreparedOpenSwap,x),inspectHistorical:(p,tx)=>inspectQaOpenSwapTransaction(tx,(p as unknown as QaPreparedOpenSwap).intent,p.expiresAt),publicAction:action,readEvidence:async(c,b,t,a,u)=>openSwapEvidence(c,b,t,a,u,chain.now())},
  open_cancel:{prepare:async(c,u)=>({...await cancel.prepare({step:'open_cancel',walletAddress:u.walletAddress,positionId:unsigned(c.workflow.positionId,true).toString()})}),verify:async(p,x)=>cancel.verifySigned(p as unknown as QaPreparedOpenCancel,x),inspectHistorical:(p,tx)=>inspectQaOpenCancelTransaction(tx,(p as unknown as QaPreparedOpenCancel).intent,p.expiresAt),publicAction:action,readEvidence:async(c,b,t,a,u)=>openCancelEvidence(c,b,t,a,u,chain.now())},
 };
}
