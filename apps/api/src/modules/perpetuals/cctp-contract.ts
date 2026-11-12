/** Lead freeze: actual Privy-signed CCTP, never solver/mirrored credits. */
import type {PreparedAction} from '@grapnel/contracts';
import type {UnsignedCctpEvmAction,CctpSourceBurnProof,CctpDestinationMintProof,CctpCoreDepositTransferProof} from '../../adapters/cctp/destination.js';
import type {PerpetualScope} from './workflow-contract.js';
export type CctpFundingStep='cctp.receive'|'core.approve'|'core.deposit';
export interface CctpFundingRecord {
 id:string;scope:PerpetualScope;accountId:string;accountAddress:`0x${string}`;amountAtomic7:string;
 state:'awaiting_source'|'source_pending'|'attesting'|'destination_pending'|'core_pending'|'completed'|'recovery_required';
 source:PreparedAction;sourceTxHash:string|null;sourceProof:CctpSourceBurnProof|null;
 messageHex:`0x${string}`|null;attestationHex:`0x${string}`|null;mintProof:CctpDestinationMintProof|null;
 depositProof:CctpCoreDepositTransferProof|null;coreProof:Record<string,unknown>|null;
 createdAt:string;
}
export interface CctpStageRecord {
 id:string;fundingId:string;step:CctpFundingStep;action:UnsignedCctpEvmAction;
 signedTransaction:`0x${string}`|null;txHash:`0x${string}`|null;
 state:'prepared'|'signed'|'sending'|'unknown'|'confirmed'|'reverted';proof:Record<string,unknown>|null;
}
export interface CctpFundingStore {
 /** Called in the source operation transaction; exact FK scope and source required. */
 create(client:import('pg').PoolClient,record:CctpFundingRecord):Promise<void>;
 get(scope:PerpetualScope,id:string):Promise<CctpFundingRecord|null>;
 pending(scope:PerpetualScope):Promise<CctpFundingRecord|null>;
 /** Trusted service supplies independently verified chain proof only; immutable once recorded. */
 saveProof(scope:PerpetualScope,id:string,patch:Partial<Pick<CctpFundingRecord,'state'|'sourceTxHash'|'sourceProof'|'messageHex'|'attestationHex'|'mintProof'|'depositProof'|'coreProof'>>):Promise<void>;
 stages(scope:PerpetualScope,id:string):Promise<CctpStageRecord[]>;
 prepareStage(scope:PerpetualScope,id:string,action:UnsignedCctpEvmAction):Promise<CctpStageRecord>;
 /** Recover signer and exact EIP1559 body before durable immutable storage; globally reserve account+nonce. */
 signStage(scope:PerpetualScope,id:string,stageId:string,signed:`0x${string}`):Promise<CctpStageRecord>;
 claimSend(scope:PerpetualScope,id:string,stageId:string):Promise<boolean>;
 stageResult(scope:PerpetualScope,id:string,stageId:string,state:'unknown'|'confirmed'|'reverted',proof:Record<string,unknown>|null):Promise<void>;
}
