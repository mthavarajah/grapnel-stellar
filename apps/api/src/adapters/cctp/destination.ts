/** Unsigned CCTP destination actions. No signer, exchange client or transaction submission. */
import {StrKey} from '@stellar/stellar-sdk';
import {GrapnelError,type CustomerContext} from '@grapnel/contracts';
import {decodeEventLog,decodeFunctionData,encodeFunctionData,keccak256,parseAbi,serializeTransaction,type Hex} from 'viem';
import {CCTP_TESTNET as P} from './registry.js';
import {evmRecipientBytes32,stellarAccountForwarding} from './encoding.js';
import {readEvmRegistry} from './reader.js';
import type {CctpRecipientBinding} from './inspector.js';

export const CCTP_EVM_ABI=parseAbi([
 'function receiveMessage(bytes message, bytes attestation) returns (bool)',
 'function approve(address spender,uint256 amount) returns (bool)',
 'function allowance(address owner,address spender) view returns (uint256)',
 'function balanceOf(address account) view returns (uint256)',
 'function deposit(uint256 amount,uint32 destinationDex)',
 'function depositForBurnWithHook(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,uint256 maxFee,uint32 minFinalityThreshold,bytes hookData)',
 'event Transfer(address indexed from,address indexed to,uint256 value)',
 'event MessageReceived(address indexed caller,uint32 sourceDomain,bytes32 indexed nonce,bytes32 sender,uint32 indexed finalityThresholdExecuted,bytes messageBody)',
]);
export const CCTP_ZERO32=`0x${'0'.repeat(64)}` as Hex;
export const cctpStageFail=(reason:string):never=>{throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','This transfer needs a fresh verified chain check',false,{reason});};
export const normalizeEvm=(v:string):`0x${string}`=>{if(typeof v!=='string'||!/^0x[0-9a-f]{40}$/i.test(v)||/^0x0{40}$/i.test(v))return cctpStageFail('CCTP_EVM_ADDRESS_INVALID');return v.toLowerCase() as `0x${string}`;};
export const boundedCctpAmount=(v:string):bigint=>{if(typeof v!=='string'||!/^[1-9]\d{0,9}$/.test(v)||BigInt(v)>1_000_000_000n)return cctpStageFail('CCTP_TESTNET_AMOUNT_INVALID');return BigInt(v);};
export const cctpQuantity=(v:unknown):bigint=>{if(typeof v!=='string'||!/^0x[0-9a-f]{1,64}$/i.test(v))return cctpStageFail('CCTP_EVM_READ_INVALID');return BigInt(v);};
const hexQuantity=(v:bigint)=>`0x${v.toString(16)}`;
export interface CctpEvmRequest {
 operationId:string;customer:CustomerContext;evmAccount:string;amountCctpAtomic:string;expiresAt:string;
 maxGas:string;maxFeePerGasWei:string;maxPriorityFeePerGasWei:string;maxTotalFeeWei:string;
}
export interface CctpEligibility {account:string;network:'hyperliquid-testnet';preexistingMainnetState:'verified'|'unknown'|'absent';verifiedAt:string;}
export function assertCctpBinding(request:Pick<CctpEvmRequest,'operationId'|'customer'|'evmAccount'|'expiresAt'|'amountCctpAtomic'>,binding:CctpRecipientBinding|null,eligibility:CctpEligibility|null,now=Date.now()):void {
 const c=request.customer,expiry=Date.parse(request.expiresAt),account=normalizeEvm(request.evmAccount);boundedCctpAmount(request.amountCctpAtomic);
 if(!c?.businessId||!c.customerId||!c.walletId||!c.privyUserId||!StrKey.isValidEd25519PublicKey(c.walletAddress)||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.operationId)||!Number.isFinite(expiry)||expiry<=now||expiry>now+120000)return cctpStageFail('CCTP_STAGE_INTENT_INVALID');
 if(!binding||binding.businessId!==c.businessId||binding.customerId!==c.customerId||binding.walletId!==c.walletId||binding.walletAddress!==c.walletAddress||binding.network!=='hyperevm-testnet'||binding.chainId!==998||normalizeEvm(binding.evmRecipient)!==account)return cctpStageFail('CCTP_RECIPIENT_BINDING_REQUIRED');
 const age=now-Date.parse(eligibility?.verifiedAt??'');
 if(!eligibility||eligibility.network!=='hyperliquid-testnet'||normalizeEvm(eligibility.account)!==account||eligibility.preexistingMainnetState!=='verified'||!Number.isFinite(age)||age<0||age>300000)return cctpStageFail('CCTP_HYPERCORE_TESTNET_ELIGIBILITY_REQUIRED');
}
/** These callbacks are trusted server readers, never flags supplied by a browser or Iris. */
export interface CctpSourceBurnProof {operationId:string;businessId:string;customerId:string;walletId:string;walletAddress:string;evmAccount:string;amountStellarAtomic:string;sourceTxHash:string;sourceLedger:number;sourceMessageHex:Hex;confirmed:true;network:'stellar-testnet';}
export function assertSourceBurn(proof:CctpSourceBurnProof,request:CctpEvmRequest,sourceHash:string):void {
 const c=request.customer;
 if(!proof||proof.operationId!==request.operationId||proof.businessId!==c.businessId||proof.customerId!==c.customerId||proof.walletId!==c.walletId||proof.walletAddress!==c.walletAddress||normalizeEvm(proof.evmAccount)!==normalizeEvm(request.evmAccount)||proof.network!=='stellar-testnet'||proof.confirmed!==true||proof.sourceTxHash!==sourceHash||!/^\d{1,11}$/.test(proof.amountStellarAtomic)||BigInt(proof.amountStellarAtomic)!==boundedCctpAmount(request.amountCctpAtomic)*10n||!Number.isSafeInteger(proof.sourceLedger)||proof.sourceLedger<=0)return cctpStageFail('CCTP_SOURCE_BURN_PROOF_REQUIRED');
}
export interface CctpV2Message {hex:Hex;hash:Hex;version:number;sourceDomain:number;destinationDomain:number;nonce:Hex;sender:Hex;recipient:Hex;destinationCaller:Hex;minFinality:number;executedFinality:number;body:Hex;burnToken:Hex;mintRecipient:Hex;amount:bigint;messageSender:Hex;maxFee:bigint;executedFee:bigint;expirationBlock:bigint;hookData:Hex;}
/** Published V2 header148/body228 byte format, not Iris's optional decoded JSON. */
export function decodeCctpV2Message(message:string):CctpV2Message {
 if(typeof message!=='string'||!/^0x(?:[0-9a-f]{2}){376,16384}$/i.test(message))return cctpStageFail('CCTP_MESSAGE_FORMAT_INVALID');
 const h=message.toLowerCase() as Hex,part=(offset:number,length:number)=>`0x${h.slice(2+offset*2,2+(offset+length)*2)}` as Hex,num=(offset:number,length:number)=>BigInt(part(offset,length));
 if(num(0,4)!==1n||num(148,4)!==1n)return cctpStageFail('CCTP_MESSAGE_VERSION_INVALID');
 return {hex:h,hash:keccak256(h),version:1,sourceDomain:Number(num(4,4)),destinationDomain:Number(num(8,4)),nonce:part(12,32),sender:part(44,32),recipient:part(76,32),destinationCaller:part(108,32),minFinality:Number(num(140,4)),executedFinality:Number(num(144,4)),body:part(148,(h.length-2)/2-148),burnToken:part(152,32),mintRecipient:part(184,32),amount:num(216,32),messageSender:part(248,32),maxFee:num(280,32),executedFee:num(312,32),expirationBlock:num(344,32),hookData:part(376,(h.length-2)/2-376)};
}
export function stellarPayload(address:string,contract=false):Hex {return `0x${Buffer.from(contract?StrKey.decodeContract(address):StrKey.decodeEd25519PublicKey(address)).toString('hex')}`;}
export function assertCanonicalCctpMessage(message:CctpV2Message):void {
 const encode=(v:unknown)=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x);if(encode(message)!==encode(decodeCctpV2Message(message.hex)))return cctpStageFail('CCTP_DECODED_MESSAGE_MISMATCH');
}
export function inspectStellarToEvmMessage(message:CctpV2Message,request:CctpEvmRequest):void {
 assertCanonicalCctpMessage(message);
 if(message.sourceDomain!==27||message.destinationDomain!==19||message.nonce===CCTP_ZERO32||message.sender!==stellarPayload(P.stellar.messenger,true)||message.recipient!==evmRecipientBytes32(P.hyperEvm.messenger)||message.destinationCaller!==CCTP_ZERO32||message.minFinality!==2000||message.executedFinality<2000||message.burnToken!==stellarPayload(P.stellar.usdc,true)||message.mintRecipient!==evmRecipientBytes32(request.evmAccount)||message.amount!==boundedCctpAmount(request.amountCctpAtomic)||message.messageSender!==stellarPayload(request.customer.walletAddress)||message.maxFee!==0n||message.executedFee!==0n||message.hookData!=='0x')return cctpStageFail('CCTP_ATTESTED_INTENT_MISMATCH');
}
/** Iris may fill nonce/finality/fee/expiration; every source-committed immutable field must still match the actual source event. */
export function inspectAttestationAgainstSource(attested:CctpV2Message,sourceMessageHex:Hex):void {
 assertCanonicalCctpMessage(attested);const source=decodeCctpV2Message(sourceMessageHex);
 const keys=['version','sourceDomain','destinationDomain','sender','recipient','destinationCaller','minFinality','burnToken','mintRecipient','amount','messageSender','maxFee','hookData'] as const;
 if(keys.some(key=>source[key]!==attested[key]))return cctpStageFail('CCTP_ATTESTATION_SOURCE_EVENT_MISMATCH');
}
export interface CctpAttestation {message:CctpV2Message;attestation:Hex;sourceTxHash:string;}
async function boundedJson(response:Response):Promise<any>{
 if(!response.ok||!response.body)return cctpStageFail('CCTP_READ_UNAVAILABLE');const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const n=await reader.read();if(n.done)break;size+=n.value.length;if(size>262144)return cctpStageFail('CCTP_READ_TOO_LARGE');chunks.push(n.value);}}finally{await reader.cancel();}return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
