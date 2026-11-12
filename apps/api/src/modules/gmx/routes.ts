import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {GrapnelError} from '@grapnel/contracts';
import {requireBusiness,requireCustomer,success} from '../../lib/context.js';
import type {GmxCustomerService} from './service.js';
import type {GmxGasTreasury} from './gas.js';
const identity=z.object({customer_id:z.string().uuid(),wallet_id:z.string().uuid()}),address=z.string().regex(/^0x[0-9a-fA-F]{40}$/),market=z.enum(['gmx-testnet:perps:ETH','gmx-testnet:perps:BTC']);
export async function registerGmxCustomerRoutes(app:FastifyInstance,d:{service:GmxCustomerService;gas:GmxGasTreasury|null;verifyGate1:()=>Promise<boolean>}){
 const base='/v1/trade/gmx';
 const scope=async(request:FastifyRequest,input:z.infer<typeof identity>)=>{await requireBusiness(request,'trade.perps');await requireBusiness(request,'capital.wallets');return requireCustomer(request,input.customer_id,input.wallet_id);};
 const key=(request:FastifyRequest)=>{const k=z.string().regex(/^[\x21-\x7e]{1,200}$/).safeParse(request.headers['idempotency-key']);if(!k.success)throw new GrapnelError(400,'IDEMPOTENCY_KEY_REQUIRED','A unique trading request identifier is required');return k.data;};
 const gate=async()=>{if(!await d.verifyGate1())throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Current customer signing proof is required');};
 app.get(base+'/status',async(request,reply)=>{reply.header('Cache-Control','private, no-store');const q=identity.extend({account_address:address.optional(),market_id:market}).strict().parse(request.query);return success(request,await d.service.status(await scope(request,q),q.account_address,q.market_id));});
 app.get(base+'/requests',async(request,reply)=>{reply.header('Cache-Control','private, no-store');const q=identity.extend({request_id:z.string().uuid().optional()}).strict().parse(request.query);return success(request,await d.service.get(await scope(request,q),q.request_id));});
 app.post(base+'/prepare',async(request,reply)=>{const b=identity.extend({account_address:address,kind:z.enum(['mint','approve','open','close']),market_id:market,is_long:z.boolean().optional(),amount:z.string().max(80).optional(),collateral:z.string().max(80).optional(),size_usd:z.string().max(80).optional(),slippage_bps:z.number().int().min(0).max(100).optional()}).strict().parse(request.body),c=await scope(request,b);await gate();const{customer_id:_,wallet_id:__,...input}=b;return reply.code(202).send(success(request,await d.service.prepare(c,input,key(request))));});
 app.post(base+'/authorize',async(request,reply)=>{const b=identity.extend({request_id:z.string().uuid(),signed_transaction:z.string().regex(/^0x[0-9a-fA-F]+$/).max(100000)}).strict().parse(request.body),c=await scope(request,b);key(request);await gate();return reply.code(202).send(success(request,await d.service.authorize(c,b.request_id,b.signed_transaction as `0x${string}`)));});
 app.post(base+'/gas',async(request,reply)=>{const b=identity.extend({account_address:address}).strict().parse(request.body),c=await scope(request,b);key(request);await gate();if(!d.gas||!await d.service.d.acceptance())throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Trading gas funding is unavailable');const account=await d.service.account(c,b.account_address);if(!account)throw new GrapnelError(403,'WALLET_OWNERSHIP_INVALID','Choose your connected trading wallet');return reply.code(202).send(success(request,await d.gas.grant(c,account)));});
}
