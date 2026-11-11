import type {CustomerContext, PreparedAction} from '@grapnel/contracts';
import type {ReservationInput} from '../operations/service.js';

export const MARGIN_STEPS = ['vault_deposit','margin_transfer','open_begin','open_swap','open_activate','open_cancel','close_prepare','close_swap','close_short_swap','close_finish','close_cancel','margin_return','vault_withdraw'] as const;
export type MarginStep = typeof MARGIN_STEPS[number];
export const MARGIN_STEP_ACTIONS:Record<MarginStep,string>={vault_deposit:'margin.vault_deposit',vault_withdraw:'margin.vault_withdraw',margin_transfer:'margin.transfer',margin_return:'margin.return',open_begin:'margin.open_begin',open_swap:'margin.open_swap',open_activate:'margin.open_activate',open_cancel:'margin.open_cancel',close_prepare:'margin.close_prepare',close_swap:'margin.close_swap',close_short_swap:'margin.close_short_swap',close_finish:'margin.close_finish',close_cancel:'margin.close_cancel'};
export type MarginPhase = 'awaiting_collateral'|'awaiting_margin_transfer'|'awaiting_open_begin'|'opening_pending'|'opening_swapped'|'open'|'closing_prepared'|'closing_swapped'|'closed'|'awaiting_vault_withdraw'|'recovered';
export interface MarginTerms {
 network:'stellar-testnet'; provider:'peridot'; marketId:string; poolId:string;
 marginAssetId:string; baseAssetId:string; receiptAssetId:string;
 direction:'long'|'short'; leverage:2|3|4|5; collateralAtomic:string;
 slippageBps:number; maxFeeStroops:string; depositMaxFeeStroops:string;
 pinsHash:string; policyVersion:string;
}
export interface MarginWorkflow {
 id:string; businessId:string; customerId:string; walletId:string; walletAddress:string;
 terms:MarginTerms; termsHash:string; revision:number; phase:MarginPhase;
 /** Set only after verified begin result and matching independently read owner/phase. */
 positionId:string|null; receiptAtomic:string|null; activeOperationId:string|null;
 createdAt:string; updatedAt:string;
}
export interface MarginStepTerms {
 /** Exact minimum shown to and approved by the customer for this step. Provider must recheck fresh slippage/oracle bounds. */
 minimumOutputAtomic?:string; maximumInputAtomic?:string; minimumDebtOutputAtomic?:string;
}
export interface MarginChild {
 workflowId:string; businessId:string; customerId:string; walletId:string;
 operationId:string; step:MarginStep; attempt:number; terms:MarginStepTerms;
 intentHash:string; baseline:Record<string,unknown>; evidence:MarginEvidence|null;
}
export interface MarginPositionEvidence {
 positionId:string; owner:string; marketId:string; direction:'long'|'short';
 status:'PendingOpen'|'Open'|'Closing'|'Closed'; debtAtomic:string;
 swapOutputAtomic:string; pendingExpiresAt:string|null;
}
export interface MarginBalanceEvidence {
 /** marginReceiptAtomic is the independently verified unreserved controller receipt balance;
  * pending/open collateral must not be counted as free margin. */
 walletUnderlyingAtomic:string; walletReceiptAtomic:string; marginReceiptAtomic:string;
 position:MarginPositionEvidence|null;
}
/** Produced by a trusted chain adapter after SUCCESS + exact transaction metadata and independent state checks.
 * This is never accepted from an HTTP request or the browser. */
export interface MarginEvidence {
 network:'stellar-testnet'; chainStatus:'SUCCESS'; txHash:string; ledger:number;
 owner:string; step:MarginStep; intentHash:string; observedAt:string;
 before:MarginBalanceEvidence; after:MarginBalanceEvidence;
 /** Actual returned ID must also match the independently read PendingOpen record. */
 returnedPositionId?:string;
 /** True only after protocol-specific proof of cancelled reservations and removed pending record. */
 cancellationVerified?:boolean;
}
export interface MarginPreparation {
 prepared:PreparedAction; baseline:Record<string,unknown>;
 reservations:Omit<ReservationInput,'businessId'|'customerId'|'walletId'|'operationId'|'expiresAt'>[];
}
export interface MarginStepContext {workflow:MarginWorkflow; step:MarginStep; terms:MarginStepTerms; intentHash:string; operationId:string;}
export interface MarginAdapter {
 /** Validate exact pinned market/pool/assets plus server-approved collateral/leverage/slippage/fee policy. Never trust caller policy fields. */
 validateWorkflowTerms(terms:MarginTerms,customer:CustomerContext):Promise<void>;
 /** Fail closed until this exact deployed step has actual Testnet execution proof. Recheck policy/code/state on every prepare. */
 assertStepReady(context:MarginStepContext,customer:CustomerContext):Promise<void>;
 prepareStep(context:MarginStepContext,customer:CustomerContext):Promise<MarginPreparation>;
 /** Must verify exact stored transaction hash and baseline; current aggregate state alone is insufficient. */
 readConfirmedEvidence(context:MarginStepContext & {baseline:Record<string,unknown>;txHash:string},customer:CustomerContext):Promise<MarginEvidence>;
}
export interface MarginExecutionAdapter extends MarginAdapter {
 verifyStepForSubmission(context:MarginStepContext & {baseline:Record<string,unknown>;prepared:PreparedAction},signedXdr:string,customer:CustomerContext):Promise<void>;
}
