import {NETWORK,fromAtomic,type CustomerContext,type PreparedAction} from '@grapnel/contracts';
import type {MarginStepContext} from '../../../modules/margin/types.js';
import {PERIDOT_BASE,PERIDOT_COLLATERAL,PERIDOT_TESTNET_PINS as P} from '../config.js';
import {PeridotQaAtomicClosePreparer,inspectQaAtomicCloseTransaction,type QaPreparedAtomicClose} from '../execution/atomic-close.js';
import type {PeridotCustomerChain} from './chain.js';
import type {CustomerPhaseBindings,PhasePrepared} from './bindings.js';
import {atomicCloseEvidence} from './atomic-evidence.js';
import {unsigned} from './policy.js';
export function publicAtomicCloseAction(c:MarginStepContext,p:PhasePrepared,u:CustomerContext):PreparedAction {
 return{operationId:c.operationId,customerId:u.customerId,network:NETWORK,walletAddress:u.walletAddress,unsignedXdr:p.unsignedXdr,signingHashHex:p.signingHashHex,summary:{action:'margin.close_atomic',fromAssetId:PERIDOT_BASE.id,toAssetId:PERIDOT_COLLATERAL.id,minReceive:fromAtomic(unsigned(c.terms.minimumOutputAtomic,true),7),positionId:unsigned(c.workflow.positionId,true).toString(),contractId:P.margin.address,recipient:P.margin.address,maxFeeStroops:p.feeStroops,expiresAt:p.expiresAt},authorization:{method:'privy_stellar',expiresAt:p.expiresAt}};
}
export function reviewedAtomicCloseBinding(chain:PeridotCustomerChain):CustomerPhaseBindings {
 const close=new PeridotQaAtomicClosePreparer(chain.server,chain.now);
 return{close_atomic:{prepare:async(c,u)=>({...await close.prepare({step:'close_atomic',walletAddress:u.walletAddress,positionId:unsigned(c.workflow.positionId,true).toString(),minimumOutputAtomic:unsigned(c.terms.minimumOutputAtomic,true).toString()})}),verify:async(p,x)=>close.verifySigned(p as unknown as QaPreparedAtomicClose,x),inspectHistorical:(p,tx)=>inspectQaAtomicCloseTransaction(tx,(p as unknown as QaPreparedAtomicClose).intent,p.expiresAt),publicAction:publicAtomicCloseAction,readEvidence:async(c,b,t,a,u)=>atomicCloseEvidence(c,b,t,a,u,chain.now())}};
}
