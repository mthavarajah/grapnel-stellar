import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Account, Asset, Keypair, Networks, Operation, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import type { Pool } from 'pg';
import { XLM, type PreparedAction, type WalletBalance } from '@grapnel/contracts';
import type { BlendPosition } from '../../adapters/blend/index.js';
import type { StellarTestnetExecutor } from '../../adapters/stellar/index.js';
import { createRuntimeWorkerChain, inspectSupplyDeltas, type SupplyBaseline } from '../../runtime.js';
import { createPool } from '../../db/index.js';
import { migrate } from '../../db/migrate.js';
import { OperationService } from '../operations/service.js';

/** All accounts, signatures and chain observations below are offline fixtures, never sent to a network. */
const wallet=Keypair.random();const recipient=Keypair.random().publicKey();
const now=Date.now();const asOf=new Date(now).toISOString();
const baseline:SupplyBaseline={asset_id:XLM.id,market_id:'offline-market',pool_contract_id:'offline-pool',reserve_contract_id:'offline-reserve',wallet_address:wallet.publicKey(),wallet_amount:'100.0000000',collateral:'0.0000000',as_of:asOf,position_as_of:asOf,position_ledger:99};
const position:BlendPosition={market_id:baseline.market_id,pool_contract_id:baseline.pool_contract_id,reserve_contract_id:baseline.reserve_contract_id,asset_id:XLM.id,supplied:'1.0000000',collateral:'0.9999999',borrowed:'0.0000000',wallet_spendable:false,supply_apy_variable:null,health_factor:null,as_of_ledger:101,as_of:asOf,readiness:'discovery_only'};
const balance:WalletBalance={asset_id:XLM.id,wallet_amount:'98.9400000',reserved:'0',spendable:'97.0000000',as_of:asOf,source:'stellar_horizon_testnet'};
const request={asset_id:XLM.id,market_id:baseline.market_id,amount:'1.0000000'};
const observation=()=>({baseline,request,walletAddress:wallet.publicKey(),positions:[position],balances:[balance],confirmedLedger:100,now});

describe('Blend supply reconciliation (offline observations)',()=>{
 it('records actual wallet and collateral deltas only when both are observed after confirmed ledger',()=>{
  const result=inspectSupplyDeltas(observation());expect(result.verified).toBe(true);
  expect(result.result.blend_supply_verification).toMatchObject({verified:true,requested_atomic:'10000000',collateral_before:'0.0000000',collateral_after:'0.9999999',collateral_delta:'0.9999999',wallet_before:'100.0000000',wallet_after:'98.9400000',wallet_debit:'1.0600000',confirmed_ledger:100,observed_ledger:101});
 });
 it.each([undefined,{}, {...baseline,collateral:'invalid'}])('does not invent a zero position when baseline is absent/invalid %j',missing=>{
  expect(inspectSupplyDeltas({...observation(),baseline:missing}).verified).toBe(false);
 });
 it('requires the exact wallet, market and native asset from baseline',()=>{
  expect(inspectSupplyDeltas({...observation(),walletAddress:recipient}).verified).toBe(false);
  expect(inspectSupplyDeltas({...observation(),request:{...request,market_id:'other'}}).verified).toBe(false);
  expect(inspectSupplyDeltas({...observation(),request:{...request,asset_id:'other'}}).verified).toBe(false);
 });
 it('does not complete when collateral or wallet deltas are missing',()=>{
  expect(inspectSupplyDeltas({...observation(),positions:[{...position,collateral:'0'}]}).verified).toBe(false);
  expect(inspectSupplyDeltas({...observation(),balances:[{...balance,wallet_amount:'99.5000000'}]}).verified).toBe(false);
  expect(inspectSupplyDeltas({...observation(),positions:[]}).verified).toBe(false);
 });
 it.each([
  {positions:[{...position,as_of:new Date(now-31000).toISOString()}]},
  {balances:[{...balance,as_of:new Date(now-16000).toISOString()}]},
  {positions:[{...position,as_of_ledger:99}]},
  {positions:[{...position,as_of_ledger:Number.NaN}]},
  {confirmedLedger:0},
  {balances:[{...balance,source:'simulation'}]},
 ])('rejects stale or unverified observations %j',change=>expect(inspectSupplyDeltas({...observation(),...change}).verified).toBe(false));
});