/** One bounded GET. Pending returns null; caller schedules durable polling, never re-burns. */
export async function readCctpAttestation(sourceDomain:27|19,sourceTxHash:string,fetcher:typeof fetch=fetch):Promise<CctpAttestation|null>{
 if(sourceDomain!==27&&sourceDomain!==19||typeof sourceTxHash!=='string'||!(sourceDomain===27?/^[0-9a-f]{64}$/i:/^0x[0-9a-f]{64}$/i).test(sourceTxHash))return cctpStageFail('CCTP_SOURCE_HASH_INVALID');
 const response=await fetcher(`${P.iris}/v2/messages/${sourceDomain}?transactionHash=${encodeURIComponent(sourceTxHash)}`,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000)});if(response.status===404)return null;
 const body=await boundedJson(response);if(body.error||!Array.isArray(body.messages)||body.messages.length!==1)return cctpStageFail('CCTP_ATTESTATION_AMBIGUOUS');
 const row=body.messages[0];if(row.status==='pending_confirmations'||row.status==='pending')return null;
 if(row.status!=='complete'||row.cctpVersion!==2||typeof row.attestation!=='string'||!/^0x(?:[0-9a-f]{130}){1,20}$/i.test(row.attestation))return cctpStageFail('CCTP_ATTESTATION_INVALID');
 // Iris is discovery, not source confirmation or cryptographic verification. receiveMessage eth_call checks its signature onchain.
 return{message:decodeCctpV2Message(row.message),attestation:row.attestation.toLowerCase(),sourceTxHash};
}
export interface CctpEvmReadTransport {request(method:string,params:unknown[]):Promise<unknown>;}
const READ_METHODS=new Set(['eth_chainId','eth_getBlockByNumber','eth_blockNumber','eth_getBalance','eth_getTransactionCount','eth_call','eth_estimateGas','eth_getTransactionReceipt','eth_getTransactionByHash']);
export function createCctpEvmReadTransport(fetcher:typeof fetch=fetch):CctpEvmReadTransport {
 let id=0;return{async request(method,params){if(!READ_METHODS.has(method))return cctpStageFail('CCTP_WRITE_TRANSPORT_FORBIDDEN');const requestId=++id,response=await fetcher(P.hyperEvm.rpc,{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:requestId,method,params}),signal:AbortSignal.timeout(15000)}),body=await boundedJson(response);if(body.jsonrpc!=='2.0'||body.id!==requestId||body.error||body.result===undefined)return cctpStageFail('CCTP_EVM_RPC_INVALID');return body.result;}};
}
export interface UnsignedCctpEvmAction {
 operationId:string;businessId:string;customerId:string;walletId:string;stellarWallet:string;evmAccount:string;network:'hyperevm-testnet';expiresAt:string;
 step:'cctp.receive'|'core.approve'|'core.deposit'|'return.approve'|'return.burn';amountCctpAtomic:string;sourceTxHash:string|null;messageHash:Hex|null;
 expiryEnforcement:'application_only';
 transaction:{chainId:998;type:'eip1559';from:Hex;to:Hex;data:Hex;value:'0';nonce:string;gas:string;maxFeePerGas:string;maxPriorityFeePerGas:string;};signingHash:Hex;
}
export interface CctpEvmCallIntent {request:CctpEvmRequest;step:UnsignedCctpEvmAction['step'];to:Hex;data:Hex;sourceTxHash?:string;messageHash?:Hex;}
export function unsignedCctpEvmDigest(tx:UnsignedCctpEvmAction['transaction']):Hex {
 return keccak256(serializeTransaction({chainId:998,type:'eip1559',to:tx.to,data:tx.data,value:0n,nonce:Number(tx.nonce),gas:BigInt(tx.gas),maxFeePerGas:BigInt(tx.maxFeePerGas),maxPriorityFeePerGas:BigInt(tx.maxPriorityFeePerGas)}));
}
function inspectFixedCall(intent:CctpEvmCallIntent):void {
 const r=intent.request,amount=boundedCctpAmount(r.amountCctpAtomic);let to:string,data:Hex;
 if(intent.step==='core.approve'||intent.step==='return.approve'){to=P.hyperEvm.usdc;data=encodeFunctionData({abi:CCTP_EVM_ABI,functionName:'approve',args:[intent.step==='core.approve'?P.hyperEvm.coreDepositWallet:P.hyperEvm.messenger,amount]});}
 else if(intent.step==='core.deposit'){to=P.hyperEvm.coreDepositWallet;data=encodeFunctionData({abi:CCTP_EVM_ABI,functionName:'deposit',args:[amount,0]});}
 else if(intent.step==='return.burn'){const f=stellarAccountForwarding(r.customer.walletAddress);to=P.hyperEvm.messenger;data=encodeFunctionData({abi:CCTP_EVM_ABI,functionName:'depositForBurnWithHook',args:[amount,27,f.mintRecipient,P.hyperEvm.usdc,f.destinationCaller,0n,2000,f.hookData]});}
 else if(intent.step==='cctp.receive'){to=P.hyperEvm.transmitter;const decoded=decodeFunctionData({abi:CCTP_EVM_ABI,data:intent.data});if(decoded.functionName!=='receiveMessage')return cctpStageFail('CCTP_FIXED_CALL_REQUIRED');const message=decodeCctpV2Message(decoded.args[0]);inspectStellarToEvmMessage(message,r);if(intent.messageHash!==message.hash||!intent.sourceTxHash||!/^[0-9a-f]{64}$/i.test(intent.sourceTxHash)||!/^0x(?:[0-9a-f]{130}){1,20}$/i.test(decoded.args[1]))return cctpStageFail('CCTP_FIXED_CALL_REQUIRED');data=encodeFunctionData({abi:CCTP_EVM_ABI,functionName:'receiveMessage',args:[message.hex,decoded.args[1]]});}
 else return cctpStageFail('CCTP_FIXED_CALL_REQUIRED');
 if(normalizeEvm(intent.to)!==normalizeEvm(to)||intent.data!==data)return cctpStageFail('CCTP_FIXED_CALL_REQUIRED');
}
export function inspectUnsignedCctpEvmAction(action:UnsignedCctpEvmAction,intent:CctpEvmCallIntent&{expectedNonce:string},now=Date.now()):void {
 inspectFixedCall(intent);
 const r=intent.request,c=r.customer,t=action.transaction,decimal=(v:string,max:bigint)=>{if(!/^(0|[1-9]\d{0,20})$/.test(v)||BigInt(v)>max)return cctpStageFail('CCTP_EVM_FEE_INVALID');return BigInt(v);};
 if(Object.keys(t).sort().join(',')!=='chainId,data,from,gas,maxFeePerGas,maxPriorityFeePerGas,nonce,to,type,value'||t.chainId!==998||t.type!=='eip1559'||t.from!==normalizeEvm(r.evmAccount)||t.to!==normalizeEvm(intent.to)||t.data!==intent.data.toLowerCase()||t.value!=='0'||t.nonce!==intent.expectedNonce||action.expiryEnforcement!=='application_only'||action.operationId!==r.operationId||action.businessId!==c.businessId||action.customerId!==c.customerId||action.walletId!==c.walletId||action.stellarWallet!==c.walletAddress||action.evmAccount!==normalizeEvm(r.evmAccount)||action.network!=='hyperevm-testnet'||action.expiresAt!==r.expiresAt||!Number.isFinite(Date.parse(action.expiresAt))||Date.parse(action.expiresAt)<=now||Date.parse(action.expiresAt)>now+120000||action.step!==intent.step||action.amountCctpAtomic!==r.amountCctpAtomic||action.sourceTxHash!==(intent.sourceTxHash??null)||action.messageHash!==(intent.messageHash??null))return cctpStageFail('CCTP_EVM_INTENT_MISMATCH');
 const gas=decimal(t.gas,3_000_000n),fee=decimal(t.maxFeePerGas,1_000_000_000_000n),tip=decimal(t.maxPriorityFeePerGas,fee),nonce=decimal(t.nonce,BigInt(Number.MAX_SAFE_INTEGER));
 if(gas<=0n||fee<=0n||gas>decimal(r.maxGas,3_000_000n)||fee>decimal(r.maxFeePerGasWei,1_000_000_000_000n)||tip>decimal(r.maxPriorityFeePerGasWei,fee)||gas*fee>decimal(r.maxTotalFeeWei,10n**18n)||nonce<0n||action.signingHash!==unsignedCctpEvmDigest(t))return cctpStageFail('CCTP_EVM_FEE_OR_DIGEST_MISMATCH');
}
export async function prepareUnsignedCctpEvmCall(intent:CctpEvmCallIntent,transport:CctpEvmReadTransport,now=Date.now):Promise<UnsignedCctpEvmAction>{
 inspectFixedCall(intent);
 const r=intent.request,from=normalizeEvm(r.evmAccount),to=normalizeEvm(intent.to);
 if(await transport.request('eth_chainId',[])!=='0x3e6')return cctpStageFail('CCTP_HYPEREVM_NETWORK_MISMATCH');
 const head=await transport.request('eth_getBlockByNumber',['latest',false]) as any,stamp=Number(cctpQuantity(head?.timestamp))*1000;
 if(!Number.isFinite(stamp)||stamp>now()+10000||now()-stamp>120000)return cctpStageFail('CCTP_EVM_STALE_HEAD');
 const call={from,to,data:intent.data,value:'0x0'},[nonce,pending,estimate,balance,result]=await Promise.all([transport.request('eth_getTransactionCount',[from,'latest']),transport.request('eth_getTransactionCount',[from,'pending']),transport.request('eth_estimateGas',[call]),transport.request('eth_getBalance',[from,'latest']),transport.request('eth_call',[call,'latest'])]);
 if(cctpQuantity(nonce)!==cctpQuantity(pending))return cctpStageFail('CCTP_EVM_PENDING_NONCE');
 if((intent.step==='cctp.receive'||intent.step==='core.approve'||intent.step==='return.approve')&&cctpQuantity(result)!==1n)return cctpStageFail('CCTP_EVM_SIMULATION_FAILED');
 if((intent.step==='core.deposit'||intent.step==='return.burn')&&result!=='0x')return cctpStageFail('CCTP_EVM_SIMULATION_FAILED');
 const gas=(cctpQuantity(estimate)*120n+99n)/100n;
 const transaction:UnsignedCctpEvmAction['transaction']={chainId:998,type:'eip1559',from,to,data:intent.data.toLowerCase() as Hex,value:'0',nonce:cctpQuantity(nonce).toString(),gas:gas.toString(),maxFeePerGas:r.maxFeePerGasWei,maxPriorityFeePerGas:r.maxPriorityFeePerGasWei};
 const action:UnsignedCctpEvmAction={operationId:r.operationId,businessId:r.customer.businessId,customerId:r.customer.customerId,walletId:r.customer.walletId,stellarWallet:r.customer.walletAddress,evmAccount:from,network:'hyperevm-testnet',expiresAt:r.expiresAt,step:intent.step,amountCctpAtomic:r.amountCctpAtomic,sourceTxHash:intent.sourceTxHash??null,messageHash:intent.messageHash??null,expiryEnforcement:'application_only',transaction,signingHash:unsignedCctpEvmDigest(transaction)};
 inspectUnsignedCctpEvmAction(action,{...intent,expectedNonce:cctpQuantity(nonce).toString()},now());if(cctpQuantity(balance)<gas*BigInt(transaction.maxFeePerGas))return cctpStageFail('CCTP_HYPE_GAS_REQUIRED');
 if(cctpQuantity(await transport.request('eth_getTransactionCount',[from,'pending']))!==cctpQuantity(nonce))return cctpStageFail('CCTP_EVM_NONCE_CHANGED');return action;
}
export interface CctpDestinationDependencies {
 transport?:CctpEvmReadTransport;fetcher?:typeof fetch;now?:()=>number;verifyRegistry?:()=>Promise<unknown>;
 readBinding:(customer:CustomerContext)=>Promise<CctpRecipientBinding|null>;
 readEligibility:(customer:CustomerContext)=>Promise<CctpEligibility|null>;
 readSourceBurn:(request:CctpEvmRequest,hash:string)=>Promise<CctpSourceBurnProof>;
 /** Persisted only after confirmDestinationMint below, not source hash or Iris status. */
 readMintProof:(request:CctpEvmRequest)=>Promise<CctpDestinationMintProof|null>;
}
export interface CctpDestinationMintProof {network:'hyperevm-testnet';chainId:998;operationId:string;businessId:string;customerId:string;walletId:string;evmAccount:string;sourceTxHash:string;destinationTxHash:Hex;messageHash:Hex;nonce:Hex;blockNumber:string;blockHash:Hex;amountCctpAtomic:string;balanceBeforeAtomic:string;balanceAfterAtomic:string;confirmed:true;}
export class CctpDestinationPreparer {
 private transport:CctpEvmReadTransport;private now:()=>number;
 constructor(private deps:CctpDestinationDependencies){this.transport=deps.transport??createCctpEvmReadTransport(deps.fetcher);this.now=deps.now??Date.now;}
 private async guard(r:CctpEvmRequest){const[b,e]=await Promise.all([this.deps.readBinding(r.customer),this.deps.readEligibility(r.customer)]);assertCctpBinding(r,b,e,this.now());await(this.deps.verifyRegistry??(()=>readEvmRegistry(this.deps.fetcher)))();}
 async prepareMint(r:CctpEvmRequest,sourceHash:string):Promise<UnsignedCctpEvmAction>{
  await this.guard(r);if(!/^[0-9a-f]{64}$/i.test(sourceHash))return cctpStageFail('CCTP_SOURCE_HASH_INVALID');const source=await this.deps.readSourceBurn(r,sourceHash);assertSourceBurn(source,r,sourceHash);
  const a=await readCctpAttestation(27,sourceHash,this.deps.fetcher);if(!a)return cctpStageFail('CCTP_ATTESTATION_PENDING');inspectStellarToEvmMessage(a.message,r);inspectAttestationAgainstSource(a.message,source.sourceMessageHex);
  return prepareUnsignedCctpEvmCall({request:r,step:'cctp.receive',to:P.hyperEvm.transmitter,data:encodeFunctionData({abi:CCTP_EVM_ABI,functionName:'receiveMessage',args:[a.message.hex,a.attestation]}),sourceTxHash:sourceHash,messageHash:a.message.hash},this.transport,this.now);
 }
 private async funded(r:CctpEvmRequest){await this.guard(r);const p=await this.deps.readMintProof(r);if(!p||p.confirmed!==true||p.network!=='hyperevm-testnet'||p.chainId!==998||p.operationId!==r.operationId||p.businessId!==r.customer.businessId||p.customerId!==r.customer.customerId||p.walletId!==r.customer.walletId||normalizeEvm(p.evmAccount)!==normalizeEvm(r.evmAccount)||p.amountCctpAtomic!==r.amountCctpAtomic||!/^0x[0-9a-f]{64}$/i.test(p.destinationTxHash)||!/^[0-9a-f]{64}$/i.test(p.sourceTxHash))return cctpStageFail('CCTP_CONFIRMED_DESTINATION_MINT_REQUIRED');const balance=await this.transport.request('eth_call',[{to:P.hyperEvm.usdc,data:encodeFunctionData({abi:CCTP_EVM_ABI,functionName:'balanceOf',args:[normalizeEvm(r.evmAccount)]})},'latest']);if(cctpQuantity(balance)<boundedCctpAmount(r.amountCctpAtomic))return cctpStageFail('CCTP_NATIVE_USDC_BALANCE_REQUIRED');return p;}
 async prepareCoreApproval(r:CctpEvmRequest):Promise<UnsignedCctpEvmAction>{const p=await this.funded(r);return prepareUnsignedCctpEvmCall({request:r,step:'core.approve',to:P.hyperEvm.usdc,data:encodeFunctionData({abi:CCTP_EVM_ABI,functionName:'approve',args:[P.hyperEvm.coreDepositWallet,boundedCctpAmount(r.amountCctpAtomic)]}),sourceTxHash:p.sourceTxHash,messageHash:p.messageHash},this.transport,this.now);}
 async prepareCoreDeposit(r:CctpEvmRequest):Promise<UnsignedCctpEvmAction>{const p=await this.funded(r),allowance=await this.transport.request('eth_call',[{to:P.hyperEvm.usdc,data:encodeFunctionData({abi:CCTP_EVM_ABI,functionName:'allowance',args:[normalizeEvm(r.evmAccount),P.hyperEvm.coreDepositWallet]})},'latest']);if(cctpQuantity(allowance)!==boundedCctpAmount(r.amountCctpAtomic))return cctpStageFail('CCTP_EXACT_CORE_ALLOWANCE_REQUIRED');return prepareUnsignedCctpEvmCall({request:r,step:'core.deposit',to:P.hyperEvm.coreDepositWallet,data:encodeFunctionData({abi:CCTP_EVM_ABI,functionName:'deposit',args:[boundedCctpAmount(r.amountCctpAtomic),0]}),sourceTxHash:p.sourceTxHash,messageHash:p.messageHash},this.transport,this.now);}
}
/** A confirmed source hash does not prove destination mint. Reads receipt, canonical block, exact logs and historical balances. */
export async function confirmDestinationMint(r:CctpEvmRequest,sourceTxHash:string,message:CctpV2Message,destinationTxHash:Hex,transport:CctpEvmReadTransport):Promise<CctpDestinationMintProof>{
 inspectStellarToEvmMessage(message,r);if(!/^[0-9a-f]{64}$/i.test(sourceTxHash)||!/^0x[0-9a-f]{64}$/i.test(destinationTxHash)||await transport.request('eth_chainId',[])!=='0x3e6')return cctpStageFail('CCTP_DESTINATION_PROOF_INVALID');
 const receipt=await transport.request('eth_getTransactionReceipt',[destinationTxHash]) as any;if(!receipt||receipt.status!=='0x1'||receipt.transactionHash?.toLowerCase()!==destinationTxHash.toLowerCase()||receipt.to?.toLowerCase()!==P.hyperEvm.transmitter.toLowerCase()||!/^0x[0-9a-f]{64}$/i.test(receipt.blockHash)||!Array.isArray(receipt.logs)||receipt.logs.length>100)return cctpStageFail('CCTP_DESTINATION_UNCONFIRMED');
 const block=cctpQuantity(receipt.blockNumber),[canonical,head]=await Promise.all([transport.request('eth_getBlockByNumber',[receipt.blockNumber,false]),transport.request('eth_blockNumber',[])]);if(block<=0n||cctpQuantity(head)<block+1n||(canonical as any)?.hash?.toLowerCase()!==receipt.blockHash.toLowerCase())return cctpStageFail('CCTP_DESTINATION_CONFIRMATIONS_REQUIRED');
 let received=0,minted=0;for(const log of receipt.logs){if(log.removed||log.transactionHash?.toLowerCase()!==destinationTxHash.toLowerCase()||log.blockHash?.toLowerCase()!==receipt.blockHash.toLowerCase())return cctpStageFail('CCTP_DESTINATION_LOG_INVALID');try{const e=decodeEventLog({abi:CCTP_EVM_ABI,data:log.data,topics:log.topics,strict:true});if(e.eventName==='MessageReceived'&&log.address.toLowerCase()===P.hyperEvm.transmitter.toLowerCase()){if(e.args.sourceDomain!==27||e.args.nonce!==message.nonce||e.args.sender!==message.sender||e.args.finalityThresholdExecuted!==message.executedFinality||e.args.messageBody!==message.body)return cctpStageFail('CCTP_DESTINATION_MESSAGE_LOG_MISMATCH');received++;}if(e.eventName==='Transfer'&&log.address.toLowerCase()===P.hyperEvm.usdc.toLowerCase()&&e.args.from==='0x0000000000000000000000000000000000000000'&&e.args.to.toLowerCase()===normalizeEvm(r.evmAccount)){if(e.args.value!==message.amount)return cctpStageFail('CCTP_DESTINATION_MINT_LOG_MISMATCH');minted++;}}catch(error){if(error instanceof GrapnelError)throw error;}}
 if(received!==1||minted!==1)return cctpStageFail('CCTP_DESTINATION_EXACT_LOGS_REQUIRED');const call={to:P.hyperEvm.usdc,data:encodeFunctionData({abi:CCTP_EVM_ABI,functionName:'balanceOf',args:[normalizeEvm(r.evmAccount)]})},[before,after]=await Promise.all([transport.request('eth_call',[call,hexQuantity(block-1n)]),transport.request('eth_call',[call,receipt.blockNumber])]);const b=cctpQuantity(before),a=cctpQuantity(after);if(a-b<message.amount)return cctpStageFail('CCTP_DESTINATION_BALANCE_DELTA_REQUIRED');
 return{network:'hyperevm-testnet',chainId:998,operationId:r.operationId,businessId:r.customer.businessId,customerId:r.customer.customerId,walletId:r.customer.walletId,evmAccount:normalizeEvm(r.evmAccount),sourceTxHash,destinationTxHash,messageHash:message.hash,nonce:message.nonce,blockNumber:block.toString(),blockHash:receipt.blockHash.toLowerCase(),amountCctpAtomic:r.amountCctpAtomic,balanceBeforeAtomic:b.toString(),balanceAfterAtomic:a.toString(),confirmed:true};
}

