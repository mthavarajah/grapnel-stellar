/** Unsigned HyperCore → HyperEVM → Stellar return. No signer or financial write transport. */
import {Contract,StrKey,xdr} from '@stellar/stellar-sdk';
import {fromAtomic,type CustomerContext} from '@grapnel/contracts';
import {encodeFunctionData,hashTypedData,parseAbi,type Hex} from 'viem';
import {CCTP_TESTNET as P} from './registry.js';
import {stellarAccountForwarding,evmRecipientBytes32,cctpAtomicToStellar} from './encoding.js';
import {readEvmRegistry} from './reader.js';
import type {CctpRecipientBinding} from './inspector.js';
import {CCTP_EVM_ABI,assertCanonicalCctpMessage,assertCctpBinding,boundedCctpAmount,cctpQuantity,cctpStageFail,createCctpEvmReadTransport,normalizeEvm,prepareUnsignedCctpEvmCall,stellarPayload,type CctpEvmRequest,type CctpEligibility,type CctpEvmReadTransport,type CctpV2Message,type CctpAttestation,type UnsignedCctpEvmAction} from './destination.js';
export const CCTP_RETURN_ABI=parseAbi(['function depositForBurnWithHook(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,uint256 maxFee,uint32 minFinalityThreshold,bytes hookData)']);
export const HYPERCORE_USDC_SYSTEM='0x2000000000000000000000000000000000000000';
export const SEND_ASSET_TYPES={'HyperliquidTransaction:SendAsset':[
 {name:'hyperliquidChain',type:'string'},{name:'destination',type:'string'},{name:'sourceDex',type:'string'},{name:'destinationDex',type:'string'},{name:'token',type:'string'},{name:'amount',type:'string'},{name:'fromSubAccount',type:'string'},{name:'nonce',type:'uint64'},
]} as const;
export interface CctpCoreWithdrawalRequest {operationId:string;customer:CustomerContext;evmAccount:string;amountCctpAtomic:string;expiresAt:string;nonce:number;}
export interface CctpCoreWithdrawable {businessId:string;customerId:string;walletId:string;account:string;network:'hyperliquid-testnet';withdrawableCctpAtomic:string;openPositions:number;openOrders:number;asOf:string;}
export interface UnsignedCctpCoreWithdrawal {
 operationId:string;businessId:string;customerId:string;walletId:string;stellarWallet:string;evmAccount:string;network:'hyperliquid-testnet';expiresAt:string;
 action:{type:'sendAsset';hyperliquidChain:'Testnet';signatureChainId:'0x3e6';destination:typeof HYPERCORE_USDC_SYSTEM;sourceDex:'';destinationDex:'spot';token:'USDC';amount:string;fromSubAccount:'';nonce:number;};
 typedData:{domain:{name:'HyperliquidSignTransaction';version:'1';chainId:998;verifyingContract:'0x0000000000000000000000000000000000000000'};types:typeof SEND_ASSET_TYPES;primaryType:'HyperliquidTransaction:SendAsset';message:{hyperliquidChain:'Testnet';destination:string;sourceDex:'';destinationDex:'spot';token:'USDC';amount:string;fromSubAccount:'';nonce:bigint;}};
 signingHash:Hex;
 /** The provider's signed schema has no expiry; this is an application review expiry, not an onchain deadline. */
 expiryEnforcement:'application_only';
}
export function prepareUnsignedCoreWithdrawal(r:CctpCoreWithdrawalRequest,binding:CctpRecipientBinding|null,eligibility:CctpEligibility|null,available:CctpCoreWithdrawable,now=Date.now()):UnsignedCctpCoreWithdrawal {
 assertCctpBinding(r,binding,eligibility,now);const c=r.customer,amount=boundedCctpAmount(r.amountCctpAtomic),age=now-Date.parse(available?.asOf??'');
 if(!Number.isSafeInteger(r.nonce)||r.nonce<now-5000||r.nonce>now+5000)return cctpStageFail('CCTP_RETURN_NONCE_INVALID');
 if(!available||available.businessId!==c.businessId||available.customerId!==c.customerId||available.walletId!==c.walletId||normalizeEvm(available.account)!==normalizeEvm(r.evmAccount)||available.network!=='hyperliquid-testnet'||!Number.isFinite(age)||age<0||age>15000||available.openPositions!==0||available.openOrders!==0||!/^\d{1,20}$/.test(available.withdrawableCctpAtomic)||BigInt(available.withdrawableCctpAtomic)<amount)return cctpStageFail('CCTP_RETURN_AVAILABLE_COLLATERAL_REQUIRED');
 const human=fromAtomic(amount,6),action:UnsignedCctpCoreWithdrawal['action']={type:'sendAsset',hyperliquidChain:'Testnet',signatureChainId:'0x3e6',destination:HYPERCORE_USDC_SYSTEM,sourceDex:'',destinationDex:'spot',token:'USDC',amount:human,fromSubAccount:'',nonce:r.nonce};
 const typedData:UnsignedCctpCoreWithdrawal['typedData']={domain:{name:'HyperliquidSignTransaction',version:'1',chainId:998,verifyingContract:'0x0000000000000000000000000000000000000000'},types:SEND_ASSET_TYPES,primaryType:'HyperliquidTransaction:SendAsset',message:{hyperliquidChain:action.hyperliquidChain,destination:action.destination,sourceDex:'',destinationDex:'spot',token:'USDC',amount:human,fromSubAccount:'',nonce:BigInt(r.nonce)}};
 return{operationId:r.operationId,businessId:c.businessId,customerId:c.customerId,walletId:c.walletId,stellarWallet:c.walletAddress,evmAccount:normalizeEvm(r.evmAccount),network:'hyperliquid-testnet',expiresAt:r.expiresAt,action,typedData,signingHash:hashTypedData(typedData),expiryEnforcement:'application_only'};
}
const canonical=(value:unknown):string=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v);
export function inspectUnsignedCoreWithdrawal(value:UnsignedCctpCoreWithdrawal,r:CctpCoreWithdrawalRequest,binding:CctpRecipientBinding|null,eligibility:CctpEligibility|null,available:CctpCoreWithdrawable,now=Date.now()):void {
 const expected=prepareUnsignedCoreWithdrawal(r,binding,eligibility,available,now);if(canonical(value)!==canonical(expected))return cctpStageFail('CCTP_RETURN_TYPED_DATA_MISMATCH');
}
/** Trusted server verifier must match the actual sendAsset ledger entry AND native USDC credit. An exchange OK is insufficient. */
export interface CctpCoreWithdrawalProof {operationId:string;businessId:string;customerId:string;walletId:string;account:string;network:'hyperliquid-testnet';nonce:number;ledgerHash:Hex;amountCctpAtomic:string;balanceBeforeAtomic:string;balanceAfterAtomic:string;destinationBlock:string;confirmed:true;}
export interface CctpReturnDependencies {
 transport?:CctpEvmReadTransport;fetcher?:typeof fetch;now?:()=>number;verifyRegistry?:()=>Promise<unknown>;
 readBinding:(customer:CustomerContext)=>Promise<CctpRecipientBinding|null>;
 readEligibility:(customer:CustomerContext)=>Promise<CctpEligibility|null>;
 readWithdrawalProof:(request:CctpEvmRequest)=>Promise<CctpCoreWithdrawalProof|null>;
 /** Root's fresh canonical Circle trustline read, tenant bound, must cover the full return amount. */
 readStellarReceiveCapacity:(customer:CustomerContext)=>Promise<{businessId:string;customerId:string;walletId:string;walletAddress:string;issuer:string;contractId:string;authorized:boolean;capacityStellarAtomic:string;asOf:string}>;
}
export function buildCctpReturnBurnData(amount:bigint,stellarWallet:string):Hex {
 if(!StrKey.isValidEd25519PublicKey(stellarWallet))return cctpStageFail('CCTP_RETURN_STELLAR_RECIPIENT_INVALID');boundedCctpAmount(amount.toString());const forward=stellarAccountForwarding(stellarWallet);
 return encodeFunctionData({abi:CCTP_RETURN_ABI,functionName:'depositForBurnWithHook',args:[amount,27,forward.mintRecipient,P.hyperEvm.usdc,forward.destinationCaller,0n,2000,forward.hookData]});
}
export class CctpReturnPreparer {
 private transport:CctpEvmReadTransport;private now:()=>number;
 constructor(private deps:CctpReturnDependencies){this.transport=deps.transport??createCctpEvmReadTransport(deps.fetcher);this.now=deps.now??Date.now;}
 private async guard(r:CctpEvmRequest){const[b,e]=await Promise.all([this.deps.readBinding(r.customer),this.deps.readEligibility(r.customer)]);assertCctpBinding(r,b,e,this.now());await(this.deps.verifyRegistry??(()=>readEvmRegistry(this.deps.fetcher)))();const p=await this.deps.readWithdrawalProof(r),c=r.customer;
  if(!p||p.confirmed!==true||p.operationId!==r.operationId||p.businessId!==c.businessId||p.customerId!==c.customerId||p.walletId!==c.walletId||normalizeEvm(p.account)!==normalizeEvm(r.evmAccount)||p.network!=='hyperliquid-testnet'||p.amountCctpAtomic!==r.amountCctpAtomic||!/^0x[0-9a-f]{64}$/i.test(p.ledgerHash)||!/^\d{1,20}$/.test(p.balanceBeforeAtomic)||!/^\d{1,20}$/.test(p.balanceAfterAtomic)||BigInt(p.balanceAfterAtomic)-BigInt(p.balanceBeforeAtomic)<boundedCctpAmount(r.amountCctpAtomic)||!/^\d{1,20}$/.test(p.destinationBlock)||!Number.isSafeInteger(p.nonce)||p.nonce<=0)return cctpStageFail('CCTP_CONFIRMED_HYPEREVM_WITHDRAWAL_REQUIRED');
  const s=await this.deps.readStellarReceiveCapacity(c),age=this.now()-Date.parse(s?.asOf??'');
  if(!s||s.businessId!==c.businessId||s.customerId!==c.customerId||s.walletId!==c.walletId||s.walletAddress!==c.walletAddress||s.issuer!==P.stellar.issuer||s.contractId!==P.stellar.usdc||s.authorized!==true||!Number.isFinite(age)||age<0||age>15000||!/^\d{1,20}$/.test(s.capacityStellarAtomic)||BigInt(s.capacityStellarAtomic)<cctpAtomicToStellar(boundedCctpAmount(r.amountCctpAtomic)))return cctpStageFail('CCTP_RETURN_CANONICAL_TRUSTLINE_CAPACITY_REQUIRED');
  const balance=await this.transport.request('eth_call',[{to:P.hyperEvm.usdc,data:encodeFunctionData({abi:CCTP_EVM_ABI,functionName:'balanceOf',args:[normalizeEvm(r.evmAccount)]})},'latest']);if(cctpQuantity(balance)<boundedCctpAmount(r.amountCctpAtomic))return cctpStageFail('CCTP_RETURN_NATIVE_USDC_BALANCE_REQUIRED');return p;
 }
 async prepareReturnApproval(r:CctpEvmRequest):Promise<UnsignedCctpEvmAction>{await this.guard(r);return prepareUnsignedCctpEvmCall({request:r,step:'return.approve',to:P.hyperEvm.usdc,data:encodeFunctionData({abi:CCTP_EVM_ABI,functionName:'approve',args:[P.hyperEvm.messenger,boundedCctpAmount(r.amountCctpAtomic)]})},this.transport,this.now);}
 async prepareReturnBurn(r:CctpEvmRequest):Promise<UnsignedCctpEvmAction>{await this.guard(r);const allowance=await this.transport.request('eth_call',[{to:P.hyperEvm.usdc,data:encodeFunctionData({abi:CCTP_EVM_ABI,functionName:'allowance',args:[normalizeEvm(r.evmAccount),P.hyperEvm.messenger]})},'latest']);if(cctpQuantity(allowance)!==boundedCctpAmount(r.amountCctpAtomic))return cctpStageFail('CCTP_RETURN_EXACT_ALLOWANCE_REQUIRED');return prepareUnsignedCctpEvmCall({request:r,step:'return.burn',to:P.hyperEvm.messenger,data:buildCctpReturnBurnData(boundedCctpAmount(r.amountCctpAtomic),r.customer.walletAddress)},this.transport,this.now);}
}
export function inspectEvmToStellarMessage(message:CctpV2Message,request:CctpEvmRequest):void {
 assertCanonicalCctpMessage(message);const forward=stellarAccountForwarding(request.customer.walletAddress);
 if(message.sourceDomain!==19||message.destinationDomain!==27||/^0x0{64}$/.test(message.nonce)||message.sender!==evmRecipientBytes32(P.hyperEvm.messenger)||message.recipient!==stellarPayload(P.stellar.messenger,true)||message.destinationCaller!==forward.destinationCaller||message.minFinality!==2000||message.executedFinality<2000||message.burnToken!==evmRecipientBytes32(P.hyperEvm.usdc)||message.mintRecipient!==forward.mintRecipient||message.amount!==boundedCctpAmount(request.amountCctpAtomic)||message.messageSender!==evmRecipientBytes32(request.evmAccount)||message.maxFee!==0n||message.executedFee!==0n||message.hookData!==forward.hookData)return cctpStageFail('CCTP_RETURN_ATTESTED_INTENT_MISMATCH');
}
/** ABI-proven invocation only. Deliberately NOT PreparedAction: root must add actual fresh record/enforce auth/footprint/fee checks. */
export function buildStellarMintAndForwardOperation(attestation:CctpAttestation,request:CctpEvmRequest):xdr.Operation {
 if(!/^0x[0-9a-f]{64}$/i.test(attestation.sourceTxHash)||!/^0x(?:[0-9a-f]{130}){1,20}$/i.test(attestation.attestation))return cctpStageFail('CCTP_RETURN_ATTESTATION_INVALID');inspectEvmToStellarMessage(attestation.message,request);
 return new Contract(P.stellar.forwarder).call('mint_and_forward',xdr.ScVal.scvBytes(Buffer.from(attestation.message.hex.slice(2),'hex')),xdr.ScVal.scvBytes(Buffer.from(attestation.attestation.slice(2),'hex')));
}
export const CCTP_RETURN_UNPROVEN_STAGE=Object.freeze({stage:'stellar.mint_and_forward',execution_status:'blocked',reason:'CCTP_RETURN_ACTUAL_ATTESTATION_AND_SOROBAN_FOOTPRINT_REQUIRED',tx_hash:null});
