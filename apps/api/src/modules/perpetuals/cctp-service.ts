import {Transaction,TransactionBuilder} from '@stellar/stellar-sdk';
import {GrapnelError,NETWORK_PASSPHRASE,XLM,fromAtomic,toAtomic,type CustomerContext} from '@grapnel/contracts';
import {type Hex,decodeFunctionData,encodeFunctionData,keccak256} from 'viem';
import type {OperationService} from '../operations/service.js';
import type {PerpetualScope,PerpetualWorkflowStore} from './workflow-contract.js';
import type {CctpFundingRecord,CctpFundingStep,CctpFundingStore,CctpCoreCreditProof,CctpStageRecord} from './cctp-contract.js';
import {CctpBurnPreparer} from '../../adapters/cctp/preparer.js';
import {CCTP_BURN_ACTION,CCTP_CIRCLE_ASSET_ID} from '../../adapters/cctp/inspector.js';
import {CctpUsdcSetupPreparer} from '../../adapters/cctp/setup.js';
import {CCTP_TESTNET as P} from '../../adapters/cctp/registry.js';
import {CCTP_EVM_ABI,CctpDestinationPreparer,confirmDestinationMint,confirmCoreDepositTransfer,decodeCctpV2Message,readCctpAttestation,type CctpEvmRequest,type CctpEligibility,type CctpSourceBurnProof,type CctpEvmReadTransport,type CctpCoreDepositTransferProof} from '../../adapters/cctp/destination.js';
import {lock} from '../../db/index.js';
import {readEvmRegistry} from '../../adapters/cctp/reader.js';
import {canonicalJson,digest} from '../../lib/crypto.js';
import {transaction} from '../../db/index.js';

