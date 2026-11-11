import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {buildApp} from '../../apps/api/src/app.js';
import {createPool} from '../../apps/api/src/db/index.js';
import {migrate} from '../../apps/api/src/db/migrate.js';
import {requireBusiness,requireCustomer,success} from '../../apps/api/src/lib/context.js';
import {SoroswapSpotAdapter,type SpotMarket} from '../../apps/api/src/adapters/soroswap/index.js';
import {createSpotReservation} from '../../apps/api/src/modules/spot/reservations.js';
import {SpotService} from '../../apps/api/src/modules/spot/service.js';
import {registerSpotRoutes} from '../../apps/api/src/modules/spot/routes.js';
import {OperationService} from '../../apps/api/src/modules/operations/service.js';
import {OperationWorker} from '../../apps/api/src/modules/operations/worker.js';
import {GrapnelError,NETWORK,NETWORK_PASSPHRASE,XLM,toAtomic,type PreparedAction} from '../../packages/contracts/src/index.js';
const require=createRequire(new URL('../../apps/api/package.json',import.meta.url));
const {Account,Asset,Contract,Keypair,TransactionBuilder}=require('@stellar/stellar-sdk');
// Exclusive disposable DB: this suite resets its schema so the global worker cannot
// accidentally claim pending fixture jobs left by an unrelated suite.
const url=process.env.MARKETS_TEST_DATABASE_URL;
const issuer='GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56';
const usdcId=`stellar-testnet:classic:USDC:${issuer}`;
const nativeSac=Asset.native().contractId(NETWORK_PASSPHRASE);
const usdcSac=new Asset('USDC',issuer).contractId(NETWORK_PASSPHRASE);
// Only the HTTP/service contract is exercised here. All provider replies, signatures,
// balances and chain observations below are isolated fixtures, never Testnet proof.
describe.skipIf(!url)('Spot HTTP/DB workflow — isolated provider and chain fixtures',()=>{
 const pool=createPool(url!);const tenantA=randomUUID(),tenantB=randomUUID(),customerA=randomUUID(),customerB=randomUUID(),walletA=randomUUID(),walletB=randomUUID();
 const wallet=Keypair.random(),otherWallet=Keypair.random();
 const keyA='gr_test_'+randomUUID()+randomUUID(),keyB='gr_test_'+randomUUID()+randomUUID();
 const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
 const marketId='qa-xlmusdc-'+randomUUID();
 const router='CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF';
 const market:SpotMarket={id:marketId,asset_in:{...XLM,contractId:nativeSac},asset_out:{id:usdcId,network:NETWORK,kind:'classic',code:'USDC',issuer,contractId:usdcSac,decimals:7,verified:true,sourceUrl:'https://example.invalid/qa-fixture'},protocols:['soroswap'],route_verified_at:new Date().toISOString(),execution_verified_at:null};
 let app:Awaited<ReturnType<typeof buildApp>>,operations:OperationService;let badMinimum=false;let fixtureUsdcBalance='0.0000000';let providerCalls=0;let inspectorCalls=0;
 const auth=(key=keyA,identity='qa-a')=>({authorization:'Bearer '+key,'x-customer-identity':identity});
 const post=(path:string,payload:Record<string,unknown>,headers=auth(),idempotencyKey=randomUUID())=>app.inject({method:'POST',url:path,headers:{...headers,'idempotency-key':idempotencyKey},payload});
 const quoteRequest=()=>({customer_id:customerA,market_id:marketId,exact_in:{asset_id:XLM.id,amount:'1'},slippage_bps:50});
 const quote=async()=>{const response=await post('/v1/trade/quotes',quoteRequest());expect(response.statusCode).toBe(200);return response.json().data;};
 beforeAll(async()=>{
  const db=(await pool.query('SELECT current_database() AS name')).rows[0].name;
  if(!db.endsWith('_test'))throw Error('Market QA requires a disposable _test database');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await migrate(pool);
  for(const [business,customer,walletId,signer,key,identity] of [[tenantA,customerA,walletA,wallet,keyA,'qa-a'],[tenantB,customerB,walletB,otherWallet,keyB,'qa-b']] as const){
   await pool.query('INSERT INTO businesses(id,name) VALUES($1,$2)',[business,'Isolated market QA']);
   await pool.query('INSERT INTO business_modules(business_id,module_code,enabled) SELECT $1,unnest(enum_range(NULL::module_code)),true',[business]);
   await pool.query("INSERT INTO api_keys(business_id,prefix,last_four,key_hash,name) VALUES($1,'qa-fixture',$2,$3,'market QA')",[business,key.slice(-4),hash(key)]);
   await pool.query('INSERT INTO customers(id,business_id,external_customer_id,privy_user_id) VALUES($1,$2,$3,$3)',[customer,business,identity]);
   await pool.query("INSERT INTO wallets(id,business_id,customer_id,privy_wallet_id,stellar_address,public_key,status) VALUES($1,$2,$3,$4,$5,$5,'active')",[walletId,business,customer,identity+'-wallet',signer.publicKey()]);
  }
  const fetcher=vi.fn(async(address:string|URL|Request,init?:RequestInit)=>{
   providerCalls++;const path=String(address);
   if(path.includes('/protocols'))return new Response(JSON.stringify(['soroswap']));
   const body=JSON.parse(String(init?.body));
   if(path.includes('/quote/build')){
    const tx=new TransactionBuilder(new Account(body.from,'1'),{fee:'100',networkPassphrase:NETWORK_PASSPHRASE}).addOperation(new Contract(router).call('qa_fixture_swap')).setTimeout(25).build();
    return new Response(JSON.stringify({xdr:tx.toXDR()}));
   }
   return new Response(JSON.stringify({tradeType:'EXACT_IN',assetIn:body.assetIn,assetOut:body.assetOut,amountIn:body.amount,amountOut:'20000000',otherAmountThreshold:badMinimum?'19899999':'19900000',routePlan:[{swapInfo:{protocol:'soroswap',path:[body.assetIn,body.assetOut]},percent:'100'}]}));
  }) as typeof fetch;
  const adapter=new SoroswapSpotAdapter({network:'testnet',networkPassphrase:NETWORK_PASSPHRASE,apiKey:'offline-fixture-never-real',gate1Passed:true,markets:[market,{...market,id:marketId+'-reverse',asset_in:market.asset_out,asset_out:market.asset_in}]},fetcher,async input=>{
   inspectorCalls++;const tx=TransactionBuilder.fromXDR(input.unsignedXdr,NETWORK_PASSPHRASE);
   const expiresAt=new Date(Number(tx.timeBounds.maxTime)*1000).toISOString();
   return {operationId:input.operationId,customerId:input.customer.customerId,network:NETWORK,walletAddress:input.customer.walletAddress,unsignedXdr:input.unsignedXdr,signingHashHex:tx.hash().toString('hex'),summary:{action:'spot.swap',fromAssetId:input.quote.asset_in_id,toAssetId:input.quote.asset_out_id,amount:input.quote.amount_in,minReceive:input.quote.min_receive,contractId:router,recipient:input.customer.walletAddress,maxFeeStroops:tx.fee,expiresAt},authorization:{method:'privy_stellar',expiresAt}};
  });
  operations=new OperationService(pool);
  const service=new SpotService(adapter,pool,operations,createSpotReservation(operations,async()=>[
   {asset_id:XLM.id,wallet_amount:'100.0000000',reserved:'0.0000000',spendable:'99.0000000',as_of:new Date().toISOString(),source:'stellar_horizon_testnet'},
   {asset_id:usdcId,wallet_amount:fixtureUsdcBalance,reserved:'0.0000000',spendable:fixtureUsdcBalance,as_of:new Date().toISOString(),source:'stellar_horizon_testnet'}
  ]));
  app=await buildApp({pool,config:{databaseUrl:url!,network:'testnet',networkPassphrase:NETWORK_PASSPHRASE,dashboardOrigin:'http://localhost:3000',fintechOrigin:'http://localhost:3002',adminLoginSecret:'qa-only-owner-secret',sessionSecret:'qa-only-owner-session-secret-32-characters',production:false,port:0,demoBusinessId:tenantA},identityVerifier:{async verify(token){const signer=token==='qa-a'?wallet:token==='qa-b'?otherWallet:null;if(!signer)throw Error('fixture identity mismatch');return {userId:token,wallets:[{id:token+'-wallet',address:signer.publicKey(),publicKey:signer.publicKey()}]};}},verifySignedAction:async(action:PreparedAction,signed:string)=>{
   const tx=TransactionBuilder.fromXDR(signed,NETWORK_PASSPHRASE);const expected=TransactionBuilder.fromXDR(action.unsignedXdr,NETWORK_PASSPHRASE);
   if(tx.hash().toString('hex')!==expected.hash().toString('hex')||tx.hash().toString('hex')!==action.signingHashHex||tx.signatures.length!==1||!Keypair.fromPublicKey(action.walletAddress).verify(tx.hash(),tx.signatures[0].signature()))throw new GrapnelError(403,'INVALID_CUSTOMER_SIGNATURE','Fixture approval differs');
   return {txHash:tx.hash().toString('hex')};
  },registerAdapters:async app=>registerSpotRoutes(app,{service,requireBusiness,requireCustomer,success})});
 });
 afterAll(async()=>{await app?.close();await pool.end();});
 it('exposes only exact XLM/issuer-USDC identities and does not label fixture market verified',async()=>{
  const result=await app.inject({url:'/v1/trade/markets?asset_class=crypto_spot',headers:auth()});
  expect(result.json().data).toEqual(expect.arrayContaining([expect.objectContaining({market_id:marketId,asset_in_id:XLM.id,asset_out_id:usdcId,executable:false,execution_status:'discovery_only'})]));
 });
 it('normalizes exact quotes and rejects below-minimum provider output before durable storage',async()=>{
  const q=await quote();expect(q).toMatchObject({amount_in:'1.0000000',expected_out:'2.0000000',min_receive:'1.9900000',asset_out_id:usdcId});
  badMinimum=true;const response=await post('/v1/trade/quotes',quoteRequest());badMinimum=false;expect(response.statusCode).toBe(502);expect(response.json().error.code).toBe('PROVIDER_INVALID_RESPONSE');
 });
 it('denies unauthenticated, forged or cross-tenant customers before any provider request',async()=>{
  const count=providerCalls;
  expect((await post('/v1/trade/quotes',quoteRequest(),{authorization:'Bearer invalid','x-customer-identity':'qa-a'})).statusCode).toBe(401);
  expect((await post('/v1/trade/quotes',quoteRequest(),auth(keyA,'forged'))).statusCode).toBe(403);
  expect((await post('/v1/trade/quotes',{...quoteRequest(),customer_id:customerB})).statusCode).toBe(404);
  expect((await post('/v1/trade/quotes',quoteRequest(),auth(keyB,'qa-b'))).statusCode).toBe(404);
  expect(providerCalls).toBe(count);
 });
 it('applies disabled and restored spot permission to the same key immediately',async()=>{
  const count=providerCalls;await pool.query("UPDATE business_modules SET enabled=false WHERE business_id=$1 AND module_code='trade.spot'",[tenantA]);
  expect((await post('/v1/trade/quotes',quoteRequest())).statusCode).toBe(403);expect(providerCalls).toBe(count);
  await pool.query("UPDATE business_modules SET enabled=true WHERE business_id=$1 AND module_code='trade.spot'",[tenantA]);expect((await post('/v1/trade/quotes',quoteRequest())).statusCode).toBe(200);
 });
 it('persists exact route assets and discovery market without external manual seeding',async()=>{await quote();const stored=(await pool.query('SELECT * FROM provider_markets WHERE id=$1',[marketId])).rows[0];expect(stored).toMatchObject({asset_in_id:XLM.id,asset_out_id:usdcId,readiness:'discovery_only'});expect((await pool.query('SELECT contract_id,decimals FROM assets WHERE id=$1',[usdcId])).rows[0]).toEqual({contract_id:usdcSac,decimals:7});});
 it('rejects a different provider operation while any wallet sequence is pending',async()=>{const q=await quote(),id=randomUUID();await pool.query("INSERT INTO operations(id,business_id,customer_id,wallet_id,module_code,type,state,request_json,provider) VALUES($1,$2,$3,$4,'capital.lending','blend.supply','accepted','{}','offline-fixture')",[id,tenantA,customerA,walletA]);try{const response=await post('/v1/trade/orders',{customer_id:customerA,wallet_id:walletA,quote_id:q.quote_id});expect(response.statusCode).toBe(409);expect(response.json().error.code).toBe('WALLET_OPERATION_PENDING');}finally{await pool.query('DELETE FROM operations WHERE id=$1',[id]);}});
 it('rejects expired or foreign quotes before preparation',async()=>{
  const q=await quote();await pool.query("UPDATE trade_quotes SET expires_at=now()-interval '1 second' WHERE id=$1",[q.quote_id]);const before=inspectorCalls;
  const response=await post('/v1/trade/orders',{customer_id:customerA,wallet_id:walletA,quote_id:q.quote_id});expect(response.statusCode).toBe(409);expect(response.json().error.code).toBe('QUOTE_EXPIRED');expect(inspectorCalls).toBe(before);
  expect((await post('/v1/trade/orders',{customer_id:customerB,wallet_id:walletB,quote_id:q.quote_id},auth(keyB,'qa-b'))).statusCode).toBe(404);
 });
 it('prepares the reverse route with USDC principal plus a separate native fee reservation',async()=>{fixtureUsdcBalance='10.0000000';try{const qr=await post('/v1/trade/quotes',{...quoteRequest(),market_id:marketId+'-reverse',exact_in:{asset_id:usdcId,amount:'1'}});expect(qr.statusCode).toBe(200);expect(qr.json().data).toMatchObject({asset_in_id:usdcId,asset_out_id:XLM.id});const order=await post('/v1/trade/orders',{customer_id:customerA,wallet_id:walletA,quote_id:qr.json().data.quote_id});expect(order.statusCode).toBe(202);const id=order.json().data.operation_id,held=(await pool.query('SELECT asset_id,amount_atomic FROM balance_reservations WHERE operation_id=$1 ORDER BY asset_id',[id])).rows;expect(held).toEqual(expect.arrayContaining([{asset_id:XLM.id,amount_atomic:'100'},{asset_id:usdcId,amount_atomic:'10000000'}]));await pool.query("UPDATE operations SET state='expired' WHERE id=$1",[id]);await pool.query("UPDATE balance_reservations SET state='released' WHERE operation_id=$1",[id]);}finally{fixtureUsdcBalance='0.0000000';}});
 it('persists one exact prepared order, requires a one-use customer signature, and keeps pending unsettled',async()=>{
  const q=await quote(),body={customer_id:customerA,wallet_id:walletA,quote_id:q.quote_id},key=randomUUID();
  const created=await post('/v1/trade/orders',body,auth(),key);expect(created.statusCode).toBe(202);const id=created.json().data.operation_id;
  const held=(await pool.query('SELECT amount_atomic FROM balance_reservations WHERE operation_id=$1',[id])).rows[0];expect(held.amount_atomic).toBe('10000100');expect((await pool.query('SELECT result_json FROM operations WHERE id=$1',[id])).rows[0].result_json.spot_swap_baseline).toMatchObject({asset_in_id:XLM.id,asset_out_id:usdcId,wallet_in_amount:'100.0000000',wallet_out_amount:'0.0000000'});
  expect(created.json().data.status).toBe('awaiting_customer_authorization');expect(created.json().data.tx_hash).toBeNull();
  const retry=await post('/v1/trade/orders',body,auth(),key);expect(retry.json().data.operation_id).toBe(id);
  expect((await post('/v1/trade/orders',body)).json().error.code).toBe('QUOTE_ALREADY_USED');
  const exposed=await app.inject({url:'/v1/operations/'+id,headers:auth()});const {prepared_action,customer_action_token}=exposed.json().data;expect(prepared_action.summary).toMatchObject({fromAssetId:XLM.id,toAssetId:usdcId,amount:'1.0000000',minReceive:'1.9900000'});
  const tx=TransactionBuilder.fromXDR(prepared_action.unsignedXdr,NETWORK_PASSPHRASE);tx.sign(otherWallet);
  const invalid=await post(`/v1/operations/${id}/authorize`,{signed_xdr:tx.toXDR(),privy_identity_proof:'qa-a',customer_action_token},auth());expect(invalid.statusCode).toBe(403);
  const signed=TransactionBuilder.fromXDR(prepared_action.unsignedXdr,NETWORK_PASSPHRASE);signed.sign(wallet);
  const approved=await post(`/v1/operations/${id}/authorize`,{signed_xdr:signed.toXDR(),privy_identity_proof:'qa-a',customer_action_token},auth());expect(approved.statusCode).toBe(202);
  expect((await post(`/v1/operations/${id}/authorize`,{signed_xdr:signed.toXDR(),privy_identity_proof:'qa-a',customer_action_token},auth())).statusCode).toBe(409);
  const send=vi.fn(async()=>({txHash:signed.hash().toString('hex')}));const verify=vi.fn(async()=>false);
  const worker=new OperationWorker(pool,{lookup:async()=>({found:false,state:'pending'}),broadcast:send,verifyDeltas:verify});await worker.tick();
  const order=await app.inject({url:'/v1/trade/orders/'+id,headers:auth()});expect(order.json().data).toMatchObject({status:'confirming',actual_in_atomic:null,actual_out_atomic:null});expect(send).toHaveBeenCalledTimes(1);expect(verify).not.toHaveBeenCalled();
  await pool.query('UPDATE worker_jobs SET next_attempt_at=now() WHERE operation_id=$1',[id]);await worker.tick();expect(send).toHaveBeenCalledTimes(1);expect((await operations.get(tenantA,id)).status).not.toBe('completed');
  // Even mocked RPC success is insufficient until independently observed deltas pass.
  const noDeltaWorker=new OperationWorker(pool,{lookup:async()=>({found:true,state:'completed'}),broadcast:send,verifyDeltas:verify});
  await pool.query('UPDATE worker_jobs SET next_attempt_at=now() WHERE operation_id=$1',[id]);
  await noDeltaWorker.tick();expect((await operations.get(tenantA,id)).status).toBe('confirming');expect(send).toHaveBeenCalledTimes(1);expect(verify).toHaveBeenCalledTimes(1);
  expect((await app.inject({url:'/v1/trade/orders/'+id,headers:auth()})).json().data).toMatchObject({actual_in_atomic:null,actual_out_atomic:null});
 });
 it('does not return P2 stock/perp/commodity markets or invented fills',async()=>{
  for(const type of ['stocks','perps','commodities']){const response=await app.inject({url:'/v1/trade/markets?asset_class='+type,headers:auth()});expect(response.statusCode).toBe(200);expect(response.json().data).toEqual([]);}
 });
});
