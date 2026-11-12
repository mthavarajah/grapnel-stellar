/** Lead-approved Robinhood Chain Testnet customer execution contract. */
import type {Hex} from 'viem';
import type {StockPreparedTransaction,createRobinhoodTransactionAdapter} from '../../adapters/robinhood/transactions.js';
import type {PerpetualScope} from '../perpetuals/workflow-contract.js';
export type StockExecutionScope=PerpetualScope;
export type StockExecutionProof=Awaited<ReturnType<ReturnType<typeof createRobinhoodTransactionAdapter>['reconcileTransaction']>>;
export interface StockExecutionTransaction {chainId:46630;type:'eip1559';to:Hex;data:Hex;value:'0';nonce:string;gas:string;maxFeePerGas:string;maxPriorityFeePerGas:string;}
export interface StockExecutionPrepared {id:string;marketId:string;side:'buy'|'sell';intent:StockPreparedTransaction;transaction:StockExecutionTransaction;signingHash:Hex;}
export interface StockExecutionRequest {id:string;scope:StockExecutionScope;accountAddress:Hex;kind:'approval'|'swap';marketId:string;side:'buy'|'sell';idempotencyKey:string;requestHash:string;state:'prepared'|'sending'|'confirming'|'completed'|'reverted'|'unknown'|'cancelled';prepared:StockExecutionPrepared;signedTransaction:Hex|null;txHash:Hex|null;proof:StockExecutionProof|null;createdAt:string;}
export interface StockExecutionStore {
 create(scope:StockExecutionScope,key:string,requestHash:string,prepared:StockExecutionPrepared):Promise<StockExecutionRequest>;
 get(scope:StockExecutionScope,id:string):Promise<StockExecutionRequest|null>;
 pending(scope:StockExecutionScope):Promise<StockExecutionRequest|null>;
 sign(scope:StockExecutionScope,id:string,raw:Hex):Promise<StockExecutionRequest>;
 claimSend(scope:StockExecutionScope,id:string):Promise<boolean>;
 proof(scope:StockExecutionScope,id:string,proof:StockExecutionProof):Promise<void>;
 markUncertain(scope:StockExecutionScope,id:string):Promise<void>;
}
