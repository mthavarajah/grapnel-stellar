import {createHash} from 'node:crypto';
import {scValToNative,nativeToScVal} from '@stellar/stellar-sdk';
import type {CustomerContext} from '@grapnel/contracts';
import type {MarginBalanceEvidence,MarginEvidence,MarginPositionEvidence,MarginStepContext} from '../../../modules/margin/types.js';
import {PERIDOT_MARKET_ID,PERIDOT_TESTNET_PINS as P} from '../config.js';
import {validateMarginPositionSnapshot,type MarginPositionSnapshot} from '../execution/state.js';
import {inspectQaOpenSwapStateChanges} from '../execution/open-swap.js';
import {inspectQaOpenCancelStateChanges} from '../execution/open-cancel.js';
import type {PrivateMarginBaseline} from './bindings.js';
import type {ConfirmedPeridotTransaction,CustomerSnapshot} from './chain.js';
import {decodePrivate} from './encoding.js';
import {PeridotTransactionChanges,committedStateCheckInput,contractKey,addressValue} from './metadata.js';
import {invalid,unsigned} from './policy.js';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v)).digest('hex');
const equal=(a:unknown,b:unknown)=>JSON.stringify(a,(_,v)=>typeof v==='bigint'?v.toString():v)===JSON.stringify(b,(_,v)=>typeof v==='bigint'?v.toString():v);
export function decodeBeforeSnapshot(baseline:PrivateMarginBaseline):CustomerSnapshot{return decodePrivate(baseline.before)as CustomerSnapshot;}
export function normalizeOwnedPosition(snapshot:MarginPositionSnapshot|null,debtAtomic:string,customer:CustomerContext,positionId:string|null):MarginPositionEvidence|null{
 if(snapshot===null)return null;
 const verified=validateMarginPositionSnapshot({...snapshot,position:snapshot.position,perps:snapshot.perps,pendingOpen:snapshot.pendingOpen,openExecution:snapshot.openExecution,pendingClose:snapshot.pendingClose});
 if(verified.walletAddress!==customer.walletAddress||verified.positionId!==positionId||!['PendingOpen','Open','Closing','Closed'].includes(verified.status))return invalid('POSITION_EVIDENCE_OWNER');
 const output=verified.openExecution?.position_amount??verified.pendingClose?.received_debt_asset??0n,expiry=verified.pendingOpen?.expires_at??verified.pendingClose?.expires_at;
 if(typeof output!=='bigint'||output<0n||expiry!==undefined&&(typeof expiry!=='bigint'||expiry<0n))return invalid('POSITION_EVIDENCE_INTEGERS');
 return{positionId:verified.positionId,owner:customer.walletAddress,marketId:PERIDOT_MARKET_ID,direction:'long',status:verified.status as MarginPositionEvidence['status'],debtAtomic:unsigned(debtAtomic).toString(),swapOutputAtomic:output.toString(),pendingExpiresAt:expiry===undefined?null:new Date(Number(expiry)*1000).toISOString()};
}
export function phaseEvidenceBase(context:MarginStepContext,baseline:PrivateMarginBaseline,confirmed:ConfirmedPeridotTransaction,after:CustomerSnapshot,customer:CustomerContext,now=Date.now()){
 const before=decodeBeforeSnapshot(baseline),changes=new PeridotTransactionChanges(confirmed.meta);
 if(context.intentHash!==baseline.intentHash||context.workflow.revision!==baseline.workflowRevision||confirmed.hash!==baseline.helper.signingHashHex||after.ledger<confirmed.ledger||before.ledger>confirmed.ledger||Date.parse(after.observedAt)>now+1000||now-Date.parse(after.observedAt)>15000||unsigned(before.nativeWalletAtomic)-unsigned(after.nativeWalletAtomic)!==unsigned(confirmed.feeAtomic,true)||unsigned(confirmed.feeAtomic)>unsigned(baseline.helper.feeStroops,true))return invalid('TRANSACTION_BASELINE_OR_FEE');
 const owner=addressValue(customer.walletAddress),fields=[['walletUnderlyingAtomic',P.mock_usdt.address,contractKey('Balance',owner)],['walletReceiptAtomic',P.mock_usdt_vault.address,contractKey('Balance',owner)],['marginReceiptAtomic',P.margin.address,contractKey('MarginBalancePtokens',owner,addressValue(P.mock_usdt_vault.address))]]as const;
 for(const [field,contract,key]of fields){const change=changes.balance(contract,key);if(change){if(change.before!==before[field]||change.after!==after[field])return invalid('TRANSACTION_LOCAL_BALANCE_MISMATCH');}else if(before[field]!==after[field])return invalid('UNPROVEN_BALANCE_MOVEMENT');}
 const balance=(value:CustomerSnapshot):MarginBalanceEvidence=>({walletUnderlyingAtomic:value.walletUnderlyingAtomic,walletReceiptAtomic:value.walletReceiptAtomic,marginReceiptAtomic:value.marginReceiptAtomic,position:normalizeOwnedPosition(value.position,value.marginDebtAtomic,customer,context.workflow.positionId)});
 const evidence:MarginEvidence={network:'stellar-testnet',chainStatus:'SUCCESS',txHash:confirmed.hash,ledger:confirmed.ledger,owner:customer.walletAddress,step:context.step,intentHash:context.intentHash,observedAt:new Date(now).toISOString(),before:balance(before),after:balance(after)};
 return{before,changes,evidence};
}
export function openSwapEvidence(context:MarginStepContext,baseline:PrivateMarginBaseline,confirmed:ConfirmedPeridotTransaction,after:CustomerSnapshot,customer:CustomerContext,now=Date.now()):MarginEvidence {
 const {before,changes,evidence}=phaseEvidenceBase(context,baseline,confirmed,after,customer,now),pending=before.position?.pendingOpen;
 if(context.step!=='open_swap'||!before.position||!after.position||!pending||baseline.helper.pendingDigest!==digest(pending)||before.marginDebtAtomic!=='0'||before.position.openExecution!==null)return invalid('OPEN_SWAP_BASELINE_PENDING');
 const intent={step:'open_swap' as const,walletAddress:customer.walletAddress,positionId:unsigned(context.workflow.positionId,true).toString()},out=inspectQaOpenSwapStateChanges(committedStateCheckInput(confirmed.meta,confirmed.ledger),intent,pending);
 const principal=changes.entry(P.mock_usdt_vault.address,contractKey('MarginBorrowPrincipal',nativeToScVal(BigInt(intent.positionId),{type:'u64'}))),actual=principal?.after?scValToNative(principal.after):null;
 if(typeof actual!=='bigint'||actual!==pending.borrow_amount||unsigned(after.marginDebtAtomic)<actual||!equal(before.position.position,after.position.position)||!equal(before.position.pendingOpen,after.position.pendingOpen)||!equal(after.position.openExecution,out)||evidence.after.position?.status!=='PendingOpen'||unsigned(evidence.after.position.swapOutputAtomic)<unsigned(String(pending.min_position_amount),true))return invalid('OPEN_SWAP_ACTUAL_DEBT_OR_EXECUTION');
 return evidence;
}
export function openCancelEvidence(context:MarginStepContext,baseline:PrivateMarginBaseline,confirmed:ConfirmedPeridotTransaction,after:CustomerSnapshot,customer:CustomerContext,now=Date.now()):MarginEvidence {
 const {before,evidence}=phaseEvidenceBase(context,baseline,confirmed,after,customer,now),pending=before.position?.pendingOpen;
 if(context.step!=='open_cancel'||!before.position||!pending||baseline.helper.pendingDigest!==digest(pending)||before.marginDebtAtomic!=='0'||after.marginDebtAtomic!=='0'||after.position!==null||before.position.openExecution!==null)return invalid('CANCEL_OWNED_PENDING_ZERO_DEBT');
 inspectQaOpenCancelStateChanges(committedStateCheckInput(confirmed.meta,confirmed.ledger),{step:'open_cancel',walletAddress:customer.walletAddress,positionId:unsigned(context.workflow.positionId,true).toString()},pending);
 return{...evidence,cancellationVerified:true};
}
