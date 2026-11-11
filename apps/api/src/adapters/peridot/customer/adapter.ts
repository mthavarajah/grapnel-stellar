import {z} from 'zod';
import {Address,Transaction,TransactionBuilder,scValToNative,nativeToScVal,xdr} from '@stellar/stellar-sdk';
import {NETWORK,NETWORK_PASSPHRASE,fromAtomic,type CustomerContext,type PreparedAction} from '@grapnel/contracts';
import {canonicalJson,digest} from '../../../lib/crypto.js';
import type {MarginAdapter,MarginEvidence,MarginPreparation,MarginStep,MarginStepContext,MarginStepTerms,MarginTerms,MarginWorkflow} from '../../../modules/margin/types.js';
import {MARGIN_STEP_ACTIONS} from '../../../modules/margin/types.js';
import {assertNextMarginStep} from '../../../modules/margin/state.js';
import {PERIDOT_BASE,PERIDOT_COLLATERAL,PERIDOT_TESTNET_PINS as P} from '../config.js';
import {buildPeridotStepOperation,strictMarginMinimum} from '../execution/intents.js';
import {inspectQaMarginBeginAuth,inspectQaMarginBeginFootprint,inspectQaMarginBeginStateChanges} from '../execution/begin.js';
import {rpc} from '@stellar/stellar-sdk';
import {PeridotCustomerChain,type CustomerChainDependencies} from './chain.js';
import {reviewedPhaseBindings,inspectPreparedHelper,type CustomerPhaseBindings,type PhasePrepared,type PrivateMarginBaseline} from './bindings.js';
import {knownMarginEvidence} from './evidence.js';
import {PERIDOT_CUSTOMER_POLICY,PERIDOT_RECEIPT_ID,REQUIRED_CUSTOMER_STEPS,createCustomerTerms,validateCustomerTerms,fail,invalid,unsigned} from './policy.js';
import {assertSamePrepared,inspectCustomerSignature} from './signature.js';

