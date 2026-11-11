import {randomUUID} from 'node:crypto';
import Fastify,{type FastifyInstance} from 'fastify';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Keypair} from '@stellar/stellar-sdk';
import {GrapnelError,XLM,fromAtomic,toAtomic,type CustomerContext} from '@grapnel/contracts';
import {ZodError} from 'zod';
import {PERIDOT_COLLATERAL,PERIDOT_TESTNET_PINS as P} from '../../adapters/peridot/config.js';
import {requireBusiness,requireCustomer} from '../../lib/context.js';
import type {OperationService} from '../operations/service.js';
import {registerMarginFundingRoutes,type MarginCollateralFundingAdapter} from './index.js';
vi.mock('../../lib/context.js',()=>({requireBusiness:vi.fn(),requireCustomer:vi.fn(),success:(_request:unknown,data:unknown)=>({data})}));
describe('Margin collateral acquisition routes (explicit offline adapter)',()=>{
 let app:FastifyInstance,adapter:MarginCollateralFundingAdapter,operations:OperationService,customer:CustomerContext;
 const reserve=vi.fn(),setPrepared=vi.fn(),query=vi.fn(async()=>({rows:[],rowCount:1}));
 const post=(path:string,body:Record<string,unknown>,headers:Record<string,string>={})=>app.inject({method:'POST',url:'/v1/trade/margin/collateral/'+path,payload:{customer_id:customer.customerId,wallet_id:customer.walletId,...body},headers});
 beforeEach(async()=>{
  vi.clearAllMocks();customer={businessId:randomUUID(),customerId:randomUUID(),walletId:randomUUID(),walletAddress:Keypair.random().publicKey(),privyUserId:'did:privy:offline'};
  vi.mocked(requireBusiness).mockResolvedValue({} as never);vi.mocked(requireCustomer).mockResolvedValue(customer);
  adapter={quoteCollateral:vi.fn(async({amount})=>{const expected=toAtomic(amount,7)*153n/1000n;return{from_asset_id:XLM.id,to_asset_id:PERIDOT_COLLATERAL.id,amount_in_atomic:toAtomic(amount,7).toString(),expected_out_atomic:expected.toString(),minimum_out_atomic:((expected*995n+999n)/1000n).toString(),expires_at:new Date(Date.now()+60000).toISOString()};}),prepareCollateralSwap:vi.fn(async(input:Parameters<MarginCollateralFundingAdapter['prepareCollateralSwap']>[0])=>{const expiresAt=new Date(Date.now()+60000).toISOString();return{prepared:{operationId:input.operationId,customerId:customer.customerId,walletAddress:customer.walletAddress,network:'stellar-testnet' as const,unsignedXdr:'OFFLINE-FIXTURE-ONLY',signingHashHex:'a'.repeat(64),summary:{action:'margin.collateral_swap',fromAssetId:XLM.id,toAssetId:PERIDOT_COLLATERAL.id,amount:input.amount,minReceive:fromAtomic(BigInt(input.minimumOutputAtomic),7),recipient:customer.walletAddress,contractId:P.aquarius_pool.address,maxFeeStroops:'100',expiresAt},authorization:{method:'privy_stellar' as const,expiresAt}},baseline:{offline:true},reservations:[{assetId:XLM.id,amountAtomic:toAtomic(input.amount,7)+100n,spendableAtomic:10000000000n,observedAt:new Date()}]};}),verifyCollateralSwap:vi.fn(),readFundingEvidence:vi.fn()};
  operations={createIdempotent:vi.fn(async(_input,prepare)=>{await prepare!({query} as never,'00000000-0000-4000-8000-000000000009');return{created:true,operation:{operation_id:'00000000-0000-4000-8000-000000000009',status:'awaiting_customer_authorization',tx_hash:null}};}),reserve,setPrepared} as unknown as OperationService;
  app=Fastify();app.setErrorHandler((error,_request,reply)=>reply.code(error instanceof GrapnelError?error.statusCode:error instanceof ZodError?422:500).send({error:{code:error instanceof GrapnelError?error.code:'VALIDATION_ERROR'}}));
  await registerMarginFundingRoutes(app,{operations,adapter,ready:async()=>true});
 });
 afterEach(async()=>{await app.close();});
 it('quotes only fixed assets and prepares a separate durable approval with exact input plus fee',async()=>{
  const quote=await post('quote',{amount:'10'});expect(quote.statusCode).toBe(200);const q=quote.json().data;expect(q.to_asset_id).toBe(PERIDOT_COLLATERAL.id);
  const prepared=await post('swap',{amount:'10',minimum_output_atomic:q.minimum_out_atomic},{'idempotency-key':'fund-1'});expect(prepared.statusCode).toBe(202);expect(prepared.json().data.status).toBe('awaiting_customer_authorization');expect(prepared.json().data.tx_hash).toBeNull();
  expect(reserve.mock.calls[0]![1]).toMatchObject({assetId:XLM.id,amountAtomic:100000100n});expect(setPrepared).toHaveBeenCalledOnce();expect(vi.mocked(requireBusiness).mock.calls.every(call=>call[1]==='trade.perps')).toBe(true);
 });
 it.each(['0','-1','10.0000001','1e1','0.00000001'])('rejects invalid or excessive input %s before provider access',async amount=>{expect((await post('quote',{amount})).statusCode).toBe(422);expect(adapter.quoteCollateral).not.toHaveBeenCalled();});
 it.each(['recipient','network','to_asset_id','evidence'])('rejects caller-owned %s overrides',async field=>{expect((await post('quote',{amount:'1',[field]:'caller'})).statusCode).toBe(422);expect(adapter.quoteCollateral).not.toHaveBeenCalled();});
 it('enforces module and customer binding before quotes or approval creation',async()=>{vi.mocked(requireBusiness).mockRejectedValueOnce(new GrapnelError(403,'MODULE_DISABLED','disabled'));expect((await post('quote',{amount:'1'})).statusCode).toBe(403);vi.mocked(requireCustomer).mockRejectedValueOnce(new GrapnelError(404,'NOT_FOUND','foreign wallet'));expect((await post('quote',{amount:'1'})).statusCode).toBe(404);expect(adapter.quoteCollateral).not.toHaveBeenCalled();});
 it('rejects a weakened or expired provider quote',async()=>{const original=await adapter.quoteCollateral({amount:'1'},customer);vi.mocked(adapter.quoteCollateral).mockResolvedValueOnce({...original,minimum_out_atomic:'1'});expect((await post('quote',{amount:'1'})).statusCode).toBe(502);vi.mocked(adapter.quoteCollateral).mockResolvedValueOnce({...original,expires_at:new Date(Date.now()-1).toISOString()});expect((await post('quote',{amount:'1'})).statusCode).toBe(502);});
 it('rejects stale user minimums before reserving or preparing',async()=>{expect((await post('swap',{amount:'1',minimum_output_atomic:'1'},{'idempotency-key':'stale'})).statusCode).toBe(409);expect(adapter.prepareCollateralSwap).not.toHaveBeenCalled();expect(reserve).not.toHaveBeenCalled();});
 it('requires idempotency before creating an approval',async()=>{expect((await post('swap',{amount:'1',minimum_output_atomic:'1522350'})).statusCode).toBe(400);expect(operations.createIdempotent).not.toHaveBeenCalled();});
 it('rejects mismatched approval recipients before reservations',async()=>{const original=await adapter.prepareCollateralSwap({operationId:'00000000-0000-4000-8000-000000000009',amount:'1',minimumOutputAtomic:'1522350'},customer);original.prepared.summary.recipient=Keypair.random().publicKey();vi.mocked(adapter.prepareCollateralSwap).mockResolvedValueOnce(original);expect((await post('swap',{amount:'1',minimum_output_atomic:'1522350'},{'idempotency-key':'recipient'})).statusCode).toBe(403);expect(reserve).not.toHaveBeenCalled();});
 it('defaults to unavailable when no reviewed provider is supplied',async()=>{const closed=Fastify();closed.setErrorHandler((error,_request,reply)=>reply.code((error as GrapnelError).statusCode).send({}));await registerMarginFundingRoutes(closed,{operations});const response=await closed.inject({method:'POST',url:'/v1/trade/margin/collateral/quote',payload:{customer_id:customer.customerId,amount:'1'}});expect(response.statusCode).toBe(409);await closed.close();});
});
