import { randomUUID,createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { beforeAll,beforeEach,afterAll,describe,it,expect,vi } from 'vitest';
import { buildApp } from '../../apps/api/src/app.js';
import { createPool } from '../../apps/api/src/db/index.js';
import { migrate } from '../../apps/api/src/db/migrate.js';
import { requireBusiness,requireCustomer,success } from '../../apps/api/src/lib/context.js';
import { WalletService } from '../../apps/api/src/modules/wallets/service.js';
import { OperationService } from '../../apps/api/src/modules/operations/service.js';
import { FundingService } from '../../apps/api/src/modules/funding/service.js';
import { TestnetFundingAdapter } from '../../apps/api/src/adapters/testnet-funding/index.js';
import { NETWORK_PASSPHRASE,XLM } from '../../packages/contracts/src/index.js';
const require=createRequire(new URL('../../apps/api/package.json',import.meta.url));
const {Keypair}=require('@stellar/stellar-sdk');
const url=process.env.API_TEST_DATABASE_URL;
describe.skipIf(!url)('QA Postgres tenant boundaries and treasury concurrency',()=>{
 const pool=createPool(url!);let app:Awaited<ReturnType<typeof buildApp>>;
 const tenantA=randomUUID(),tenantB=randomUUID(),customerA=randomUUID(),customerB=randomUUID(),walletA=randomUUID(),walletB=randomUUID();
 const addressA=Keypair.random().publicKey(),addressB=Keypair.random().publicKey();
 const keyA='gr_test_'+randomUUID()+randomUUID();const keyB='gr_test_'+randomUUID()+randomUUID();
 const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
 const auth=(key=keyA)=>({authorization:'Bearer '+key});
 const ownerOrigin='http://localhost:3000';let ownerCookie:string,csrf:string;
 const identity={async verify(token:string){if(token!=='qa-user-a')throw Error('invalid fixture identity');return {userId:'did:privy:qa-user-a',wallets:[{id:'qa-wallet-a',address:addressA,publicKey:addressA}]};}};
 beforeAll(async()=>{
  const name=(await pool.query('SELECT current_database() AS name')).rows[0].name;
  if(!name.endsWith('_test'))throw Error('QA requires disposable database ending in _test');
  await migrate(pool);
  for(const [id,key,customer,wallet,address,user] of [[tenantA,keyA,customerA,walletA,addressA,'a'],[tenantB,keyB,customerB,walletB,addressB,'b']]){
   await pool.query('INSERT INTO businesses(id,name) VALUES($1,$2)',[id,'QA tenant '+user]);
   await pool.query('INSERT INTO business_modules(business_id,module_code,enabled) SELECT $1,unnest(enum_range(NULL::module_code)),true',[id]);
   await pool.query("INSERT INTO api_keys(business_id,prefix,last_four,key_hash,name) VALUES($1,'qa-fixture',$2,$3,'QA fixture')",[id,key.slice(-4),hash(key)]);
   await pool.query('INSERT INTO customers(id,business_id,external_customer_id,privy_user_id) VALUES($1,$2,$3,$3)',[customer,id,'did:privy:qa-user-'+user]);
   await pool.query("INSERT INTO wallets(id,business_id,customer_id,privy_wallet_id,stellar_address,public_key,status) VALUES($1,$2,$3,$4,$5,$5,'active')",[wallet,id,customer,'qa-wallet-'+user,address]);
  }
  const wallets=new WalletService(pool,identity,{} as any,{} as any);
  app=await buildApp({pool,config:{databaseUrl:url!,network:'testnet',networkPassphrase:NETWORK_PASSPHRASE,dashboardOrigin:ownerOrigin,fintechOrigin:'http://localhost:3002',adminLoginSecret:'qa-only-owner-secret',sessionSecret:'qa-only-session-secret-at-least-32-bytes',production:false,port:0,demoBusinessId:tenantA},identityVerifier:identity,registerAdapters:async app=>{
   app.get('/qa/wallets/:id',async request=>{const b=await requireBusiness(request,'capital.wallets');return success(request,await wallets.get(b.businessId,(request.params as {id:string}).id));});
   app.post('/qa/spend',async request=>{await requireBusiness(request,'capital.testnet_funding');const body=request.body as {customer_id:string;wallet_id:string};return success(request,await requireCustomer(request,body.customer_id,body.wallet_id));});
  }});
  const login=await app.inject({method:'POST',url:'/v1/dashboard/login',headers:{origin:ownerOrigin},payload:{secret:'qa-only-owner-secret'}});
  ownerCookie=login.cookies[0]!.name+'='+login.cookies[0]!.value;csrf=login.json().data.csrf_token;
 });
 // Each case owns its offline pending operations. Terminalize only prior-case fixture
 // operations; runtime pending/ambiguous-send assertions within each case stay intact.
 beforeEach(async()=>{
  await pool.query("UPDATE operations SET state='failed' WHERE business_id=ANY($1::uuid[]) AND state NOT IN ('completed','failed','rejected','expired')",[[tenantA,tenantB]]);
  await pool.query("UPDATE balance_reservations SET state='released' WHERE business_id=ANY($1::uuid[])",[[tenantA,tenantB]]);
  await pool.query("UPDATE worker_jobs SET state='completed' WHERE operation_id IN (SELECT id FROM operations WHERE business_id=ANY($1::uuid[]))",[[tenantA,tenantB]]);
 });
 afterAll(async()=>{await app?.close();await pool.end();});
 it('hides foreign wallet, operation and portfolio under valid tenant A key',async()=>{
  const ops=new OperationService(pool);
  const foreign=await ops.createIdempotent({businessId:tenantB,customerId:customerB,walletId:walletB,module:'capital.wallets',type:'qa.fixture',provider:'test-only',route:'/qa',idempotencyKey:randomUUID(),request:{}});
  expect((await app.inject({url:'/qa/wallets/'+walletB,headers:auth()})).statusCode).toBe(404);
  expect((await app.inject({url:'/v1/operations/'+foreign.operation.operation_id,headers:auth()})).statusCode).toBe(404);
  expect((await app.inject({url:'/v1/portfolio?customer_id='+customerB,headers:auth()})).statusCode).toBe(404);
 });
 it('database rejects a cross-tenant wallet/customer relationship',async()=>{
  await expect(pool.query("INSERT INTO wallets(business_id,customer_id,privy_wallet_id,stellar_address,public_key) VALUES($1,$2,'foreign-fixture',$3,$3)",[tenantA,customerB,addressB])).rejects.toMatchObject({code:'23503'});
 });
 it('valid identity cannot spend through another customer or wallet binding',async()=>{
  for(const payload of [{customer_id:customerB,wallet_id:walletB},{customer_id:customerA,wallet_id:walletB}]){
   expect((await app.inject({method:'POST',url:'/qa/spend',headers:{...auth(),'x-customer-identity':'qa-user-a'},payload})).statusCode).toBe(404);
  }
  expect((await app.inject({method:'POST',url:'/qa/spend',headers:auth(),payload:{customer_id:customerA,wallet_id:walletA}})).statusCode).toBe(403);
 });
 it('rejects hostile origin even with valid owner cookie and CSRF',async()=>{
  const result=await app.inject({method:'PATCH',url:'/v1/dashboard/modules',headers:{cookie:ownerCookie,'x-csrf-token':csrf,origin:'https://attacker.invalid'},payload:{modules:[]}});
  expect(result.statusCode).toBe(403);expect(result.json().error.code).toBe('CSRF_INVALID');
 });
 it('same key loses and regains financial permission without rotation',async()=>{
  const change=async(modules:string[])=>app.inject({method:'PATCH',url:'/v1/dashboard/modules',headers:{cookie:ownerCookie,origin:ownerOrigin,'x-csrf-token':csrf},payload:{modules}});
  await change(['capital.wallets']);
  const payload={customer_id:customerA,wallet_id:walletA};const headers={...auth(),'x-customer-identity':'qa-user-a'};
  expect((await app.inject({method:'POST',url:'/qa/spend',headers,payload})).statusCode).toBe(403);
  await change(['capital.wallets','capital.testnet_funding']);
  expect((await app.inject({method:'POST',url:'/qa/spend',headers,payload})).statusCode).toBe(200);
 });
 it('serializes treasury preparation across tenants and preserves unknown grants',async()=>{
  const adapter=new TestnetFundingAdapter({network:'testnet',networkPassphrase:NETWORK_PASSPHRASE,treasurySecret:Keypair.random().secret(),enabled:true,gate1Passed:true,maxPerCustomerAtomic:1000000000n,maxPerTenantAtomic:1000000000n,maxGlobalAtomic:1000000000n});
  const testHash=hash(randomUUID());
  const spy=vi.spyOn(adapter,'prepareFund').mockImplementation(async input=>({unsignedXdr:'test-only-unsigned',signedXdr:'test-only-signed-never-broadcast',txHash:testHash,source:adapter.treasuryAddress!,recipient:input.customer.walletAddress,amountAtomic:10000000n,feeAtomic:100n,beforeRecipientAtomic:0n,expiresAt:new Date(Date.now()+120000).toISOString()}));
  const service=new FundingService(adapter,new OperationService(pool));
  const attempts=[[tenantA,customerA,walletA,addressA,'a'],[tenantB,customerB,walletB,addressB,'b']].map(async([businessId,customerId,walletId,walletAddress,user])=>service.create('fund',{customer_id:customerId,wallet_id:walletId,asset_id:XLM.id,amount:'1'},{businessId,customerId,walletId,walletAddress,privyUserId:'did:privy:qa-user-'+user},randomUUID()));
  const results=await Promise.allSettled(attempts);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect((results.find(r=>r.status==='rejected') as PromiseRejectedResult).reason.code).toBe('TREASURY_BUSY');
  expect(spy).toHaveBeenCalledTimes(1);
  const stored=(await pool.query('SELECT state,tx_hash FROM operations WHERE tx_hash=$1',[testHash])).rows[0];
  expect(stored.state).toBe('preparing');expect(stored.tx_hash).toBe(testHash);
  spy.mockRestore();
 });
 it('enforces lifetime grant cap across API keys using durable transfer totals',async()=>{
  const adapter=new TestnetFundingAdapter({network:'testnet',networkPassphrase:NETWORK_PASSPHRASE,treasurySecret:Keypair.random().secret(),enabled:true,gate1Passed:true,maxGlobalAtomic:1n});
  const spy=vi.spyOn(adapter,'prepareFund');
  const service=new FundingService(adapter,new OperationService(pool));
  await expect(service.create('fund',{customer_id:customerA,wallet_id:walletA,asset_id:XLM.id,amount:'1'},{businessId:tenantA,customerId:customerA,walletId:walletA,walletAddress:addressA,privyUserId:'did:privy:qa-user-a'},randomUUID())).rejects.toMatchObject({code:'TESTNET_FUNDING_LIMIT',statusCode:429});
  expect(spy).not.toHaveBeenCalled();spy.mockRestore();
 });
 it('revoked tenant key fails before object lookup',async()=>{
  await pool.query('UPDATE api_keys SET revoked_at=now() WHERE business_id=$1',[tenantB]);
  expect((await app.inject({url:'/qa/wallets/'+walletB,headers:auth(keyB)})).statusCode).toBe(401);
 });
});
