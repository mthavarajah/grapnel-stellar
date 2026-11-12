/** Lead-owned internal execution contract. No HTTP route or financial permission is
 * created by these types. Customer approval and durable persistence precede send. */
export interface BoundPerpetualAccount {
 businessId:string;customerId:string;walletId:string;stellarAddress:string;
 accountAddress:`0x${string}`;signingKeyRef:string;
}
export interface ApprovedPerpetualIntent {
 operationId:string;businessId:string;customerId:string;walletId:string;
 network:'hyperliquid-testnet';accountAddress:`0x${string}`;
 marketId:string;providerSymbol:string;assetIndex:number;dex:string;
 side:'buy'|'sell';leverage:number;size:string;limitPrice:string;reduceOnly:boolean;
 nonce:number;clientOrderId:`0x${string}`;expiresAt:string;
 customerApprovalHash:string;
}
export interface SignedPerpetualAction {
 network:'hyperliquid-testnet';accountAddress:`0x${string}`;operationId:string;
 nonce:number;clientOrderId:`0x${string}`;intentHash:string;payload:unknown;
}
export interface PerpetualExecutionStatus {
 state:'unknown'|'open'|'filled'|'cancelled'|'rejected'|'no_fill';
 orderId:string|null;clientOrderId:string;filledSize:string;averagePrice:string|null;
 /** Actual provider fill hashes/IDs only; an order acknowledgement is not a fill. */
 fillIds:string[];rawStatus:string;
}
export interface PerpetualExecutionAdapter {
 prepare(intent:ApprovedPerpetualIntent,account:BoundPerpetualAccount):Promise<SignedPerpetualAction>;
 /** Caller must persist the exact signed payload and nonce before invoking send. */
 send(action:SignedPerpetualAction):Promise<PerpetualExecutionStatus>;
 reconcile(action:SignedPerpetualAction):Promise<PerpetualExecutionStatus>;
}
