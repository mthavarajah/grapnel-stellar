import {NETWORK,fromAtomic,type CustomerContext,type PreparedAction} from '@grapnel/contracts';
import type {MarginStepContext,MarginEvidence} from '../../../modules/margin/types.js';
import {PERIDOT_COLLATERAL,PERIDOT_TESTNET_PINS as P} from '../config.js';
import {PeridotQaMarginReturnPreparer,inspectQaMarginReturnTransaction,inspectQaMarginReturnStateChanges,type QaPreparedMarginReturn} from '../execution/margin-return.js';
import {PeridotQaVaultWithdrawPreparer,inspectQaVaultWithdrawTransaction,type QaPreparedVaultWithdraw} from '../execution/vault-withdraw.js';
import type {PeridotCustomerChain,CustomerSnapshot,ConfirmedPeridotTransaction} from './chain.js';
import type {CustomerPhaseBindings,PhasePrepared,PrivateMarginBaseline} from './bindings.js';
import {PERIDOT_RECEIPT_ID,invalid,unsigned} from './policy.js';
import {phaseEvidenceBase} from './phase-evidence.js';
import {committedStateCheckInput,contractKey,addressValue} from './metadata.js';
import {scValToNative,xdr} from '@stellar/stellar-sdk';
const equal=(a:unknown,b:unknown)=>JSON.stringify(a,(_,v)=>typeof v==='bigint'?v.toString():v)===JSON.stringify(b,(_,v)=>typeof v==='bigint'?v.toString():v);
function publicExit(context:MarginStepContext,helper:PhasePrepared,customer:CustomerContext):PreparedAction{
 const withdraw=context.step==='vault_withdraw';
 return{operationId:context.operationId,customerId:customer.customerId,network:NETWORK,walletAddress:customer.walletAddress,unsignedXdr:helper.unsignedXdr,signingHashHex:helper.signingHashHex,summary:{action:withdraw?'margin.vault_withdraw':'margin.return',positionId:unsigned(context.workflow.positionId,true).toString(),fromAssetId:PERIDOT_RECEIPT_ID,...(withdraw?{toAssetId:PERIDOT_COLLATERAL.id}:{}),amount:fromAtomic(unsigned(context.workflow.receiptAtomic,true),6),recipient:customer.walletAddress,contractId:withdraw?P.mock_usdt_vault.address:P.margin.address,maxFeeStroops:helper.feeStroops,expiresAt:helper.expiresAt},authorization:{method:'privy_stellar',expiresAt:helper.expiresAt}};
}
export function marginReturnEvidence(context:MarginStepContext,baseline:PrivateMarginBaseline,confirmed:ConfirmedPeridotTransaction,after:CustomerSnapshot,customer:CustomerContext,now=Date.now()):MarginEvidence{
 const {before,evidence}=phaseEvidenceBase(context,baseline,confirmed,after,customer,now);
 if(context.step!=='margin_return'||before.position!==null||after.position!==null||before.marginDebtAtomic!=='0'||after.marginDebtAtomic!=='0'||baseline.helper.intent.step!=='margin_return'||(baseline.helper.intent as {repaidPositionId?:string}).repaidPositionId!==context.workflow.positionId)return invalid('REPAID_RETURN_CONTEXT');
 inspectQaMarginReturnStateChanges(committedStateCheckInput(confirmed.meta,confirmed.ledger),(baseline.helper as unknown as QaPreparedMarginReturn).intent);return evidence;
}
export function vaultWithdrawEvidence(context:MarginStepContext,baseline:PrivateMarginBaseline,confirmed:ConfirmedPeridotTransaction,after:CustomerSnapshot,customer:CustomerContext,now=Date.now()):MarginEvidence{
 const {before,changes,evidence}=phaseEvidenceBase(context,baseline,confirmed,after,customer,now),amount=unsigned(context.workflow.receiptAtomic,true),owner=addressValue(customer.walletAddress);
 if(context.step!=='vault_withdraw'||before.position!==null||after.position!==null||before.marginDebtAtomic!=='0'||after.marginDebtAtomic!=='0'||before.marginReceiptAtomic!=='0'||after.marginReceiptAtomic!=='0'||baseline.helper.intent.step!=='vault_withdraw'||(baseline.helper.intent as {repaidPositionId?:string}).repaidPositionId!==context.workflow.positionId)return invalid('REPAID_WITHDRAW_CONTEXT');
 const receipt=changes.balance(P.mock_usdt_vault.address,contractKey('Balance',owner)),wallet=changes.balance(P.mock_usdt.address,contractKey('Balance',owner)),vault=changes.balance(P.mock_usdt.address,contractKey('Balance',addressValue(P.mock_usdt_vault.address))),cash=changes.balance(P.mock_usdt_vault.address,contractKey('ManagedCash')),deposited=changes.balance(P.mock_usdt_vault.address,contractKey('TotalDeposited'));
 if(!receipt||!wallet||!vault||!cash||!deposited||unsigned(receipt.before)-unsigned(receipt.after)!==amount)return invalid('WITHDRAW_EXACT_RECEIPT_BURN');
 const output=unsigned(wallet.after)-unsigned(wallet.before);
 if(output!==unsigned(baseline.helper.expectedUnderlyingAtomic,true)||unsigned(vault.before)-unsigned(vault.after)!==output||unsigned(cash.before)-unsigned(cash.after)!==output||unsigned(deposited.before)-unsigned(deposited.after)!==output)return invalid('WITHDRAW_EXACT_OBSERVED_UNDERLYING');
 const instance=changes.entry(P.mock_usdt_vault.address,xdr.ScVal.scvLedgerKeyContractInstance());if(!instance?.before||!instance.after)return invalid('WITHDRAW_RECEIPT_INSTANCE');
 const old=instance.before.instance(),current=instance.after.instance();for(const value of [old,current])if(value.executable().switch().name!=='contractExecutableWasm'||value.executable().wasmHash().toString('hex')!==P.mock_usdt_vault.wasmHash)return invalid('WITHDRAW_RECEIPT_CODE');
 const b=old.storage()??[],a=current.storage()??[];if(b.length!==a.length||new Set(b.map(e=>e.key().toXDR('base64'))).size!==b.length||new Set(a.map(e=>e.key().toXDR('base64'))).size!==a.length)return invalid('WITHDRAW_INSTANCE_STORAGE');let found=false;
 for(const previous of b){const next=a.find(e=>e.key().toXDR('base64')===previous.key().toXDR('base64'));if(!next)return invalid('WITHDRAW_INSTANCE_KEY');if(equal(scValToNative(previous.key()),['TotalSupply'])){found=true;const beforeSupply=scValToNative(previous.val()),afterSupply=scValToNative(next.val());if(typeof beforeSupply!=='bigint'||typeof afterSupply!=='bigint'||beforeSupply-afterSupply!==amount)return invalid('WITHDRAW_EXACT_SUPPLY_BURN');}else if(previous.val().toXDR('base64')!==next.val().toXDR('base64'))return invalid('WITHDRAW_INSTANCE_METADATA_CHANGED');}
 if(!found)return invalid('WITHDRAW_TOTAL_SUPPLY_REQUIRED');return evidence;
}
export function reviewedExitBindings(chain:PeridotCustomerChain):CustomerPhaseBindings{
 const returned=new PeridotQaMarginReturnPreparer(chain.server,chain.now),withdraw=new PeridotQaVaultWithdrawPreparer(chain.server,chain.now);
 return{
  margin_return:{prepare:async(c,u)=>({...await returned.prepare({step:'margin_return',walletAddress:u.walletAddress,receiptAtomic:unsigned(c.workflow.receiptAtomic,true).toString(),repaidPositionId:unsigned(c.workflow.positionId,true).toString()})}),verify:async(p,x)=>returned.verifySigned(p as unknown as QaPreparedMarginReturn,x),inspectHistorical:(p,tx)=>inspectQaMarginReturnTransaction(tx,(p as unknown as QaPreparedMarginReturn).intent,p.expiresAt),publicAction:publicExit,readEvidence:async(c,b,t,a,u)=>marginReturnEvidence(c,b,t,a,u,chain.now())},
  vault_withdraw:{prepare:async(c,u)=>({...await withdraw.prepare({step:'vault_withdraw',walletAddress:u.walletAddress,receiptAtomic:unsigned(c.workflow.receiptAtomic,true).toString(),repaidPositionId:unsigned(c.workflow.positionId,true).toString()})}),verify:async(p,x)=>withdraw.verifySigned(p as unknown as QaPreparedVaultWithdraw,x),inspectHistorical:(p,tx)=>inspectQaVaultWithdrawTransaction(tx,(p as unknown as QaPreparedVaultWithdraw).intent,p.expiresAt),publicAction:publicExit,readEvidence:async(c,b,t,a,u)=>vaultWithdrawEvidence(c,b,t,a,u,chain.now())},
 };
}
