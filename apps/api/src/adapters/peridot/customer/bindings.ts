import {Transaction,TransactionBuilder} from '@stellar/stellar-sdk';
import {NETWORK_PASSPHRASE,type CustomerContext,type PreparedAction} from '@grapnel/contracts';
import type {MarginStepContext,MarginStep} from '../../../modules/margin/types.js';
import {canonicalJson} from '../../../lib/crypto.js';
import type {PeridotStepIntent,PeridotPositionStep} from '../execution/intents.js';
import type {QaAtomicCloseIntent} from '../execution/atomic-close.js';
import type {QaMarginReturnIntent} from '../execution/margin-return.js';
import type {QaVaultWithdrawIntent} from '../execution/vault-withdraw.js';
import {PeridotQaVaultDepositPreparer,inspectQaVaultDepositTransaction,type QaPreparedVaultDeposit} from '../execution/vault-deposit.js';
import {PeridotQaMarginTransferPreparer,inspectQaMarginTransferTransaction,type QaPreparedMarginTransfer} from '../execution/transfer.js';
import {PeridotQaMarginBeginPreparer,inspectQaMarginBeginTransaction,type QaPreparedMarginBegin} from '../execution/begin.js';
import type {PeridotCustomerChain,ConfirmedPeridotTransaction,CustomerSnapshot} from './chain.js';
import {invalid,unsigned} from './policy.js';
import type {MarginEvidence} from '../../../modules/margin/types.js';
export type KnownPrepared=QaPreparedVaultDeposit|QaPreparedMarginTransfer|QaPreparedMarginBegin;
export interface PhasePrepared {
 intent:PeridotStepIntent|QaAtomicCloseIntent|QaMarginReturnIntent|QaVaultWithdrawIntent;unsignedXdr:string;signingHashHex:string;
 expiresAt:string;feeStroops:string;networkPassphrase:typeof NETWORK_PASSPHRASE;expectedPositionId?:string;[key:string]:unknown;
}
export interface CustomerPhaseBinding {
 publicAction?(context:MarginStepContext,prepared:PhasePrepared,customer:CustomerContext):PreparedAction;
 quoteTerms?(workflow:MarginStepContext['workflow'],customer:CustomerContext):Promise<{terms:MarginStepContext['terms'];expires_at:string}>;
 prepare(context:MarginStepContext,customer:CustomerContext):Promise<PhasePrepared>;
 verify(prepared:PhasePrepared,signedXdr:string):Promise<void>;
 inspectHistorical(prepared:PhasePrepared,transaction:Transaction):void;
 /** Further phases must provide their own exact transaction-local principal/debt/phase extractor. */
 readEvidence?(context:MarginStepContext,baseline:PrivateMarginBaseline,confirmed:ConfirmedPeridotTransaction,after:CustomerSnapshot,customer:CustomerContext):Promise<MarginEvidence>;
}
export interface PrivateMarginBaseline {
 version:1;intentHash:string;workflowRevision:number;helper:PhasePrepared;
 before:Omit<CustomerSnapshot,'position'>&{position:unknown};
}
export type CustomerPhaseBindings=Partial<Record<MarginStep,CustomerPhaseBinding>>;
const transaction=(p:PhasePrepared)=>{const tx=TransactionBuilder.fromXDR(p.unsignedXdr,NETWORK_PASSPHRASE);if(!(tx instanceof Transaction))return invalid('PREPARED_ENVELOPE');return tx;};
/** Pure unsigned guard reuse. No QA key or signer is referenced by this customer integration. */
export function reviewedPhaseBindings(chain:PeridotCustomerChain):CustomerPhaseBindings {
 const deposit=new PeridotQaVaultDepositPreparer(chain.server,{allowInitialPinnedColdRestore:true},chain.now),transfer=new PeridotQaMarginTransferPreparer(chain.server,chain.now),begin=new PeridotQaMarginBeginPreparer(chain.server,chain.now);
 return{
  vault_deposit:{
   prepare:async(c,u)=>({...await deposit.prepare({step:'vault_deposit',walletAddress:u.walletAddress,underlyingAtomic:c.workflow.terms.collateralAtomic})}),
   verify:async(p,xdr)=>deposit.verifySigned(p as unknown as QaPreparedVaultDeposit,xdr),
   inspectHistorical:(p,tx)=>inspectQaVaultDepositTransaction(tx,(p as unknown as QaPreparedVaultDeposit).intent,p.expiresAt,{allowInitialPinnedColdRestore:true}),
  },
  margin_transfer:{
   prepare:async(c,u)=>({...await transfer.prepare({step:'margin_transfer',walletAddress:u.walletAddress,receiptAtomic:unsigned(c.workflow.receiptAtomic,true).toString()})}),
   verify:async(p,xdr)=>transfer.verifySigned(p as unknown as QaPreparedMarginTransfer,xdr),
   inspectHistorical:(p,tx)=>inspectQaMarginTransferTransaction(tx,(p as unknown as QaPreparedMarginTransfer).intent,p.expiresAt),
  },
  open_begin:{
   prepare:async(c,u)=>({...await begin.prepare({step:'open_begin',walletAddress:u.walletAddress,marginReceiptAtomic:unsigned(c.workflow.receiptAtomic,true).toString(),leverage:2,direction:'long',minimumOutputAtomic:unsigned(c.terms.minimumOutputAtomic,true).toString()})}),
   verify:async(p,xdr)=>begin.verifySigned(p as unknown as QaPreparedMarginBegin,xdr),
   inspectHistorical:(p,tx)=>inspectQaMarginBeginTransaction(tx,(p as unknown as QaPreparedMarginBegin).intent,unsigned(p.expectedPositionId,true).toString(),p.expiresAt),
  },
 };
}
export function inspectPreparedHelper(p:PhasePrepared,context:MarginStepContext,customer:CustomerContext):void {
 if(p.networkPassphrase!==NETWORK_PASSPHRASE||p.intent.walletAddress!==customer.walletAddress||p.intent.step!==context.step||p.signingHashHex!==transaction(p).hash().toString('hex')||transaction(p).source!==customer.walletAddress||transaction(p).fee!==p.feeStroops)return invalid('HELPER_BINDING');
 const owner={walletAddress:customer.walletAddress};let expected:PeridotStepIntent|QaAtomicCloseIntent|QaMarginReturnIntent|QaVaultWithdrawIntent;
 switch(context.step){
  case 'vault_deposit':expected={...owner,step:'vault_deposit',underlyingAtomic:context.workflow.terms.collateralAtomic};break;
  case 'margin_transfer':expected={...owner,step:'margin_transfer',receiptAtomic:unsigned(context.workflow.receiptAtomic,true).toString()};break;
  case 'margin_return':case 'vault_withdraw':expected={...owner,step:context.step,receiptAtomic:unsigned(context.workflow.receiptAtomic,true).toString(),repaidPositionId:unsigned(context.workflow.positionId,true).toString()};break;
  case 'open_begin':expected={...owner,step:'open_begin',marginReceiptAtomic:unsigned(context.workflow.receiptAtomic,true).toString(),leverage:2,direction:'long',minimumOutputAtomic:unsigned(context.terms.minimumOutputAtomic,true).toString()};break;
  case 'close_atomic':expected={...owner,step:'close_atomic',positionId:unsigned(context.workflow.positionId,true).toString(),minimumOutputAtomic:unsigned(context.terms.minimumOutputAtomic,true).toString()};break;
  case 'close_swap':expected={...owner,step:'close_swap',positionId:unsigned(context.workflow.positionId,true).toString(),minimumOutputAtomic:unsigned(context.terms.minimumOutputAtomic,true).toString()};break;
  case 'close_short_swap':expected={...owner,step:'close_short_swap',positionId:unsigned(context.workflow.positionId,true).toString(),maximumInputAtomic:unsigned(context.terms.maximumInputAtomic,true).toString(),minimumDebtOutputAtomic:unsigned(context.terms.minimumDebtOutputAtomic,true).toString()};break;
  default:expected={...owner,step:context.step as PeridotPositionStep,positionId:unsigned(context.workflow.positionId,true).toString()};
 }
 if(canonicalJson(p.intent)!==canonicalJson(expected))return invalid('HELPER_ECONOMIC_INTENT');
}
