import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {GrapnelError} from '@grapnel/contracts';
import {requireBusiness,requireCustomer,success} from '../../lib/context.js';
import type {RobinhoodTreasury} from './treasury.js';
const identity=z.object({customer_id:z.string().uuid(),wallet_id:z.string().uuid(),account_address:z.string().regex(/^0x[a-f0-9]{40}$/i)});
export async function registerRobinhoodTreasuryRoutes(app:FastifyInstance,d:{treasury:RobinhoodTreasury|null;verifyGate1:()=>Promise<boolean>;readWallets:(c:Awaited<ReturnType<typeof requireCustomer>>)=>Promise<{address:string}[]>}){
 const scope=async(r:FastifyRequest,b:z.infer<typeof identity>)=>{await requireBusiness(r,'trade.stocks');await requireBusiness(r,'capital.wallets');return requireCustomer(r,b.customer_id,b.wallet_id);};
 app.get('/v1/trade/stocks/grants',async(request,reply)=>{const q=identity.strict().parse(request.query),c=await scope(request,q);reply.header('Cache-Control','private, no-store');if(d.treasury)return success(request,await d.treasury.status(c,q.account_address));if(!(await d.readWallets(c)).some(w=>w.address.toLowerCase()===q.account_address.toLowerCase()))throw new GrapnelError(403,'WALLET_OWNERSHIP_INVALID','Your funding account could not be verified');return success(request,{scope:{business_id:c.businessId,customer_id:c.customerId,wallet_id:c.walletId},account_address:q.account_address.toLowerCase(),state:null,stages:[],funding_available:false});});
 app.post('/v1/trade/stocks/fund',async(request,reply)=>{const b=identity.strict().parse(request.body),c=await scope(request,b),key=z.string().regex(/^[\x21-\x7e]{1,200}$/).parse(request.headers['idempotency-key']);if(!d.treasury||!await d.verifyGate1())throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Stock funding is being prepared');return reply.code(202).send(success(request,await d.treasury.grant(c,b.account_address,key)));});
}
