import {z} from 'zod';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {GrapnelError,MarginCustomerBindingSchema,MarginWorkflowInputSchema,MarginStepSchema,MarginStepInputSchema,MarginStepTermsSchema,MarginWorkflowPublicSchema,MarginStepQuoteSchema,type MarginWorkflowPublic,type CustomerContext,type ExecutionStatus} from '@grapnel/contracts';
import {requireBusiness,requireCustomer,success} from '../../lib/context.js';
import {orderedMarginSteps} from './state.js';
import {MARGIN_STEPS,type MarginStep,type MarginStepTerms,type MarginTerms,type MarginWorkflow} from './types.js';
import type {MarginWorkflowService} from './service.js';

const identity=MarginCustomerBindingSchema,createInput=MarginWorkflowInputSchema;
const workflowParams=z.object({id:z.string().uuid()}).strict();
const stepParams=workflowParams.extend({step:MarginStepSchema}).strict();
const atomicInput=MarginStepTermsSchema.shape.minimumOutputAtomic.unwrap();
const stepInput=MarginStepInputSchema;
const keySchema=z.string().regex(/^[\x21-\x7e]{1,200}$/);
const quoteSchema=MarginStepQuoteSchema.pick({terms:true,expires_at:true});
export type MarginWorkflowCreateInput=Omit<z.infer<typeof createInput>,'customer_id'|'wallet_id'>;
export interface MarginWorkflowReadiness {execution_status:ExecutionStatus;preparation_available:boolean;steps:readonly MarginStep[];reason?:string;}
export type MarginPublicWorkflow=MarginWorkflowPublic;
export interface MarginRoutesDependencies {
 service?:Pick<MarginWorkflowService,'create'|'get'|'list'|'prepare'|'reconcile'>;
 /** Server constructs exact approved terms, identities, pins and policy; caller never supplies full terms. */
 termsFor?:(input:MarginWorkflowCreateInput,customer:CustomerContext)=>Promise<MarginTerms>;
 creationReadyFor?:(terms:MarginTerms,customer:CustomerContext)=>Promise<boolean>;
 readinessFor?:(workflow:MarginWorkflow,customer:CustomerContext)=>Promise<MarginWorkflowReadiness>;
 quoteFor?:(workflow:MarginWorkflow,step:MarginStep,customer:CustomerContext)=>Promise<{terms:MarginStepTerms;expires_at:string}>;
}
const unavailable=(reason='MARGIN_EXECUTION_PROOF_REQUIRED'):never=>{throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Verified Margin preparation is unavailable',false,{reason});};
function serviceFor(deps:MarginRoutesDependencies){if(!deps.service)return unavailable();return deps.service;}
function idempotencyKey(request:FastifyRequest):string {
 const result=keySchema.safeParse(request.headers['idempotency-key']);if(!result.success)throw new GrapnelError(400,'IDEMPOTENCY_KEY_REQUIRED','Idempotency-Key must contain 1–200 visible ASCII characters');return result.data;
}
function exactStepTerms(step:MarginStep,terms:MarginStepTerms):MarginStepTerms {
 const shape=step==='open_begin'||step==='close_atomic'||step==='close_swap'?z.object({minimumOutputAtomic:atomicInput}).strict():step==='close_short_swap'?z.object({maximumInputAtomic:atomicInput,minimumDebtOutputAtomic:atomicInput}).strict():z.object({}).strict();return shape.parse(terms);
}
async function readiness(deps:MarginRoutesDependencies,w:MarginWorkflow,c:CustomerContext):Promise<MarginWorkflowReadiness>{
 if(!deps.readinessFor)return{execution_status:'blocked',preparation_available:false,steps:[]};
 const r=await deps.readinessFor(w,c);
 // Trust no optimistic default: only explicit current Testnet proof can enable a step.
 if(r.execution_status!=='testnet_verified'||r.preparation_available!==true)return{execution_status:r.execution_status,preparation_available:false,steps:[],...(r.reason?{reason:r.reason}:{})};
 return{...r,steps:r.steps.filter(s=>MARGIN_STEPS.includes(s))};
}
async function serialize(deps:MarginRoutesDependencies,w:MarginWorkflow,c:CustomerContext):Promise<MarginPublicWorkflow>{
 const r=await readiness(deps,w,c),next=orderedMarginSteps(w).filter(s=>r.steps.includes(s));
 return MarginWorkflowPublicSchema.parse({workflow_id:w.id,customer_id:w.customerId,wallet_id:w.walletId,market_id:w.terms.marketId,direction:w.terms.direction,leverage:w.terms.leverage,amount_atomic:w.terms.collateralAtomic,asset_id:w.terms.marginAssetId,phase:w.phase,revision:w.revision,position_id:w.positionId,active_operation_id:w.activeOperationId,...(w.receiptAtomic===null?{}:{receipt_atomic:w.receiptAtomic}),created_at:w.createdAt,updated_at:w.updatedAt,next_steps:next,execution_status:r.execution_status,preparation_available:r.preparation_available&&next.length>0,...(r.reason?{reason:r.reason}:{})});
}
/** Routes retain the existing operation authorization endpoint; no browser evidence/hash/pins is accepted. */
export async function registerMarginRoutes(app:FastifyInstance,deps:MarginRoutesDependencies):Promise<void>{
 const base='/v1/trade/margin/workflows';
 app.post(base,async(request,reply)=>{
  await requireBusiness(request,'trade.perps');const input=createInput.parse(request.body),key=idempotencyKey(request),customer=await requireCustomer(request,input.customer_id,input.wallet_id),service=serviceFor(deps);if(!deps.termsFor)return unavailable();
  const {customer_id:_,wallet_id:__,...economics}=input,terms=await deps.termsFor(economics,customer);if(!deps.creationReadyFor||!await deps.creationReadyFor(terms,customer))return unavailable();const workflow=await service.create(customer,terms,key);reply.code(201);return success(request,await serialize(deps,workflow,customer));
 });
 app.get(base,async request=>{
  await requireBusiness(request,'trade.perps');const query=identity.parse(request.query),customer=await requireCustomer(request,query.customer_id,query.wallet_id),workflows=await serviceFor(deps).list(customer);return success(request,{workflows:await Promise.all(workflows.map(w=>serialize(deps,w,customer)))});
 });
 app.get(`${base}/:id`,async request=>{
  await requireBusiness(request,'trade.perps');const {id}=workflowParams.parse(request.params),query=identity.parse(request.query),customer=await requireCustomer(request,query.customer_id,query.wallet_id),workflow=await serviceFor(deps).get(customer,id);return success(request,await serialize(deps,workflow,customer));
 });
 app.post(`${base}/:id/reconcile`,async request=>{
  await requireBusiness(request,'trade.perps');const {id}=workflowParams.parse(request.params),body=identity.parse(request.body),customer=await requireCustomer(request,body.customer_id,body.wallet_id),workflow=await serviceFor(deps).reconcile(customer,id);return success(request,await serialize(deps,workflow,customer));
 });
 app.post(`${base}/:id/steps/:step`,async(request,reply)=>{
  await requireBusiness(request,'trade.perps');const {id,step}=stepParams.parse(request.params),body=stepInput.parse(request.body),terms=exactStepTerms(step,body.terms),key=idempotencyKey(request),customer=await requireCustomer(request,body.customer_id,body.wallet_id);
  const result=await serviceFor(deps).prepare(customer,id,step,terms,key);reply.code(202);return success(request,result.operation);
 });
 app.post(`${base}/:id/steps/:step/quote`,async request=>{
  await requireBusiness(request,'trade.perps');const {id,step}=stepParams.parse(request.params),body=identity.parse(request.body),customer=await requireCustomer(request,body.customer_id,body.wallet_id),service=serviceFor(deps),workflow=await service.get(customer,id),r=await readiness(deps,workflow,customer);
  if(!r.preparation_available||!r.steps.includes(step)||!orderedMarginSteps(workflow).includes(step))return unavailable('MARGIN_STEP_NOT_READY');if(!deps.quoteFor)return unavailable('MARGIN_QUOTE_REQUIRED');
  const quote=quoteSchema.parse(await deps.quoteFor(workflow,step,customer)),terms=exactStepTerms(step,quote.terms),expiry=Date.parse(quote.expires_at),now=Date.now();
  if(expiry<=now||expiry>now+120000)throw new GrapnelError(502,'INVALID_MARGIN_QUOTE','Margin quote expiry is outside the approved interval');
  const fresh=await service.get(customer,id);if(fresh.revision!==workflow.revision||fresh.activeOperationId!==workflow.activeOperationId)throw new GrapnelError(409,'MARGIN_WORKFLOW_CONFLICT','Margin workflow changed while preparing a quote');
  return success(request,MarginStepQuoteSchema.parse({workflow_id:id,step,revision:workflow.revision,terms,expires_at:quote.expires_at}));
 });
}
