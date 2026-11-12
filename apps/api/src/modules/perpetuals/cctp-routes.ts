import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {GrapnelError} from '@grapnel/contracts';
import {requireBusiness,requireCustomer,success} from '../../lib/context.js';
import type {CctpFundingCoordinator} from './cctp-service.js';
import type {CctpBurnExecutionBridge} from './cctp-burn-execution.js';
const identity=z.object({customer_id:z.string().uuid(),wallet_id:z.string().uuid()});
const id=z.string().uuid(),step=z.enum(['cctp.receive','core.approve','core.deposit']);
export async function registerCctpCustomerRoutes(app:FastifyInstance,service:CctpFundingCoordinator,burn:CctpBurnExecutionBridge){
 const base='/v1/trade/perpetuals/funding';
 const scope=async(request:FastifyRequest,input:z.infer<typeof identity>)=>{await requireBusiness(request,'trade.perps');await requireBusiness(request,'capital.wallets');const c=await requireCustomer(request,input.customer_id,input.wallet_id);return {businessId:c.businessId,customerId:c.customerId,walletId:c.walletId,stellarAddress:c.walletAddress};};
 const key=(request:FastifyRequest)=>{const value=z.string().regex(/^[\x21-\x7e]{1,200}$/).safeParse(request.headers['idempotency-key']);if(!value.success)throw new GrapnelError(400,'IDEMPOTENCY_KEY_REQUIRED','A unique funding request identifier is required');return value.data;};
 app.get(base,async request=>{const q=identity.extend({funding_id:id.optional()}).strict().parse(request.query);return success(request,await service.get(await scope(request,q),q.funding_id));});
 app.post(base+'/prepare',async(request,reply)=>{const b=identity.extend({amount:z.string().max(50)}).strict().parse(request.body);return reply.code(202).send(success(request,await service.prepare(await scope(request,b),b.amount,key(request))));});
 app.post(base+'/source-review',async request=>{const b=identity.extend({funding_id:id}).strict().parse(request.body);const s=await scope(request,b);await service.idempotency(s,b.funding_id,base+'/source-review',key(request),b);return success(request,await service.reviewSource(s,b.funding_id));});
 app.post(base+'/source-authorize',async(request,reply)=>{
  const b=identity.extend({funding_id:id,customer_action_token:z.string().min(1).max(200),signed_xdr:z.string().min(1).max(100000)}).strict().parse(request.body),s=await scope(request,b);await service.idempotency(s,b.funding_id,base+'/source-authorize',key(request),b);
  if(!await service.d.store.get(s,b.funding_id))throw new GrapnelError(404,'NOT_FOUND','Funding request not found');
  await service.d.operations.authorize({businessId:s.businessId,customerId:s.customerId,operationId:b.funding_id,token:b.customer_action_token,signedXdr:b.signed_xdr,verify:(action,signed)=>burn.verifyForSubmission(action,signed)});
  return reply.code(202).send(success(request,await service.get(s,b.funding_id)));
 });
 app.post(base+'/stage-prepare',async(request,reply)=>{const b=identity.extend({funding_id:id,step}).strict().parse(request.body);const s=await scope(request,b);await service.idempotency(s,b.funding_id,base+'/stage-prepare',key(request),b);return reply.code(202).send(success(request,await service.prepareStage(s,b.funding_id,b.step)));});
 app.post(base+'/stage-authorize',async(request,reply)=>{const b=identity.extend({funding_id:id,stage_id:id,step,signed_transaction:z.string().regex(/^0x[0-9a-fA-F]+$/).max(100000)}).strict().parse(request.body);const s=await scope(request,b);await service.idempotency(s,b.funding_id,base+'/stage-authorize',key(request),b);return reply.code(202).send(success(request,await service.authorizeStage(s,b.funding_id,b.stage_id,b.step,b.signed_transaction as `0x${string}`)));});
}
