import {scValToNative,nativeToScVal} from '@stellar/stellar-sdk';
import type {CustomerContext} from '@grapnel/contracts';
import type {MarginBalanceEvidence,MarginEvidence,MarginStepContext} from '../../../modules/margin/types.js';
import {PERIDOT_MARKET_ID,PERIDOT_TESTNET_PINS as P} from '../config.js';
import {validateMarginPositionSnapshot} from '../execution/state.js';
import type {ConfirmedPeridotTransaction,CustomerSnapshot} from './chain.js';
import type {PrivateMarginBaseline} from './bindings.js';
import {PeridotTransactionChanges,addressValue,contractKey} from './metadata.js';
import {invalid,unsigned} from './policy.js';
const serialize=(value:unknown)=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v);
const positionNone=(snapshot:PrivateMarginBaseline['before'])=>{if(snapshot.position!==null)return invalid('UNEXPECTED_PRIOR_POSITION');return null;};
/** Known proven first phases only. Later phases require their own exact debt/receipt metadata extractor. */
export function knownMarginEvidence(context:MarginStepContext,baseline:PrivateMarginBaseline,confirmed:ConfirmedPeridotTransaction,after:CustomerSnapshot,customer:CustomerContext,now=Date.now()):MarginEvidence {
 const before=baseline.before;
 if(context.intentHash!==baseline.intentHash||context.workflow.revision!==baseline.workflowRevision||confirmed.hash!==baseline.helper.signingHashHex||after.ledger<confirmed.ledger||before.ledger>confirmed.ledger||Date.parse(after.observedAt)>now+1000||now-Date.parse(after.observedAt)>15000||unsigned(before.nativeWalletAtomic)-unsigned(after.nativeWalletAtomic)!==unsigned(confirmed.feeAtomic,true)||unsigned(confirmed.feeAtomic)>unsigned(baseline.helper.feeStroops,true))return invalid('TRANSACTION_BASELINE_OR_FEE');
 const changes=new PeridotTransactionChanges(confirmed.meta),owner=addressValue(customer.walletAddress);
 const fields=[['walletUnderlyingAtomic',P.mock_usdt.address,contractKey('Balance',owner)],['walletReceiptAtomic',P.mock_usdt_vault.address,contractKey('Balance',owner)],['marginReceiptAtomic',P.margin.address,contractKey('MarginBalancePtokens',owner,addressValue(P.mock_usdt_vault.address))]]as const;
 const observed=new Map<string,{before:string;after:string}>();
 for(const [name,contract,key] of fields){
  const changed=changes.balance(contract,key);
  if(changed){if(changed.before!==before[name]||changed.after!==after[name])return invalid('TRANSACTION_LOCAL_BALANCE_MISMATCH');observed.set(name,changed);}
  else if(before[name]!==after[name])return invalid('UNPROVEN_BALANCE_MOVEMENT');
 }
 const b:MarginBalanceEvidence={walletUnderlyingAtomic:before.walletUnderlyingAtomic,walletReceiptAtomic:before.walletReceiptAtomic,marginReceiptAtomic:before.marginReceiptAtomic,position:positionNone(before)};
 const a:MarginBalanceEvidence={walletUnderlyingAtomic:after.walletUnderlyingAtomic,walletReceiptAtomic:after.walletReceiptAtomic,marginReceiptAtomic:after.marginReceiptAtomic,position:null};
 const evidence:MarginEvidence={network:'stellar-testnet',chainStatus:'SUCCESS',txHash:confirmed.hash,ledger:confirmed.ledger,owner:customer.walletAddress,step:context.step,intentHash:context.intentHash,observedAt:new Date(now).toISOString(),before:b,after:a};
 if(context.step==='vault_deposit'){
  if(!observed.has('walletUnderlyingAtomic')||!observed.has('walletReceiptAtomic')||unsigned(b.walletUnderlyingAtomic)-unsigned(a.walletUnderlyingAtomic)!==unsigned(context.workflow.terms.collateralAtomic)||unsigned(a.walletReceiptAtomic)<=unsigned(b.walletReceiptAtomic)||a.marginReceiptAtomic!==b.marginReceiptAtomic||after.position!==null||after.marginDebtAtomic!=='0')return invalid('DEPOSIT_PRINCIPAL_PROOF');
 }else if(context.step==='margin_transfer'){
  const receipt=unsigned(context.workflow.receiptAtomic,true);
  if(!observed.has('walletReceiptAtomic')||!observed.has('marginReceiptAtomic')||unsigned(b.walletReceiptAtomic)-unsigned(a.walletReceiptAtomic)!==receipt||unsigned(a.marginReceiptAtomic)-unsigned(b.marginReceiptAtomic)!==receipt||a.walletUnderlyingAtomic!==b.walletUnderlyingAtomic||after.position!==null||after.marginDebtAtomic!=='0')return invalid('TRANSFER_PRINCIPAL_PROOF');
 }else if(context.step==='open_begin'){
  const id=unsigned(baseline.helper.expectedPositionId,true).toString();
  if(!confirmed.returnValue||scValToNative(confirmed.returnValue)!==BigInt(id))return invalid('BEGIN_RETURNED_ID');
  const key=nativeToScVal(BigInt(id),{type:'u64'}),position=changes.entry(P.margin.address,contractKey('Position',key)),pending=changes.entry(P.margin.address,contractKey('PendingPerpsOpenPosition',key));
  if(!position?.created||position.before||!position.after||!pending?.created||pending.before||!pending.after||!observed.has('marginReceiptAtomic'))return invalid('BEGIN_CREATED_RECORDS');
  const snapshot=validateMarginPositionSnapshot({positionId:id,walletAddress:customer.walletAddress,direction:'long',position:scValToNative(position.after),pendingOpen:scValToNative(pending.after),perps:null,openExecution:null,pendingClose:null,observedLedger:confirmed.ledger,observedAt:new Date(now).toISOString()});
  if(after.marginDebtAtomic!=='0'||!after.position||after.position.positionId!==id||serialize(after.position.position)!==serialize(snapshot.position)||serialize(after.position.pendingOpen)!==serialize(snapshot.pendingOpen)||snapshot.position.debt_shares!==0n||snapshot.position.collateral_ptokens!==0n||snapshot.pendingOpen?.margin_ptokens!==unsigned(context.workflow.receiptAtomic,true)||snapshot.pendingOpen.min_position_amount!==unsigned(context.terms.minimumOutputAtomic,true)||unsigned(b.marginReceiptAtomic)-unsigned(a.marginReceiptAtomic)!==unsigned(context.workflow.receiptAtomic,true))return invalid('BEGIN_OWNER_PHASE_PRINCIPAL_PROOF');
  a.position={positionId:id,owner:customer.walletAddress,marketId:PERIDOT_MARKET_ID,direction:'long',status:'PendingOpen',debtAtomic:'0',swapOutputAtomic:'0',pendingExpiresAt:new Date(Number(snapshot.pendingOpen.expires_at)*1000).toISOString()};evidence.returnedPositionId=id;
 }else return invalid('PHASE_EVIDENCE_EXTRACTOR_REQUIRED');
 return evidence;
}
