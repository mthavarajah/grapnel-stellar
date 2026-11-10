import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {createPool} from '../../apps/api/src/db/index.js';
import {migrate} from '../../apps/api/src/db/migrate.js';
import {OperationService} from '../../apps/api/src/modules/operations/service.js';
import {OperationWorker} from '../../apps/api/src/modules/operations/worker.js';
import type {PreparedAction} from '../../packages/contracts/src/index.js';
const databaseUrl=process.env.REVIEW_TEST_DATABASE_URL??process.env.API_TEST_DATABASE_URL;
/** Offline fake verifier/envelopes are confined to this disposable Postgres database. No broadcast API exists here. */
describe.skipIf(!databaseUrl)('review: atomic authorization and ambiguous send safety',()=>{
 const pool=createPool(databaseUrl!);const service=new OperationService(pool);
 const businessId=randomUUID(),customerId=randomUUID(),walletId=randomUUID();
 const address='GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
 beforeAll(async()=>{
  const actual=(await pool.query('SELECT current_database() AS name')).rows[0].name;
  if(!actual.endsWith('_test'))throw Error('Review requires an explicitly configured disposable database ending in _test');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');await migrate(pool);
  await pool.query("INSERT INTO businesses(id,name) VALUES($1,'Offline security review')",[businessId]);
  await pool.query("INSERT INTO customers(id,business_id,external_customer_id,privy_user_id) VALUES($1,$2,'offline-user','did:privy:offline-review')",[customerId,businessId]);
  await pool.query("INSERT INTO wallets(id,business_id,customer_id,privy_wallet_id,stellar_address,public_key) VALUES($1,$2,$3,'offline-wallet',$4,$4)",[walletId,businessId,customerId,address]);
 });
 afterAll(async()=>{await pool.end();});
 async function preparedOperation(){
  const result=await service.createIdempotent({businessId,customerId,walletId,module:'capital.wallets',type:'offline.review',provider:'offline_fixture',route:'/offline-review',idempotencyKey:randomUUID(),request:{fixture:true}},async(client,id)=>{
   const action:PreparedAction={operationId:id,customerId,network:'stellar-testnet',walletAddress:address,unsignedXdr:'OFFLINE_NON_EXECUTABLE_FIXTURE',signingHashHex:'a'.repeat(64),summary:{action:'offline.review',expiresAt:new Date(Date.now()+120000).toISOString()},authorization:{method:'privy_stellar',expiresAt:new Date(Date.now()+120000).toISOString()}};
   await service.setPrepared(client,businessId,id,action);
  });
  const authorization=await service.issueAuthorization(businessId,result.operation.operation_id);
  return {id:result.operation.operation_id,token:authorization.customer_action_token};
 }
 it('rolls back token consumption, hash and job when exact signature verification rejects',async()=>{
  const op=await preparedOperation();
  await expect(service.authorize({businessId,customerId,operationId:op.id,token:op.token,signedXdr:'OFFLINE_INVALID_SIGNATURE',verify:async()=>{throw Error('offline signature rejection');}})).rejects.toThrow('offline signature rejection');
  const row=(await pool.query('SELECT state,tx_hash,signed_xdr FROM operations WHERE id=$1',[op.id])).rows[0];
  expect(row).toEqual({state:'awaiting_customer_authorization',tx_hash:null,signed_xdr:null});
  expect((await pool.query('SELECT consumed_at,status FROM wallet_authorizations WHERE operation_id=$1',[op.id])).rows[0]).toMatchObject({consumed_at:null,status:'pending'});
  expect((await pool.query('SELECT id FROM worker_jobs WHERE operation_id=$1',[op.id])).rowCount).toBe(0);
 });
 it('rejects another operation token for the same authenticated customer/wallet before verifier runs',async()=>{
  const a=await preparedOperation(),b=await preparedOperation();const verify=vi.fn(async()=>({txHash:'b'.repeat(64)}));
  await expect(service.authorize({businessId,customerId,operationId:b.id,token:a.token,signedXdr:'OFFLINE_FIXTURE',verify})).rejects.toMatchObject({code:'CUSTOMER_AUTH_INVALID'});
  expect(verify).not.toHaveBeenCalled();
 });
 it('concurrent replay consumes one authorization and persists exactly one broadcast job',async()=>{
  const op=await preparedOperation();const verify=vi.fn(async()=>({txHash:randomUUID().replaceAll('-','').repeat(2)}));
  const input={businessId,customerId,operationId:op.id,token:op.token,signedXdr:'OFFLINE_FIXTURE',verify};
  const results=await Promise.allSettled([service.authorize(input),service.authorize(input)]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
  expect(verify).toHaveBeenCalledTimes(1);
  expect((await pool.query('SELECT id FROM worker_jobs WHERE operation_id=$1',[op.id])).rowCount).toBe(1);
  await pool.query("UPDATE worker_jobs SET state='completed' WHERE operation_id=$1",[op.id]);
 });
 it('an ambiguous initial send is polled by stored hash without another send or false completion',async()=>{
  const op=await preparedOperation();const hash=randomUUID().replaceAll('-','').repeat(2);
  await service.authorize({businessId,customerId,operationId:op.id,token:op.token,signedXdr:'OFFLINE_FIXTURE',verify:async()=>({txHash:hash})});
  const broadcast=vi.fn(async()=>{throw Error('offline timeout after possible delivery');});
  const worker=new OperationWorker(pool,{lookup:async()=>({found:false,state:'pending'}),broadcast,verifyDeltas:async()=>false});
  await worker.tick();
  await pool.query("UPDATE worker_jobs SET next_attempt_at=now() WHERE operation_id=$1",[op.id]);
  await worker.tick();
  expect(broadcast).toHaveBeenCalledTimes(1);
  expect((await service.get(businessId,op.id)).status).not.toBe('completed');
  expect((await pool.query('SELECT tx_hash,signed_xdr FROM operations WHERE id=$1',[op.id])).rows[0]).toEqual({tx_hash:hash,signed_xdr:'OFFLINE_FIXTURE'});
  expect((await pool.query('SELECT id FROM operation_attempts WHERE operation_id=$1',[op.id])).rowCount).toBe(1);
 });
});