const unavailable=(reason:string):never=>{throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Trading funding needs a verified account and chain check',false,{reason});};
export interface CctpFundingDependencies {
 operations:OperationService;store:CctpFundingStore;accounts:PerpetualWorkflowStore;setup:CctpUsdcSetupPreparer;burn:CctpBurnPreparer;destination:CctpDestinationPreparer;
 transport:CctpEvmReadTransport;
 customer:(scope:PerpetualScope)=>Promise<CustomerContext>;
 eligibility:(address:Hex)=>Promise<CctpEligibility>;
 /** Authoritative remaining receive capacity; absent evidence must block a source burn. */
 receiveCapacity?:(address:Hex)=>Promise<{accountAddress:Hex;remainingAtomic6:string;observedAt:string;source:string}|null>;
 verifyGate1:()=>Promise<boolean>;accessApproved:()=>Promise<boolean>;
 verifyEvmRegistry?:()=>Promise<unknown>;
 readSourceProof:(r:CctpEvmRequest,hash:string)=>Promise<CctpSourceBurnProof>;
 readCoreBaseline:(request:CctpEvmRequest)=>Promise<Record<string,unknown>>;
 confirmCoreCredit:(r:CctpEvmRequest,p:CctpCoreDepositTransferProof,baseline:Record<string,unknown>)=>Promise<CctpCoreCreditProof>;
 /** Signed bytes are already durable and claimed. Must use the fixed Testnet endpoint. */
 sendRaw:(serialized:Hex)=>Promise<Hex>;
 now?:()=>number;
}
/** Each financial stage needs a fresh explicit customer signature. GET only reconciles. */
export class CctpFundingCoordinator {
 private now:()=>number;
 constructor(readonly d:CctpFundingDependencies){this.now=d.now??Date.now;}
 private async load(scope:PerpetualScope,id:string){const r=await this.d.store.get(scope,id);if(!r)throw new GrapnelError(404,'NOT_FOUND','Funding request not found');return r;}
 async request(r:CctpFundingRecord,verifiedCustomer?:CustomerContext):Promise<CctpEvmRequest>{return {operationId:r.id,customer:verifiedCustomer??await this.d.customer(r.scope),evmAccount:r.accountAddress,amountCctpAtomic:(BigInt(r.amountAtomic7)/10n).toString(),expiresAt:new Date(Math.floor(this.now()/1000)*1000+90000).toISOString(),maxGas:'3000000',maxFeePerGasWei:'1000000000000',maxPriorityFeePerGasWei:'1000000000',maxTotalFeeWei:'10000000000000000'};}
 async assertReady(s:PerpetualScope,expected?:CctpFundingRecord,amountAtomic7?:bigint){
  if(!await this.d.verifyGate1())return unavailable('CURRENT_CUSTOMER_SIGNING_PROOF_REQUIRED');
  if(!await this.d.accessApproved())return unavailable('HYPERLIQUID_TESTNET_ACCESS_NOT_CONFIRMED');
  const account=await this.d.accounts.account(s);if(!account)return unavailable('CONNECT_TRADING_WALLET');
  if(expected&&(account.id!==expected.accountId||account.accountAddress!==expected.accountAddress))return unavailable('CCTP_ACCOUNT_BINDING_CHANGED');
  const eligible=await this.d.eligibility(account.accountAddress);
  if(eligible.preexistingMainnetState!=='verified')return unavailable('HYPERCORE_TESTNET_EXISTING_ACCOUNT_REQUIRED');
  const age=this.now()-Date.parse(eligible.verifiedAt);
  if(eligible.account.toLowerCase()!==account.accountAddress||eligible.network!=='hyperliquid-testnet'||!Number.isFinite(age)||age<0||age>15000)return unavailable('HYPERCORE_ELIGIBILITY_STALE');
  await (this.d.verifyEvmRegistry??readEvmRegistry)();
  // Mint and deposit need HYPE. Check before irreversibly burning Stellar USDC.
  if(await this.d.transport.request('eth_chainId',[])!=='0x3e6')return unavailable('CCTP_HYPEREVM_NETWORK_MISMATCH');
  const gas=await this.d.transport.request('eth_getBalance',[account.accountAddress,'latest']);
  // Covers three bounded destination stages at the fixed aggregate fee ceiling.
  if(typeof gas!=='string'||!/^0x[0-9a-f]+$/i.test(gas)||BigInt(gas)<(amountAtomic7!==undefined?3n*10n**16n:1n))return unavailable('HYPEREVM_TESTNET_HYPE_REQUIRED');
  if(amountAtomic7!==undefined){const capacity=await this.d.receiveCapacity?.(account.accountAddress),at=Date.parse(capacity?.observedAt??'');
   if(!capacity||capacity.accountAddress.toLowerCase()!==account.accountAddress||!capacity.source||!Number.isFinite(at)||at>this.now()||this.now()-at>15000||!/^\d+$/.test(capacity.remainingAtomic6)||BigInt(capacity.remainingAtomic6)<amountAtomic7/10n)return unavailable('CCTP_TESTNET_RECEIVE_CAPACITY_UNVERIFIED');}
  return account;
 }
 async prepare(scope:PerpetualScope,amount:string,key:string){
  const customer=await this.d.customer(scope),atomic=toAtomic(amount,7);
  if(atomic<=0n||atomic>10_000_000_000n||atomic%10n!==0n)return unavailable('CCTP_TESTNET_AMOUNT_INVALID');
  const account=await this.assertReady(scope,undefined,atomic);
  const created=await this.d.operations.createIdempotent({businessId:scope.businessId,customerId:scope.customerId,walletId:scope.walletId,module:'trade.perps',type:CCTP_BURN_ACTION,provider:'circle-cctp',route:'/v1/trade/perpetuals/funding/prepare',idempotencyKey:key,request:{customer_id:scope.customerId,wallet_id:scope.walletId,amount,account_address:account.accountAddress}},async(client,id)=>{
   const pending=await this.d.store.pending(scope);if(pending)return unavailable('CCTP_FUNDING_ALREADY_PENDING');
   await lock(client,`wallet:${scope.businessId}:${scope.walletId}:${CCTP_CIRCLE_ASSET_ID}`);
   const baseline=await this.d.setup.readStatus(customer);
   if(!baseline.trustline_exists||baseline.trustline_authorized!==true||baseline.spendable_before_reservations===null)return unavailable('CCTP_CIRCLE_USDC_TRUSTLINE_REQUIRED');
   const expiresAt=new Date(Math.floor(this.now()/1000)*1000+90000).toISOString();
   const source=await this.d.burn.prepare({operationId:id,customer,amountStellarAtomic:atomic.toString(),evmRecipient:account.accountAddress,destinationDomain:19,expiresAt,maxFeeStroops:'10000000'});
   const tx=TransactionBuilder.fromXDR(source.unsignedXdr,NETWORK_PASSPHRASE);if(!(tx instanceof Transaction))return unavailable('CCTP_SOURCE_INVALID');
   for(const [assetId,held,spendable]of [[CCTP_CIRCLE_ASSET_ID,atomic,toAtomic(baseline.spendable_before_reservations,7)],[XLM.id,BigInt(tx.fee),toAtomic(baseline.native_spendable_before_reservations,7)]] as const)
    await this.d.operations.reserve(client,{businessId:scope.businessId,customerId:scope.customerId,walletId:scope.walletId,operationId:id,assetId,amountAtomic:held,spendableAtomic:spendable,observedAt:new Date(baseline.as_of),expiresAt:new Date(expiresAt)});
   await this.d.operations.setPrepared(client,scope.businessId,id,source);
   await this.d.store.create(client,{id,scope:{...scope},accountId:account.id,accountAddress:account.accountAddress,amountAtomic7:atomic.toString(),state:'awaiting_source',source,sourceTxHash:null,sourceProof:null,messageHex:null,attestationHex:null,mintProof:null,depositProof:null,coreProof:null,createdAt:new Date(this.now()).toISOString()});
  });
  return this.reviewSource(scope,created.operation.operation_id);
 }
 async reviewSource(scope:PerpetualScope,id:string){const r=await this.load(scope,id),authorization=await this.d.operations.issueAuthorization(scope.businessId,id);return {...await this.public(r),source:authorization.prepared_action,source_customer_action_token:authorization.customer_action_token};}
 async get(scope:PerpetualScope,id?:string){let r=id?await this.load(scope,id):await this.d.store.pending(scope);if(!r)return null;
  const operation=await this.d.operations.get(scope.businessId,r.id);
  if(operation.tx_hash&&!r.sourceTxHash)await this.d.store.saveProof(scope,r.id,{sourceTxHash:operation.tx_hash,state:'source_pending'});
  r=await this.load(scope,r.id);
  if(r.sourceTxHash&&!r.sourceProof){try{const proof=await this.d.readSourceProof(await this.request(r),r.sourceTxHash);await this.d.store.saveProof(scope,r.id,{sourceProof:proof,state:'attesting'});}catch{/* Keep actual source hash through indexing delays; no new burn. */}}
  r=await this.load(scope,r.id);
  if(r.sourceProof&&!r.messageHex){const attestation=await readCctpAttestation(27,r.sourceProof.sourceTxHash);if(attestation)await this.d.store.saveProof(scope,r.id,{messageHex:attestation.message.hex,attestationHex:attestation.attestation,state:'destination_pending'});}
  r=await this.load(scope,r.id);
  for(const stage of await this.d.store.stages(scope,r.id))if(stage.txHash&&(['sending','unknown','signed'].includes(stage.state)||stage.state==='confirmed'&&(stage.step==='cctp.receive'&&!r.mintProof||stage.step==='core.deposit'&&!r.coreProof)))await this.reconcileStage(await this.load(scope,r.id),stage);
  return this.public(await this.load(scope,r.id));
 }
 async prepareStage(scope:PerpetualScope,id:string,step:CctpFundingStep){const r=await this.load(scope,id);await this.assertReady(scope,r);await this.assertNext(r,step);const request=await this.request(r);
  let action,baseline:Record<string,unknown>|undefined;
  if(step==='cctp.receive'){if(!r.sourceProof||!r.sourceTxHash)return unavailable('CCTP_CONFIRMED_SOURCE_BURN_REQUIRED');action=await this.d.destination.prepareMint(request,r.sourceTxHash);}
  else if(step==='core.approve')action=await this.d.destination.prepareCoreApproval(request);
  else{baseline=await this.d.readCoreBaseline(request);action=await this.d.destination.prepareCoreDeposit(request);}
  await this.d.store.prepareStage(scope,id,action,baseline);return this.public(await this.load(scope,id));
 }
 async authorizeStage(scope:PerpetualScope,id:string,stageId:string,step:CctpFundingStep,signed:Hex){const r=await this.load(scope,id);await this.assertReady(scope,r);await this.assertNext(r,step);
  const known=(await this.d.store.stages(scope,id)).find(s=>s.id===stageId&&s.step===step);if(!known)return unavailable('CCTP_STAGE_NOT_FOUND');
  const stage=await this.d.store.signStage(scope,id,stageId,signed);
  if(await this.d.store.claimSend(scope,id,stage.id)){try{const sent=await this.d.sendRaw(signed);if(sent.toLowerCase()!==stage.txHash?.toLowerCase())return unavailable('CCTP_SUBMISSION_HASH_MISMATCH');}finally{await this.d.store.stageResult(scope,id,stage.id,'unknown',null);}}
  return this.get(scope,r.id);
 }
 private async reconcileStage(r:CctpFundingRecord,stage:CctpStageRecord){if(!stage.txHash)return;const request=await this.request(r);
  try{
   const receipt=await this.d.transport.request('eth_getTransactionReceipt',[stage.txHash]) as {status?:string}|null;if(!receipt)return;
   if(receipt.status==='0x0'){await this.d.store.stageResult(r.scope,r.id,stage.id,'reverted',{txHash:stage.txHash});await this.d.store.saveProof(r.scope,r.id,{state:'recovery_required'});return;}
   if(stage.step==='cctp.receive'){
    if(!r.messageHex||!r.sourceTxHash)return;const proof=await confirmDestinationMint(request,r.sourceTxHash,decodeCctpV2Message(r.messageHex),stage.txHash,this.d.transport);
    await this.d.store.stageResult(r.scope,r.id,stage.id,'confirmed',{...proof});await this.d.store.saveProof(r.scope,r.id,{mintProof:proof,state:'core_pending'});
   }else if(stage.step==='core.approve'){
    const proof=await this.approvalProof(r,stage);await this.d.store.stageResult(r.scope,r.id,stage.id,'confirmed',proof);
   }else if(r.mintProof&&stage.baseline){
    const deposit=await confirmCoreDepositTransfer(request,r.mintProof,stage.txHash,this.d.transport);await this.d.store.stageResult(r.scope,r.id,stage.id,'confirmed',{...deposit});await this.d.store.saveProof(r.scope,r.id,{depositProof:deposit,state:'core_pending'});
    const credit=await this.d.confirmCoreCredit(request,deposit,stage.baseline);await this.d.store.saveProof(r.scope,r.id,{coreProof:credit,state:'completed'});
   }
  }catch{/* Uncertain sends remain recoverable and never become fabricated credits. */}
 }
 async assertNext(r:CctpFundingRecord,step:CctpFundingStep){
  if(['completed','recovery_required'].includes(r.state))return unavailable('CCTP_FUNDING_NOT_PREPARABLE');
  const stages=await this.d.store.stages(r.scope,r.id);
  if(stages.some(s=>s.step!==step&&!['confirmed','reverted'].includes(s.state)))return unavailable('CCTP_PREVIOUS_STAGE_PENDING');
  if(step==='cctp.receive'&&(!r.sourceProof||!r.messageHex||!r.attestationHex||r.mintProof))return unavailable('CCTP_VERIFIED_ATTESTATION_REQUIRED');
  if(step!=='cctp.receive'&&!r.mintProof)return unavailable('CCTP_CONFIRMED_DESTINATION_MINT_REQUIRED');
  if(step==='core.deposit'&&!stages.some(s=>s.step==='core.approve'&&s.state==='confirmed'))return unavailable('CCTP_CONFIRMED_APPROVAL_REQUIRED');
 }
 async idempotency(scope:PerpetualScope,id:string,route:string,key:string,body:unknown){await this.load(scope,id);const requestHash=digest(canonicalJson(body));
  await transaction(this.d.operations.pool,async client=>{await lock(client,`idempotency:${scope.businessId}:${route}:${key}`);const old=(await client.query('SELECT request_hash,operation_id FROM idempotency_records WHERE business_id=$1 AND route=$2 AND idempotency_key=$3',[scope.businessId,route,key])).rows[0];
   if(old){if(old.request_hash!==requestHash||old.operation_id!==id)throw new GrapnelError(409,'IDEMPOTENCY_CONFLICT','This request identifier already belongs to another action');return;}
   await client.query('INSERT INTO idempotency_records(business_id,route,idempotency_key,request_hash,operation_id) VALUES($1,$2,$3,$4,$5)',[scope.businessId,route,key,requestHash,id]);});
 }
 async approvalProof(r:CctpFundingRecord,stage:CctpStageRecord){
  if(stage.step!=='core.approve'||!stage.txHash||!stage.signedTransaction||keccak256(stage.signedTransaction)!==stage.txHash||await this.d.transport.request('eth_chainId',[])!=='0x3e6')return unavailable('CCTP_APPROVAL_PROOF_REQUIRED');
  const [receipt,tx]=await Promise.all([this.d.transport.request('eth_getTransactionReceipt',[stage.txHash]),this.d.transport.request('eth_getTransactionByHash',[stage.txHash])]) as any[];
  const t=stage.action.transaction;
  if(!receipt||receipt.status!=='0x1'||receipt.transactionHash?.toLowerCase()!==stage.txHash||!tx||tx.hash?.toLowerCase()!==stage.txHash||tx.from?.toLowerCase()!==r.accountAddress||tx.to?.toLowerCase()!==t.to.toLowerCase()||tx.input?.toLowerCase()!==t.data.toLowerCase()||BigInt(tx.chainId??0)!==998n||BigInt(tx.value??-1)!==0n||BigInt(tx.nonce??-1)!==BigInt(t.nonce)||!/^0x[0-9a-f]{64}$/i.test(receipt.blockHash))return unavailable('CCTP_APPROVAL_TRANSACTION_MISMATCH');
  const [block,head]=await Promise.all([this.d.transport.request('eth_getBlockByNumber',[receipt.blockNumber,false]),this.d.transport.request('eth_blockNumber',[])]) as any[];
  if(block?.hash?.toLowerCase()!==receipt.blockHash.toLowerCase()||BigInt(head)<BigInt(receipt.blockNumber)+1n)return unavailable('CCTP_APPROVAL_CONFIRMATIONS_REQUIRED');
  const allowance=await this.d.transport.request('eth_call',[{to:P.hyperEvm.usdc,data:encodeFunctionData({abi:CCTP_EVM_ABI,functionName:'allowance',args:[r.accountAddress,P.hyperEvm.coreDepositWallet]})},receipt.blockNumber]);
  if(typeof allowance!=='string'||BigInt(allowance)!==BigInt(r.amountAtomic7)/10n)return unavailable('CCTP_APPROVAL_ALLOWANCE_MISMATCH');
  return {txHash:stage.txHash,blockHash:receipt.blockHash,blockNumber:BigInt(receipt.blockNumber).toString(),allowanceAtomic6:(BigInt(r.amountAtomic7)/10n).toString()};
 }
 async public(r:CctpFundingRecord){const stages=await this.d.store.stages(r.scope,r.id),stage=stages.find(s=>s.state!=='confirmed'&&s.state!=='reverted')??null;
  return {id:r.id,...r.scope,accountAddress:r.accountAddress,amountAtomic7:r.amountAtomic7,amount:fromAtomic(BigInt(r.amountAtomic7),7),state:r.state,source:r.source,sourceTxHash:r.sourceTxHash,messageHex:r.messageHex,attestationHex:r.attestationHex,stage:stage?.step??null,stage_id:stage?.id??null,evmAction:stage?.action??null,expiresAt:stage?.action.expiresAt??r.source.authorization.expiresAt,proof:r.coreProof,destinationProof:r.mintProof,depositProof:r.depositProof,next_step:r.coreProof?null:!r.mintProof?'cctp.receive':!stages.some(s=>s.step==='core.approve'&&s.state==='confirmed')?'core.approve':'core.deposit',stages:stages.map(s=>({id:s.id,step:s.step,state:s.state,txHash:s.txHash})),source_customer_action_token:null};
 }
}
