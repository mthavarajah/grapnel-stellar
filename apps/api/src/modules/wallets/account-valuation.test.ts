import {describe,expect,it,vi} from 'vitest';
import {Asset,Keypair,StrKey} from '@stellar/stellar-sdk';
import {NETWORK,NETWORK_PASSPHRASE,XLM,type AssetIdentity,type CustomerContext,type WalletBalance} from '@grapnel/contracts';
import {AccountValuationService,type AccountProtocolPosition,type AccountValuationDependencies} from './account-valuation.js';
import {valueAssetHoldings} from './valuation.js';
const now=Date.parse('2026-11-11T20:00:00.000Z'),at=new Date(now).toISOString();
const customer:CustomerContext={businessId:'business',customerId:'customer',walletId:'wallet',walletAddress:Keypair.random().publicKey(),privyUserId:'did:privy:offline'};
const issuer=Keypair.random().publicKey(),usdc=`stellar-testnet:classic:USDC:${issuer}`,usdcReserve=new Asset('USDC',issuer).contractId(NETWORK_PASSPHRASE);
const oldPool=StrKey.encodeContract(Buffer.alloc(32,1)),newPool=StrKey.encodeContract(Buffer.alloc(32,2)),nativeReserve=Asset.native().contractId(NETWORK_PASSPHRASE);
const wallet=(asset_id:string,wallet_amount:string):WalletBalance=>({asset_id,wallet_amount,reserved:'0',spendable:'0',source:'stellar_horizon_testnet',as_of:at});
const position=(pool=oldPool,asset_id=XLM.id,supplied='2',borrowed='0',collateral=supplied):AccountProtocolPosition=>{
 const reserve=asset_id===XLM.id?nativeReserve:usdcReserve;
 return {market_id:`stellar-testnet:blend:${pool}:${reserve}`,pool_contract_id:pool,reserve_contract_id:reserve,asset_id,supplied,borrowed,collateral,as_of:at,as_of_ledger:100};
};
const defaults=():AccountValuationDependencies=>({walletBalances:vi.fn(async()=>[wallet(XLM.id,'10'),wallet(usdc,'4')]),earnPositions:vi.fn(async()=>[position()]),borrowPositions:vi.fn(async()=>[position(newPool,XLM.id,'3','1')]),priceFor:vi.fn(async(id:string)=>({value:id===XLM.id?'0.5':'0.99',as_of:at})),now:()=>now});
describe('Gross account valuation from separate wallet and protocol holdings',()=>{
 it('adds total supplied once, never adding collateral twice or subtracting debt from gross',async()=>{
  const service=new AccountValuationService(defaults());
  expect(await service.read(customer)).toEqual({total_usd:'11.46',priced_subtotal_usd:'11.46',unpriced_asset_count:0,unknown_source_count:0,liabilities_usd:'0.5',priced_liabilities_subtotal_usd:'0.5',unpriced_liability_asset_count:0,net_equity_usd:'10.96',as_of:at});
 });
 it('aggregates the exact same asset across both pools and wallet before rounding',async()=>{
  const deps=defaults();deps.walletBalances=async()=>[wallet(XLM.id,'0.0000001')];deps.earnPositions=async()=>[position(oldPool,XLM.id,'0.0000001')];deps.borrowPositions=async()=>[position(newPool,XLM.id,'0.0000001')];deps.priceFor=async()=>({value:'0.00000000001',as_of:at});
  expect((await new AccountValuationService(deps).read(customer)).total_usd).toBe('0.000000000000000003');
 });
 it('uses one shared actual price observation for gross and liability values',async()=>{
  const deps=defaults(),read=vi.fn(async(id:string)=>({value:id===XLM.id?'0.5':'0.99',as_of:at}));deps.priceFor=read;
  await new AccountValuationService(deps).read(customer);expect(read).toHaveBeenCalledTimes(2);expect(read).toHaveBeenCalledWith(XLM.id);expect(read).toHaveBeenCalledWith(usdc);
 });
 it.each(['walletBalances','earnPositions','borrowPositions'] as const)('marks totals unknown on failed %s while preserving actual priced holdings',async source=>{
  const deps=defaults();deps[source]=async()=>{throw Error('Offline provider failure');};
  const value=await new AccountValuationService(deps).read(customer);
  expect(value.total_usd).toBeNull();expect(value.liabilities_usd).toBeNull();expect(value.net_equity_usd).toBeNull();expect(value.unknown_source_count).toBe(1);expect(value.unpriced_asset_count).toBe(0);
  expect(value.priced_subtotal_usd).toBe(source==='walletBalances'?'2.5':source==='earnPositions'?'10.46':'9.96');
 });
 it('handles synchronous provider failures as an unknown source, not an assumed zero',async()=>{
  const deps=defaults();deps.earnPositions=()=>{throw Error('Offline immediate failure');};
  expect(await new AccountValuationService(deps).read(customer)).toMatchObject({total_usd:null,priced_subtotal_usd:'10.46',unknown_source_count:1});
 });
 it('missing debt data invalidates the entire source instead of silently treating it as zero debt',async()=>{
  const deps=defaults();deps.borrowPositions=async()=>[{...position(newPool),borrowed:undefined as never}];
  expect(await new AccountValuationService(deps).read(customer)).toMatchObject({total_usd:null,liabilities_usd:null,net_equity_usd:null,unknown_source_count:1,priced_subtotal_usd:'9.96'});
 });
 it('does not double count a duplicate pool/reserve returned by two readers',async()=>{
  const deps=defaults();deps.borrowPositions=async()=>[position()];
  expect(await new AccountValuationService(deps).read(customer)).toMatchObject({total_usd:null,priced_subtotal_usd:'9.96',unknown_source_count:1});
 });
 it('rejects duplicates inside a source transactionally, retaining other complete sources',async()=>{
  const deps=defaults();deps.earnPositions=async()=>[position(),position()];
  expect(await new AccountValuationService(deps).read(customer)).toMatchObject({total_usd:null,priced_subtotal_usd:'10.46',unknown_source_count:1});
 });
 it('does not accept collateral greater than the source supplied total',async()=>{
  const deps=defaults();deps.earnPositions=async()=>[position(oldPool,XLM.id,'1','0','2')];
  expect((await new AccountValuationService(deps).read(customer)).unknown_source_count).toBe(1);
 });
 it('keeps unknown asset price coverage separate from missing source coverage',async()=>{
  const deps=defaults();deps.priceFor=async id=>id===usdc?null:{value:'0.5',as_of:at};
  expect(await new AccountValuationService(deps).read(customer)).toMatchObject({total_usd:null,priced_subtotal_usd:'7.5',unpriced_asset_count:1,unknown_source_count:0,liabilities_usd:'0.5',net_equity_usd:null});
 });
 it('can show negative net equity without turning gross assets into a debt-adjusted value',async()=>{
  const deps=defaults();deps.walletBalances=async()=>[wallet(XLM.id,'1')];deps.earnPositions=async()=>[];deps.borrowPositions=async()=>[position(newPool,XLM.id,'0','3','0')];
  expect(await new AccountValuationService(deps).read(customer)).toMatchObject({total_usd:'0.5',liabilities_usd:'1.5',net_equity_usd:'-1'});
 });
 it('all complete and empty sources legitimately value at zero, including zero debt',async()=>{
  const deps=defaults();deps.walletBalances=async()=>[];deps.earnPositions=async()=>[];deps.borrowPositions=async()=>[];
  expect(await new AccountValuationService(deps).read(customer)).toMatchObject({total_usd:'0',priced_subtotal_usd:'0',liabilities_usd:'0',net_equity_usd:'0',unknown_source_count:0});
 });
 it.each([
  {as_of:new Date(now-31000).toISOString()},{as_of_ledger:0},{pool_contract_id:'not-a-contract'},{reserve_contract_id:usdcReserve},{borrowed:'-1'},
 ])('treats an invalid or stale position snapshot as unknown %j',async patch=>{
  const deps=defaults();deps.earnPositions=async()=>[{...position(),...patch}];expect((await new AccountValuationService(deps).read(customer)).unknown_source_count).toBe(1);
 });
 it('accepts explicit verified metadata for a protocol-held 18-decimal token',async()=>{
  const contract=StrKey.encodeContract(Buffer.alloc(32,4)),id=`stellar-testnet:soroban:${contract}`,asset:AssetIdentity={id,network:NETWORK,kind:'soroban',code:'TOKEN',contractId:contract,decimals:18,verified:true,sourceUrl:'https://example.com/verified-registry'};
  const deps=defaults();deps.walletBalances=async()=>[];deps.earnPositions=async()=>[];deps.borrowPositions=async()=>[{...position(newPool),market_id:`stellar-testnet:blend:${newPool}:${contract}`,reserve_contract_id:contract,asset_id:id,supplied:'1.000000000000000001',collateral:'1.000000000000000001'}];deps.assetFor=key=>key===id?asset:undefined;deps.priceFor=async()=>({value:'1',as_of:at});
  expect((await new AccountValuationService(deps).read(customer)).total_usd).toBe('1.000000000000000001');
 });
 it('generic holdings retain duplicate protection independently of account aggregation',async()=>{
  await expect(valueAssetHoldings([{asset_id:XLM.id,amount:'1'},{asset_id:XLM.id,amount:'2'}],async()=>null,now)).rejects.toMatchObject({code:'PROVIDER_INVALID_RESPONSE'});
 });
});

