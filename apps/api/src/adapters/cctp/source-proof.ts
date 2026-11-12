/** Actual confirmed Stellar source evidence. No signatures, simulation or broadcasting. */
import {rpc,Transaction,TransactionBuilder,StrKey,xdr} from '@stellar/stellar-sdk';
import type {PreparedAction} from '@grapnel/contracts';
import type {Hex} from 'viem';
import {CCTP_TESTNET as P} from './registry.js';
import {readStellarRegistry} from './reader.js';
import {cctpBurnIntent,inspectPreparedCctpBurn,type CctpBurnRequest} from './inspector.js';
import {boundedCctpAmount,cctpStageFail,decodeCctpV2Message,normalizeEvm,stellarPayload,CCTP_ZERO32,type CctpEvmRequest,type CctpSourceBurnProof} from './destination.js';
import {evmRecipientBytes32} from './encoding.js';
export interface PersistedCctpSource {request:CctpBurnRequest;prepared:PreparedAction;}
export interface CctpSourceProofDependencies {
 server?:Pick<rpc.Server,'getNetwork'|'getTransaction'>;now?:()=>number;verifyRegistry?:()=>Promise<unknown>;
 /** Must load the immutable approved operation through the full tenant/customer/wallet scope. */
 readPreparedBurn:(request:CctpEvmRequest,sourceHash:string)=>Promise<PersistedCctpSource|null>;
}
/** Source relay message has zero nonce/finality; Circle fills these fields only when attesting. */
export function inspectSourceBurnMessage(message:Hex,r:CctpEvmRequest):void{
 const m=decodeCctpV2Message(message);
 if(m.sourceDomain!==27||m.destinationDomain!==19||m.nonce!==CCTP_ZERO32||m.executedFinality!==0||m.sender!==stellarPayload(P.stellar.messenger,true)||m.recipient!==evmRecipientBytes32(P.hyperEvm.messenger)||m.destinationCaller!==CCTP_ZERO32||m.minFinality!==2000||m.burnToken!==stellarPayload(P.stellar.usdc,true)||m.mintRecipient!==evmRecipientBytes32(r.evmAccount)||m.amount!==boundedCctpAmount(r.amountCctpAtomic)||m.messageSender!==stellarPayload(r.customer.walletAddress)||m.maxFee!==0n||m.executedFee!==0n||m.expirationBlock!==0n||m.hookData!=='0x')return cctpStageFail('CCTP_SOURCE_MESSAGE_INTENT_MISMATCH');
}
export function extractSourceBurnMessage(meta:xdr.TransactionMeta):Hex{
 let events:xdr.ContractEvent[];
 if(meta.switch()===3){const soroban=meta.v3().sorobanMeta();if(!soroban)return cctpStageFail('CCTP_SOURCE_META_REQUIRED');events=soroban.events();}
 else if(meta.switch()===4){const operations=meta.v4().operations();if(operations.length!==1)return cctpStageFail('CCTP_SOURCE_META_REQUIRED');events=operations[0]!.events();}
 else return cctpStageFail('CCTP_SOURCE_META_UNSUPPORTED');
 if(events.length>100)return cctpStageFail('CCTP_SOURCE_EVENTS_AMBIGUOUS');
 const messages:Hex[]=[];
 for(const event of events){
  if(event.type().name!=='contract'||(event.contractId()?Buffer.from(event.contractId() as unknown as Uint8Array).toString('hex'):null)!==Buffer.from(StrKey.decodeContract(P.stellar.transmitter)).toString('hex')||event.body().switch()!==0)continue;
  const body=event.body().v0(),topics=body.topics();if(topics.length!==1||topics[0]!.switch().name!=='scvSymbol'||topics[0]!.sym().toString()!=='message_sent')continue;
  const data=body.data();if(data.switch().name!=='scvMap')return cctpStageFail('CCTP_SOURCE_EVENT_FORMAT_INVALID');const entries=data.map();
  if(!entries||entries.length!==1||entries[0]!.key().switch().name!=='scvSymbol'||entries[0]!.key().sym().toString()!=='message'||entries[0]!.val().switch().name!=='scvBytes')return cctpStageFail('CCTP_SOURCE_EVENT_FORMAT_INVALID');
  messages.push(`0x${entries[0]!.val().bytes().toString('hex')}`);
 }
 if(messages.length!==1)return cctpStageFail('CCTP_SOURCE_UNIQUE_MESSAGE_EVENT_REQUIRED');return messages[0]!;
}
export class CctpSourceBurnReader{
 private server:NonNullable<CctpSourceProofDependencies['server']>;private now:()=>number;
 constructor(private deps:CctpSourceProofDependencies){this.server=deps.server??new rpc.Server(P.stellar.rpc,{timeout:15});this.now=deps.now??Date.now;}
 async read(r:CctpEvmRequest,sourceHash:string):Promise<CctpSourceBurnProof>{
  r=structuredClone(r);
  if(!/^[a-f0-9]{64}$/.test(sourceHash))return cctpStageFail('CCTP_SOURCE_HASH_INVALID');boundedCctpAmount(r.amountCctpAtomic);normalizeEvm(r.evmAccount);
  const found=await this.deps.readPreparedBurn(structuredClone(r),sourceHash),stored=found?structuredClone(found):null,c=r.customer,s=stored?.request;
  if(!stored||!s||s.operationId!==r.operationId||s.customer.businessId!==c.businessId||s.customer.customerId!==c.customerId||s.customer.walletId!==c.walletId||s.customer.walletAddress!==c.walletAddress||s.customer.privyUserId!==c.privyUserId||s.destinationDomain!==19||normalizeEvm(s.evmRecipient)!==normalizeEvm(r.evmAccount)||s.amountStellarAtomic!==(boundedCctpAmount(r.amountCctpAtomic)*10n).toString()||stored.prepared.signingHashHex!==sourceHash)return cctpStageFail('CCTP_PERSISTED_SOURCE_INTENT_REQUIRED');
  if((await this.server.getNetwork()).passphrase!==P.stellar.passphrase)return cctpStageFail('CCTP_SOURCE_NETWORK_MISMATCH');await(this.deps.verifyRegistry??readStellarRegistry)();
  const result=await this.server.getTransaction(sourceHash);
  if(result.status!=='SUCCESS'||result.txHash!==sourceHash||result.feeBump||!Number.isSafeInteger(result.ledger)||result.ledger<=0||result.latestLedger<result.ledger||!Number.isSafeInteger(result.createdAt)||result.createdAt<=0||result.createdAt*1000>this.now()+1000||!Number.isFinite(result.latestLedgerCloseTime)||this.now()-result.latestLedgerCloseTime*1000>120000||result.latestLedgerCloseTime*1000>this.now()+1000||result.resultXdr.result().switch().name!=='txSuccess')return cctpStageFail('CCTP_SOURCE_CONFIRMATION_REQUIRED');
  const opResults=result.resultXdr.result().results();if(opResults.length!==1||opResults[0]!.switch().name!=='opInner'||opResults[0]!.tr().switch().name!=='invokeHostFunction'||opResults[0]!.tr().invokeHostFunctionResult().switch().name!=='invokeHostFunctionSuccess')return cctpStageFail('CCTP_SOURCE_OPERATION_RESULT_REQUIRED');
  const tx=TransactionBuilder.fromXDR(result.envelopeXdr,P.stellar.passphrase),prepared=TransactionBuilder.fromXDR(stored.prepared.unsignedXdr,P.stellar.passphrase);
  if(!(tx instanceof Transaction)||!(prepared instanceof Transaction)||tx.hash().toString('hex')!==sourceHash||!tx.signatures.length||tx.toEnvelope().v1().tx().toXDR('base64')!==prepared.toEnvelope().v1().tx().toXDR('base64'))return cctpStageFail('CCTP_SOURCE_ENVELOPE_MISMATCH');
  const binding={businessId:c.businessId,customerId:c.customerId,walletId:c.walletId,walletAddress:c.walletAddress,evmRecipient:r.evmAccount,network:'hyperevm-testnet' as const,chainId:998 as const},intent=cctpBurnIntent(s,binding,result.createdAt*1000);
  inspectPreparedCctpBurn(stored.prepared,prepared,intent,BigInt(prepared.sequence),result.createdAt*1000);
  const message=extractSourceBurnMessage(result.resultMetaXdr);inspectSourceBurnMessage(message,r);
  return{operationId:r.operationId,businessId:c.businessId,customerId:c.customerId,walletId:c.walletId,walletAddress:c.walletAddress,evmAccount:normalizeEvm(r.evmAccount),amountStellarAtomic:s.amountStellarAtomic,sourceTxHash:sourceHash,sourceLedger:result.ledger,sourceMessageHex:message,confirmed:true,network:'stellar-testnet'};
 }
}
