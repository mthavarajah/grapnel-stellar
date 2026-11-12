import {createHash} from 'node:crypto';
import {Address,scValToNative,nativeToScVal,xdr} from '@stellar/stellar-sdk';
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

/** Prove activation using actual receipt mint/balance/supply deltas; never invent an execution exchange rate. */
export function activationEvidence(context:MarginStepContext,baseline:PrivateMarginBaseline,confirmed:ConfirmedPeridotTransaction,after:CustomerSnapshot,customer:CustomerContext,now=Date.now()):MarginEvidence {
 const {before,changes,evidence}=phaseEvidenceBase(context,baseline,confirmed,after,customer,now),pending=before.position?.pendingOpen,execution=before.position?.openExecution,id=unsigned(context.workflow.positionId,true).toString(),key=nativeToScVal(BigInt(id),{type:'u64'});
 if(context.step!=='open_activate'||!before.position||!after.position||!pending||!execution||baseline.helper.pendingDigest!==digest(pending)||baseline.helper.executionDigest!==digest(execution)||unsigned(before.marginDebtAtomic)<=0n||unsigned(after.marginDebtAtomic)<unsigned(before.marginDebtAtomic))return invalid('ACTIVATION_EXISTING_EXECUTION_DEBT');
 const position=changes.entry(P.margin.address,contractKey('Position',key)),perps=changes.entry(P.margin.address,contractKey('PerpsPositionData',key)),removedPending=changes.entry(P.margin.address,contractKey('PendingPerpsOpenPosition',key)),removedExecution=changes.entry(P.margin.address,contractKey('PendingPerpsOpenExecution',key));
 if(!position?.before||!position.after||!perps?.created||!perps.after||!removedPending?.removed||!removedPending.before||!removedExecution?.removed||!removedExecution.before||!equal(scValToNative(position.before),before.position.position)||!equal(scValToNative(position.after),after.position.position)||!equal(scValToNative(perps.after),after.position.perps)||!equal(scValToNative(removedPending.before),pending)||!equal(scValToNative(removedExecution.before),execution)||after.position.status!=='Open'||after.position.pendingOpen!==null||after.position.openExecution!==null)return invalid('ACTIVATION_EXACT_RECORD_TRANSITION');
 const amount=unsigned(String(execution.position_amount),true),receipt=changes.balance(P.native_vault.address,contractKey('Balance',addressValue(P.margin.address)));
 if(!receipt)return invalid('ACTIVATION_RECEIPT_MINT');const minted=unsigned(receipt.after)-unsigned(receipt.before),nativeInstance=changes.entry(P.native_vault.address,xdr.ScVal.scvLedgerKeyContractInstance());
 const total=(value:import('@stellar/stellar-sdk').xdr.ScVal|null)=>{if(!value||value.switch().name!=='scvContractInstance')return invalid('ACTIVATION_SUPPLY_INSTANCE');const rows=(value.instance().storage()??[]).filter(e=>equal(scValToNative(e.key()),['TotalSupply']));if(rows.length!==1)return invalid('ACTIVATION_SUPPLY_IDENTITY');return unsigned(String(scValToNative(rows[0]!.val())),true);};
 if(!nativeInstance?.before||!nativeInstance.after||minted<=0n||total(nativeInstance.after)-total(nativeInstance.before)!==minted||after.position.position.collateral_ptokens!==minted||after.position.position.owner!==customer.walletAddress||after.position.position.opened_at!==before.position.position.opened_at||after.position.position.entry_price_scaled!==unsigned(String(pending.notional_value),true)*1000000n/amount||after.position.perps?.margin_amount!==pending.margin_amount||after.position.perps?.notional_value!==pending.notional_value||after.position.perps?.maintenance_margin_scaled!==50000n||after.position.perps?.liquidation_incentive_scaled!==10000n)return invalid('ACTIVATION_MINTED_POSITION_RISK');
 for(const field of ['ManagedCash','TotalDeposited']){const delta=changes.balance(P.native_vault.address,contractKey(field));if(!delta||unsigned(delta.after)-unsigned(delta.before)!==amount)return invalid('ACTIVATION_EXACT_NATIVE_VAULT_PRINCIPAL');}
 const native=(contractOwner:string)=>{const row=changes.entry(P.native_token.address,contractKey('Balance',addressValue(contractOwner)));if(!row?.before||!row.after)return invalid('ACTIVATION_NATIVE_MOVEMENT');const n=(v:import('@stellar/stellar-sdk').xdr.ScVal)=>{const b=scValToNative(v)as Record<string,unknown>;if(b?.authorized!==true||b.clawback!==false)return invalid('ACTIVATION_NATIVE_FLAGS');return unsigned(String(b.amount));};return n(row.after)-n(row.before);};
 if(native(P.margin.address)!==-amount||native(P.native_vault.address)!==amount)return invalid('ACTIVATION_NATIVE_RECIPIENT');
 const state=committedStateCheckInput(confirmed.meta,confirmed.ledger);
 if(state.stateChanges!.some(row=>row.key.switch().name==='contractData'&&Address.fromScAddress(row.key.contractData().contract()).toString()===P.mock_usdt_vault.address&&row.key.contractData().key().switch().name==='scvVec'&&['MarginBorrowPrincipal','MarginBorrowSnapshots','TotalBorrowed'].includes(row.key.contractData().key().vec()?.[0]?.sym()?.toString()??'')))return invalid('ACTIVATION_NO_NEW_BORROW');
 return evidence;
}
