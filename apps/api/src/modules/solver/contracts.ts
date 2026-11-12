/** Lead-owned solver-settlement freeze v0.4.0. Real assets stay on each chain.
 * Provider proof is supplied by trusted readers, never request/body booleans. */
export type SolverScope={businessId:string;customerId:string;identityWalletId:string};
export type SolverFreighterProof={scheme:'stellar-sep53-v1';signer_address:string;signature_base64:string};
export type SolverChallenge={id:string;scope:SolverScope&{freighterAddress:string};purpose:'bind'|'order'|'withdraw';intentHash:string;message:string;nonce:string;expiresAt:string;origin:string;assetId:string};
export type SolverWallet=SolverScope&{id:string;freighterAddress:string;assetId:string;escrowAddress:string;masterAddress:`0x${string}`;subAccountAddress:`0x${string}`|null;createdAt:string};
export type SolverRequestKind='deposit'|'order'|'withdraw';
export type SolverRequestState='preparing'|'awaiting_approval'|'authorized'|'submitted'|'confirming'|'completed'|'failed'|'recovery_required'|'expired';
export type SolverDepositTerms={kind:'deposit';assetId:string;amountAtomic7:string;source:string;escrowAddress:string;memoHashHex:string};
export type SolverOrderTerms={kind:'order';marketId:string;providerSymbol:string;assetIndex:number;dex:''|'xyz';side:'buy'|'sell';size:string;limitPrice:string;leverage:number;reduceOnly:boolean};
export type SolverWithdrawalTerms={kind:'withdraw';assetId:string;amountAtomic7:string;recipient:string};
export type SolverTerms=SolverDepositTerms|SolverOrderTerms|SolverWithdrawalTerms;
export type SolverPreparedTransaction={id:string;intentHash:string;source:string;treasury:string;assetId:string;amountAtomic7:string;expiresAt:string;unsignedXdr:string;signingHashHex:string;memoHashHex:string;feeStroops:string};
export type SolverRequest=SolverScope&{id:string;walletId:string;kind:SolverRequestKind;module:'trade.perps'|'trade.stocks';idempotencyKey:string;requestHash:string;intentHash:string;terms:SolverTerms;state:SolverRequestState;challenge:SolverChallenge|null;prepared:SolverPreparedTransaction|null;signedXdr:string|null;txHash:string|null;proof:SolverFreighterProof|null;expiresAt:string;result:Record<string,unknown>|null;createdAt:string};
export type SolverPaymentProof={network:'stellar-testnet';txHash:string;ledger:number;source:string;destination:string;assetId:string;amountAtomic7:string;memoHashHex:string;feeStroops:string;observedAt:string};
export type SolverSubaccountProof={network:'hyperliquid-testnet';masterAddress:`0x${string}`;subAccountAddress:`0x${string}`;name:string;observedAt:string};
export type SolverCashProof={network:'hyperliquid-testnet';actionId:string;masterAddress:`0x${string}`;subAccountAddress:`0x${string}`;direction:'fund'|'return';amountAtomic6:string;masterBefore:string;masterAfter:string;subaccountBefore:string;subaccountAfter:string;observedAt:string;providerReference:string};
export type SolverProviderAction=SolverScope&{id:string;requestId:string;kind:'create_subaccount'|'fund'|'order'|'return';masterAddress:`0x${string}`;subAccountAddress:`0x${string}`|null;nonce:number;clientOrderId:string|null;intentHash:string;payload:unknown;state:'prepared'|'sending'|'unknown'|'verified'|'failed';result:Record<string,unknown>|null;createdAt:string};
export interface SolverRepository{
 challenge(value:SolverChallenge):Promise<void>;
 challengeById(scope:SolverScope,id:string):Promise<SolverChallenge|null>;
 bindWallet(value:SolverWallet,challengeId:string,proof:SolverFreighterProof):Promise<SolverWallet>;
 wallet(scope:SolverScope):Promise<SolverWallet|null>;
 assignSubaccount(scope:SolverScope,walletId:string,proof:SolverSubaccountProof):Promise<void>;
 createRequest(value:SolverRequest):Promise<SolverRequest>;
 request(scope:SolverScope,id:string):Promise<SolverRequest|null>;
 pendingRequest(scope:SolverScope):Promise<SolverRequest|null>;
 setPrepared(scope:SolverScope,id:string,value:SolverPreparedTransaction):Promise<void>;
 authorizeDeposit(scope:SolverScope,id:string,signedXdr:string,txHash:string):Promise<void>;
 authorizeMessage(scope:SolverScope,id:string,proof:SolverFreighterProof):Promise<void>;
 claimStellarSend(scope:SolverScope,id:string,txHash:string):Promise<boolean>;
 confirmDeposit(scope:SolverScope,id:string,proof:SolverPaymentProof):Promise<void>;
 reserveMasterCapacity(scope:SolverScope,id:string,amountAtomic6:string,availableAtomic6:string,observedAt:string):Promise<void>;
 releaseMasterCapacity(scope:SolverScope,id:string):Promise<void>;
 /** Master nonce namespace is global across all solver customers and action kinds. */
 reserveProviderAction(value:Omit<SolverProviderAction,'nonce'>):Promise<SolverProviderAction>;
 providerAction(scope:SolverScope,id:string):Promise<SolverProviderAction|null>;
 saveProviderPayload(scope:SolverScope,id:string,payload:unknown):Promise<void>;
 claimProviderSend(scope:SolverScope,id:string,payloadHash:string):Promise<boolean>;
 recordProviderResult(scope:SolverScope,id:string,state:'unknown'|'verified'|'failed',result:Record<string,unknown>):Promise<void>;
 confirmFunding(scope:SolverScope,requestId:string,proof:SolverCashProof):Promise<void>;
 reserveWithdrawal(scope:SolverScope,id:string,availableAtomic7:string,treasuryAvailableAtomic7:string):Promise<void>;
 confirmReturn(scope:SolverScope,requestId:string,proof:SolverCashProof):Promise<void>;
 payoutAuthorized(scope:SolverScope,id:string):Promise<boolean>;
 preparePayout(scope:SolverScope,id:string,value:SolverPreparedTransaction,signedXdr:string,txHash:string):Promise<void>;
 confirmPayout(scope:SolverScope,id:string,proof:SolverPaymentProof):Promise<void>;
 availableCreditAtomic7(scope:SolverScope):Promise<string>;
 saveResult(scope:SolverScope,id:string,state:SolverRequestState,result:Record<string,unknown>):Promise<void>;
}
