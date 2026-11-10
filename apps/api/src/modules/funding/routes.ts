import type { FastifyInstance, FastifyRequest } from 'fastify';
import { FundingInputSchema, type CustomerContext } from '@grapnel/contracts';
import type { FundingService } from './service.js';

/** Auth/context are the shared API helpers; this module cannot create customer authority. */
export interface FundingRouteDependencies {
  service:FundingService;
  requireBusiness(request:FastifyRequest,module:'capital.testnet_funding'):Promise<unknown>;
  requireCustomer(request:FastifyRequest,customerId:string,walletId:string):Promise<CustomerContext>;
  success(request:FastifyRequest,data:unknown):unknown;
}
export async function registerFundingRoutes(app:FastifyInstance,deps:FundingRouteDependencies):Promise<void> {
  app.get('/v1/capital/testnet/funding-assets',async request=>{
    await deps.requireBusiness(request,'capital.testnet_funding');
    return deps.success(request,await deps.service.adapter.discoverAssets());
  });
  for (const direction of ['fund','return'] as const) {
    app.post(`/v1/capital/testnet/${direction}`,async (request,reply)=>{
      await deps.requireBusiness(request,'capital.testnet_funding');
      const body=FundingInputSchema.parse(request.body);
      const customer=await deps.requireCustomer(request,body.customer_id,body.wallet_id);
      const key=request.headers['idempotency-key'];
      const result=await deps.service.create(direction,body,customer,typeof key==='string'?key:'');
      return reply.code(202).send(deps.success(request,result.operation));
    });
  }
}
