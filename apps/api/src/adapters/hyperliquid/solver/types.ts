import type {AbstractViemLocalAccount} from '@nktkas/hyperliquid/signing';
import type {SolverWallet,SolverRequest,SolverProviderAction,SolverRepository,SolverPaymentProof,SolverSubaccountProof,SolverCashProof} from '../../../modules/solver/contracts.js';
import type {ExecutionTransport,MarketIdentity,PositionBaseline} from '../execution/types.js';
import type {PerpetualExecutionStatus} from '../../../modules/perpetuals/execution-contract.js';
export type SolverActionKind=SolverProviderAction['kind'];
export interface SolverSnapshot {accountValue:string;cashBalance:string;withdrawable:string;positions:{coin:string;size:string;leverage:number;leverageType:'cross'|'isolated'}[];time:number;}
export interface SolverWire {action:Record<string,unknown>;nonce:number;expiresAfter:number;vaultAddress?:`0x${string}`;signature:{r:`0x${string}`;s:`0x${string}`;v:27|28};}
export interface SolverSignedPayload {
 version:1;request:SolverRequest;wallet:SolverWallet;wire:SolverWire;
 before:{master:SolverSnapshot;subaccount:SolverSnapshot|null};
 market:MarketIdentity|null;position:PositionBaseline|null;amountAtomic6:string|null;subaccountName:string;
}
export interface SolverReconciliation {
 state:'unknown'|'verified'|'failed';reason:string;
 subaccount?:SolverSubaccountProof;cash?:SolverCashProof;order?:PerpetualExecutionStatus;
}
export interface HyperliquidSolverDependencies {
 scope:SolverWallet;signingKeyRef:string;transport:ExecutionTransport;
 repository:Pick<SolverRepository,'reserveProviderAction'|'providerAction'|'saveProviderPayload'|'claimProviderSend'>;
 /** Current server-owned authorization/policy records. Never browser/body booleans. */
 verifyRequestApproval?:(request:SolverRequest,wallet:SolverWallet,stage:SolverActionKind)=>Promise<boolean>;
 /** Actual current source payment receipt, not an SQL-only credit. Required before funding. */
 readSourceDeposit?:(request:SolverRequest,wallet:SolverWallet)=>Promise<SolverPaymentProof|null>;
 /** Operator access decision plus source-backed capacity checks. Missing fails closed. */
 verifyAccessAndCapacity?:(wallet:SolverWallet,stage:SolverActionKind)=>Promise<boolean>;
 resolveSigner?:(keyRef:string)=>Promise<AbstractViemLocalAccount>;
 now?:()=>number;
}
export type {SolverProviderAction,SolverRequest,SolverWallet};