export interface CctpCoreDepositTransferProof {
 network:'hyperevm-testnet';chainId:998;operationId:string;businessId:string;customerId:string;walletId:string;evmAccount:string;
 sourceTxHash:string;mintTxHash:Hex;depositTxHash:Hex;blockNumber:string;blockHash:Hex;amountCctpAtomic:string;
 balanceBeforeAtomic:string;balanceAfterAtomic:string;evmDepositConfirmed:true;
 /** The EVM receipt proves token custody changed, not that a tradable HyperCore balance was credited. */
 hyperCoreCreditConfirmed:false;execution_status:'blocked';reason:'CCTP_MATCHING_HYPERCORE_LEDGER_CREDIT_REQUIRED';
}
/** Only EVM-side evidence; root must independently reconcile the actual HyperCore ledger credit. */
export async function confirmCoreDepositTransfer(r:CctpEvmRequest,mint:CctpDestinationMintProof,depositTxHash:Hex,transport:CctpEvmReadTransport):Promise<CctpCoreDepositTransferProof>{
 if(mint.confirmed!==true||mint.operationId!==r.operationId||mint.businessId!==r.customer.businessId||mint.customerId!==r.customer.customerId||mint.walletId!==r.customer.walletId||normalizeEvm(mint.evmAccount)!==normalizeEvm(r.evmAccount)||mint.amountCctpAtomic!==r.amountCctpAtomic||!/^0x[0-9a-f]{64}$/i.test(depositTxHash)||await transport.request('eth_chainId',[])!=='0x3e6')return cctpStageFail('CCTP_CORE_DEPOSIT_PROOF_INVALID');
 const[receipt,transaction]=await Promise.all([transport.request('eth_getTransactionReceipt',[depositTxHash]),transport.request('eth_getTransactionByHash',[depositTxHash])]) as any[],amount=boundedCctpAmount(r.amountCctpAtomic),data=encodeFunctionData({abi:CCTP_EVM_ABI,functionName:'deposit',args:[amount,0]});
 if(!receipt||receipt.status!=='0x1'||receipt.transactionHash?.toLowerCase()!==depositTxHash.toLowerCase()||receipt.to?.toLowerCase()!==P.hyperEvm.coreDepositWallet.toLowerCase()||!/^0x[0-9a-f]{64}$/i.test(receipt.blockHash)||!Array.isArray(receipt.logs)||receipt.logs.length>100||!transaction||transaction.hash?.toLowerCase()!==depositTxHash.toLowerCase()||transaction.blockHash?.toLowerCase()!==receipt.blockHash.toLowerCase()||transaction.from?.toLowerCase()!==normalizeEvm(r.evmAccount)||transaction.to?.toLowerCase()!==P.hyperEvm.coreDepositWallet.toLowerCase()||transaction.input?.toLowerCase()!==data||cctpQuantity(transaction.value)!==0n)return cctpStageFail('CCTP_CORE_DEPOSIT_UNCONFIRMED');
 const block=cctpQuantity(receipt.blockNumber),[canonical,head]=await Promise.all([transport.request('eth_getBlockByNumber',[receipt.blockNumber,false]),transport.request('eth_blockNumber',[])]);if(block<=0n||cctpQuantity(head)<block+1n||(canonical as any)?.hash?.toLowerCase()!==receipt.blockHash.toLowerCase())return cctpStageFail('CCTP_CORE_DEPOSIT_CONFIRMATIONS_REQUIRED');
 let transferred=0;for(const log of receipt.logs){if(log.removed||log.transactionHash?.toLowerCase()!==depositTxHash.toLowerCase()||log.blockHash?.toLowerCase()!==receipt.blockHash.toLowerCase())return cctpStageFail('CCTP_CORE_DEPOSIT_LOG_INVALID');if(log.address?.toLowerCase()!==P.hyperEvm.usdc.toLowerCase())continue;try{const event=decodeEventLog({abi:CCTP_EVM_ABI,data:log.data,topics:log.topics,strict:true});if(event.eventName==='Transfer'&&event.args.from.toLowerCase()===normalizeEvm(r.evmAccount)&&event.args.to.toLowerCase()===P.hyperEvm.coreDepositWallet.toLowerCase()){if(event.args.value!==amount)return cctpStageFail('CCTP_CORE_DEPOSIT_AMOUNT_MISMATCH');transferred++;}}catch(error){if(error instanceof GrapnelError)throw error;}}
 if(transferred!==1)return cctpStageFail('CCTP_CORE_DEPOSIT_EXACT_LOG_REQUIRED');const call={to:P.hyperEvm.usdc,data:encodeFunctionData({abi:CCTP_EVM_ABI,functionName:'balanceOf',args:[normalizeEvm(r.evmAccount)]})},[before,after]=await Promise.all([transport.request('eth_call',[call,hexQuantity(block-1n)]),transport.request('eth_call',[call,receipt.blockNumber])]),b=cctpQuantity(before),a=cctpQuantity(after);if(b-a!==amount)return cctpStageFail('CCTP_CORE_DEPOSIT_BALANCE_DELTA_REQUIRED');
 return{network:'hyperevm-testnet',chainId:998,operationId:r.operationId,businessId:r.customer.businessId,customerId:r.customer.customerId,walletId:r.customer.walletId,evmAccount:normalizeEvm(r.evmAccount),sourceTxHash:mint.sourceTxHash,mintTxHash:mint.destinationTxHash,depositTxHash,blockNumber:block.toString(),blockHash:receipt.blockHash.toLowerCase(),amountCctpAtomic:r.amountCctpAtomic,balanceBeforeAtomic:b.toString(),balanceAfterAtomic:a.toString(),evmDepositConfirmed:true,hyperCoreCreditConfirmed:false,execution_status:'blocked',reason:'CCTP_MATCHING_HYPERCORE_LEDGER_CREDIT_REQUIRED'};
}
