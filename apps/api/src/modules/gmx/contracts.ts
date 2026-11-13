import type {GmxPrepared,GmxCreationProof,GmxTokenProof,GmxExecutionResult,GmxRevertProof} from '../../adapters/gmx/contracts.js';
import type {PerpetualScope} from '../perpetuals/workflow-contract.js';
export type GmxScope=PerpetualScope;
export interface GmxRequest {
 id:string;idempotencyKey?:string;requestHash?:string;scope:GmxScope;accountAddress:`0x${string}`;kind:GmxPrepared['kind'];marketId:string;
 state:'prepared'|'sending'|'confirming'|'completed'|'cancelled'|'reverted'|'unknown';
 prepared:GmxPrepared;signedTransaction:`0x${string}`|null;txHash:`0x${string}`|null;
 creationProof:GmxCreationProof|GmxTokenProof|GmxRevertProof|null;settlement:GmxExecutionResult|null;
 createdAt:string;
}
export interface GmxRequestStore {
 create(scope:GmxScope,key:string,requestHash:string,prepared:GmxPrepared,marketId:string):Promise<GmxRequest>;
 get(scope:GmxScope,id:string):Promise<GmxRequest|null>;
 pending(scope:GmxScope):Promise<GmxRequest|null>;
 sign(scope:GmxScope,id:string,raw:`0x${string}`):Promise<GmxRequest>;
 claimSend(scope:GmxScope,id:string):Promise<boolean>;
 creation(scope:GmxScope,id:string,proof:GmxCreationProof|GmxTokenProof):Promise<void>;
 settlement(scope:GmxScope,id:string,proof:GmxExecutionResult):Promise<void>;
 reverted?(scope:GmxScope,id:string,proof:GmxRevertProof):Promise<void>;
 markUncertain(scope:GmxScope,id:string):Promise<void>;
}
