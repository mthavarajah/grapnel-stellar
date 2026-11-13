import type { Hex } from 'viem';
export type GmxSymbol = 'ETH' | 'BTC' | 'CRV' | 'XAU' | 'XAG' | 'XPT';
export interface GmxReadTransport {
    request(method: string, params: unknown[]): Promise<unknown>;
}
export interface GmxPosition {
    account: Hex;
    market: Hex;
    collateralToken: Hex;
    isLong: boolean;
    sizeUsd30: string;
    sizeTokens: string;
    collateralAtomic6: string; pendingImpactAmount?:string;
    key: Hex;
}
export interface GmxStatus {
    nativeWei: string;
    collateralAtomic6: string;
    allowanceAtomic6: string;
    blockNumber: string;
    observedAt: string;
}
export interface GmxBaseIntent {
    id: string;
    account: Hex;
    expiresAt: string;
}
export interface GmxTokenIntent extends GmxBaseIntent {
    amountAtomic6: string;
}
export interface GmxTradeIntent extends GmxBaseIntent {
    symbol: GmxSymbol;
    isLong: boolean;
    executionFeeWei: string;
    slippageBps: number;
}
export interface GmxOpenIntent extends GmxTradeIntent {
    collateralAtomic6: string;
    sizeUsd30: string;
}
export interface GmxPrepared {
    id: string;
    network: 'arbitrum-sepolia';
    kind: 'mint' | 'approve' | 'open' | 'close';
    account: Hex;
    expiresAt: string;
    signingHash: Hex;
    transaction: {
        chainId: 421614;
        type: 'eip1559';
        to: Hex;
        data: Hex;
        value: bigint;
        nonce: number;
        gas: bigint;
        maxFeePerGas: bigint;
        maxPriorityFeePerGas: bigint;
    };
    intent: {
        amountAtomic6?: string;
        symbol?: GmxSymbol;
        market?: Hex;
        isLong?: boolean;
        collateralAtomic6?: string;
        sizeUsd30?: string;
        acceptablePrice?: string;
        executionFeeWei?: string;
        slippageBps?: number;
        quoteMinPrice30?: string;
        quoteMaxPrice30?: string;
        quoteObservedAt?: string;
        indexDecimals?: number;executionPrice?:string;priceImpactUsd?:string;priceImpactDiffUsd?:string;totalImpactUsd?:string;proportionalPendingImpactUsd?:string;executionQuoteBlock?:string;executionQuoteSource?:'gmx_reader_getExecutionPrice';
    };
    baseline: {
        status: GmxStatus;
        positions: GmxPosition[];
    };
}
export interface GmxCreationProof {
    network: 'arbitrum-sepolia';
    account: Hex;
    creationTxHash: Hex;
    creationBlock: string;
    orderKey: Hex;
    kind: 'open' | 'close';
}
export interface GmxTokenProof {
    network: 'arbitrum-sepolia';
    account: Hex;
    txHash: Hex;
    blockNumber: string;
    kind: 'mint' | 'approve';
    amountAtomic6: string;
    proof_basis?: 'canonical_token_event';
    balanceDeltaAtomic6?: string;
    allowanceAtomic6?: string;
    beforeAtomic6?: string;
    afterAtomic6?: string;
    confirmed: true;
}
export type GmxExecutionResult = {
    state: 'pending';
    scannedToBlock: string;
} | {
    state: 'cancelled';
    orderKey: Hex;
    executionTxHash: Hex;
    reason: string;
} | {
    state: 'executed';
    execution_status: 'testnet_verified';
    orderKey: Hex;
    creationTxHash: Hex;
    executionTxHash: Hex;
    positionBefore: GmxPosition | null;
    positionAfter: GmxPosition | null;
    collateralBalanceAtomic6: string;
    event: Record<string, unknown>;
};

/** Actual canonical failed receipt, never a local exception or submission timeout. */
export interface GmxRevertProof {network:'arbitrum-sepolia';account:Hex;txHash:Hex;blockNumber:string;kind:GmxPrepared['kind'];reverted:true;confirmed:true;}
