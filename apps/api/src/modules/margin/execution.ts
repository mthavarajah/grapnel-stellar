import {Keypair,Transaction,TransactionBuilder} from '@stellar/stellar-sdk';
import {GrapnelError,NETWORK,NETWORK_PASSPHRASE,PreparedActionSchema,type CustomerContext,type PreparedAction} from '@grapnel/contracts';
import {canonicalJson,digest} from '../../lib/crypto.js';
import type {OperationService} from '../operations/service.js';
import type {DeltaVerification} from '../operations/worker.js';
import {applyMarginEvidence,assertNextMarginStep,atomic,validateMarginTerms} from './state.js';
import {MARGIN_STEPS,MARGIN_STEP_ACTIONS,type MarginChild,type MarginExecutionAdapter,type MarginStepContext,type MarginWorkflow} from './types.js';

const fail=(reason:string):never=>{throw new GrapnelError(403,'MARGIN_EXECUTION_BINDING_INVALID','Margin execution differs from its durable approved customer step',false,{reason});};
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const equal=(left:unknown,right:unknown)=>canonicalJson(left)===canonicalJson(right);
export interface MarginExecutionBridge {
 verifyForSubmission(prepared:PreparedAction,signedXdr:string):Promise<void>;
 verifyDeltas(operationId:string,txHash:string):Promise<DeltaVerification>;
}
/** Bridge owns no signing/sending. Authorization still requires the normal verified customer session and one-use operation token. */
export function createMarginExecutionBridge(operations:OperationService,adapter:MarginExecutionAdapter|undefined,approvedPolicy:{pinsHash:string;policyVersion:string},now=Date.now):MarginExecutionBridge {
 async function load(operationId:string){
  if(!adapter)throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Verified Margin execution adapter is unavailable',false,{reason:'MARGIN_EXECUTION_PROOF_REQUIRED'});
  const row=(await operations.pool.query(`SELECT o.*,s.workflow_id,s.step,s.attempt,s.step_terms,s.intent_hash,s.baseline_json,
   f.wallet_address,f.terms_json,f.terms_hash,f.revision AS workflow_revision,f.phase,f.position_id,f.receipt_atomic,f.active_operation_id,
   f.created_at AS workflow_created_at,f.updated_at AS workflow_updated_at,w.stellar_address,c.privy_user_id
   FROM operations o JOIN margin_workflow_steps s ON(s.business_id=o.business_id AND s.customer_id=o.customer_id AND s.wallet_id=o.wallet_id AND s.operation_id=o.id)
   JOIN margin_workflows f ON(f.business_id=s.business_id AND f.customer_id=s.customer_id AND f.wallet_id=s.wallet_id AND f.id=s.workflow_id)
   JOIN wallets w ON(w.business_id=o.business_id AND w.customer_id=o.customer_id AND w.id=o.wallet_id)
   JOIN customers c ON(c.business_id=o.business_id AND c.id=o.customer_id)
   WHERE o.id=$1 AND o.module_code='trade.perps' AND o.provider='peridot'`,[operationId])).rows[0];
  if(!row||row.id!==operationId||row.module_code!=='trade.perps'||row.provider!=='peridot'||row.network!==NETWORK||!MARGIN_STEPS.includes(row.step)||row.type!==MARGIN_STEP_ACTIONS[row.step as typeof MARGIN_STEPS[number]]||row.active_operation_id!==operationId||!row.privy_user_id||row.wallet_address!==row.stellar_address)return fail('DURABLE_OWNER_OPERATION');
  const workflow:MarginWorkflow={id:row.workflow_id,businessId:row.business_id,customerId:row.customer_id,walletId:row.wallet_id,walletAddress:row.wallet_address,terms:row.terms_json,termsHash:row.terms_hash,revision:row.workflow_revision,phase:row.phase,positionId:row.position_id??null,receiptAtomic:row.receipt_atomic??null,activeOperationId:row.active_operation_id,createdAt:new Date(row.workflow_created_at).toISOString(),updatedAt:new Date(row.workflow_updated_at).toISOString()};
  validateMarginTerms(workflow.terms);
  if(workflow.termsHash!==digest(canonicalJson(workflow.terms))||workflow.terms.pinsHash!==approvedPolicy.pinsHash||workflow.terms.policyVersion!==approvedPolicy.policyVersion||!object(row.step_terms)||!object(row.baseline_json))return fail('FROZEN_TERMS_BASELINE');
  const child:MarginChild={workflowId:row.workflow_id,businessId:row.business_id,customerId:row.customer_id,walletId:row.wallet_id,operationId,step:row.step,attempt:row.attempt,terms:row.step_terms,intentHash:row.intent_hash,baseline:row.baseline_json,evidence:null};
  assertNextMarginStep({...workflow,activeOperationId:null},child.step,child.terms);
  const expectedIntent=digest(canonicalJson({workflowId:workflow.id,termsHash:workflow.termsHash,step:child.step,terms:child.terms,positionId:workflow.positionId,receiptAtomic:workflow.receiptAtomic}));
  if(child.intentHash!==expectedIntent||!equal(row.request_json,{workflow_id:workflow.id,step:child.step,terms:child.terms}))return fail('STORED_INTENT');
  const prepared=PreparedActionSchema.parse(row.prepared_action);
  if(prepared.operationId!==operationId||prepared.customerId!==workflow.customerId||prepared.walletAddress!==workflow.walletAddress||prepared.network!==NETWORK||prepared.summary.action!==row.type||prepared.authorization.method!=='privy_stellar'||prepared.summary.expiresAt!==prepared.authorization.expiresAt||row.approved_intent_hash!==digest(canonicalJson(prepared.summary))||row.xdr_hash!==digest(prepared.unsignedXdr))return fail('STORED_PREPARED_ACTION');
  const cap=child.step==='vault_deposit'?workflow.terms.depositMaxFeeStroops:workflow.terms.maxFeeStroops;if(atomic(prepared.summary.maxFeeStroops,true)>atomic(cap,true))return fail('FROZEN_FEE_CAP');
  const customer:CustomerContext={businessId:workflow.businessId,customerId:workflow.customerId,walletId:workflow.walletId,walletAddress:workflow.walletAddress,privyUserId:row.privy_user_id};
  const context:MarginStepContext={workflow,step:child.step,terms:child.terms,intentHash:child.intentHash,operationId};
  return{row,workflow,child,prepared,customer,context};
 }
 function signedBinding(prepared:PreparedAction,signedXdr:string){
  const unsigned=TransactionBuilder.fromXDR(prepared.unsignedXdr,NETWORK_PASSPHRASE),signed=TransactionBuilder.fromXDR(signedXdr,NETWORK_PASSPHRASE);
  if(!(unsigned instanceof Transaction)||!(signed instanceof Transaction)||unsigned.source!==prepared.walletAddress||signed.source!==prepared.walletAddress||unsigned.operations.length!==1||unsigned.signatures.length!==0||signed.signatures.length!==1||unsigned.hash().toString('hex')!==prepared.signingHashHex||signed.hash().toString('hex')!==prepared.signingHashHex||!equal(unsigned.toEnvelope().v1().tx().toXDR('base64'),signed.toEnvelope().v1().tx().toXDR('base64'))||prepared.summary.maxFeeStroops!==unsigned.fee)return fail('EXACT_SIGNED_ENVELOPE');
  const signer=Keypair.fromPublicKey(prepared.walletAddress),signature=signed.signatures[0]!;
  if(!signature.hint().equals(signer.signatureHint())||!signer.verify(signed.hash(),signature.signature()))return fail('WALLET_SIGNATURE');
  return signed;
 }
 return{
  async verifyForSubmission(prepared,signedXdr){
   const bound=await load(prepared.operationId);if(!equal(bound.prepared,prepared))return fail('PREPARED_SUBSTITUTION');
   const signed=signedBinding(bound.prepared,signedXdr),hash=signed.hash().toString('hex'),expiry=Date.parse(prepared.authorization.expiresAt);
   if(expiry<=now()||expiry>now()+120000||!signed.timeBounds||BigInt(signed.timeBounds.maxTime)*1000n!==BigInt(expiry))return fail('APPROVAL_EXPIRY');
   if(bound.row.state==='awaiting_customer_authorization'){if(bound.row.tx_hash!==null&&bound.row.tx_hash!==undefined||bound.row.signed_xdr!==null&&bound.row.signed_xdr!==undefined)return fail('PREVIOUS_SIGNED_SUBMISSION');}
   else if(bound.row.state!=='submitted'||bound.row.tx_hash!==hash||bound.row.signed_xdr!==signedXdr)return fail('SUBMISSION_STATE_HASH');
   const cap=bound.child.step==='vault_deposit'?bound.workflow.terms.depositMaxFeeStroops:bound.workflow.terms.maxFeeStroops;if(atomic(signed.fee,true)>atomic(cap,true))return fail('FROZEN_FEE_CAP');
   await adapter!.validateWorkflowTerms(bound.workflow.terms,bound.customer);await adapter!.assertStepReady(bound.context,bound.customer);
   await adapter!.verifyStepForSubmission({...bound.context,baseline:bound.child.baseline,prepared:bound.prepared},signedXdr,bound.customer);
  },
  async verifyDeltas(operationId,txHash){
   try{
    const bound=await load(operationId);if(!/^[a-f0-9]{64}$/.test(txHash)||bound.row.tx_hash!==txHash||!['preparing','submitted','confirming','recovery_required','completed'].includes(bound.row.state)||typeof bound.row.signed_xdr!=='string')return{verified:false,result:{reason:'MARGIN_CHAIN_STATUS'}};
    const signed=signedBinding(bound.prepared,bound.row.signed_xdr);if(signed.hash().toString('hex')!==txHash)return{verified:false,result:{reason:'MARGIN_STORED_HASH'}};
    const evidence=await adapter!.readConfirmedEvidence({...bound.context,baseline:bound.child.baseline,txHash},bound.customer);
    applyMarginEvidence(bound.workflow,bound.child.step,bound.child.intentHash,txHash,evidence,now());
    return{verified:true,result:{margin_step_verification:{workflow_id:bound.workflow.id,operation_id:operationId,step:bound.child.step,tx_hash:txHash,ledger:evidence.ledger,delta_verified:true}}};
   }catch(error){return{verified:false,result:{reason:error instanceof GrapnelError?error.code:'MARGIN_EVIDENCE_UNAVAILABLE'}};}
  },
 };
}
