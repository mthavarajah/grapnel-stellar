import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {Account,Address,Asset,Keypair,StrKey,TransactionBuilder,nativeToScVal,xdr} from '@stellar/stellar-sdk';
import {describe,expect,it,vi} from 'vitest';
import {NETWORK_PASSPHRASE,XLM,type PreparedAction,type WalletBalance} from '@grapnel/contracts';
import {createRuntimeWorkerChain} from '../../runtime.js';
import type {StellarTestnetExecutor} from '../../adapters/stellar/index.js';
import {buildBorrowOperation,BORROW_USDC_ISSUER,BORROW_USDC_ID} from '../../adapters/blend/borrow.js';
import {BORROW_POOL_ID,createBorrowBaseline,type BorrowingAction,type BorrowingPosition} from './borrowing.js';
import {serializeOperation} from '../operations/service.js';

const summaryAction=(action:BorrowingAction)=>action==='collateral_supply'?'blend.borrow_collateral_supply':action==='collateral_withdraw'?'blend.borrow_collateral_withdraw':`blend.${action}`;
function fixture(action:BorrowingAction='borrow',usdc=false){
 const signer=Keypair.random(),wallet=signer.publicKey(),now=new Date().toISOString(),asset=usdc?BORROW_USDC_ID:XLM.id,index=usdc?3:0;
 const reserve=usdc?new Asset('USDC',BORROW_USDC_ISSUER).contractId(NETWORK_PASSPHRASE):Asset.native().contractId(NETWORK_PASSPHRASE);
 const market=`stellar-testnet:blend:${BORROW_POOL_ID}:${reserve}`,beforeDebt=action==='repay'?10000000n:0n,beforeCollateral=20000000n;
 const before:BorrowingPosition={market_id:market,asset_id:asset,pool_contract_id:BORROW_POOL_ID,reserve_contract_id:reserve,borrowed:action==='repay'?'1':'0',collateral:'2',as_of:now,as_of_ledger:100,debt_tokens:beforeDebt.toString(),collateral_tokens:beforeCollateral.toString(),debt_rate:'1000000000000',collateral_rate:'1000000000000',rate_decimals:12,reserve_index:index};
 const native:WalletBalance={asset_id:XLM.id,wallet_amount:'100',spendable:'98',reserved:'0',source:'stellar_horizon_testnet',as_of:now};
 const balancesBefore=usdc?[native,{...native,asset_id:asset}]:[native];
 const baseline=createBorrowBaseline(before,balancesBefore,wallet);
 const tx=new TransactionBuilder(new Account(wallet,'1'),{fee:'100000',networkPassphrase:NETWORK_PASSPHRASE}).addOperation(xdr.Operation.fromXDR(buildBorrowOperation({action,poolId:BORROW_POOL_ID,reserveId:reserve,walletAddress:wallet,amountAtomic:10000000n}),'base64')).setTimeout(60).build();
 const id=randomUUID(),customerId=randomUUID(),walletId=randomUUID(),expiry=new Date(Date.now()+60000).toISOString();
 const prepared:PreparedAction={operationId:id,customerId,network:'stellar-testnet',walletAddress:wallet,unsignedXdr:tx.toXDR(),signingHashHex:tx.hash().toString('hex'),summary:{action:summaryAction(action),fromAssetId:asset,amount:'1',contractId:BORROW_POOL_ID,recipient:wallet,maxFeeStroops:tx.fee,expiresAt:expiry},authorization:{method:'privy_stellar',expiresAt:expiry}};
 tx.sign(signer);const hash=tx.hash().toString('hex');
 const op={id,business_id:randomUUID(),customer_id:customerId,wallet_id:walletId,stellar_address:wallet,privy_user_id:'did:privy:offline-worker-fixture',module_code:'capital.lending',provider:'blend',type:summaryAction(action),state:'submitted',request_json:{customer_id:customerId,wallet_id:walletId,market_id:market,asset_id:asset,amount:'1'},prepared_action:prepared,signed_xdr:tx.toXDR(),tx_hash:hash,result_json:{blend_borrowing_baseline:baseline},created_at:now,updated_at:now};
 const afterDebt=action==='borrow'?10000000n:0n,afterCollateral=action==='collateral_supply'?30000000n:action==='collateral_withdraw'?10000000n:beforeCollateral;
 const position:BorrowingPosition={...before,borrowed:afterDebt?'1':'0',collateral:afterCollateral===30000000n?'3':afterCollateral===10000000n?'1':'2',debt_tokens:afterDebt.toString(),collateral_tokens:afterCollateral.toString(),as_of_ledger:101};
 const incoming=action==='borrow'||action==='collateral_withdraw';
 const observedBalances:WalletBalance[]=usdc?[{...native,wallet_amount:'99.99'},{...native,asset_id:asset,wallet_amount:incoming?'101':'99'}]:[{...native,wallet_amount:incoming?'100.99':'98.99'}];
 const maps=(debt:bigint,collateral:bigint)=>xdr.ScVal.scvMap(['liabilities','collateral','supply'].map(name=>new xdr.ScMapEntry({key:xdr.ScVal.scvSymbol(name),val:xdr.ScVal.scvMap(name==='supply'||name==='liabilities'&&debt===0n?[]:[new xdr.ScMapEntry({key:xdr.ScVal.scvU32(index),val:nativeToScVal(name==='liabilities'?debt:collateral,{type:'i128'})})])})));
 const entry=(name:string,target:string,value:xdr.ScVal)=>new xdr.LedgerEntry({lastModifiedLedgerSeq:101,data:xdr.LedgerEntryData.contractData(new xdr.ContractDataEntry({ext:new xdr.ExtensionPoint(0),contract:Address.fromString(BORROW_POOL_ID).toScAddress(),key:xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(name),Address.fromString(target).toScVal()]),durability:xdr.ContractDataDurability.persistent(),val:value})),ext:new xdr.LedgerEntryExt(0)});
 const reserveValue=xdr.ScVal.scvMap(['d_rate','b_rate','ir_mod','d_supply','b_supply','backstop_credit','last_time'].map(name=>new xdr.ScMapEntry({key:xdr.ScVal.scvSymbol(name),val:name==='last_time'?xdr.ScVal.scvU64(xdr.Uint64.fromString('1')):nativeToScVal(name==='d_rate'||name==='b_rate'?1000000000000n:0n,{type:'i128'})})));
 const changes=[xdr.LedgerEntryChange.ledgerEntryState(entry('Positions',wallet,maps(beforeDebt,beforeCollateral))),xdr.LedgerEntryChange.ledgerEntryUpdated(entry('Positions',wallet,maps(afterDebt,afterCollateral))),xdr.LedgerEntryChange.ledgerEntryUpdated(entry('ResData',reserve,reserveValue))];
 const event=(contract:string,topics:xdr.ScVal[],data:xdr.ScVal)=>new xdr.ContractEvent({ext:new xdr.ExtensionPoint(0),contractId:StrKey.decodeContract(contract) as unknown as xdr.ContractId,type:xdr.ContractEventType.contract(),body:new xdr.ContractEventBody(0,new xdr.ContractEventV0({topics,data}))});
 const events=action==='repay'?[event(BORROW_POOL_ID,[xdr.ScVal.scvSymbol('repay'),Address.fromString(reserve).toScVal(),Address.fromString(wallet).toScVal()],xdr.ScVal.scvVec([nativeToScVal(10000000n,{type:'i128'}),nativeToScVal(10000000n,{type:'i128'})])),event(reserve,[xdr.ScVal.scvSymbol('transfer'),Address.fromString(wallet).toScVal(),Address.fromString(BORROW_POOL_ID).toScVal(),xdr.ScVal.scvString(usdc?'USDC:'+BORROW_USDC_ISSUER:'native')],nativeToScVal(10000000n,{type:'i128'}))]:[];
 const meta=new xdr.TransactionMeta(4,new xdr.TransactionMetaV4({ext:new xdr.ExtensionPoint(0),txChangesBefore:[],operations:[new xdr.OperationMetaV2({ext:new xdr.ExtensionPoint(0),changes,events})],txChangesAfter:[],sorobanMeta:null,events:[],diagnosticEvents:[]}));
 return {op,tx,hash,meta,position,observedBalances,asset};
}
function runtime(f:ReturnType<typeof fixture>,options:{gate?:boolean;inspector?:boolean;adapter?:boolean;rpcStatus?:string;source?:string;ledger?:number;txHash?:string;meta?:unknown;fee?:string}={}){
 const send=vi.fn(async()=>({hash:f.hash,status:'PENDING'})),verify=vi.fn(async()=>{}),positions=vi.fn(async()=>[f.position]),legacyVerify=vi.fn(async()=>{});
 const query=vi.fn(async()=>({rows:[f.op]})),pool={query} as unknown as Pool;
 const chain={reconcile:vi.fn(async()=> 'completed'),verifyLiveNetwork:vi.fn(async()=>{}),getClassicBalances:vi.fn(async()=>f.observedBalances),server:{sendTransaction:send,getTransaction:vi.fn(async()=>({status:options.rpcStatus??'SUCCESS',ledger:101,resultMetaXdr:options.meta===undefined?f.meta:options.meta}))},horizon:{transactions:()=>({transaction:()=>({call:async()=>({successful:true,hash:options.txHash??f.hash,source_account:options.source??f.op.stellar_address,ledger_attr:options.ledger??101,fee_charged:options.fee??'100000'})})})}} as unknown as StellarTestnetExecutor;
 const worker=createRuntimeWorkerChain({pool,chain,blend:{positions:async()=>[]},soroban:{verifyForSubmission:legacyVerify},gate1Passed:options.gate??true,verifyGate1:async()=>options.gate??true,...(options.adapter===false?{}:{borrowing:{positions}}),...(options.inspector===false?{}:{borrowPreparer:{verifyForSubmission:verify}})});
 return {worker,send,verify,positions,legacyVerify,query,chain};
}
describe('Borrow worker composition — explicit offline ports, no broadcasts to a real network',()=>{
 it.each(['borrow','repay','collateral_supply','collateral_withdraw'] as const)('uses the dedicated inspector for %s and preserves its exact recorded hash',async action=>{
  const f=fixture(action),r=runtime(f);await expect(r.worker.broadcast(f.op.signed_xdr)).resolves.toEqual({txHash:f.hash});
  expect(r.verify).toHaveBeenCalledWith(f.op.prepared_action,f.op.signed_xdr);expect(r.legacyVerify).not.toHaveBeenCalled();expect(r.send).toHaveBeenCalledTimes(1);
  expect(r.query.mock.calls[0]).toBeDefined();
 });
 it.each([{gate:false},{inspector:false},{adapter:false}])('does not send before current gate, inspector and adapter are ready: %j',async options=>{
  const f=fixture(),r=runtime(f,options);await expect(r.worker.broadcast(f.op.signed_xdr)).rejects.toBeDefined();expect(r.send).not.toHaveBeenCalled();expect(r.verify).not.toHaveBeenCalled();
 });
 it('rejects changed tenant/customer request, pool, amount or unauthorized state before inspection',async()=>{
  for(const change of ['customer','wallet','pool','amount','asset','state','provider','baseline','digest']){
   const f=fixture();if(change==='customer')f.op.request_json.customer_id=randomUUID();if(change==='wallet')f.op.request_json.wallet_id=randomUUID();if(change==='pool')f.op.prepared_action.summary.contractId=Asset.native().contractId(NETWORK_PASSPHRASE);if(change==='amount')f.op.request_json.amount='2';if(change==='asset')f.op.request_json.asset_id=BORROW_USDC_ID;if(change==='state')f.op.state='awaiting_customer_authorization';if(change==='provider')f.op.provider='other';if(change==='baseline')f.op.result_json.blend_borrowing_baseline.market_id+=':other';if(change==='digest')f.op.prepared_action.signingHashHex='a'.repeat(64);
   const r=runtime(f);await expect(r.worker.broadcast(f.op.signed_xdr)).rejects.toBeDefined();expect(r.verify).not.toHaveBeenCalled();expect(r.send).not.toHaveBeenCalled();
  }
 });
 it.each(['preparing','confirming','recovery_required','completed'])('does not rebroadcast an operation in state %s',async state=>{const f=fixture();f.op.state=state;const r=runtime(f);await expect(r.worker.broadcast(f.op.signed_xdr)).rejects.toMatchObject({code:'OPERATION_STATE_INVALID'});expect(r.send).not.toHaveBeenCalled();});
 it('does not send a signed envelope if fresh exact simulation rejects it',async()=>{const f=fixture(),r=runtime(f);r.verify.mockRejectedValueOnce(Error('Changed debt health'));await expect(r.worker.broadcast(f.op.signed_xdr)).rejects.toThrow('Changed debt health');expect(r.send).not.toHaveBeenCalled();});
 it('preserves stored hash through timeout or uncertain provider response without generating a replacement',async()=>{
  const f=fixture(),r=runtime(f);r.send.mockRejectedValueOnce(Error('Offline send timeout'));await expect(r.worker.broadcast(f.op.signed_xdr)).rejects.toMatchObject({code:'SUBMISSION_UNCERTAIN',details:{tx_hash:f.hash}});expect(r.send).toHaveBeenCalledTimes(1);
  r.send.mockResolvedValueOnce({hash:f.hash,status:'TRY_AGAIN_LATER'});await expect(r.worker.broadcast(f.op.signed_xdr)).rejects.toMatchObject({code:'SUBMISSION_UNCERTAIN',details:{tx_hash:f.hash}});
 });
 it.each(['borrow','repay','collateral_supply','collateral_withdraw'] as const)('reconciles confirmed XLM and USDC %s using transaction-local debt/collateral state plus actual fees',async action=>{
  for(const usdc of [false,true]){const f=fixture(action,usdc),r=runtime(f,{gate:false});const result=await r.worker.verifyDeltas(f.op.id,f.hash);expect(result).toMatchObject({verified:true,result:{blend_borrowing_verification:{operation:action,tx_hash:f.hash,asset_id:f.asset,actual_fee_stroops:'100000'}}});expect(r.send).not.toHaveBeenCalled();expect(r.query).toHaveBeenCalledTimes(1);}
 });
 it('does not complete repayment when source-transfer or refund metadata is absent or inconsistent',async()=>{
  for(const invalid of ['missing','amount'] as const){
   const f=fixture('repay'),events=f.meta.v4().operations()[0]!.events();
   if(invalid==='missing')f.meta.v4().operations()[0]!.events([]);else events[1]!.body().v0().data(nativeToScVal(10000001n,{type:'i128'}));
   const r=runtime(f);expect(await r.worker.verifyDeltas(f.op.id,f.hash)).toMatchObject({verified:false});expect(r.send).not.toHaveBeenCalled();
  }
 });
 it.each([{rpcStatus:'NOT_FOUND'},{source:'other'},{ledger:102},{txHash:'b'.repeat(64)},{meta:null},{fee:'99999'}])('never completes a pending or mismatched receipt: %j',async options=>{
  const f=fixture(),r=runtime(f,options);expect(await r.worker.verifyDeltas(f.op.id,f.hash)).toMatchObject({verified:false});expect(r.send).not.toHaveBeenCalled();
 });
 it('accepts SDK object metadata and encoded metadata but rejects changed position tokens',async()=>{
  const f=fixture(),r=runtime(f,{meta:f.meta.toXDR('base64')});expect(await r.worker.verifyDeltas(f.op.id,f.hash)).toMatchObject({verified:true});f.position.debt_tokens='20000000';expect(await r.worker.verifyDeltas(f.op.id,f.hash)).toMatchObject({verified:false});
 });
 it('includes exact display amounts and asset identities for all four activity types',()=>{
  for(const action of ['borrow','repay','collateral_supply','collateral_withdraw'] as const){const f=fixture(action),serialized=serializeOperation(f.op);expect(serialized.display_amount).toBe('1');expect(serialized.display_asset_id).toBe(XLM.id);}
 });
});
