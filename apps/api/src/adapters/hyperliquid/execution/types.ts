import type{AbstractViemLocalAccount}from'@nktkas/hyperliquid/signing';
import type{ApprovedPerpetualIntent,BoundPerpetualAccount,SignedPerpetualAction}from'../../../modules/perpetuals/execution-contract.js';
export const HL_INFO='https://api.hyperliquid-testnet.xyz/info' as const;
export const HL_EXCHANGE='https://api.hyperliquid-testnet.xyz/exchange' as const;
export const HL_RPC='https://rpc.hyperliquid-testnet.xyz/evm' as const;
export interface ReadReceipt {endpoint:string;request:unknown;receivedAt:number;body:unknown;}
/** No default transport exists. Production transport and eligibility require lead review. */
export interface ExecutionTransport{
 rpc(endpoint:typeof HL_RPC,request:{jsonrpc:'2.0';id:1;method:'eth_chainId';params:[]}):Promise<ReadReceipt>;
 info(endpoint:typeof HL_INFO,request:Record<string,unknown>):Promise<ReadReceipt>;
 exchange(endpoint:typeof HL_EXCHANGE,body:unknown):Promise<unknown>;
}
export interface ExecutionDurability{
 /** Atomic uniqueness across account+nonce, account+cloid, and operation. No signing retry generates a nonce. */
 reserveIntent(intent:ApprovedPerpetualIntent,account:BoundPerpetualAccount,intentHash:string):Promise<boolean>;
 /** Caller persists the entire exact artifact before send. Lookup must enforce configured tenant/customer/wallet. */
 loadPrepared(operationId:string,intentHash:string):Promise<SignedPerpetualAction|null>;
 /** Atomic, durable compare-and-set BEFORE exchange call; false means reconcile only forever. */
 claimSend(operationId:string,intentHash:string,payloadHash:string):Promise<boolean>;
}
export interface HyperliquidExecutionDependencies{
 scope:BoundPerpetualAccount;
 transport:ExecutionTransport;
 durability:ExecutionDurability;
 /** Trusted exact-approval verifier, never a browser/body boolean or business API-key authorization. */
 verifyCustomerApproval?(intent:ApprovedPerpetualIntent,account:BoundPerpetualAccount):Promise<boolean>;
 /** Root verifies eligible Testnet account, attributable actual funding and provider execution proof. */
 verifyAccountExecutionProof?(account:BoundPerpetualAccount):Promise<boolean>;
 /** Lead-owned verified source category, not a browser label or symbol heuristic. Required only for stocks aliases. */
 verifyStockMarketCategory?(market:MarketIdentity):Promise<{network:'hyperliquid-testnet';assetIndex:number;providerSymbol:string;dex:string;category:'equity'|'index';observedAt:number}|null>;
 resolveSigner(keyRef:string):Promise<AbstractViemLocalAccount>;
 now?:()=>number;
}
export interface MarketIdentity {symbol:string;assetIndex:number;localAssetIndex:number;dex:string;dexIndex:number;szDecimals:number;maxLeverage:number;}
export interface PositionBaseline {size:string;leverageType:'cross'|'isolated';observedAt:number;}
