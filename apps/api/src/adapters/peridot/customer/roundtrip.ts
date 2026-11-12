import {createHash} from 'node:crypto';
import {z} from 'zod';
import {Address,Keypair,StrKey,scValToNative,nativeToScVal,xdr} from '@stellar/stellar-sdk';
import {GrapnelError,NETWORK,NETWORK_PASSPHRASE,type CustomerContext} from '@grapnel/contracts';
import {PERIDOT_TESTNET_PINS as P} from '../config.js';
import {verifyPeridotPhaseCodeBytes} from '../execution/phase-reads.js';
import {inspectQaPoolSwapTransaction,type PeridotQaPoolSwapIntent} from '../execution/pool-swap.js';
import {inspectQaMarginBeginStateChanges} from '../execution/begin.js';
import {inspectQaOpenSwapStateChanges} from '../execution/open-swap.js';
import {inspectQaOpenCancelStateChanges} from '../execution/open-cancel.js';
import {validateMarginPositionSnapshot} from '../execution/state.js';
import {PERIDOT_CUSTOMER_POLICY,invalid,unsigned} from './policy.js';
import {PeridotTransactionChanges,committedStateCheckInput,contractKey,addressValue} from './metadata.js';
import type {PeridotCustomerChain,ConfirmedPeridotTransaction} from './chain.js';
import type {CustomerPhaseBindings,PhasePrepared} from './bindings.js';
import type {MarginStep} from '../../../modules/margin/types.js';
import {nativeFundingPrincipalDelta} from './funding.js';
const phases=['collateral_swap','vault_deposit','margin_transfer','open_begin','open_cancel','open_swap','open_activate','close_atomic','margin_return','vault_withdraw']as const;
type ProofStep=typeof phases[number];
const manifestSchema=z.object({version:z.literal(1),network:z.literal(NETWORK),network_passphrase:z.literal(NETWORK_PASSPHRASE),signer:z.literal('own_QA_ed25519_NOT_Privy_customer_flow'),customer_privy_proof:z.literal(false),owner:z.string().refine(StrKey.isValidEd25519PublicKey),pins_hash:z.literal(PERIDOT_CUSTOMER_POLICY.pinsHash),steps:z.array(z.object({step:z.enum(phases),tx_hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).min(9).max(11)}).strict();
export type PeridotRoundTripManifest=z.infer<typeof manifestSchema>;
export interface PeridotRoundTripVerifierDependencies {chain:PeridotCustomerChain;bindings:CustomerPhaseBindings;readManifest():Promise<unknown|null>;now?:()=>number;}
const equal=(a:unknown,b:unknown)=>JSON.stringify(a,(_,v)=>typeof v==='bigint'?v.toString():v)===JSON.stringify(b,(_,v)=>typeof v==='bigint'?v.toString():v);
const hashObject=(v:unknown)=>createHash('sha256').update(JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x)).digest('hex');
const integer=(v:unknown)=>typeof v==='bigint'?unsigned(v.toString()):invalid('ROUND_TRIP_INTEGER');
const record=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:invalid('ROUND_TRIP_RECORD');
interface Model {phase:'start'|'funded'|'deposited'|'margin_ready'|'pending'|'swapped'|'open'|'closed'|'returned'|'done';walletMock:bigint|null;walletReceipt:bigint;freeMargin:bigint;receipts:bigint;principal:bigint;positionId:string|null;position:Record<string,unknown>|null;pending:Record<string,unknown>|null;execution:Record<string,unknown>|null;perps:Record<string,unknown>|null;recovered:boolean;ids:string[];}
function stateValue(changes:PeridotTransactionChanges,contract:string,name:string,args:xdr.ScVal[]=[],before=false):unknown {
 const change=changes.entry(contract,contractKey(name,...args)),value=before?change?.before:change?.after;if(!value)return invalid('ROUND_TRIP_REQUIRED_ENTRY_'+name);return scValToNative(value);
}
function delta(changes:PeridotTransactionChanges,contract:string,name:string,args:xdr.ScVal[]=[]):bigint {const b=changes.balance(contract,contractKey(name,...args));if(!b)return invalid('ROUND_TRIP_REQUIRED_BALANCE_'+name);return unsigned(b.after)-unsigned(b.before);}
function supplyDelta(changes:PeridotTransactionChanges,contract:string):bigint {
 const row=changes.entry(contract,xdr.ScVal.scvLedgerKeyContractInstance());if(!row?.before||!row.after)return invalid('ROUND_TRIP_SUPPLY_INSTANCE');
 const supply=(v:xdr.ScVal)=>{if(v.switch().name!=='scvContractInstance')return invalid('ROUND_TRIP_SUPPLY_ABI');const entries=(v.instance().storage()??[]).filter(e=>equal(scValToNative(e.key()),['TotalSupply']));if(entries.length!==1)return invalid('ROUND_TRIP_SUPPLY_KEY');return integer(scValToNative(entries[0]!.val()));};return supply(row.after)-supply(row.before);
}
function nativeDelta(changes:PeridotTransactionChanges,owner:string):bigint {
 const row=changes.entry(P.native_token.address,contractKey('Balance',addressValue(owner)));if(!row?.before||!row.after)return invalid('ROUND_TRIP_NATIVE_RECIPIENT');
 const amount=(v:xdr.ScVal)=>{const value=record(scValToNative(v));if(value.authorized!==true||value.clawback!==false)return invalid('ROUND_TRIP_NATIVE_FLAGS');return integer(value.amount);};return amount(row.after)-amount(row.before);
}
function signedProof(tx:ConfirmedPeridotTransaction,owner:string){
 const t=tx.transaction;if(t.source!==owner||t.operations.length!==1||t.signatures.length!==1||t.hash().toString('hex')!==tx.hash||!t.timeBounds||unsigned(t.fee,true)<unsigned(tx.feeAtomic,true))return invalid('ROUND_TRIP_SIGNED_SOURCE');
 const key=Keypair.fromPublicKey(owner),sig=t.signatures[0]!;if(!sig.hint().equals(key.signatureHint())||!key.verify(t.hash(),sig.signature()))return invalid('ROUND_TRIP_SIGNATURE');
 const operation=t.operations[0];if(operation?.type!=='invokeHostFunction'||operation.source||operation.func.switch().name!=='hostFunctionTypeInvokeContract')return invalid('ROUND_TRIP_INVOCATION');
 const call=operation.func.invokeContract();return{args:call.args().map(scValToNative),expiresAt:new Date(Number(t.timeBounds.maxTime)*1000).toISOString()};
}
function helperFor(step:ProofStep,tx:ConfirmedPeridotTransaction,owner:string,args:unknown[],model:Model):PhasePrepared {
 const sameOwner=()=>{if(args[0]!==owner)return invalid('ROUND_TRIP_OWNER_ARGUMENT');};let intent:Record<string,unknown>;
 switch(step){
  case'vault_deposit':sameOwner();intent={step,walletAddress:owner,underlyingAtomic:integer(args[1]).toString()};break;
  case'margin_transfer':case'margin_return':sameOwner();if(args[1]!==P.mock_usdt.address)return invalid('ROUND_TRIP_MARGIN_ASSET');intent={step,walletAddress:owner,receiptAtomic:integer(args[2]).toString()};break;
  case'vault_withdraw':sameOwner();intent={step,walletAddress:owner,receiptAtomic:integer(args[1]).toString()};break;
  case'open_begin':sameOwner();intent={step,walletAddress:owner,marginReceiptAtomic:integer(args[3]).toString(),leverage:Number(integer(args[4])),direction:equal(args[5],['Long'])?'long':'invalid',minimumOutputAtomic:integer(args[9]).toString()};break;
  case'close_atomic':sameOwner();intent={step,walletAddress:owner,positionId:integer(args[1]).toString(),minimumOutputAtomic:integer(args[2]).toString()};break;
  default:sameOwner();intent={step,walletAddress:owner,positionId:integer(args[1]).toString()};
 }
 const envelope=tx.transaction.toEnvelope();envelope.v1().signatures([]);
 return{intent: intent as unknown as PhasePrepared['intent'],unsignedXdr:envelope.toXDR('base64'),signingHashHex:tx.hash,expiresAt:new Date(Number(tx.transaction.timeBounds!.maxTime)*1000).toISOString(),feeStroops:tx.transaction.fee,networkPassphrase:NETWORK_PASSPHRASE,signingMode:'ephemeral_qa_ed25519_NOT_Privy_customer_flow',...(step==='open_begin'?{expectedPositionId:integer(tx.returnValue?scValToNative(tx.returnValue):undefined).toString()}:{}),...(model.pending?{pendingDigest:hashObject(model.pending)}:{}),...(model.execution?{executionDigest:hashObject(model.execution)}:{})};
}
/** Independently verifies ordered real protocol execution. A manifest is evidence input, never an execution switch. */
export class PeridotRoundTripVerifier {
 private pending:Promise<boolean>|undefined;private positiveAt=0;private reason='ROUND_TRIP_NOT_VERIFIED';
 constructor(private readonly deps:PeridotRoundTripVerifierDependencies){}
 get lastFailureReason(){return this.reason;}
 async verify():Promise<boolean>{
  const now=this.deps.now?.()??Date.now();if(this.positiveAt&&now>=this.positiveAt&&now-this.positiveAt<30000)return true;
  this.pending??=this.inspect().then(result=>{if(result){this.positiveAt=this.deps.now?.()??Date.now();this.reason='';}return result;}).catch(error=>{this.reason=error instanceof GrapnelError?String(error.details.reason??error.code):error instanceof Error?error.message:'ROUND_TRIP_READ_FAILED';return false;}).finally(()=>{this.pending=undefined;});return this.pending;
 }
 private async inspect():Promise<boolean>{
  const raw=await this.deps.readManifest();if(raw===null){this.reason='ROUND_TRIP_MANIFEST_REQUIRED';return false;}const manifest=manifestSchema.parse(raw);
  const required=['vault_deposit','margin_transfer','open_begin','open_swap','open_activate','open_cancel','close_atomic','margin_return','vault_withdraw'];
  if(required.some(step=>!this.deps.bindings[step as MarginStep])){this.reason='ROUND_TRIP_PHASE_GUARD_REQUIRED';return false;}
  await verifyPeridotPhaseCodeBytes(this.deps.chain.server);
  const source:CustomerContext={businessId:'protocol-evidence-only',customerId:'protocol-evidence-only',walletId:'protocol-evidence-only',walletAddress:manifest.owner,privyUserId:'own_QA_ed25519_NOT_Privy_customer_flow'};
  const model:Model={phase:'start',walletMock:null,walletReceipt:0n,freeMargin:0n,receipts:0n,principal:0n,positionId:null,position:null,pending:null,execution:null,perps:null,recovered:false,ids:[]};
  let sequence:bigint|undefined,ledger=0;const hashes=new Set<string>();
  for(const row of manifest.steps){
   if(hashes.has(row.tx_hash))return invalid('ROUND_TRIP_DUPLICATE_HASH');hashes.add(row.tx_hash);
   const tx=await this.deps.chain.confirmed(row.tx_hash,source),signed=signedProof(tx,manifest.owner),nextSequence=BigInt(tx.transaction.sequence);
   if(sequence!==undefined&&nextSequence!==sequence+1n||tx.ledger<=ledger)return invalid('ROUND_TRIP_ORDER');sequence=nextSequence;ledger=tx.ledger;
   const changes=new PeridotTransactionChanges(tx.meta),owner=addressValue(manifest.owner),id=model.positionId?nativeToScVal(BigInt(model.positionId),{type:'u64'}):null;
   if(row.step==='collateral_swap'){
    if(model.phase!=='start')return invalid('ROUND_TRIP_FUNDING_ORDER');const input=integer(signed.args[3]),minimum=integer(signed.args[4]);
    const intent:PeridotQaPoolSwapIntent={purpose:'qa_funding',walletAddress:manifest.owner,inputXlmAtomic:input.toString(),minimumMockUsdtAtomic:minimum.toString()};inspectQaPoolSwapTransaction(tx.transaction,intent,signed.expiresAt,{allowPinnedMockCodeRestore:true});
    const credit=changes.balance(P.mock_usdt.address,contractKey('Balance',owner));if(nativeFundingPrincipalDelta(tx.meta,manifest.owner)!==-input||!credit||credit.before!=='0'||unsigned(credit.after)<minimum||input>100000000n)return invalid('ROUND_TRIP_FUNDING_OUTPUT');model.walletMock=unsigned(credit.after);model.phase='funded';continue;
   }
   const helper=helperFor(row.step,tx,manifest.owner,signed.args,model),binding=this.deps.bindings[row.step as MarginStep]!;binding.inspectHistorical(helper,tx.transaction);
   switch(row.step){
    case'vault_deposit':{
     if(model.phase!=='funded')return invalid('ROUND_TRIP_DEPOSIT_ORDER');const input=unsigned((helper.intent as {underlyingAtomic:string}).underlyingAtomic,true),wallet=changes.balance(P.mock_usdt.address,contractKey('Balance',owner)),receipt=changes.balance(P.mock_usdt_vault.address,contractKey('Balance',owner));
     if(input>10000000n||!wallet||!receipt||unsigned(wallet.before)!==model.walletMock||unsigned(wallet.before)-unsigned(wallet.after)!==input||receipt.before!=='0'||unsigned(receipt.after)<=0n||supplyDelta(changes,P.mock_usdt_vault.address)!==unsigned(receipt.after))return invalid('ROUND_TRIP_DEPOSIT_DELTAS');model.walletMock=unsigned(wallet.after);model.walletReceipt=unsigned(receipt.after);model.receipts=model.walletReceipt;model.phase='deposited';break;
    }
    case'margin_transfer':{
     if(model.phase!=='deposited')return invalid('ROUND_TRIP_TRANSFER_ORDER');const free=changes.balance(P.margin.address,contractKey('MarginBalancePtokens',owner,addressValue(P.mock_usdt_vault.address)));
     if(!free||free.before!=='0'||unsigned(free.after)!==model.receipts||delta(changes,P.mock_usdt_vault.address,'Balance',[owner])!==-model.receipts)return invalid('ROUND_TRIP_TRANSFER_DELTAS');model.walletReceipt=0n;model.freeMargin=model.receipts;model.phase='margin_ready';break;
    }
    case'open_begin':{
     if(model.phase!=='margin_ready'||!tx.returnValue)return invalid('ROUND_TRIP_BEGIN_ORDER');const intent=helper.intent as Parameters<typeof inspectQaMarginBeginStateChanges>[1],positionId=unsigned(helper.expectedPositionId,true).toString();
     if(intent.leverage!==2||intent.direction!=='long'||unsigned(intent.marginReceiptAtomic)!==model.freeMargin)return invalid('ROUND_TRIP_BEGIN_SCOPE');
     if(!Number.isSafeInteger(tx.createdAt)||tx.createdAt!<=0||model.ids.includes(positionId))return invalid('ROUND_TRIP_BEGIN_TIMESTAMP_OR_ID');const createdAt=tx.createdAt!*1000;
     const pending=inspectQaMarginBeginStateChanges(committedStateCheckInput(tx.meta,tx.ledger,tx.returnValue),intent,positionId,createdAt);
     model.position=record(stateValue(changes,P.margin.address,'Position',[nativeToScVal(BigInt(positionId),{type:'u64'})]));model.pending=pending;model.positionId=positionId;model.ids.push(positionId);model.freeMargin=0n;model.phase='pending';break;
    }
    case'open_cancel':
     if(model.phase!=='pending'||model.recovered||!model.pending||!id||(helper.intent as {positionId:string}).positionId!==model.positionId)return invalid('ROUND_TRIP_CANCEL_ORDER');
     inspectQaOpenCancelStateChanges(committedStateCheckInput(tx.meta,tx.ledger),{step:'open_cancel',walletAddress:manifest.owner,positionId:model.positionId!},model.pending);model.freeMargin=model.receipts;model.position=null;model.pending=null;model.positionId=null;model.recovered=true;model.phase='margin_ready';break;
    case'open_swap':{
     if(model.phase!=='pending'||!model.pending||!id||(helper.intent as {positionId:string}).positionId!==model.positionId)return invalid('ROUND_TRIP_SWAP_ORDER');
     model.execution=inspectQaOpenSwapStateChanges(committedStateCheckInput(tx.meta,tx.ledger),{step:'open_swap',walletAddress:manifest.owner,positionId:model.positionId!},model.pending);model.principal=integer(model.pending.borrow_amount);model.phase='swapped';break;
    }
    case'open_activate':{
     if(model.phase!=='swapped'||!model.position||!model.pending||!model.execution||!id)return invalid('ROUND_TRIP_ACTIVATE_ORDER');
     const p=changes.entry(P.margin.address,contractKey('Position',id)),perps=changes.entry(P.margin.address,contractKey('PerpsPositionData',id)),pending=changes.entry(P.margin.address,contractKey('PendingPerpsOpenPosition',id)),execution=changes.entry(P.margin.address,contractKey('PendingPerpsOpenExecution',id));
     if(!p?.before||!p.after||!perps?.after||!perps.created||!pending?.removed||!pending.before||!execution?.removed||!execution.before||!equal(scValToNative(p.before),model.position)||!equal(scValToNative(pending.before),model.pending)||!equal(scValToNative(execution.before),model.execution))return invalid('ROUND_TRIP_ACTIVATE_RECORDS');
     const pos=record(scValToNative(p.after)),detail=record(scValToNative(perps.after)),amount=integer(model.execution.position_amount),mint=delta(changes,P.native_vault.address,'Balance',[addressValue(P.margin.address)]);
     validateMarginPositionSnapshot({walletAddress:manifest.owner,positionId:model.positionId!,direction:'long',position:pos,perps:detail,pendingOpen:null,openExecution:null,pendingClose:null,observedLedger:tx.ledger,observedAt:new Date().toISOString()});
     if(mint<=0n||integer(pos.collateral_ptokens)!==mint||supplyDelta(changes,P.native_vault.address)!==mint||nativeDelta(changes,P.margin.address)!==-amount||nativeDelta(changes,P.native_vault.address)!==amount||delta(changes,P.native_vault.address,'ManagedCash')!==amount||delta(changes,P.native_vault.address,'TotalDeposited')!==amount||detail.margin_amount!==model.pending.margin_amount||detail.notional_value!==model.pending.notional_value||detail.maintenance_margin_scaled!==50000n||detail.liquidation_incentive_scaled!==10000n)return invalid('ROUND_TRIP_ACTIVATE_ASSETS');
     model.position=pos;model.perps=detail;model.pending=null;model.execution=null;model.phase='open';break;
    }
    case'close_atomic':{
     if(model.phase!=='open'||!model.position||!model.perps||!id||(helper.intent as {positionId:string}).positionId!==model.positionId)return invalid('ROUND_TRIP_CLOSE_ORDER');
     const p=changes.entry(P.margin.address,contractKey('Position',id)),perps=changes.entry(P.margin.address,contractKey('PerpsPositionData',id));if(!p?.removed||!p.before||!perps?.removed||!perps.before||!equal(scValToNative(p.before),model.position)||!equal(scValToNative(perps.before),model.perps))return invalid('ROUND_TRIP_CLOSE_OWN_RECORDS');
     const principal=changes.balance(P.mock_usdt_vault.address,contractKey('MarginBorrowPrincipal',id)),snapshotBefore=record(stateValue(changes,P.mock_usdt_vault.address,'MarginBorrowSnapshots',[id],true)),snapshotAfter=record(stateValue(changes,P.mock_usdt_vault.address,'MarginBorrowSnapshots',[id]));
     if(!principal||unsigned(principal.before)!==model.principal||principal.after!=='0'||integer(snapshotBefore.principal)!==model.principal||integer(snapshotAfter.principal)!==0n||integer(snapshotAfter.interest_index)<integer(snapshotBefore.interest_index)||stateValue(changes,P.mock_usdt_vault.address,'MarginHasBorrowed',[id],true)!==true||stateValue(changes,P.mock_usdt_vault.address,'MarginHasBorrowed',[id])!==false)return invalid('ROUND_TRIP_CLOSE_ACTUAL_DEBT');
     const debt=model.principal*integer(snapshotAfter.interest_index)/integer(snapshotBefore.interest_index),output=-delta(changes,P.mock_usdt.address,'Balance',[addressValue(P.aquarius_pool.address)]),minimum=unsigned((helper.intent as unknown as {minimumOutputAtomic:string}).minimumOutputAtomic,true),residual=output-debt,mint=delta(changes,P.mock_usdt_vault.address,'Balance',[addressValue(P.margin.address)]),input=nativeDelta(changes,P.aquarius_pool.address);
     if(debt<model.principal||delta(changes,P.mock_usdt_vault.address,'TotalBorrowed')!==-debt||output<minimum||residual<=0n||mint<=0n||supplyDelta(changes,P.mock_usdt_vault.address)!==mint||delta(changes,P.margin.address,'MarginBalancePtokens',[owner,addressValue(P.mock_usdt_vault.address)])!==mint||delta(changes,P.margin.address,'TotalMarginPtokens',[addressValue(P.mock_usdt_vault.address)])!==mint||delta(changes,P.native_vault.address,'Balance',[addressValue(P.margin.address)])!==-integer(model.position.collateral_ptokens)||supplyDelta(changes,P.native_vault.address)!==-integer(model.position.collateral_ptokens)||input<=0n||nativeDelta(changes,P.native_vault.address)!==-input||nativeDelta(changes,P.margin.address)!==0n||delta(changes,P.native_vault.address,'ManagedCash')!==-input||delta(changes,P.native_vault.address,'TotalDeposited')!==-input||delta(changes,P.mock_usdt.address,'Balance',[addressValue(P.mock_usdt_vault.address)])!==output||delta(changes,P.mock_usdt_vault.address,'ManagedCash')!==output||delta(changes,P.mock_usdt_vault.address,'TotalDeposited')!==residual||delta(changes,P.mock_usdt.address,'Balance',[addressValue(P.margin.address)])!==0n)return invalid('ROUND_TRIP_CLOSE_CONSERVATION');
     const positions=stateValue(changes,P.margin.address,'UserPositions',[owner]);if(!Array.isArray(positions)||positions.length)return invalid('ROUND_TRIP_CLOSE_USER_LIST');model.principal=0n;model.freeMargin=mint;model.receipts=mint;model.position=null;model.perps=null;model.phase='closed';break;
    }
    case'margin_return':
     if(model.phase!=='closed'||model.freeMargin<=0n||(helper.intent as {receiptAtomic:string}).receiptAtomic!==model.freeMargin.toString()||delta(changes,P.margin.address,'MarginBalancePtokens',[owner,addressValue(P.mock_usdt_vault.address)])!==-model.freeMargin||delta(changes,P.mock_usdt_vault.address,'Balance',[owner])!==model.freeMargin||delta(changes,P.mock_usdt_vault.address,'Balance',[addressValue(P.margin.address)])!==-model.freeMargin)return invalid('ROUND_TRIP_RETURN');model.walletReceipt=model.freeMargin;model.freeMargin=0n;model.phase='returned';break;
    case'vault_withdraw':{
     if(model.phase!=='returned'||model.walletReceipt<=0n||(helper.intent as {receiptAtomic:string}).receiptAtomic!==model.walletReceipt.toString()||delta(changes,P.mock_usdt_vault.address,'Balance',[owner])!==-model.walletReceipt||supplyDelta(changes,P.mock_usdt_vault.address)!==-model.walletReceipt)return invalid('ROUND_TRIP_WITHDRAW_RECEIPTS');
     const wallet=changes.balance(P.mock_usdt.address,contractKey('Balance',owner));if(!wallet||unsigned(wallet.before)!==model.walletMock||unsigned(wallet.after)<=unsigned(wallet.before))return invalid('ROUND_TRIP_WITHDRAW_UNDERLYING');const output=unsigned(wallet.after)-unsigned(wallet.before);if(delta(changes,P.mock_usdt.address,'Balance',[addressValue(P.mock_usdt_vault.address)])!==-output||delta(changes,P.mock_usdt_vault.address,'ManagedCash')!==-output||delta(changes,P.mock_usdt_vault.address,'TotalDeposited')!==-output)return invalid('ROUND_TRIP_WITHDRAW_CONSERVATION');model.walletMock=unsigned(wallet.after);model.walletReceipt=0n;model.phase='done';break;
    }
   }
  }
  if(model.phase!=='done'||!model.positionId||model.principal!==0n||model.walletReceipt!==0n||model.freeMargin!==0n)return invalid('ROUND_TRIP_INCOMPLETE');
  for(const positionId of model.ids)if(await this.deps.chain.positionSnapshot(source,positionId,true)!==null)return invalid('ROUND_TRIP_FINAL_POSITION_NOT_REMOVED');
  const final=await this.deps.chain.snapshot(source,model.positionId,true);if(final.marginDebtAtomic!=='0'||final.walletReceiptAtomic!=='0'||final.marginReceiptAtomic!=='0'||final.position!==null||unsigned(final.walletUnderlyingAtomic)!==model.walletMock)return invalid('ROUND_TRIP_FINAL_BALANCES');
  return true;
 }
}
