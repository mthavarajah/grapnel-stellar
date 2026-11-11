import {GrapnelError} from '@grapnel/contracts';
import type {MarginEvidence,MarginPhase,MarginStep,MarginStepTerms,MarginTerms,MarginWorkflow,MarginPositionEvidence} from './types.js';

const fail=(reason:string):never=>{throw new GrapnelError(409,'MARGIN_STATE_MISMATCH','Verified Margin state does not permit the requested transition',false,{reason});};
export function atomic(value:unknown,positive=false):bigint {
 if(typeof value!=='string'||!/^(0|[1-9]\d{0,37})$/.test(value))return fail('INVALID_ATOMIC');
 const n=BigInt(value);if(positive&&n===0n)return fail('ZERO_AMOUNT');return n;
}
export function validateMarginTerms(t:MarginTerms):void {
 if(t.network!=='stellar-testnet'||t.provider!=='peridot'||!t.marketId||!t.poolId||!t.marginAssetId||!t.baseAssetId||!t.receiptAssetId||t.marginAssetId===t.baseAssetId||!['long','short'].includes(t.direction)||![2,3,4,5].includes(t.leverage)||!Number.isInteger(t.slippageBps)||t.slippageBps<0||t.slippageBps>500||!/^[a-f0-9]{64}$/.test(t.pinsHash)||!t.policyVersion)return fail('TERMS');
 atomic(t.collateralAtomic,true);atomic(t.maxFeeStroops,true);atomic(t.depositMaxFeeStroops,true);
}
export function orderedMarginSteps(w:MarginWorkflow):MarginStep[] {
 const allowed:Record<MarginPhase,readonly MarginStep[]>={awaiting_collateral:['vault_deposit'],awaiting_margin_transfer:['margin_transfer'],awaiting_open_begin:['open_begin','margin_return'],opening_pending:['open_swap','open_cancel'],opening_swapped:['open_activate'],open:['close_prepare'],closing_prepared:w.terms.direction==='long'?['close_swap','close_cancel']:['close_short_swap','close_cancel'],closing_swapped:['close_finish'],closed:['margin_return'],awaiting_vault_withdraw:['vault_withdraw'],recovered:[]};
 return w.activeOperationId?[]:[...(allowed[w.phase]??[])];
}
export function assertNextMarginStep(w:MarginWorkflow,step:MarginStep,terms:MarginStepTerms):void {
 if(!orderedMarginSteps(w).includes(step))return fail('STEP_ORDER_OR_PENDING');
 const keys=Object.keys(terms).sort().join(',');
 const expected=step==='open_begin'||step==='close_swap'?'minimumOutputAtomic':step==='close_short_swap'?'maximumInputAtomic,minimumDebtOutputAtomic':'';
 if(keys!==expected)return fail('EXACT_STEP_TERMS');
 for(const v of Object.values(terms))atomic(v,true);
 if(['open_swap','open_activate','open_cancel','close_prepare','close_swap','close_short_swap','close_finish','close_cancel'].includes(step)&&w.positionId===null)return fail('CONFIRMED_POSITION_REQUIRED');
 if(['margin_transfer','open_begin','margin_return','vault_withdraw'].includes(step)&&(w.receiptAtomic===null||atomic(w.receiptAtomic)<=0n))return fail('CONFIRMED_RECEIPTS_REQUIRED');
}
function position(w:MarginWorkflow,p:MarginPositionEvidence|null,status:MarginPositionEvidence['status'],positionId:string|null=w.positionId):MarginPositionEvidence {
 if(!p||p.owner!==w.walletAddress||p.marketId!==w.terms.marketId||p.direction!==w.terms.direction||p.positionId!==positionId||p.status!==status)return fail('POSITION_BINDING');
 if(atomic(p.positionId)>=(1n<<64n))return fail('POSITION_ID');atomic(p.debtAtomic);atomic(p.swapOutputAtomic);
 if(p.pendingExpiresAt!==null&&!Number.isFinite(Date.parse(p.pendingExpiresAt)))return fail('POSITION_DEADLINE');
 return p;
}
/** Pure defense-in-depth reducer. Protocol adapter remains responsible for code/auth, exact tx metadata and pool/asset/health verification. */
export function applyMarginEvidence(w:MarginWorkflow,step:MarginStep,intentHash:string,txHash:string,e:MarginEvidence,now=Date.now()):Pick<MarginWorkflow,'phase'|'positionId'|'receiptAtomic'> {
 const required:Record<MarginStep,readonly MarginPhase[]>={vault_deposit:['awaiting_collateral'],margin_transfer:['awaiting_margin_transfer'],open_begin:['awaiting_open_begin'],open_swap:['opening_pending'],open_activate:['opening_swapped'],open_cancel:['opening_pending'],close_prepare:['open'],close_swap:['closing_prepared'],close_short_swap:['closing_prepared'],close_finish:['closing_swapped'],close_cancel:['closing_prepared'],margin_return:['awaiting_open_begin','closed'],vault_withdraw:['awaiting_vault_withdraw']};
 if(!required[step]?.includes(w.phase)||(step==='close_swap'&&w.terms.direction!=='long')||(step==='close_short_swap'&&w.terms.direction!=='short'))return fail('STEP_ORDER');
 if(e.network!=='stellar-testnet'||e.chainStatus!=='SUCCESS'||e.step!==step||e.owner!==w.walletAddress||e.intentHash!==intentHash||e.txHash!==txHash||!/^[a-f0-9]{64}$/.test(txHash)||!Number.isSafeInteger(e.ledger)||e.ledger<=0||!Number.isFinite(Date.parse(e.observedAt))||Date.parse(e.observedAt)>now+1000||now-Date.parse(e.observedAt)>15000)return fail('CHAIN_EVIDENCE');
 for(const b of [e.before,e.after]){atomic(b.walletUnderlyingAtomic);atomic(b.walletReceiptAtomic);atomic(b.marginReceiptAtomic);}
 const walletReceiptDelta=atomic(e.after.walletReceiptAtomic)-atomic(e.before.walletReceiptAtomic),marginDelta=atomic(e.after.marginReceiptAtomic)-atomic(e.before.marginReceiptAtomic);
 const result={phase:w.phase,positionId:w.positionId,receiptAtomic:w.receiptAtomic};
 const exactReceipts=()=>w.receiptAtomic===null?fail('MISSING_RECEIPTS'):atomic(w.receiptAtomic,true);
 switch(step){
  case 'vault_deposit':if(atomic(e.before.walletUnderlyingAtomic)-atomic(e.after.walletUnderlyingAtomic)!==atomic(w.terms.collateralAtomic)||walletReceiptDelta<=0n||marginDelta!==0n)return fail('DEPOSIT_DELTA');result.receiptAtomic=walletReceiptDelta.toString();result.phase='awaiting_margin_transfer';break;
  case 'margin_transfer':if(walletReceiptDelta!==-exactReceipts()||marginDelta!==exactReceipts()||e.before.walletUnderlyingAtomic!==e.after.walletUnderlyingAtomic)return fail('TRANSFER_DELTA');result.phase='awaiting_open_begin';break;
  case 'open_begin':{
   if(e.returnedPositionId===undefined)return fail('BEGIN_RESULT');atomic(e.returnedPositionId);const p=position(w,e.after.position,'PendingOpen',e.returnedPositionId);
   if(e.before.position!==null||p.debtAtomic!=='0'||p.swapOutputAtomic!=='0'||p.pendingExpiresAt===null||Date.parse(p.pendingExpiresAt)<=now||marginDelta!==-exactReceipts())return fail('BEGIN_PHASE');
   result.positionId=e.returnedPositionId;result.phase='opening_pending';break;
  }
  case 'open_swap':{const before=position(w,e.before.position,'PendingOpen'),after=position(w,e.after.position,'PendingOpen');if(atomic(before.swapOutputAtomic)!==0n||atomic(after.swapOutputAtomic)<=0n)return fail('OPEN_SWAP_DELTA');result.phase='opening_swapped';break;}
  case 'open_activate':{const before=position(w,e.before.position,'PendingOpen'),after=position(w,e.after.position,'Open');if(atomic(before.swapOutputAtomic)<=0n||atomic(after.debtAtomic)<=0n)return fail('ACTIVATE_DELTA');result.phase='open';break;}
  case 'close_prepare':position(w,e.before.position,'Open');position(w,e.after.position,'Closing');if(e.after.position!.pendingExpiresAt===null||Date.parse(e.after.position!.pendingExpiresAt)<=now||atomic(e.after.position!.swapOutputAtomic)!==0n)return fail('CLOSE_PREPARE');result.phase='closing_prepared';break;
  case 'close_swap':case 'close_short_swap':{const before=position(w,e.before.position,'Closing'),after=position(w,e.after.position,'Closing');if(atomic(before.swapOutputAtomic)!==0n||atomic(after.swapOutputAtomic)<=0n)return fail('CLOSE_SWAP_DELTA');result.phase='closing_swapped';break;}
  case 'close_finish':{const before=position(w,e.before.position,'Closing'),after=position(w,e.after.position,'Closed');if(atomic(before.swapOutputAtomic)<=0n||atomic(after.debtAtomic)!==0n||marginDelta<0n)return fail('CLOSE_FINISH');result.receiptAtomic=marginDelta.toString();result.phase=marginDelta===0n?'recovered':'closed';break;}
  case 'open_cancel':{const p=position(w,e.before.position,'PendingOpen');if(atomic(p.swapOutputAtomic)!==0n||!e.cancellationVerified||e.after.position!==null||marginDelta<0n)return fail('OPEN_CANCEL');result.receiptAtomic=marginDelta.toString();result.phase=marginDelta===0n?'recovered':'closed';break;}
  case 'close_cancel':{const p=position(w,e.before.position,'Closing');position(w,e.after.position,'Open');if(atomic(p.swapOutputAtomic)!==0n||!e.cancellationVerified)return fail('CLOSE_CANCEL');result.phase='open';break;}
  case 'margin_return':if(marginDelta!==-exactReceipts()||walletReceiptDelta!==exactReceipts()||e.after.position&&atomic(e.after.position.debtAtomic)!==0n)return fail('RETURN_DELTA');result.phase='awaiting_vault_withdraw';break;
  case 'vault_withdraw':if(walletReceiptDelta!==-exactReceipts()||atomic(e.after.walletUnderlyingAtomic)<=atomic(e.before.walletUnderlyingAtomic)||marginDelta!==0n)return fail('WITHDRAW_DELTA');result.receiptAtomic='0';result.phase='recovered';break;
 }
 return result;
}