import {createRequire} from 'node:module';
import {afterEach} from 'vitest';
import {GrapnelError} from '@grapnel/contracts';
import {registerAccountValuationRoutes,registerWalletValuationRoutes} from './valuation-routes.js';
const require=createRequire(new URL('../../../package.json',import.meta.url));
const Fastify=require('fastify') as typeof import('fastify').default;
const apps:ReturnType<typeof Fastify>[]=[];
afterEach(async()=>{await Promise.all(apps.splice(0).map(app=>app.close()));});
async function routeHarness(){
 const app=Fastify();apps.push(app);
 app.setErrorHandler((error,_request,reply)=>reply.code(error instanceof GrapnelError?error.statusCode:error instanceof Error&&error.name==='ZodError'?422:500).send({error:{code:error instanceof GrapnelError?error.code:'INVALID'}}));
 const context={...customer,customerId:'00000000-0000-4000-8000-000000000001',walletId:'00000000-0000-4000-8000-000000000002'};
 const business=vi.fn(async()=>({businessId:context.businessId})),identity=vi.fn(async()=>context),read=vi.fn(async()=>new AccountValuationService(defaults()).read(context)),balances=vi.fn(async()=>[wallet(XLM.id,'1')]),price=vi.fn(async()=>({value:'0.5',as_of:new Date().toISOString()}));
 const success=(_request:unknown,data:unknown)=>({data});
 await registerAccountValuationRoutes(app,{requireBusiness:business,requireCustomer:identity,success,readAccount:read});
 await registerWalletValuationRoutes(app,{requireBusiness:business,requireCustomer:identity,success,balances,priceFor:price});
 const account=`/v1/portfolio/valuation?customer_id=${context.customerId}&wallet_id=${context.walletId}`;
 const walletUrl=`/v1/capital/wallets/${context.walletId}/valuation?customer_id=${context.customerId}`;
 return {app,context,business,identity,read,balances,price,account,walletUrl};
}
describe('Customer-scoped valuation route boundaries (offline fixtures)',()=>{
 it('binds both account identifiers to verified customer context before reading anything',async()=>{
  const f=await routeHarness(),res=await f.app.inject(f.account);
  expect(res.statusCode).toBe(200);expect(f.business).toHaveBeenCalledWith(expect.anything(),'capital.wallets');expect(f.identity).toHaveBeenCalledWith(expect.anything(),f.context.customerId,f.context.walletId);expect(f.read).toHaveBeenCalledWith(f.context);expect(res.json().data.wallet_id).toBe(f.context.walletId);
 });
 it('keeps profile wallet valuation separate from protocol account valuation',async()=>{
  const f=await routeHarness();expect((await f.app.inject(f.walletUrl)).statusCode).toBe(200);expect(f.balances).toHaveBeenCalledWith(f.context);expect(f.read).not.toHaveBeenCalled();expect(f.price).toHaveBeenCalledWith(XLM.id);
 });
 it.each([401,403])('stops account and wallet source reads on business/module denial %s',async status=>{
  const f=await routeHarness();f.business.mockRejectedValue(new GrapnelError(status,'ACCESS_DENIED','Offline denial'));
  expect((await f.app.inject(f.account)).statusCode).toBe(status);expect((await f.app.inject(f.walletUrl)).statusCode).toBe(status);expect(f.identity).not.toHaveBeenCalled();expect(f.read).not.toHaveBeenCalled();expect(f.balances).not.toHaveBeenCalled();expect(f.price).not.toHaveBeenCalled();
 });
 it('rejects cross-tenant wallet/customer access before any valuation source',async()=>{
  const f=await routeHarness();f.identity.mockRejectedValue(new GrapnelError(404,'NOT_FOUND','Foreign customer'));
  expect((await f.app.inject(f.account)).statusCode).toBe(404);expect((await f.app.inject(f.walletUrl)).statusCode).toBe(404);expect(f.read).not.toHaveBeenCalled();expect(f.balances).not.toHaveBeenCalled();expect(f.price).not.toHaveBeenCalled();
 });
 it.each(['customer_id=not-a-uuid&wallet_id=not-a-uuid','customer_id=00000000-0000-4000-8000-000000000001','customer_id=00000000-0000-4000-8000-000000000001&wallet_id=00000000-0000-4000-8000-000000000002&pool_id=forged'])('rejects malformed or expanded account query %s',async query=>{
  const f=await routeHarness();expect((await f.app.inject('/v1/portfolio/valuation?'+query)).statusCode).toBe(422);expect(f.identity).not.toHaveBeenCalled();expect(f.read).not.toHaveBeenCalled();
 });
 it('requires UUID wallet path and rejects extra wallet query fields before reads',async()=>{
  const f=await routeHarness();expect((await f.app.inject(f.walletUrl+'&amount=10000')).statusCode).toBe(422);expect((await f.app.inject('/v1/capital/wallets/not-a-wallet/valuation?customer_id='+f.context.customerId)).statusCode).toBe(422);expect(f.balances).not.toHaveBeenCalled();expect(f.price).not.toHaveBeenCalled();
 });
});