function envelopeFixture(){
 const tx=new TransactionBuilder(new Account(wallet.publicKey(),'1'),{fee:'100',networkPassphrase:Networks.TESTNET}).addOperation(Operation.payment({destination:recipient,asset:Asset.native(),amount:'1'})).setTimeout(60).build();tx.sign(wallet);
 const expiry=new Date(Date.now()+60000).toISOString();
 const action:PreparedAction={operationId:'operation',customerId:'customer',network:'stellar-testnet',walletAddress:wallet.publicKey(),unsignedXdr:'offline fixture',signingHashHex:tx.hash().toString('hex'),summary:{action:'blend.supply',fromAssetId:XLM.id,amount:'1',recipient:wallet.publicKey(),contractId:'offline-pool',maxFeeStroops:'100',expiresAt:expiry},authorization:{method:'privy_stellar',expiresAt:expiry}};
 const row={id:'operation',business_id:'business',customer_id:'customer',wallet_id:'wallet',stellar_address:wallet.publicKey(),privy_user_id:'did:privy:offline',type:'blend.supply',module_code:'capital.lending',provider:'blend',prepared_action:action,request_json:request,result_json:{blend_supply_baseline:baseline},signed_xdr:tx.toXDR(),tx_hash:tx.hash().toString('hex')};
 return {tx,row};
}
function fakeRuntime(row:unknown,gate1Passed=true,status='SUCCESS'){
 const submit=vi.fn(async()=>({txHash:'offline'}));const send=vi.fn(async(_tx:Transaction)=>({hash:'offline',status:'PENDING'}));
 const positions=vi.fn(async()=>[position]);const verify=vi.fn(async()=>{});
 const chain={reconcile:vi.fn(async()=>status==='SUCCESS'?'completed':'pending'),submit,verifyLiveNetwork:vi.fn(async()=>{}),getClassicBalances:vi.fn(async()=>[balance]),server:{sendTransaction:send,getTransaction:vi.fn(async()=>({status,ledger:100}))}} as unknown as StellarTestnetExecutor;
 const pool={query:vi.fn(async()=>({rows:row?[row]:[]}))} as unknown as Pool;
 return {worker:createRuntimeWorkerChain({pool,chain,blend:{positions},soroban:{verifyForSubmission:verify},gate1Passed}),submit,send,positions,verify};
}
describe('Durable worker provider boundaries (offline doubles; no sender touches network)',()=>{
 it('never executes provider verification or send when Gate1 is absent',async()=>{const {tx,row}=envelopeFixture();const f=fakeRuntime(row,false);await expect(f.worker.broadcast(tx.toXDR())).rejects.toMatchObject({code:'EXECUTION_UNAVAILABLE'});expect(f.verify).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();expect(f.submit).not.toHaveBeenCalled();});
 it('rejects an envelope without an exact durable operation and unknown operation types',async()=>{const {tx,row}=envelopeFixture();for(const missing of [undefined,{...row,type:'unreviewed.action'}]){const f=fakeRuntime(missing);await expect(f.worker.broadcast(tx.toXDR())).rejects.toMatchObject({code:'EXECUTION_UNAVAILABLE'});expect(f.send).not.toHaveBeenCalled();expect(f.submit).not.toHaveBeenCalled();}});
 it('requires stored approved supply amount to match the exact request',async()=>{const {tx,row}=envelopeFixture();const f=fakeRuntime({...row,request_json:{...request,amount:'2'}});await expect(f.worker.broadcast(tx.toXDR())).rejects.toMatchObject({code:'INTENT_MISMATCH'});expect(f.verify).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();});
 it('re-runs the exact inspector before any future supply send and keeps uncertain result hash',async()=>{const {tx,row}=envelopeFixture();const f=fakeRuntime(row);f.verify.mockRejectedValueOnce(Error('Changed footprint'));await expect(f.worker.broadcast(tx.toXDR())).rejects.toThrow('Changed footprint');expect(f.send).not.toHaveBeenCalled();});
 it('does not retry or mutate an approved envelope after an ambiguous mocked RPC send',async()=>{const {tx,row}=envelopeFixture();const f=fakeRuntime(row);f.send.mockRejectedValueOnce(Error('offline timeout'));await expect(f.worker.broadcast(tx.toXDR())).rejects.toMatchObject({code:'SUBMISSION_UNCERTAIN',details:{tx_hash:row.tx_hash}});expect(f.send).toHaveBeenCalledTimes(1);expect(f.submit).not.toHaveBeenCalled();expect(f.send.mock.calls[0]?.[0]?.toXDR()).toBe(tx.toXDR());});
 it('cannot verify supply deltas when RPC is pending or failed',async()=>{const {row}=envelopeFixture();for(const status of ['NOT_FOUND','FAILED']){const f=fakeRuntime(row,true,status);expect(await f.worker.verifyDeltas(row.id,row.tx_hash)).toBe(false);expect(f.positions).not.toHaveBeenCalled();}});
 it('returns unverified for absent baseline even after mocked RPC success',async()=>{const {row}=envelopeFixture();const f=fakeRuntime({...row,result_json:{}});const result=await f.worker.verifyDeltas(row.id,row.tx_hash);expect(result).toMatchObject({verified:false});});
 it('returns structured observed evidence only after mocked RPC success and actual fixture deltas',async()=>{const {row}=envelopeFixture();const f=fakeRuntime(row);const result=await f.worker.verifyDeltas(row.id,row.tx_hash);expect(result).toMatchObject({verified:true,result:{blend_supply_verification:{verified:true}}});});
});

