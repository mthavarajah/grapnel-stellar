import {randomUUID} from 'node:crypto';
import {GrapnelError,NETWORK,PreparedActionSchema,type CustomerContext,type Operation} from '@grapnel/contracts';
import type {PoolClient,QueryResultRow} from 'pg';
import {lock,transaction} from '../../db/index.js';
import {canonicalJson,digest} from '../../lib/crypto.js';
import {OperationService} from '../operations/service.js';
import {applyMarginEvidence,assertNextMarginStep,atomic,validateMarginTerms} from './state.js';
import type {MarginAdapter,MarginChild,MarginStep,MarginStepContext,MarginStepTerms,MarginTerms,MarginWorkflow} from './types.js';
import {MARGIN_STEP_ACTIONS} from './types.js';

const missing=():never=>{throw new GrapnelError(404,'NOT_FOUND','Margin workflow not found');};
const conflict=(reason:string):never=>{throw new GrapnelError(409,'MARGIN_WORKFLOW_CONFLICT','Margin workflow changed or awaits reconciliation',false,{reason});};
const rowWorkflow=(r:QueryResultRow):MarginWorkflow=>({id:r.id,businessId:r.business_id,customerId:r.customer_id,walletId:r.wallet_id,walletAddress:r.wallet_address,terms:r.terms_json,termsHash:r.terms_hash,revision:r.revision,phase:r.phase,positionId:r.position_id??null,receiptAtomic:r.receipt_atomic??null,activeOperationId:r.active_operation_id??null,createdAt:new Date(r.created_at).toISOString(),updatedAt:new Date(r.updated_at).toISOString()});
const rowChild=(r:QueryResultRow):MarginChild=>({workflowId:r.workflow_id,businessId:r.business_id,customerId:r.customer_id,walletId:r.wallet_id,operationId:r.operation_id,step:r.step,attempt:r.attempt,terms:r.step_terms,intentHash:r.intent_hash,baseline:r.baseline_json,evidence:r.evidence_json??null});
/** Durable orchestration only: never signs or broadcasts. Root registers routes/worker bindings only after actual adapter steps are proven. */
export class MarginWorkflowService {
 constructor(readonly operations:OperationService,private readonly adapter:MarginAdapter,private readonly approvedPolicy:{pinsHash:string;policyVersion:string},private readonly now=Date.now){}
 private async binding(client:Pick<PoolClient,'query'>,customer:CustomerContext):Promise<void>{
  const found=await client.query('SELECT id FROM wallets WHERE business_id=$1 AND customer_id=$2 AND id=$3 AND stellar_address=$4',[customer.businessId,customer.customerId,customer.walletId,customer.walletAddress]);if(found.rowCount!==1)return missing();
 }
 private async read(client:Pick<PoolClient,'query'>,customer:CustomerContext,id:string,locked=false):Promise<MarginWorkflow>{
  const row=(await client.query(`SELECT * FROM margin_workflows WHERE business_id=$1 AND customer_id=$2 AND wallet_id=$3 AND id=$4 ${locked?'FOR UPDATE':''}`,[customer.businessId,customer.customerId,customer.walletId,id])).rows[0];
  if(!row||row.wallet_address!==customer.walletAddress)return missing();const workflow=rowWorkflow(row);
  validateMarginTerms(workflow.terms);if(workflow.termsHash!==digest(canonicalJson(workflow.terms))||workflow.terms.pinsHash!==this.approvedPolicy.pinsHash||workflow.terms.policyVersion!==this.approvedPolicy.policyVersion)return conflict('FROZEN_POLICY_CHANGED');
  return workflow;
 }
 async get(customer:CustomerContext,id:string):Promise<MarginWorkflow>{await this.binding(this.operations.pool,customer);return this.read(this.operations.pool,customer,id);}
 async create(customer:CustomerContext,terms:MarginTerms,idempotencyKey:string):Promise<MarginWorkflow>{
  validateMarginTerms(terms);if(!idempotencyKey||idempotencyKey.length>200)throw new GrapnelError(400,'IDEMPOTENCY_KEY_REQUIRED','Idempotency-Key must contain 1–200 characters');
  if(terms.pinsHash!==this.approvedPolicy.pinsHash||terms.policyVersion!==this.approvedPolicy.policyVersion)return conflict('POLICY_NOT_APPROVED');
  await this.binding(this.operations.pool,customer);await this.adapter.validateWorkflowTerms(terms,customer);
  const termsHash=digest(canonicalJson(terms));
  return transaction(this.operations.pool,async client=>{
   await this.binding(client,customer);await lock(client,`margin-workflow-create:${customer.businessId}:${idempotencyKey}`);await lock(client,`wallet:${customer.businessId}:${customer.walletId}`);
   const existing=(await client.query('SELECT * FROM margin_workflows WHERE business_id=$1 AND creation_key=$2',[customer.businessId,idempotencyKey])).rows[0];
   if(existing){if(existing.customer_id!==customer.customerId||existing.wallet_id!==customer.walletId||existing.terms_hash!==termsHash)throw new GrapnelError(409,'IDEMPOTENCY_CONFLICT','This idempotency key was used with a different workflow');return this.read(client,customer,existing.id);}
   const pending=(await client.query("SELECT id FROM margin_workflows WHERE business_id=$1 AND wallet_id=$2 AND phase<>'recovered' LIMIT 1",[customer.businessId,customer.walletId])).rows[0];if(pending)return conflict('ANOTHER_MARGIN_WORKFLOW');
   const row=(await client.query("INSERT INTO margin_workflows(id,business_id,customer_id,wallet_id,wallet_address,creation_key,terms_json,terms_hash,phase,revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'awaiting_collateral',0) RETURNING *",[randomUUID(),customer.businessId,customer.customerId,customer.walletId,customer.walletAddress,idempotencyKey,JSON.stringify(terms),termsHash])).rows[0];return rowWorkflow(row);
  });
 }
 async prepare(customer:CustomerContext,id:string,step:MarginStep,terms:MarginStepTerms,idempotencyKey:string):Promise<{operation:Operation;created:boolean}>{
  // Identity and policy checked even on an idempotent replay; no caller-supplied workflow/position/evidence is accepted.
  await this.get(customer,id);
  return this.operations.createIdempotent({businessId:customer.businessId,customerId:customer.customerId,walletId:customer.walletId,module:'trade.perps',provider:'peridot',type:MARGIN_STEP_ACTIONS[step],route:`/v1/trade/margin/workflows/${id}/steps/${step}`,idempotencyKey,request:{workflow_id:id,step,terms}},async(client,operationId)=>{
   await this.binding(client,customer);const workflow=await this.read(client,customer,id,true);assertNextMarginStep(workflow,step,terms);
   const intentHash=digest(canonicalJson({workflowId:id,termsHash:workflow.termsHash,step,terms,positionId:workflow.positionId,receiptAtomic:workflow.receiptAtomic}));
   const context:MarginStepContext={workflow,step,terms,intentHash,operationId};
   await this.adapter.assertStepReady(context,customer);
   const result=await this.adapter.prepareStep(context,customer),prepared=PreparedActionSchema.parse(result.prepared),expiry=Date.parse(prepared.authorization.expiresAt);
   const fee=atomic(prepared.summary.maxFeeStroops,true),cap=atomic(step==='vault_deposit'?workflow.terms.depositMaxFeeStroops:workflow.terms.maxFeeStroops,true);
   if(prepared.operationId!==operationId||prepared.customerId!==customer.customerId||prepared.walletAddress!==customer.walletAddress||prepared.network!==NETWORK||prepared.summary.action!==MARGIN_STEP_ACTIONS[step]||prepared.authorization.method!=='privy_stellar'||expiry<=this.now()||expiry>this.now()+120000||Date.parse(prepared.summary.expiresAt)!==expiry||fee>cap)throw new GrapnelError(403,'PREPARED_ACTION_MISMATCH','Margin preparation does not match this exact customer step');
   if(result.reservations.length===0||!result.reservations.some(r=>r.assetId==='stellar-testnet:native:XLM'&&r.amountAtomic>=fee))throw new GrapnelError(403,'MARGIN_FEE_RESERVATION_REQUIRED','Margin preparation must reserve the full exact XLM fee');
   const principalAsset=step==='vault_deposit'?workflow.terms.marginAssetId:step==='margin_transfer'||step==='vault_withdraw'?workflow.terms.receiptAssetId:null;
   const principal=step==='vault_deposit'?atomic(workflow.terms.collateralAtomic,true):principalAsset?atomic(workflow.receiptAtomic,true):0n;
   const expectedReservations=new Map<string,bigint>([['stellar-testnet:native:XLM',fee]]);
   if(principalAsset)expectedReservations.set(principalAsset,(expectedReservations.get(principalAsset)??0n)+principal);
   const totals=new Map<string,bigint>();for(const r of result.reservations)totals.set(r.assetId,(totals.get(r.assetId)??0n)+r.amountAtomic);
   if(totals.size!==expectedReservations.size||[...expectedReservations].some(([asset,amount])=>totals.get(asset)!==amount))throw new GrapnelError(403,'MARGIN_RESERVATION_MISMATCH','Margin preparation must reserve only the exact approved wallet principal and fee');
   for(const reservation of result.reservations)await this.operations.reserve(client,{...reservation,businessId:customer.businessId,customerId:customer.customerId,walletId:customer.walletId,operationId,expiresAt:new Date(expiry)});
   const attempt=Number((await client.query('SELECT COALESCE(max(attempt),0)+1 AS attempt FROM margin_workflow_steps WHERE business_id=$1 AND workflow_id=$2 AND step=$3',[customer.businessId,id,step])).rows[0].attempt);
   await client.query('INSERT INTO margin_workflow_steps(business_id,customer_id,wallet_id,workflow_id,operation_id,step,attempt,step_terms,intent_hash,baseline_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[customer.businessId,customer.customerId,customer.walletId,id,operationId,step,attempt,JSON.stringify(terms),intentHash,JSON.stringify(result.baseline)]);
   const updated=await client.query('UPDATE margin_workflows SET active_operation_id=$5,revision=revision+1,updated_at=now() WHERE business_id=$1 AND customer_id=$2 AND wallet_id=$3 AND id=$4 AND revision=$6 AND active_operation_id IS NULL',[customer.businessId,customer.customerId,customer.walletId,id,operationId,workflow.revision]);if(updated.rowCount!==1)return conflict('REVISION');
   await this.operations.setPrepared(client,customer.businessId,operationId,prepared);
  });
 }
 /** No advance on accepted/submitted/timeout. Independently verify the same completed child hash, then atomically persist normalized evidence and parent transition. */
 async reconcile(customer:CustomerContext,id:string):Promise<MarginWorkflow>{
  const current=await this.get(customer,id);if(!current.activeOperationId)return current;
  const childRow=(await this.operations.pool.query("SELECT s.*,o.state AS operation_state,o.tx_hash,o.signed_xdr FROM margin_workflow_steps s JOIN operations o ON(o.business_id=s.business_id AND o.customer_id=s.customer_id AND o.wallet_id=s.wallet_id AND o.id=s.operation_id AND o.module_code='trade.perps' AND o.provider='peridot') WHERE s.business_id=$1 AND s.customer_id=$2 AND s.wallet_id=$3 AND s.workflow_id=$4 AND s.operation_id=$5",[customer.businessId,customer.customerId,customer.walletId,id,current.activeOperationId])).rows[0];if(!childRow)return conflict('CHILD_NOT_FOUND');
  const child=rowChild(childRow);
  if(['expired','rejected','failed'].includes(childRow.operation_state)&&!childRow.tx_hash&&!childRow.signed_xdr){
   return transaction(this.operations.pool,async client=>{const fresh=await this.read(client,customer,id,true);if(fresh.revision!==current.revision||fresh.activeOperationId!==child.operationId)return conflict('REVISION');await client.query('UPDATE margin_workflows SET active_operation_id=NULL,revision=revision+1,updated_at=now() WHERE business_id=$1 AND id=$2',[customer.businessId,id]);return this.read(client,customer,id);});
  }
  if(childRow.operation_state!=='completed'||typeof childRow.tx_hash!=='string')return current;
  if(typeof childRow.signed_xdr!=='string'||!childRow.signed_xdr)return conflict('CUSTOMER_SIGNATURE_REQUIRED');
  const context:MarginStepContext={workflow:current,step:child.step,terms:child.terms,intentHash:child.intentHash,operationId:child.operationId};
  const evidence=await this.adapter.readConfirmedEvidence({...context,baseline:child.baseline,txHash:childRow.tx_hash},customer);
  const next=applyMarginEvidence(current,child.step,child.intentHash,childRow.tx_hash,evidence,this.now());
  return transaction(this.operations.pool,async client=>{
   const fresh=await this.read(client,customer,id,true);if(fresh.revision!==current.revision||fresh.activeOperationId!==child.operationId)return conflict('REVISION');
   const op=(await client.query('SELECT state,tx_hash FROM operations WHERE business_id=$1 AND customer_id=$2 AND wallet_id=$3 AND id=$4 FOR UPDATE',[customer.businessId,customer.customerId,customer.walletId,child.operationId])).rows[0];if(op?.state!=='completed'||op.tx_hash!==evidence.txHash)return conflict('CHAIN_STATUS_CHANGED');
   await client.query('UPDATE margin_workflow_steps SET evidence_json=$5,confirmed_at=now() WHERE business_id=$1 AND customer_id=$2 AND workflow_id=$3 AND operation_id=$4 AND evidence_json IS NULL',[customer.businessId,customer.customerId,id,child.operationId,JSON.stringify(evidence)]);
   await client.query('UPDATE margin_workflows SET phase=$3,position_id=$4,receipt_atomic=$5,active_operation_id=NULL,revision=revision+1,updated_at=now() WHERE business_id=$1 AND id=$2',[customer.businessId,id,next.phase,next.positionId,next.receiptAtomic]);return this.read(client,customer,id);
  });
 }
}
