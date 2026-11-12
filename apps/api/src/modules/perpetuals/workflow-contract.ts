/** Lead freeze v0.3.1. Customer EVM signatures stay in the browser; no server
 * key export, shared relayer balances, or business-key spend authority. */
import type {ApprovedPerpetualIntent,BoundPerpetualAccount,SignedPerpetualAction,PerpetualExecutionStatus} from './execution-contract.js';
export interface PerpetualScope {businessId:string;customerId:string;walletId:string;stellarAddress:string;}
export interface PerpetualAccount extends BoundPerpetualAccount {id:string;createdAt:string;}
export interface PerpetualChallenge {id:string;scope:PerpetualScope;accountAddress:`0x${string}`;message:string;digest:string;expiresAt:string;}
export interface PendingPerpetualOrder {
 id:string;scope:PerpetualScope;accountId:string;idempotencyKey:string;requestHash:string;
 intent:ApprovedPerpetualIntent;approvalMessage:string;approvalDigest:string;
 unsignedAction:unknown|null;signedAction:SignedPerpetualAction|null;payloadHash:string|null;
 state:'preparing'|'awaiting_approval'|'approved'|'sending'|'unknown'|'filled'|'cancelled'|'rejected'|'no_fill'|'expired';
 result:PerpetualExecutionStatus|null;createdAt:string;
}
export interface PerpetualWorkflowStore {
 challenge(value:PerpetualChallenge):Promise<void>;
 getChallenge(scope:PerpetualScope,id:string):Promise<PerpetualChallenge|null>;
 /** Atomic single-use challenge consumption + global account segregation. */
 bind(scope:PerpetualScope,challengeId:string,account:PerpetualAccount):Promise<PerpetualAccount>;
 account(scope:PerpetualScope):Promise<PerpetualAccount|null>;
 createOrder(order:PendingPerpetualOrder):Promise<PendingPerpetualOrder>;
 order(scope:PerpetualScope,id:string):Promise<PendingPerpetualOrder|null>;
 saveUnsigned(scope:PerpetualScope,id:string,unsigned:unknown):Promise<void>;
 /** Stores exact immutable signature artifact before any send claim. */
 saveSigned(scope:PerpetualScope,id:string,action:SignedPerpetualAction,payloadHash:string):Promise<void>;
 reserveIntent(scope:PerpetualScope,intent:ApprovedPerpetualIntent,account:BoundPerpetualAccount,intentHash:string):Promise<boolean>;
 loadPrepared(scope:PerpetualScope,id:string,intentHash:string):Promise<SignedPerpetualAction|null>;
 claimSend(scope:PerpetualScope,id:string,intentHash:string,payloadHash:string):Promise<boolean>;
 saveResult(scope:PerpetualScope,id:string,result:PerpetualExecutionStatus):Promise<void>;
}
