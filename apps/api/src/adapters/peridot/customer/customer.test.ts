import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
import {Account,Keypair,Operation,Transaction,TransactionBuilder,xdr,scValToNative} from '@stellar/stellar-sdk';
import {NETWORK_PASSPHRASE,type CustomerContext,type PreparedAction} from '@grapnel/contracts';
import {canonicalJson,digest} from '../../../lib/crypto.js';
import type {MarginStepContext,MarginWorkflow,MarginTerms} from '../../../modules/margin/types.js';
import {PERIDOT_MARKET_ID,PERIDOT_TESTNET_PINS as P} from '../config.js';
import {validateMarginPositionSnapshot} from '../execution/state.js';
import {PeridotCustomerAdapter,publicMarginAction} from './adapter.js';
import {PeridotCustomerChain,type ConfirmedPeridotTransaction,type CustomerSnapshot} from './chain.js';
import {PERIDOT_CUSTOMER_POLICY,createCustomerTerms,PERIDOT_RECEIPT_ID} from './policy.js';
import {PeridotTransactionChanges,contractKey} from './metadata.js';
import {knownMarginEvidence} from './evidence.js';
import {PeridotCollateralFundingAdapter,collateralFundingEvidence,publicCollateralAction,type FundingBaseline} from './funding.js';
import {inspectCustomerSignature,assertSamePrepared} from './signature.js';
import type {PhasePrepared,PrivateMarginBaseline} from './bindings.js';
const qaOwner='GAJZ5PEECGFB46QXKFW2QTWRXHYL4SOBS5VE2JDGJ4TDUIAUWEAHKV34';
const customer:CustomerContext={businessId:randomUUID(),customerId:randomUUID(),walletId:randomUUID(),walletAddress:qaOwner,privyUserId:'did:privy:EXPLICIT_OFFLINE_FIXTURE_NOT_CUSTOMER_PROOF'};
const input={market_id:PERIDOT_MARKET_ID,direction:'long' as const,leverage:2,amount:'1',slippage_bps:50};
const terms=createCustomerTerms(input,customer);
const fail=()=>{throw Error('No network in offline test');};
const dependencies=()=>({nativeBalance:vi.fn(fail),horizonTransaction:vi.fn(fail)});
function context(step:MarginStepContext['step']='vault_deposit',receipt:string|null=null):MarginStepContext{
 const workflow:MarginWorkflow={id:randomUUID(),businessId:customer.businessId,customerId:customer.customerId,walletId:customer.walletId,walletAddress:customer.walletAddress,terms,termsHash:digest(canonicalJson(terms)),revision:1,phase:step==='vault_deposit'?'awaiting_collateral':step==='margin_transfer'?'awaiting_margin_transfer':'awaiting_open_begin',positionId:null,receiptAtomic:receipt,activeOperationId:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
 const bound={workflow,step,terms:step==='open_begin'?{minimumOutputAtomic:'129282345'}:{},operationId:randomUUID(),intentHash:''};bound.intentHash=digest(canonicalJson({workflowId:workflow.id,termsHash:workflow.termsHash,step,terms:bound.terms,positionId:workflow.positionId,receiptAtomic:receipt}));return bound;
}
function fixture(phase:'deposit'|'transfer'|'begin'|'funding'){
 const raw=JSON.parse(readFileSync(new URL(`./research/${phase}-transaction.json`,import.meta.url),'utf8')),body=raw.response.result;
 const envelope=xdr.TransactionEnvelope.fromXDR(body.envelopeXdr,'base64'),signed=TransactionBuilder.fromXDR(body.envelopeXdr,NETWORK_PASSPHRASE)as Transaction;envelope.v1().signatures([]);
 const unsigned=TransactionBuilder.fromXDR(envelope.toXDR('base64'),NETWORK_PASSPHRASE)as Transaction,meta=xdr.TransactionMeta.fromXDR(body.resultMetaXdr,'base64'),result=xdr.TransactionResult.fromXDR(body.resultXdr,'base64');
 const confirmed:ConfirmedPeridotTransaction={hash:raw.hash,ledger:body.ledger,feeAtomic:result.feeCharged().toString(),meta,returnValue:meta.v4().sorobanMeta()?.returnValue()??undefined,transaction:signed};
 return{raw,body,unsigned,signed,confirmed};
}
const snapshot=(nativeWalletAtomic:string,underlying:string,receipt:string,margin:string,ledger:number,at:string):CustomerSnapshot=>({walletUnderlyingAtomic:underlying,walletReceiptAtomic:receipt,marginReceiptAtomic:margin,marginDebtAtomic:'0',nativeWalletAtomic,nativeSpendableAtomic:nativeWalletAtomic,ledger,observedAt:at,position:null});
function evidenceFixture(phase:'deposit'|'transfer'|'begin'){
 const f=fixture(phase),step=phase==='deposit'?'vault_deposit':phase==='transfer'?'margin_transfer':'open_begin',c=context(step,phase==='deposit'?null:'9999780'),now=Date.parse(f.raw.observed_at),at=new Date(now).toISOString();
 const before=phase==='deposit'?snapshot('99899968977','15300316','0','0',f.body.ledger-1,at):phase==='transfer'?snapshot('99851151098','5300316','9999780','0',f.body.ledger-1,at):snapshot('99850701390','5300316','0','9999780',f.body.ledger-1,at);
 const after=phase==='deposit'?snapshot('99851151098','5300316','9999780','0',f.body.ledger,at):phase==='transfer'?snapshot('99850701390','5300316','0','9999780',f.body.ledger,at):snapshot((BigInt(before.nativeWalletAtomic)-BigInt(f.confirmed.feeAtomic)).toString(),'5300316','0','0',f.body.ledger,at);
 const intent=phase==='deposit'?{step:'vault_deposit',walletAddress:qaOwner,underlyingAtomic:'10000000'}:phase==='transfer'?{step:'margin_transfer',walletAddress:qaOwner,receiptAtomic:'9999780'}:{step:'open_begin',walletAddress:qaOwner,marginReceiptAtomic:'9999780',leverage:2,direction:'long',minimumOutputAtomic:'129282345'};
 const helper={intent,unsignedXdr:f.unsigned.toXDR(),signingHashHex:f.raw.hash,feeStroops:f.unsigned.fee,expiresAt:new Date(Number(f.unsigned.timeBounds!.maxTime)*1000).toISOString(),networkPassphrase:NETWORK_PASSPHRASE,...(phase==='begin'?{expectedPositionId:'13843'}:{})}as PhasePrepared;
 if(phase==='begin'){
  const changes=new PeridotTransactionChanges(f.confirmed.meta),id=xdr.ScVal.scvU64(xdr.Uint64.fromString('13843'));
  after.position=validateMarginPositionSnapshot({positionId:'13843',walletAddress:qaOwner,direction:'long',position:scValToNative(changes.entry(P.margin.address,contractKey('Position',id))!.after!),pendingOpen:scValToNative(changes.entry(P.margin.address,contractKey('PendingPerpsOpenPosition',id))!.after!),perps:null,pendingClose:null,openExecution:null,observedLedger:f.body.ledger,observedAt:at});
 }
 const baseline:PrivateMarginBaseline={version:1,intentHash:c.intentHash,workflowRevision:c.workflow.revision,helper,before};
 return{...f,c,now,before,after,baseline};
}
describe('Peridot customer policy and fail-closed readiness',()=>{
 it('constructs the pinned server-owned exact initial customer scope',()=>{
  expect(terms).toMatchObject({marketId:PERIDOT_MARKET_ID,leverage:2,direction:'long',collateralAtomic:'10000000',receiptAssetId:PERIDOT_RECEIPT_ID,...PERIDOT_CUSTOMER_POLICY});
  for(const changed of [{market_id:'mainnet:NVDA'},{direction:'short'},{leverage:5},{amount:'1.0000001'},{amount:'0'},{slippage_bps:51}])expect(()=>createCustomerTerms({...input,...changed}as typeof input,customer)).toThrow();
 });
 it('does not turn a callback or credentials into missing phase execution guards',async()=>{
  const proof=vi.fn(async()=>true),adapter=new PeridotCustomerAdapter({...dependencies(),verifyRoundTripProof:proof});
  expect(await adapter.executionReady()).toBe(false);expect(proof).not.toHaveBeenCalled();
  expect(await adapter.readinessFor(context().workflow,customer)).toMatchObject({execution_status:'blocked',preparation_available:false,steps:[]});
  await expect(adapter.prepareStep(context(),customer)).rejects.toMatchObject({details:{reason:'PERIDOT_ROUND_TRIP_PROOF_REQUIRED'}});
 });
 it('rejects a foreign customer or mutated frozen workflow before provider preparation',async()=>{
  const adapter=new PeridotCustomerAdapter(dependencies()),c=context();
  await expect(adapter.assertStepReady(c,{...customer,customerId:randomUUID()})).rejects.toMatchObject({details:{reason:'WORKFLOW_CUSTOMER_BINDING'}});
  c.workflow.terms={...terms,maxFeeStroops:'999999999'};await expect(adapter.assertStepReady(c,customer)).rejects.toMatchObject({details:{reason:'SERVER_POLICY'}});
 });
 it('keeps collateral swaps blocked while round-trip proof is missing',async()=>{
  const adapter=new PeridotCollateralFundingAdapter(new PeridotCustomerChain(dependencies()),async()=>false);
  await expect(adapter.quoteCollateral({amount:'10'},customer)).rejects.toMatchObject({details:{reason:'PERIDOT_ROUND_TRIP_PROOF_REQUIRED'}});
 });
});
describe('Exact Stellar customer envelope validation (offline signatures only)',()=>{
 const key=Keypair.random(),owner={...customer,walletAddress:key.publicKey()};
 it('validates a source signature over the exact prepared body, independently of QA keys',()=>{
  const f=fixture('deposit'),c=context();const prepared=publicMarginAction(c,{intent:{step:'vault_deposit',walletAddress:qaOwner,underlyingAtomic:'10000000'},unsignedXdr:f.unsigned.toXDR(),signingHashHex:f.raw.hash,expiresAt:new Date(Number(f.unsigned.timeBounds!.maxTime)*1000).toISOString(),feeStroops:f.unsigned.fee,networkPassphrase:NETWORK_PASSPHRASE},customer);
  expect(inspectCustomerSignature(prepared,f.signed.toXDR(),customer).source).toBe(qaOwner);
  expect(()=>inspectCustomerSignature({...prepared,signingHashHex:'f'.repeat(64)},f.signed.toXDR(),customer)).toThrow();
  expect(()=>inspectCustomerSignature(prepared,f.signed.toXDR(),owner)).toThrow();
  expect(()=>inspectCustomerSignature(prepared,f.unsigned.toXDR(),customer)).toThrow();
  expect(()=>assertSamePrepared({...prepared,summary:{...prepared.summary,amount:'2'}},prepared)).toThrow();
 });
});
describe('Recorded public Testnet metadata extraction (not customer Privy proof)',()=>{
 it.each(['deposit','transfer','begin']as const)('binds actual %s entry deltas and independently observed fee-net balances',phase=>{
  const f=evidenceFixture(phase),proof=knownMarginEvidence(f.c,f.baseline,f.confirmed,f.after,customer,f.now);
  expect(proof.chainStatus).toBe('SUCCESS');expect(proof.txHash).toBe(f.raw.hash);expect(proof.step).toBe(f.c.step);
  if(phase==='begin')expect(proof).toMatchObject({returnedPositionId:'13843',after:{position:{owner:qaOwner,status:'PendingOpen',debtAtomic:'0'}}});
 });
 it.each(['deposit','transfer','begin']as const)('rejects substituted %s fees, hash, wallet deltas and observation time',phase=>{
  const f=evidenceFixture(phase);
  for(const confirmed of [{...f.confirmed,hash:'f'.repeat(64)},{...f.confirmed,feeAtomic:'1'}])expect(()=>knownMarginEvidence(f.c,f.baseline,confirmed,f.after,customer,f.now)).toThrow();
  expect(()=>knownMarginEvidence(f.c,f.baseline,f.confirmed,{...f.after,walletUnderlyingAtomic:'1'},customer,f.now)).toThrow();
  expect(()=>knownMarginEvidence(f.c,f.baseline,f.confirmed,{...f.after,observedAt:new Date(f.now-16000).toISOString()},customer,f.now)).toThrow();
 });
 it('does not promote RPC SUCCESS without matching operation-local changes',()=>{
  const f=evidenceFixture('deposit'),empty=xdr.TransactionMeta.fromXDR(f.confirmed.meta.toXDR());empty.v4().operations()[0]!.changes([]);
  expect(()=>knownMarginEvidence(f.c,f.baseline,{...f.confirmed,meta:empty},f.after,customer,f.now)).toThrow();
 });
 it('rejects duplicate transaction-local balance state instead of picking one',()=>{
  const f=evidenceFixture('deposit'),meta=xdr.TransactionMeta.fromXDR(f.confirmed.meta.toXDR()),ops=meta.v4().operations()[0]!,changes=ops.changes(),state=changes.find(c=>c.switch().name==='ledgerEntryState'&&c.state().data().switch().name==='contractData')!;ops.changes([...changes,state]);
  expect(()=>new PeridotTransactionChanges(meta)).toThrow();
 });
 it('proves the funding swap using actual native principal metadata plus fee and exact token credit',()=>{
  const f=fixture('funding'),at=f.raw.observed_at,now=Date.parse(at),helper={intent:{purpose:'qa_funding',walletAddress:qaOwner,inputXlmAtomic:'100000000',minimumMockUsdtAtomic:'15223815'},unsignedXdr:f.unsigned.toXDR(),signingHashHex:f.raw.hash,expiresAt:new Date(Number(f.unsigned.timeBounds!.maxTime)*1000).toISOString(),feeStroops:f.unsigned.fee,networkPassphrase:NETWORK_PASSPHRASE,signingMode:'ephemeral_qa_ed25519_NOT_Privy_customer_flow'}as const;
  const before=snapshot('100000000000','0','0','0',f.body.ledger-1,at),after=snapshot('99899968977','15300316','0','0',f.body.ledger,at),baseline:FundingBaseline={version:1,kind:'peridot_collateral_swap',helper,before};
  expect(collateralFundingEvidence(baseline,f.confirmed,after,customer,now)).toMatchObject({verified:true,result:{margin_collateral_swap_verification:{input_atomic:'100000000',output_atomic:'15300316',actual_fee_stroops:f.confirmed.feeAtomic}}});
  expect(publicCollateralAction(randomUUID(),helper,customer).summary).toMatchObject({action:'margin.collateral_swap',amount:'10.0000000',minReceive:'1.5223815'});
  expect(()=>collateralFundingEvidence(baseline,f.confirmed,{...after,nativeWalletAtomic:'99900000000'},customer,now)).toThrow();
  expect(()=>collateralFundingEvidence({...baseline,helper:{...helper,intent:{...helper.intent,inputXlmAtomic:'100000001'}}},f.confirmed,after,customer,now)).toThrow();
 });
});