export interface PeridotCustomerDependencies extends CustomerChainDependencies {
 /** Must independently verify an actual full current Testnet round trip. No flag or credentials establish this proof. */
 verifyRoundTripProof?:()=>Promise<boolean>;
 /** Root supplies further reviewed phase guards and exact metadata extractors; an absent phase never inherits another phase's guards. */
 bindings?:CustomerPhaseBindings;
}
const safe=(value:unknown)=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v));
const helperSchema=z.object({intent:z.object({step:z.string(),walletAddress:z.string()}).passthrough(),unsignedXdr:z.string().min(1),signingHashHex:z.string().regex(/^[a-f0-9]{64}$/),expiresAt:z.string().datetime(),feeStroops:z.string().regex(/^[1-9]\d*$/),networkPassphrase:z.literal(NETWORK_PASSPHRASE),expectedPositionId:z.string().optional()}).passthrough();
const snapshotSchema=z.object({walletUnderlyingAtomic:z.string(),walletReceiptAtomic:z.string(),marginReceiptAtomic:z.string(),marginDebtAtomic:z.string(),nativeWalletAtomic:z.string(),nativeSpendableAtomic:z.string(),observedAt:z.string().datetime(),ledger:z.number().int().positive(),position:z.unknown()}).strict();
const baselineSchema=z.object({version:z.literal(1),intentHash:z.string().regex(/^[a-f0-9]{64}$/),workflowRevision:z.number().int().positive(),helper:helperSchema,before:snapshotSchema}).strict();
export function publicMarginAction(context:MarginStepContext,helper:PhasePrepared,customer:CustomerContext):PreparedAction {
 const receipt=['margin_transfer','margin_return','vault_withdraw','open_begin'].includes(context.step),from=receipt?PERIDOT_RECEIPT_ID:PERIDOT_COLLATERAL.id;
 const amount=receipt?fromAtomic(unsigned(context.workflow.receiptAtomic,true),6):fromAtomic(unsigned(context.workflow.terms.collateralAtomic,true),7);
 const contract=context.step==='vault_deposit'||context.step==='vault_withdraw'?P.mock_usdt_vault.address:P.margin.address;
 return{operationId:context.operationId,customerId:customer.customerId,network:NETWORK,walletAddress:customer.walletAddress,unsignedXdr:helper.unsignedXdr,signingHashHex:helper.signingHashHex,summary:{action:MARGIN_STEP_ACTIONS[context.step],fromAssetId:from,...(context.step==='vault_deposit'?{toAssetId:PERIDOT_RECEIPT_ID}:context.step==='open_begin'?{toAssetId:PERIDOT_BASE.id,minReceive:fromAtomic(unsigned(context.terms.minimumOutputAtomic,true),7)}:{}),amount,recipient:context.step==='vault_deposit'?P.mock_usdt_vault.address:context.step==='vault_withdraw'?customer.walletAddress:P.margin.address,contractId:contract,maxFeeStroops:helper.feeStroops,expiresAt:helper.expiresAt},authorization:{method:'privy_stellar',expiresAt:helper.expiresAt}};
}
export class PeridotCustomerAdapter implements MarginAdapter {
 readonly chain:PeridotCustomerChain;readonly bindings:CustomerPhaseBindings;
 constructor(private readonly deps:PeridotCustomerDependencies){this.chain=new PeridotCustomerChain(deps);this.bindings={...reviewedPhaseBindings(this.chain),...deps.bindings};}
 async executionReady():Promise<boolean>{
  if(!REQUIRED_CUSTOMER_STEPS.every(step=>this.bindings[step]&&(['vault_deposit','margin_transfer','open_begin'].includes(step)||!!this.bindings[step]!.readEvidence&&!!this.bindings[step]!.publicAction)&&(!['close_swap','close_short_swap'].includes(step)||!!this.bindings[step]!.quoteTerms)))return false;
  try{return await this.deps.verifyRoundTripProof?.()===true;}catch{return false;}
 }
 async termsFor(input:Parameters<typeof createCustomerTerms>[0],customer:CustomerContext):Promise<MarginTerms>{return createCustomerTerms(input,customer);}
 async creationReadyFor(terms:MarginTerms,customer:CustomerContext):Promise<boolean>{validateCustomerTerms(terms,customer);return this.executionReady();}
 async validateWorkflowTerms(terms:MarginTerms,customer:CustomerContext):Promise<void>{validateCustomerTerms(terms,customer);}
 private validateContext(context:MarginStepContext,customer:CustomerContext):void{
  const w=context.workflow;validateCustomerTerms(w.terms,customer);
  if(w.businessId!==customer.businessId||w.customerId!==customer.customerId||w.walletId!==customer.walletId||w.walletAddress!==customer.walletAddress||w.termsHash!==digest(canonicalJson(w.terms))||context.intentHash!==digest(canonicalJson({workflowId:w.id,termsHash:w.termsHash,step:context.step,terms:context.terms,positionId:w.positionId,receiptAtomic:w.receiptAtomic}))||w.activeOperationId!==null&&w.activeOperationId!==context.operationId)return invalid('WORKFLOW_CUSTOMER_BINDING');
  assertNextMarginStep({...w,activeOperationId:null},context.step,context.terms);
 }
 async assertStepReady(context:MarginStepContext,customer:CustomerContext):Promise<void>{
  this.validateContext(context,customer);
  if(!await this.executionReady()||!this.bindings[context.step])return fail('PERIDOT_ROUND_TRIP_PROOF_REQUIRED');
 }
 async readinessFor(workflow:MarginWorkflow,customer:CustomerContext){
  validateCustomerTerms(workflow.terms,customer);
  const ready=await this.executionReady();
  return{execution_status:ready?'testnet_verified' as const:'blocked' as const,preparation_available:ready,steps:ready?Object.keys(this.bindings)as MarginStep[]:[],...(ready?{}:{reason:'PERIDOT_ROUND_TRIP_PROOF_REQUIRED'})};
 }
 async prepareStep(context:MarginStepContext,customer:CustomerContext):Promise<MarginPreparation>{
  await this.assertStepReady(context,customer);const binding=this.bindings[context.step]!,helper=await binding.prepare(context,customer);inspectPreparedHelper(helper,context,customer);
  const prepared=this.actionFor(context,helper,customer),before=await this.chain.snapshot(customer,context.workflow.positionId),fee=unsigned(helper.feeStroops,true),cap=unsigned(context.step==='vault_deposit'?context.workflow.terms.depositMaxFeeStroops:context.workflow.terms.maxFeeStroops,true);
  if(fee>cap||Date.parse(helper.expiresAt)<=this.chain.now()||Date.parse(helper.expiresAt)>this.chain.now()+120000)return invalid('PREPARED_FEE_OR_EXPIRY');
  const reservations:MarginPreparation['reservations']=[{assetId:PERIDOT_BASE.id,amountAtomic:fee,spendableAtomic:unsigned(before.nativeSpendableAtomic),observedAt:new Date(before.observedAt)}];
  if(context.step==='vault_deposit')reservations.push({assetId:PERIDOT_COLLATERAL.id,amountAtomic:unsigned(context.workflow.terms.collateralAtomic,true),spendableAtomic:unsigned(before.walletUnderlyingAtomic),observedAt:new Date(before.observedAt)});
  if(context.step==='margin_transfer'||context.step==='vault_withdraw')reservations.push({assetId:PERIDOT_RECEIPT_ID,amountAtomic:unsigned(context.workflow.receiptAtomic,true),spendableAtomic:unsigned(before.walletReceiptAtomic),observedAt:new Date(before.observedAt)});
  const baseline:PrivateMarginBaseline={version:1,intentHash:context.intentHash,workflowRevision:context.workflow.revision+1,helper,before:safe(before)};
  return{prepared,baseline:safe(baseline),reservations};
 }
 private actionFor(context:MarginStepContext,helper:PhasePrepared,customer:CustomerContext):PreparedAction {
  const action=this.bindings[context.step]?.publicAction;if(action)return action(context,helper,customer);
  if(!['vault_deposit','margin_transfer','open_begin'].includes(context.step))return fail('PERIDOT_PHASE_SUMMARY_REQUIRED');
  return publicMarginAction(context,helper,customer);
 }
 private baseline(context:MarginStepContext,raw:Record<string,unknown>,customer:CustomerContext):PrivateMarginBaseline{
  this.validateContext(context,customer);const parsed=baselineSchema.parse(raw)as PrivateMarginBaseline;inspectPreparedHelper(parsed.helper,context,customer);
  if(parsed.intentHash!==context.intentHash||parsed.workflowRevision!==context.workflow.revision)return invalid('PRIVATE_BASELINE_BINDING');return parsed;
 }
 async verifyStepForSubmission(context:MarginStepContext&{baseline:Record<string,unknown>;prepared:PreparedAction},signedXdr:string,customer:CustomerContext):Promise<void>{
  await this.assertStepReady(context,customer);const baseline=this.baseline(context,context.baseline,customer),expected=this.actionFor(context,baseline.helper,customer);assertSamePrepared(context.prepared,expected);inspectCustomerSignature(context.prepared,signedXdr,customer);
  await this.bindings[context.step]!.verify(baseline.helper,signedXdr);
 }
 async readConfirmedEvidence(context:MarginStepContext&{baseline:Record<string,unknown>;txHash:string},customer:CustomerContext):Promise<MarginEvidence>{
  const baseline=this.baseline(context,context.baseline,customer),binding=this.bindings[context.step];if(!binding)return fail('PERIDOT_PHASE_EXTRACTOR_REQUIRED');
  const confirmed=await this.chain.confirmed(context.txHash,customer),prepared=this.actionFor(context,baseline.helper,customer);
  if(context.txHash!==prepared.signingHashHex)return invalid('STORED_CHAIN_HASH');inspectCustomerSignature(prepared,confirmed.transaction.toXDR(),customer);binding.inspectHistorical(baseline.helper,confirmed.transaction);
  const positionId=context.step==='open_begin'?unsigned(baseline.helper.expectedPositionId,true).toString():context.workflow.positionId,after=await this.chain.snapshot(customer,positionId);
  if(binding.readEvidence)return binding.readEvidence(context,baseline,confirmed,after,customer);
  return knownMarginEvidence(context,baseline,confirmed,after,customer,this.chain.now());
 }
 async quoteFor(workflow:MarginWorkflow,step:MarginStep,customer:CustomerContext):Promise<{terms:MarginStepTerms;expires_at:string}>{
  validateCustomerTerms(workflow.terms,customer);if(!await this.executionReady()||!this.bindings[step])return fail('PERIDOT_ROUND_TRIP_PROOF_REQUIRED');
  if(step==='open_begin'){
   const intent={step:'open_begin' as const,walletAddress:customer.walletAddress,marginReceiptAtomic:unsigned(workflow.receiptAtomic,true).toString(),leverage:2 as const,direction:'long' as const,minimumOutputAtomic:'1'};
   const tx=new TransactionBuilder(await this.chain.server.getAccount(customer.walletAddress),{fee:'100',networkPassphrase:NETWORK_PASSPHRASE}).addOperation(xdr.Operation.fromXDR(buildPeridotStepOperation(intent),'base64')).setTimeout(30).build();
   const sim=await this.chain.server.simulateTransaction(tx,{cpuInstructions:500000},'record');if(!rpc.Api.isSimulationSuccess(sim)||rpc.Api.isSimulationRestore(sim)||!sim.result||sim.result.retval.switch().name!=='scvU64')return fail('PERIDOT_QUOTE_SIMULATION');
   const id=(scValToNative(sim.result.retval)as bigint).toString();inspectQaMarginBeginAuth(sim.result.auth,intent);inspectQaMarginBeginFootprint(sim.transactionData.build(),intent,id);const pending=inspectQaMarginBeginStateChanges(sim,intent,id,this.chain.now()),input=unsigned(String(pending.margin_amount),true)+unsigned(String(pending.borrow_amount),true);
   const [quote,xp,up]=await Promise.all([this.chain.view(customer.walletAddress,P.aquarius_pool.address,'estimate_swap',[nativeToScVal(1,{type:'u32'}),nativeToScVal(0,{type:'u32'}),nativeToScVal(input,{type:'u128'})]),this.chain.view(customer.walletAddress,P.troller.address,'get_price_usd',[new Address(P.native_token.address).toScVal()]),this.chain.view(customer.walletAddress,P.troller.address,'get_price_usd',[new Address(P.mock_usdt.address).toScVal()])]);
   if(typeof quote.value!=='bigint'||quote.value<=0n||!Array.isArray(xp.value)||!Array.isArray(up.value)||xp.value.length!==2||up.value.length!==2||[...xp.value,...up.value].some(v=>typeof v!=='bigint'||v<=0n))return fail('PERIDOT_QUOTE_VALUES');
   const x=xp.value as bigint[],u=up.value as bigint[],numerator=input*u[0]!*x[1]!*9500n,denominator=u[1]!*x[0]!*10000n;
   return{terms:{minimumOutputAtomic:strictMarginMinimum(quote.value.toString(),((numerator+denominator-1n)/denominator).toString(),0)},expires_at:new Date(this.chain.now()+60000).toISOString()};
  }
  if(step==='close_swap'||step==='close_short_swap'){const quote=this.bindings[step]?.quoteTerms;if(!quote)return fail('PERIDOT_CLOSE_QUOTE_BINDING_REQUIRED');return quote(workflow,customer);}
  return{terms:{},expires_at:new Date(this.chain.now()+60000).toISOString()};
 }
}
export {PERIDOT_CUSTOMER_POLICY};
