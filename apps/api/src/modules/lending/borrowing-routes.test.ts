import {randomUUID} from 'node:crypto';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Asset,Keypair} from '@stellar/stellar-sdk';
import {createRequire} from 'node:module';
import {GrapnelError,NETWORK_PASSPHRASE,XLM,type CustomerContext,type PreparedAction,type WalletBalance} from '@grapnel/contracts';
vi.mock('../../lib/context.js',()=>({requireBusiness:vi.fn(),requireCustomer:vi.fn(),success:(_request:unknown,data:unknown)=>({data})}));
import {requireBusiness,requireCustomer} from '../../lib/context.js';
import {registerBorrowingRoutes} from './borrowing-routes.js';
import {BORROW_POOL_ID,type BorrowingAdapter,type BorrowingPosition} from './borrowing.js';
import type {OperationService} from '../operations/service.js';
const require=createRequire(new URL('../../package.json',import.meta.url));
const Fastify=require('fastify') as typeof import('fastify').default;
const wallet=Keypair.random().publicKey(),reserve=Asset.native().contractId(NETWORK_PASSPHRASE),market=`stellar-testnet:blend:${BORROW_POOL_ID}:${reserve}`;
const customer:CustomerContext={businessId:randomUUID(),customerId:randomUUID(),walletId:randomUUID(),walletAddress:wallet,privyUserId:'did:privy:offline'};
const input={customer_id:customer.customerId,wallet_id:customer.walletId,asset_id:XLM.id,market_id:market,amount:'1'};
const expiry=()=>new Date(Date.now()+60000).toISOString();
const position=():BorrowingPosition=>({market_id:market,asset_id:XLM.id,pool_contract_id:BORROW_POOL_ID,reserve_contract_id:reserve,borrowed:'0',collateral:'2',as_of:new Date().toISOString(),as_of_ledger:10,debt_tokens:'0',collateral_tokens:'20000000',debt_rate:'1000000000000',collateral_rate:'1000000000000',rate_decimals:12,reserve_index:0});
const balance=():WalletBalance=>({asset_id:XLM.id,wallet_amount:'100',spendable:'98',reserved:'0',as_of:new Date().toISOString(),source:'stellar_horizon_testnet'});
function prepared(operationId:string,action:string):PreparedAction{const exp=expiry();return {operationId,customerId:customer.customerId,network:'stellar-testnet',walletAddress:wallet,unsignedXdr:'offline-unsent-fixture',signingHashHex:'a'.repeat(64),summary:{action,contractId:BORROW_POOL_ID,recipient:wallet,fromAssetId:XLM.id,amount:'1.0000000',maxFeeStroops:'100000',expiresAt:exp},authorization:{method:'privy_stellar',expiresAt:exp}};}
const apps:ReturnType<typeof Fastify>[]=[];
beforeEach(()=>{vi.mocked(requireBusiness).mockResolvedValue({businessId:customer.businessId,apiKeyId:'offline'});vi.mocked(requireCustomer).mockResolvedValue(customer);});
afterEach(async()=>{vi.resetAllMocks();await Promise.all(apps.splice(0).map(app=>app.close()));});
async function harness(options:{adapter?:boolean;pending?:boolean;changedAction?:boolean;position?:BorrowingPosition;prepareError?:Error;reused?:boolean}={}){
 const app=Fastify();apps.push(app);app.setErrorHandler((error,_request,reply)=>reply.code(error instanceof GrapnelError?error.statusCode:error instanceof Error&&error.name==='ZodError'?422:500).send({error:{code:error instanceof GrapnelError?error.code:error instanceof Error?error.name:'Unknown'}}));
 const query=vi.fn(async(sql:string)=>({rows:[],rowCount:sql.startsWith('SELECT id FROM operations')&&options.pending?1:0}));
 const reserveFunds=vi.fn(async()=>{}),setPrepared=vi.fn(async()=>{}),operationId=randomUUID();
 const createIdempotent=vi.fn(async(args:unknown,prepare:(client:unknown,id:string)=>Promise<void>)=>{
  if(!options.reused)await prepare({query},operationId);
  return {created:!options.reused,operation:{operation_id:operationId,status:'awaiting_customer_authorization',tx_hash:null}};
 });
 const adapter:BorrowingAdapter={read:vi.fn(async()=>({pool_id:BORROW_POOL_ID,as_of:new Date().toISOString(),assets:[]})),positions:vi.fn(async()=>[options.position??position()]),prepare:vi.fn(async(action,request)=>{if(options.prepareError)throw options.prepareError;return prepared(request.operationId,options.changedAction?'blend.supply':`blend.${action}`);}),prepareCollateral:vi.fn(async(action,request)=>prepared(request.operationId,`blend.borrow_collateral_${action}`))};
 const balances=vi.fn(async()=>[balance()]);
 await registerBorrowingRoutes(app,{borrowing:options.adapter===false?undefined:adapter,operations:{createIdempotent,reserve:reserveFunds,setPrepared} as unknown as OperationService,balanceReader:balances});
 return {app,adapter,createIdempotent,reserveFunds,setPrepared,query,balances};
}
const send=(app:ReturnType<typeof Fastify>,path='/v1/capital/lending/borrow',payload:unknown=input)=>app.inject({method:'POST',url:path,headers:{'idempotency-key':'offline-request'},payload});
describe('Borrow API authorization and durable preparation (offline fixture)',()=>{
 it('returns customer-bound borrowing data only after module and identity checks',async()=>{const f=await harness();const res=await f.app.inject(`/v1/capital/lending/borrowing?customer_id=${customer.customerId}&wallet_id=${customer.walletId}`);expect(res.statusCode).toBe(200);expect(requireBusiness).toHaveBeenCalledWith(expect.anything(),'capital.lending');expect(requireCustomer).toHaveBeenCalledWith(expect.anything(),customer.customerId,customer.walletId);expect(f.adapter.read).toHaveBeenCalledWith(customer);});
 it.each([401,403])('stops before adapter/data when business authorization fails %s',async status=>{const f=await harness();vi.mocked(requireBusiness).mockRejectedValue(new GrapnelError(status,status===401?'UNAUTHORIZED':'MODULE_NOT_ENABLED','Offline denial'));expect((await send(f.app)).statusCode).toBe(status);expect((await f.app.inject(`/v1/capital/lending/borrowing?customer_id=${customer.customerId}`)).statusCode).toBe(status);expect(f.adapter.read).not.toHaveBeenCalled();expect(f.createIdempotent).not.toHaveBeenCalled();});
 it('rejects foreign customer before provider or operation creation',async()=>{const f=await harness();vi.mocked(requireCustomer).mockRejectedValue(new GrapnelError(404,'NOT_FOUND','Foreign customer'));expect((await send(f.app)).statusCode).toBe(404);expect(f.adapter.prepare).not.toHaveBeenCalled();expect(f.createIdempotent).not.toHaveBeenCalled();});
 it('fails closed without the dedicated borrowing adapter, never old-pool fallback',async()=>{const f=await harness({adapter:false});expect((await send(f.app)).statusCode).toBe(409);expect(f.createIdempotent).not.toHaveBeenCalled();});
 it('binds idempotency, operation, baseline and fee reservation to the verified tenant wallet',async()=>{const f=await harness();const response=await send(f.app);expect(response.statusCode).toBe(202);expect(response.json().data).toMatchObject({status:'awaiting_customer_authorization',tx_hash:null});expect(f.createIdempotent).toHaveBeenCalledWith(expect.objectContaining({businessId:customer.businessId,customerId:customer.customerId,walletId:customer.walletId,module:'capital.lending',type:'blend.borrow',route:'/v1/capital/lending/borrow',idempotencyKey:'offline-request',request:input}),expect.any(Function));expect(f.reserveFunds).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({assetId:XLM.id,amountAtomic:100000n,spendableAtomic:980000000n}));const update=f.query.mock.calls.find(call=>call[0].startsWith('UPDATE operations'));expect(update).toBeDefined();expect(f.setPrepared).toHaveBeenCalledOnce();});
 it('reuses the durable operation without preparing or reserving twice',async()=>{const f=await harness({reused:true});expect((await send(f.app)).statusCode).toBe(202);expect(f.adapter.prepare).not.toHaveBeenCalled();expect(f.reserveFunds).not.toHaveBeenCalled();});
 it('rejects extra browser pool/identity overrides before provider calls',async()=>{const f=await harness();expect((await send(f.app,undefined,{...input,pool_id:'arbitrary'})).statusCode).toBe(422);expect(f.createIdempotent).not.toHaveBeenCalled();});
 it('does not reserve or prepare when a prior operation remains pending',async()=>{const f=await harness({pending:true});expect((await send(f.app)).statusCode).toBe(409);expect(f.adapter.prepare).not.toHaveBeenCalled();expect(f.reserveFunds).not.toHaveBeenCalled();});
 it('propagates fresh collateral/health rejection before any reservation',async()=>{const f=await harness({prepareError:new GrapnelError(409,'INSUFFICIENT_COLLATERAL','Offline fixture collateral failure')});expect((await send(f.app)).statusCode).toBe(409);expect(f.reserveFunds).not.toHaveBeenCalled();expect(f.setPrepared).not.toHaveBeenCalled();});
 it('rejects adapter action substitution and missing position metadata',async()=>{const f=await harness({changedAction:true});expect((await send(f.app)).statusCode).toBe(403);expect(f.setPrepared).not.toHaveBeenCalled();const missing=await harness({position:{...position(),debt_tokens:undefined}});expect((await send(missing.app)).statusCode).toBe(409);expect(missing.setPrepared).not.toHaveBeenCalled();});
 it.each([['/v1/capital/lending/repay','blend.repay',10100000n],['/v1/capital/lending/borrowing/collateral/supply','blend.borrow_collateral_supply',10100000n],['/v1/capital/lending/borrowing/collateral/withdraw','blend.borrow_collateral_withdraw',100000n]] as const)('prepares %s through the dedicated pool adapter',async(path,type,amountAtomic)=>{const f=await harness();const response=await send(f.app,path);expect(response.statusCode).toBe(202);expect(f.createIdempotent).toHaveBeenCalledWith(expect.objectContaining({type,route:path}),expect.any(Function));expect(f.reserveFunds).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({amountAtomic}));});
});
