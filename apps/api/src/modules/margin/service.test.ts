import {randomUUID} from 'node:crypto';
import {Account,Asset,Keypair,Operation,TransactionBuilder} from '@stellar/stellar-sdk';
import pg from 'pg';
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {NETWORK_PASSPHRASE,type CustomerContext,type PreparedAction} from '@grapnel/contracts';
import {canonicalJson,digest} from '../../lib/crypto.js';
import {migrate} from '../../db/migrate.js';
import {OperationService} from '../operations/service.js';
import {MarginWorkflowService} from './service.js';
import {MARGIN_STEP_ACTIONS,type MarginAdapter,type MarginEvidence,type MarginFailureEvidence,type MarginStepContext,type MarginTerms} from './types.js';

const databaseUrl=process.env.MARGIN_WORKFLOW_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('Margin coordinator disposable Postgres integration (fixture adapter; no chain execution)',()=>{
 const businessId='00000000-0000-4000-8000-000000000001';
 const policy={pinsHash:'a'.repeat(64),policyVersion:'fixture-v1'};
 const terms:MarginTerms={network:'stellar-testnet',provider:'peridot',marketId:'test-only-market',poolId:'test-only-pool',marginAssetId:'test-only-usdt',baseAssetId:'stellar-testnet:native:XLM',receiptAssetId:'test-only-receipt',direction:'long',leverage:2,collateralAtomic:'10000000',slippageBps:50,maxFeeStroops:'10000000',depositMaxFeeStroops:'80000000',...policy};
 let pool:pg.Pool,operations:OperationService,service:MarginWorkflowService,customer:CustomerContext,adapter:MarginAdapter,signer:Keypair;
 let observedContext:MarginStepContext|null,evidence:MarginEvidence;
 beforeAll(async()=>{
  pool=new pg.Pool({connectionString:databaseUrl});const actual=(await pool.query('SELECT current_database() AS name')).rows[0].name;
  if(actual!=='grapnel_margin_workflow_test')throw Error('Use only the dedicated disposable grapnel_margin_workflow_test database');
  await pool.query('DROP SCHEMA public CASCADE;CREATE SCHEMA public');await migrate(pool);
  await pool.query("INSERT INTO assets(id,network,kind,code,decimals,verified,source_url) VALUES('test-only-usdt','stellar-testnet','soroban','MOCK',7,true,'test-fixture'),('test-only-receipt','stellar-testnet','soroban','RECEIPT',6,true,'test-fixture')");
 });
 afterAll(async()=>{await pool?.end();});
 beforeEach(async()=>{
  signer=Keypair.random();customer={businessId,customerId:randomUUID(),walletId:randomUUID(),walletAddress:signer.publicKey(),privyUserId:'did:privy:offline-test'};
  await pool.query('INSERT INTO customers(id,business_id,external_customer_id) VALUES($1,$2,$3)',[customer.customerId,businessId,customer.customerId]);
  await pool.query("INSERT INTO wallets(id,business_id,customer_id,privy_wallet_id,stellar_address,public_key,status) VALUES($1,$2,$3,$5,$4,$4,'active')",[customer.walletId,businessId,customer.customerId,customer.walletAddress,customer.walletId]);
  operations=new OperationService(pool);observedContext=null;
  adapter={validateWorkflowTerms:vi.fn(async()=>{}),assertStepReady:vi.fn(async()=>{}),prepareStep:vi.fn(async (context:MarginStepContext)=>{
   observedContext=context;const expiresAt=new Date(Date.now()+60000).toISOString();
   const prepared:PreparedAction={operationId:context.operationId,customerId:customer.customerId,network:'stellar-testnet',walletAddress:customer.walletAddress,unsignedXdr:'offline-explicit-fixture-not-real-xdr',signingHashHex:'b'.repeat(64),summary:{action:MARGIN_STEP_ACTIONS[context.step],fromAssetId:terms.marginAssetId,amount:'1',maxFeeStroops:'100',expiresAt},authorization:{method:'privy_stellar',expiresAt}};
   return{prepared,baseline:{fixture:true},reservations:[{assetId:'stellar-testnet:native:XLM',amountAtomic:100n,spendableAtomic:1000000000n,observedAt:new Date()},{assetId:terms.marginAssetId,amountAtomic:10000000n,spendableAtomic:1000000000n,observedAt:new Date()}]};
  }),readConfirmedEvidence:vi.fn(async()=>evidence)};
  service=new MarginWorkflowService(operations,adapter,policy);
 });
 async function prepared(){const workflow=await service.create(customer,terms,randomUUID());const result=await service.prepare(customer,workflow.id,'vault_deposit',{},'deposit');return{workflow,result};}
 async function completedFixture(){const f=await prepared(),c=observedContext!;const hash=randomUUID().replaceAll('-','').repeat(2);
  await pool.query("UPDATE operations SET state='completed',tx_hash=$2,signed_xdr='offline-signed-fixture' WHERE id=$1",[f.result.operation.operation_id,hash]);
  evidence={network:'stellar-testnet',chainStatus:'SUCCESS',txHash:hash,ledger:10,owner:customer.walletAddress,step:'vault_deposit',intentHash:c.intentHash,observedAt:new Date().toISOString(),before:{walletUnderlyingAtomic:'10000000',walletReceiptAtomic:'0',marginReceiptAtomic:'0',position:null},after:{walletUnderlyingAtomic:'0',walletReceiptAtomic:'9999780',marginReceiptAtomic:'0',position:null}};
  return f;
 }
 async function failedFixture(){
  const f=await prepared(),context=observedContext!,stored=(await pool.query('SELECT prepared_action FROM operations WHERE id=$1',[f.result.operation.operation_id])).rows[0].prepared_action as PreparedAction;
  // A local signed payment fixture tests generic durable recovery binding; it is not a real Peridot execution or failure proof.
  const tx=new TransactionBuilder(new Account(customer.walletAddress,'1'),{fee:'100',networkPassphrase:NETWORK_PASSPHRASE}).addOperation(Operation.payment({destination:Keypair.random().publicKey(),asset:Asset.native(),amount:'0.1'})).setTimeout(60).build(),expiresAt=new Date(Number(tx.timeBounds!.maxTime)*1000).toISOString();
  const actualPrepared:PreparedAction={...stored,unsignedXdr:tx.toXDR(),signingHashHex:tx.hash().toString('hex'),summary:{...stored.summary,expiresAt},authorization:{...stored.authorization,expiresAt}};tx.sign(signer);const hash=tx.hash().toString('hex'),signed=tx.toXDR();
  await pool.query("UPDATE operations SET state='failed',prepared_action=$2,approved_intent_hash=$3,xdr_hash=$4,signed_xdr=$5,tx_hash=$6 WHERE id=$1",[f.result.operation.operation_id,JSON.stringify(actualPrepared),digest(canonicalJson(actualPrepared.summary)),digest(actualPrepared.unsignedXdr),signed,hash]);
  await pool.query("UPDATE balance_reservations SET state='released' WHERE operation_id=$1",[f.result.operation.operation_id]);
  const failure:MarginFailureEvidence={network:'stellar-testnet',chainStatus:'FAILED',txHash:hash,ledger:42,owner:customer.walletAddress,step:'vault_deposit',intentHash:context.intentHash,observedAt:new Date().toISOString(),principalAndPositionUnchanged:true,sourceSequenceConsumed:true,feeStroops:'100'};
  adapter.readFailedEvidence=vi.fn(async()=>failure);return{...f,failure,hash,signed,actualPrepared};
 }
 it('creates an idempotent parent without a pending operation and freezes all approved economic terms',async()=>{
  const w=await service.create(customer,terms,customer.customerId);expect(await service.create(customer,terms,customer.customerId)).toEqual(w);expect((await pool.query('SELECT * FROM operations WHERE wallet_id=$1',[customer.walletId])).rowCount).toBe(0);
  await expect(service.create(customer,{...terms,leverage:3},customer.customerId)).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
  await expect(pool.query("UPDATE margin_workflows SET terms_json=terms_json||'{\"leverage\":5}' WHERE id=$1",[w.id])).rejects.toThrow('immutable');
 });
 it('binds workflow to the exact tenant/customer/wallet/address before calling adapters',async()=>{
  const w=await service.create(customer,terms,customer.customerId);await expect(service.get({...customer,businessId:randomUUID()},w.id)).rejects.toMatchObject({code:'NOT_FOUND'});await expect(service.get({...customer,customerId:randomUUID()},w.id)).rejects.toMatchObject({code:'NOT_FOUND'});await expect(service.get({...customer,walletAddress:Keypair.random().publicKey()},w.id)).rejects.toMatchObject({code:'NOT_FOUND'});
 });
 it('does not permit another workflow while the wallet has unrecovered margin',async()=>{await service.create(customer,terms,customer.customerId+'a');await expect(service.create(customer,terms,customer.customerId+'b')).rejects.toMatchObject({code:'MARGIN_WORKFLOW_CONFLICT'});});
 it('validates server policy and exact adapter readiness before creating an approvable child',async()=>{
  vi.mocked(adapter.validateWorkflowTerms).mockRejectedValueOnce(Error('wrong exact pool'));await expect(service.create(customer,terms,customer.customerId)).rejects.toThrow('wrong exact pool');
  const w=await service.create(customer,terms,customer.customerId);vi.mocked(adapter.assertStepReady).mockRejectedValueOnce(Error('current step unproven'));await expect(service.prepare(customer,w.id,'vault_deposit',{},'deposit')).rejects.toThrow('current step unproven');expect((await service.get(customer,w.id)).activeOperationId).toBeNull();expect((await pool.query('SELECT * FROM operations WHERE wallet_id=$1',[customer.walletId])).rowCount).toBe(0);
 });
 it('prepares one separate customer approval with exact fee/principal reservations and durable child binding',async()=>{
  const {workflow,result}=await prepared();expect(result.operation.status).toBe('awaiting_customer_authorization');const state=await service.get(customer,workflow.id);expect(state.phase).toBe('awaiting_collateral');expect(state.activeOperationId).toBe(result.operation.operation_id);expect(state.revision).toBe(1);
  expect((await pool.query('SELECT amount_atomic::text FROM balance_reservations WHERE operation_id=$1 ORDER BY amount_atomic',[result.operation.operation_id])).rows.map(r=>r.amount_atomic)).toEqual(['100','10000000']);
  expect((await pool.query('SELECT step,attempt FROM margin_workflow_steps WHERE operation_id=$1',[result.operation.operation_id])).rows).toEqual([{step:'vault_deposit',attempt:1}]);
 });
 it('returns the same child on idempotent retry and blocks out-of-order/parallel actions',async()=>{
  const {workflow,result}=await prepared();const again=await service.prepare(customer,workflow.id,'vault_deposit',{},'deposit');expect(again.created).toBe(false);expect(again.operation.operation_id).toBe(result.operation.operation_id);expect(adapter.prepareStep).toHaveBeenCalledTimes(1);
  await expect(service.prepare(customer,workflow.id,'margin_transfer',{},'next')).rejects.toMatchObject({code:'WALLET_OPERATION_PENDING'});
 });
 it('never advances on accepted, submitted or uncertain operations and retains the same hash',async()=>{
  const {workflow,result}=await prepared();for(const status of ['awaiting_customer_authorization','submitted','recovery_required']){await pool.query('UPDATE operations SET state=$2 WHERE id=$1',[result.operation.operation_id,status]);expect((await service.reconcile(customer,workflow.id)).phase).toBe('awaiting_collateral');}expect(adapter.readConfirmedEvidence).not.toHaveBeenCalled();
 });
 it('requires both durable completed hash and independent matching metadata before advancing',async()=>{
  const {workflow,result}=await completedFixture();const next=await service.reconcile(customer,workflow.id);expect(next.phase).toBe('awaiting_margin_transfer');expect(next.receiptAtomic).toBe('9999780');expect(next.activeOperationId).toBeNull();expect(next.revision).toBe(2);
  const child=(await pool.query('SELECT evidence_json,confirmed_at FROM margin_workflow_steps WHERE operation_id=$1',[result.operation.operation_id])).rows[0];expect(child.evidence_json.txHash).toBe(evidence.txHash);expect(child.confirmed_at).toBeTruthy();await service.reconcile(customer,workflow.id);expect(adapter.readConfirmedEvidence).toHaveBeenCalledTimes(1);
 });
 it('keeps a completed child bound if independent evidence disagrees',async()=>{const {workflow,result}=await completedFixture();evidence.txHash='f'.repeat(64);await expect(service.reconcile(customer,workflow.id)).rejects.toMatchObject({code:'MARGIN_STATE_MISMATCH'});expect((await service.get(customer,workflow.id)).activeOperationId).toBe(result.operation.operation_id);});
 it('requires retained customer signed envelope even for a completed hash',async()=>{const {workflow,result}=await completedFixture();await pool.query('UPDATE operations SET signed_xdr=NULL WHERE id=$1',[result.operation.operation_id]);await expect(service.reconcile(customer,workflow.id)).rejects.toMatchObject({code:'MARGIN_WORKFLOW_CONFLICT'});expect(adapter.readConfirmedEvidence).not.toHaveBeenCalled();});
 it('releases only a never-signed terminal approval and gives explicit retry a distinct child attempt',async()=>{
  const {workflow,result}=await prepared();await pool.query("UPDATE operations SET state='expired' WHERE id=$1",[result.operation.operation_id]);await pool.query("UPDATE balance_reservations SET state='released' WHERE operation_id=$1",[result.operation.operation_id]);const next=await service.reconcile(customer,workflow.id);expect(next.activeOperationId).toBeNull();
  const retry=await service.prepare(customer,workflow.id,'vault_deposit',{},'retry');expect(retry.operation.operation_id).not.toBe(result.operation.operation_id);expect((await pool.query('SELECT attempt FROM margin_workflow_steps WHERE operation_id=$1',[retry.operation.operation_id])).rows[0].attempt).toBe(2);
 });
 it('rejects preparing without exact principal/fee reservations',async()=>{const w=await service.create(customer,terms,customer.customerId);const original=adapter.prepareStep;adapter.prepareStep=async(...args)=>{const prepared=await original(...args);prepared.reservations.pop();return prepared;};await expect(service.prepare(customer,w.id,'vault_deposit',{},'deposit')).rejects.toMatchObject({code:'MARGIN_RESERVATION_MISMATCH'});expect((await service.get(customer,w.id)).activeOperationId).toBeNull();});
 it('prevents forged child linkage across customers through composite database constraints',async()=>{
  const {workflow,result}=await prepared();await expect(pool.query('UPDATE margin_workflow_steps SET customer_id=$2 WHERE operation_id=$1',[result.operation.operation_id,randomUUID()])).rejects.toMatchObject({code:'23503'});expect((await service.get(customer,workflow.id)).activeOperationId).toBe(result.operation.operation_id);
 });
 it('serializes concurrent identical retries into one child and one reservation set',async()=>{
  const w=await service.create(customer,terms,customer.customerId),results=await Promise.all([service.prepare(customer,w.id,'vault_deposit',{},'same'),service.prepare(customer,w.id,'vault_deposit',{},'same')]);expect(results[0].operation.operation_id).toBe(results[1].operation.operation_id);expect(results.filter(r=>r.created)).toHaveLength(1);expect(adapter.prepareStep).toHaveBeenCalledTimes(1);expect((await pool.query('SELECT * FROM margin_workflow_steps WHERE workflow_id=$1',[w.id])).rowCount).toBe(1);
 });
 it('refuses parallel distinct approvals for the same wallet',async()=>{
  const w=await service.create(customer,terms,customer.customerId),results=await Promise.allSettled([service.prepare(customer,w.id,'vault_deposit',{},'one'),service.prepare(customer,w.id,'vault_deposit',{},'two')]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);expect(adapter.prepareStep).toHaveBeenCalledTimes(1);
 });
 it('does not overwrite a parent revision changed during external chain verification',async()=>{
  const {workflow,result}=await completedFixture();adapter.readConfirmedEvidence=async()=>{await pool.query('UPDATE margin_workflows SET revision=revision+1 WHERE id=$1',[workflow.id]);return evidence;};await expect(service.reconcile(customer,workflow.id)).rejects.toMatchObject({code:'MARGIN_WORKFLOW_CONFLICT'});const w=await service.get(customer,workflow.id);expect(w.phase).toBe('awaiting_collateral');expect(w.activeOperationId).toBe(result.operation.operation_id);expect((await pool.query('SELECT evidence_json FROM margin_workflow_steps WHERE operation_id=$1',[result.operation.operation_id])).rows[0].evidence_json).toBeNull();
 });
 it('lists at most20 scoped wallet workflows with active recovery first',async()=>{
  for(let i=0;i<21;i++){const w=await service.create(customer,terms,`${customer.customerId}-${i}`);await pool.query("UPDATE margin_workflows SET phase='recovered' WHERE id=$1",[w.id]);}
  const active=await service.create(customer,terms,`${customer.customerId}-active`),listed=await service.list(customer);expect(listed).toHaveLength(20);expect(listed[0].id).toBe(active.id);expect(listed.every(w=>w.customerId===customer.customerId&&w.walletId===customer.walletId&&w.businessId===customer.businessId)).toBe(true);await expect(service.list({...customer,walletAddress:Keypair.random().publicKey()})).rejects.toMatchObject({code:'NOT_FOUND'});
 });
 it('clears only a verified exact signedFAILED attempt, preserves economic state/hash, and requires explicit fresh retry',async()=>{
  const f=await failedFixture(),before=await service.get(customer,f.workflow.id),after=await service.reconcile(customer,f.workflow.id);expect(after).toMatchObject({phase:before.phase,positionId:before.positionId,receiptAtomic:before.receiptAtomic,activeOperationId:null,revision:before.revision+1});
  const op=(await pool.query('SELECT state,tx_hash,signed_xdr FROM operations WHERE id=$1',[f.result.operation.operation_id])).rows[0];expect(op).toEqual({state:'failed',tx_hash:f.hash,signed_xdr:f.signed});expect((await pool.query('SELECT evidence_json,confirmed_at FROM margin_workflow_steps WHERE operation_id=$1',[f.result.operation.operation_id])).rows[0]).toMatchObject({evidence_json:f.failure,confirmed_at:expect.any(Date)});
  const same=await service.prepare(customer,f.workflow.id,'vault_deposit',{},'deposit');expect(same.operation.operation_id).toBe(f.result.operation.operation_id);expect(same.created).toBe(false);const fresh=await service.prepare(customer,f.workflow.id,'vault_deposit',{},'retry-after-proof');expect(fresh.operation.operation_id).not.toBe(f.result.operation.operation_id);expect((await pool.query('SELECT attempt FROM margin_workflow_steps WHERE operation_id=$1',[fresh.operation.operation_id])).rows[0].attempt).toBe(2);
 });
 it('retains failed signed child if no trusted failure adapter exists',async()=>{const f=await failedFixture();delete adapter.readFailedEvidence;expect((await service.reconcile(customer,f.workflow.id)).activeOperationId).toBe(f.result.operation.operation_id);});
 it.each(['submitted','confirming','recovery_required'])('never clears signed%s from failure evidence alone',async state=>{const f=await failedFixture();await pool.query('UPDATE operations SET state=$2 WHERE id=$1',[f.result.operation.operation_id,state]);expect((await service.reconcile(customer,f.workflow.id)).activeOperationId).toBe(f.result.operation.operation_id);expect(adapter.readFailedEvidence).not.toHaveBeenCalled();});
 it.each(['hash','owner','step','intent','principal','sequence','stale','fee'] as const)('rejects mismatched signed failure evidence%s without clearing the child',async field=>{
  const f=await failedFixture();if(field==='hash')f.failure.txHash='f'.repeat(64);if(field==='owner')f.failure.owner=Keypair.random().publicKey();if(field==='step')f.failure.step='open_activate';if(field==='intent')f.failure.intentHash='f'.repeat(64);if(field==='principal')(f.failure as any).principalAndPositionUnchanged=false;if(field==='sequence')(f.failure as any).sourceSequenceConsumed=false;if(field==='stale')f.failure.observedAt=new Date(Date.now()-16000).toISOString();if(field==='fee')f.failure.feeStroops='101';await expect(service.reconcile(customer,f.workflow.id)).rejects.toMatchObject({code:'MARGIN_STATE_MISMATCH'});expect((await service.get(customer,f.workflow.id)).activeOperationId).toBe(f.result.operation.operation_id);expect((await pool.query('SELECT evidence_json FROM margin_workflow_steps WHERE operation_id=$1',[f.result.operation.operation_id])).rows[0].evidence_json).toBeNull();
 });
 it('rejects a retained envelope with a foreign wallet signature before calling failure adapter',async()=>{
  const f=await failedFixture(),tx=TransactionBuilder.fromXDR(f.actualPrepared.unsignedXdr,NETWORK_PASSPHRASE);tx.sign(Keypair.random());await pool.query('UPDATE operations SET signed_xdr=$2 WHERE id=$1',[f.result.operation.operation_id,tx.toXDR()]);await expect(service.reconcile(customer,f.workflow.id)).rejects.toMatchObject({code:'MARGIN_EXECUTION_BINDING_INVALID'});expect(adapter.readFailedEvidence).not.toHaveBeenCalled();
 });
 it('rechecks failed operation state after the external proof read before releasing the parent',async()=>{
  const f=await failedFixture();adapter.readFailedEvidence=async()=>{await pool.query("UPDATE operations SET state='confirming' WHERE id=$1",[f.result.operation.operation_id]);return f.failure;};await expect(service.reconcile(customer,f.workflow.id)).rejects.toMatchObject({code:'MARGIN_WORKFLOW_CONFLICT'});expect((await service.get(customer,f.workflow.id)).activeOperationId).toBe(f.result.operation.operation_id);
 });
 it('advances concurrent failed-hash recovery only once under row lock/revision CAS',async()=>{
  const f=await failedFixture();let count=0,release:()=>void=()=>{};const both=new Promise<void>(resolve=>{release=resolve;});adapter.readFailedEvidence=async()=>{if(++count===2)release();await both;return f.failure;};const results=await Promise.allSettled([service.reconcile(customer,f.workflow.id),service.reconcile(customer,f.workflow.id)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);const w=await service.get(customer,f.workflow.id);expect(w.revision).toBe(2);expect(w.phase).toBe('awaiting_collateral');expect(w.activeOperationId).toBeNull();
 });
});
