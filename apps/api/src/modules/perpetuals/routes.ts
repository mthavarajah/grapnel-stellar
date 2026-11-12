import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {GrapnelError,type CustomerContext,type ModuleId} from '@grapnel/contracts';
import {requireBusiness,requireCustomer,success} from '../../lib/context.js';
import type {PerpetualCustomerService} from './service.js';
import type {PerpetualScope} from './workflow-contract.js';
const identity=z.object({customer_id:z.string().uuid(),wallet_id:z.string().uuid()});
const accountInput=identity.extend({asset_class:z.enum(['perps','stocks']).default('perps')});
const marketId=z.string().regex(/^hyperliquid-testnet:(perps|stocks):(?:0|[1-9]\d{0,8})$/);
const positive=z.string().max(50).regex(/^(0|[1-9]\d{0,29})(\.\d{1,18})?$/);
const signature=z.string().regex(/^0x[0-9a-fA-F]{130}$/);
const stellarSignature=z.string().regex(/^(0x)?[0-9a-fA-F]{128}$/);
const customerScope=(c:CustomerContext):PerpetualScope=>({businessId:c.businessId,customerId:c.customerId,walletId:c.walletId,stellarAddress:c.walletAddress});
const moduleFor=(id:string):ModuleId=>id.startsWith('hyperliquid-testnet:stocks:')?'trade.stocks':'trade.perps';
export async function registerPerpetualCustomerRoutes(app:FastifyInstance,service:PerpetualCustomerService,verifyGate1:()=>Promise<boolean>){
 const base='/v1/trade/perpetuals';
 async function scope(request:FastifyRequest,input:z.infer<typeof identity>,module:ModuleId){await requireBusiness(request,module);return customerScope(await requireCustomer(request,input.customer_id,input.wallet_id));}
 app.get(base+'/account',async request=>{const q=accountInput.extend({market_id:marketId.optional()}).strict().parse(request.query);if(q.market_id&&moduleFor(q.market_id)!=='trade.'+q.asset_class)throw new GrapnelError(404,'NOT_FOUND','Market not found');const c=await scope(request,q,q.asset_class==='stocks'?'trade.stocks':'trade.perps');return success(request,await service.status(c,q.market_id));});
 app.post(base+'/accounts/challenge',{config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async request=>{const b=accountInput.extend({account_address:z.string().regex(/^0x[0-9a-fA-F]{40}$/)}).strict().parse(request.body),c=await scope(request,b,b.asset_class==='stocks'?'trade.stocks':'trade.perps');return success(request,await service.challenge(c,b.account_address as `0x${string}`));});
 app.post(base+'/accounts/bind',async request=>{const b=accountInput.extend({challenge_id:z.string().uuid(),stellar_signature:stellarSignature,evm_signature:signature}).strict().parse(request.body),c=await scope(request,b,b.asset_class==='stocks'?'trade.stocks':'trade.perps');await service.bind(c,b.challenge_id,b.stellar_signature,b.evm_signature as `0x${string}`);return success(request,await service.status(c));});
 app.post(base+'/orders/prepare',async request=>{
  const b=identity.extend({market_id:marketId,side:z.enum(['buy','sell']),size:positive,limit_price:positive,leverage:z.number().int().min(1).max(1000),reduce_only:z.boolean()}).strict().parse(request.body);
  const c=await scope(request,b,moduleFor(b.market_id)),key=request.headers['idempotency-key'];
  if(!await verifyGate1())throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Current customer signing proof is required');
  if(typeof key!=='string'||!z.string().regex(/^[\x21-\x7e]{1,200}$/).safeParse(key).success)throw new GrapnelError(400,'IDEMPOTENCY_KEY_REQUIRED','A unique request identifier is required');
  const {customer_id:_,wallet_id:__,...input}=b;return success(request,await service.prepare(c,input,key));
 });
 app.post(base+'/orders/:id/authorize',async request=>{
  const {id}=z.object({id:z.string().uuid()}).parse(request.params),b=identity.extend({stellar_signature:stellarSignature,evm_signature:signature}).strict().parse(request.body);
  await requireBusiness(request,'capital.wallets');const c=customerScope(await requireCustomer(request,b.customer_id,b.wallet_id)),order=await service.get(c,id);await requireBusiness(request,moduleFor(order.intent.marketId));
  if(!await verifyGate1())throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Current customer signing proof is required');
  return success(request,await service.authorize(c,id,b.stellar_signature,b.evm_signature as `0x${string}`));
 });
 app.get(base+'/orders/:id',async request=>{const {id}=z.object({id:z.string().uuid()}).parse(request.params),q=identity.strict().parse(request.query);await requireBusiness(request,'capital.wallets');const c=customerScope(await requireCustomer(request,q.customer_id,q.wallet_id)),order=await service.get(c,id);await requireBusiness(request,moduleFor(order.intent.marketId));return success(request,await service.reconcile(c,id));});
}