const databaseUrl=process.env.SUPPLY_RUNTIME_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('Reconciliation baseline preservation (disposable Postgres, offline operations)',()=>{
 let pool:Pool;let operations:OperationService;const businessId=randomUUID(),customerId=randomUUID(),walletId=randomUUID();
 beforeAll(async()=>{pool=createPool(databaseUrl!);const actual=(await pool.query('SELECT current_database() AS name')).rows[0].name;if(!actual.endsWith('_test'))throw Error('Dedicated disposable _test database required');await migrate(pool);operations=new OperationService(pool);await pool.query("INSERT INTO businesses(id,name) VALUES($1,'Offline supply runtime tests')",[businessId]);await pool.query("INSERT INTO customers(id,business_id,external_customer_id) VALUES($1,$2,'offline')",[customerId,businessId]);await pool.query("INSERT INTO wallets(id,business_id,customer_id,privy_wallet_id,stellar_address,public_key) VALUES($1,$2,$3,'offline-wallet',$4,$4)",[walletId,businessId,customerId,wallet.publicKey()]);});
 afterAll(async()=>pool?.end());
 it('preserves the real baseline through pending and unverified observations, never completing without verified delta',async()=>{
  const created=await operations.createIdempotent({businessId,customerId,walletId,module:'capital.lending',type:'blend.supply',provider:'offline-test',route:'/offline/supply',idempotencyKey:randomUUID(),request});const id=created.operation.operation_id;
  await pool.query("UPDATE operations SET state='confirming',tx_hash=$2,result_json=$3 WHERE id=$1",[id,randomUUID().replaceAll('-','').repeat(2),JSON.stringify({blend_supply_baseline:baseline})]);
  await operations.recordReconciliation(businessId,id,{state:'pending'});
  let row=(await pool.query('SELECT state,result_json FROM operations WHERE id=$1',[id])).rows[0];expect(row.state).toBe('confirming');expect(row.result_json.blend_supply_baseline).toEqual(baseline);
  await operations.recordReconciliation(businessId,id,{state:'completed',deltaVerified:false,result:{blend_supply_verification:{verified:false}}});
  row=(await pool.query('SELECT state,result_json FROM operations WHERE id=$1',[id])).rows[0];expect(row.state).toBe('confirming');expect(row.result_json.blend_supply_baseline).toEqual(baseline);expect(row.result_json.blend_supply_verification.verified).toBe(false);
 });
});
