import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createPool } from '../../apps/api/src/db/index.js';
import type { PreparedAction } from '../../packages/contracts/src/index.js';
const require=createRequire(new URL('../../apps/api/package.json',import.meta.url));
const {Keypair}=require('@stellar/stellar-sdk');
import { migrate } from '../../apps/api/src/db/migrate.js';
import { OperationService } from '../../apps/api/src/modules/operations/service.js';
const url=process.env.API_TEST_DATABASE_URL;
describe.skipIf(!url)('Unsigned action expiry (offline Postgres fixtures)',()=>{
 let pool:ReturnType<typeof createPool>;let operations:OperationService;let customerId:string;let walletId:string;
 const businessId='00000000-0000-4000-8000-000000000001';const address=Keypair.random().publicKey();
 beforeAll(async()=>{pool=createPool(url!);const name=(await pool.query('SELECT current_database() AS name')).rows[0].name;if(!name.endsWith('_test'))throw Error('Disposable _test database required');await migrate(pool);operations=new OperationService(pool);customerId=(await pool.query('INSERT INTO customers(business_id,external_customer_id) VALUES($1,$2) RETURNING id',[businessId,'offline-expiry-'+randomUUID()])).rows[0].id;walletId=(await pool.query("INSERT INTO wallets(business_id,customer_id,privy_wallet_id,stellar_address,public_key) VALUES($1,$2,'offline-expiry',$3,$3) RETURNING id",[businessId,customerId,address])).rows[0].id;});
 afterAll(async()=>pool?.end());
 async function fixture(){
  const created=await operations.createIdempotent({businessId,customerId,walletId,module:'capital.wallets',type:'offline.expiry',provider:'offline-test',route:'/test/expiry',idempotencyKey:randomUUID(),request:{}},async(client,id)=>{
   const expiry=new Date(Date.now()+60000).toISOString();const action:PreparedAction={operationId:id,customerId,network:'stellar-testnet',walletAddress:address,unsignedXdr:'offline fixture only',signingHashHex:'0'.repeat(64),summary:{action:'payment',expiresAt:expiry},authorization:{method:'privy_stellar',expiresAt:expiry}};
   await operations.reserve(client,{businessId,customerId,walletId,operationId:id,assetId:'stellar-testnet:native:XLM',amountAtomic:1n,spendableAtomic:100n,observedAt:new Date(),expiresAt:new Date(expiry)});
   await operations.setPrepared(client,businessId,id,action);
  });
  const id=created.operation.operation_id;await operations.issueAuthorization(businessId,id);
  await pool.query("UPDATE operations SET prepared_action=jsonb_set(prepared_action,'{authorization,expiresAt}',to_jsonb('2000-01-01T00:00:00.000Z'::text)) WHERE id=$1",[id]);return id;
 }
 it('expires abandoned unsigned approval and releases its hold and token',async()=>{const id=await fixture();expect((await operations.get(businessId,id)).status).toBe('expired');expect((await pool.query('SELECT state FROM balance_reservations WHERE operation_id=$1',[id])).rows[0].state).toBe('released');expect((await pool.query('SELECT status FROM wallet_authorizations WHERE operation_id=$1',[id])).rows[0].status).toBe('expired');});
 it('retains signed or uncertain transaction holds even after approval expiry',async()=>{const id=await fixture();await pool.query("UPDATE operations SET state='confirming',signed_xdr='offline uncertain fixture',tx_hash=$2 WHERE id=$1",[id,randomUUID().replaceAll('-','').repeat(2)]);await operations.expireUnsignedActions();expect((await operations.get(businessId,id)).status).toBe('confirming');expect((await pool.query('SELECT state FROM balance_reservations WHERE operation_id=$1',[id])).rows[0].state).toBe('active');});
});
