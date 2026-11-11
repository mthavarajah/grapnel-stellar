import {describe,expect,it} from 'vitest';
import {Asset,Keypair,Address,nativeToScVal,xdr} from '@stellar/stellar-sdk';
import {NETWORK_PASSPHRASE,XLM,fromAtomic,type WalletBalance} from '@grapnel/contracts';
import {BLEND_USDC_ASSET_ID,BLEND_USDC_ISSUER} from '../../adapters/blend/usdc-inspector.js';
import {BORROW_POOL_ID,BorrowBaselineSchema,borrowingReservationPlan,createBorrowBaseline,extractBorrowTransactionEvidence,inspectBorrowingDeltas,type BorrowingAction,type BorrowingPosition,type BorrowTransactionEvidence} from './borrowing.js';
const wallet=Keypair.random().publicKey(),now=Date.now(),at=new Date(now).toISOString(),hash='a'.repeat(64);
const reserve=Asset.native().contractId(NETWORK_PASSPHRASE),usdcReserve=new Asset('USDC',BLEND_USDC_ISSUER).contractId(NETWORK_PASSPHRASE);
const market=`stellar-testnet:blend:${BORROW_POOL_ID}:${reserve}`;
const pos:BorrowingPosition={market_id:market,asset_id:XLM.id,pool_contract_id:BORROW_POOL_ID,reserve_contract_id:reserve,borrowed:'0.0000000',collateral:'2.0000000',as_of:at,as_of_ledger:100,debt_tokens:'0',collateral_tokens:'20000000',debt_rate:'1000000000000',collateral_rate:'1000000000000',rate_decimals:12,reserve_index:0};
const native:WalletBalance={asset_id:XLM.id,wallet_amount:'100.0000000',spendable:'98.0000000',reserved:'0',source:'stellar_horizon_testnet',as_of:at};
const baseline=createBorrowBaseline(pos,[native],wallet,now);
const evidence:BorrowTransactionEvidence={tx_hash:hash,confirmed_ledger:101,pool_contract_id:BORROW_POOL_ID,reserve_contract_id:reserve,wallet_address:wallet,reserve_index:0,debt_tokens_before:'0',debt_tokens_after:'10000000',collateral_tokens_before:'20000000',collateral_tokens_after:'20000000',debt_rate:'1000000000000',collateral_rate:'1000000000000',other_positions_unchanged:true};
const observation=()=>({action:'borrow' as const,baseline,request:{asset_id:XLM.id,market_id:market,amount:'1'},walletAddress:wallet,positions:[{...pos,borrowed:'1.0000000',debt_tokens:'10000000',as_of_ledger:102}],balances:[{...native,wallet_amount:'100.9900000'}],confirmedLedger:101,txHash:hash,feeStroops:'100000',transactionEvidence:evidence,now});
describe('Borrowing reservations and exact baseline',()=>{
 it('reserves only XLM fees for borrowing XLM or USDC',()=>{expect(borrowingReservationPlan('borrow',XLM.id,'1','100000')).toEqual([{assetId:XLM.id,amountAtomic:100000n}]);expect(borrowingReservationPlan('borrow',BLEND_USDC_ASSET_ID,'1','100000')).toEqual([{assetId:XLM.id,amountAtomic:100000n}]);});
 it('reserves repayment and collateral principal independently of native fees',()=>{expect(borrowingReservationPlan('repay',XLM.id,'1','100000')).toEqual([{assetId:XLM.id,amountAtomic:10100000n}]);expect(borrowingReservationPlan('collateral_supply',BLEND_USDC_ASSET_ID,'4','100000')).toEqual([{assetId:BLEND_USDC_ASSET_ID,amountAtomic:40000000n},{assetId:XLM.id,amountAtomic:100000n}]);});
 it('withdrawal reserves fees but never counts supplied collateral as wallet spendable',()=>expect(borrowingReservationPlan('collateral_withdraw',BLEND_USDC_ASSET_ID,'4','100000')).toEqual([{assetId:XLM.id,amountAtomic:100000n}]));
 it.each(['0','-1','10000001','1.5','oops'])('rejects invalid/unbounded fee %s',fee=>expect(()=>borrowingReservationPlan('borrow',XLM.id,'1',fee)).toThrow());
 it('rejects unrelated assets, excessive precision and zero principal',()=>{expect(()=>borrowingReservationPlan('repay','fake','1','100')).toThrow();expect(()=>borrowingReservationPlan('repay',XLM.id,'0.00000001','100')).toThrow();expect(()=>borrowingReservationPlan('borrow',XLM.id,'0','100')).toThrow();});
 it('pins new pool and exact reserve, and requires native fee observations for USDC',()=>{expect(BorrowBaselineSchema.safeParse({...baseline,pool_contract_id:'other'}).success).toBe(false);expect(BorrowBaselineSchema.safeParse({...baseline,reserve_contract_id:usdcReserve}).success).toBe(false);const usdc={...pos,asset_id:BLEND_USDC_ASSET_ID,reserve_contract_id:usdcReserve,market_id:`stellar-testnet:blend:${BORROW_POOL_ID}:${usdcReserve}`,reserve_index:3};expect(()=>createBorrowBaseline(usdc,[{...native,asset_id:BLEND_USDC_ASSET_ID}],wallet,now)).toThrow();});
 it('rejects stale, duplicate or simulated balances and missing token metadata',()=>{expect(()=>createBorrowBaseline({...pos,debt_tokens:undefined},[native],wallet,now)).toThrow();expect(()=>createBorrowBaseline(pos,[native,native],wallet,now)).toThrow();expect(()=>createBorrowBaseline(pos,[{...native,source:'simulation' as never}],wallet,now)).toThrow();expect(()=>createBorrowBaseline(pos,[{...native,as_of:new Date(now-16000).toISOString()}],wallet,now)).toThrow();});
});
describe('Borrowing principal settlement (offline metadata and balance observations)',()=>{
 it('requires actual exact receipt, fee and transaction-bound debt tokens',()=>{const result=inspectBorrowingDeltas(observation());expect(result.verified).toBe(true);expect(result.result.blend_borrowing_verification).toMatchObject({wallet_principal_delta:'1.0000000',debt_principal_delta:'1.0000000',actual_fee_stroops:'100000'});});
 it.each([undefined,{}, {...evidence,tx_hash:'b'.repeat(64)}, {...evidence,debt_tokens_before:'1'}, {...evidence,other_positions_unchanged:false}, {...evidence,pool_contract_id:'other'}])('rejects absent/mismatched transaction evidence %j',transactionEvidence=>expect(inspectBorrowingDeltas({...observation(),transactionEvidence}).verified).toBe(false));
 it('does not count a later unrelated debt increase as the approved borrow',()=>{expect(inspectBorrowingDeltas({...observation(),positions:[{...pos,debt_tokens:'20000000',borrowed:'2',as_of_ledger:102}]}).verified).toBe(false);expect(inspectBorrowingDeltas({...observation(),transactionEvidence:{...evidence,debt_tokens_after:'20000000'},positions:[{...pos,debt_tokens:'20000000',borrowed:'2',as_of_ledger:102}]}).verified).toBe(false);});
 it.each(['100.9800000','101.0000000','101.9900000'])('rejects wrong fee/principal wallet receipt %s',wallet_amount=>expect(inspectBorrowingDeltas({...observation(),balances:[{...native,wallet_amount}]}).verified).toBe(false));
 it('uses the execution rate, not elapsed interest, to validate principal',()=>{
  const prior={...baseline,debt_tokens:'10000000',borrowed:'1'},transactionEvidence={...evidence,debt_tokens_before:'10000000',debt_tokens_after:'20000000',debt_rate:'1000000001000'};
  expect(inspectBorrowingDeltas({...observation(),baseline:prior,transactionEvidence,positions:[{...pos,debt_tokens:'20000000',borrowed:'2.0000001',as_of_ledger:102}]}).verified).toBe(true);
 });
 it('rejects stale or pre-confirmation positions, wrong source/wallet and fee',()=>{
  const f=observation();for(const change of [{positions:[{...f.positions[0]!,as_of_ledger:100}]},{balances:[{...native,source:'simulation'}]},{walletAddress:Keypair.random().publicKey()},{feeStroops:'0'},{positions:[{...f.positions[0]!,as_of:new Date(now-31000).toISOString()}]}])expect(inspectBorrowingDeltas({...f,...change} as never).verified).toBe(false);
 });
 it('verifies a capped full repayment but rejects an unrequested partial repayment',()=>{
  const b={...baseline,debt_tokens:'10000000',borrowed:'1'},p={...pos,debt_tokens:'0',borrowed:'0',as_of_ledger:102},e={...evidence,debt_tokens_before:'10000000',debt_tokens_after:'0'};
  expect(inspectBorrowingDeltas({...observation(),action:'repay',baseline:b,request:{...observation().request,amount:'2'},positions:[p],balances:[{...native,wallet_amount:'98.9900000'}],transactionEvidence:e}).verified).toBe(true);
  expect(inspectBorrowingDeltas({...observation(),action:'repay',baseline:b,positions:[{...p,debt_tokens:'5000000'}],balances:[{...native,wallet_amount:'99.4900000'}],transactionEvidence:{...e,debt_tokens_after:'5000000'}}).verified).toBe(false);
 });
 it.each(['collateral_supply','collateral_withdraw'] as const)('verifies exact %s without changing debt',action=>{
  const supply=action==='collateral_supply',tokens=supply?'30000000':'10000000';
  expect(inspectBorrowingDeltas({...observation(),action,positions:[{...pos,collateral_tokens:tokens,collateral:supply?'3':'1',as_of_ledger:102}],balances:[{...native,wallet_amount:supply?'98.9900000':'100.9900000'}],transactionEvidence:{...evidence,debt_tokens_after:'0',collateral_tokens_after:tokens}}).verified).toBe(true);
 });
 it('keeps USDC principal separate from actual XLM fee',()=>{
  const usdcPos={...pos,asset_id:BLEND_USDC_ASSET_ID,reserve_contract_id:usdcReserve,market_id:`stellar-testnet:blend:${BORROW_POOL_ID}:${usdcReserve}`,reserve_index:3};
  const usdcBalance={...native,asset_id:BLEND_USDC_ASSET_ID,wallet_amount:'4.0000000'};
  const usdcBaseline=createBorrowBaseline(usdcPos,[native,usdcBalance],wallet,now),e={...evidence,reserve_contract_id:usdcReserve,reserve_index:3};
  const f={...observation(),baseline:usdcBaseline,request:{asset_id:BLEND_USDC_ASSET_ID,market_id:usdcPos.market_id,amount:'1'},positions:[{...usdcPos,debt_tokens:'10000000',borrowed:'1',as_of_ledger:102}],balances:[{...usdcBalance,wallet_amount:'5.0000000'},{...native,wallet_amount:'99.9900000'}],transactionEvidence:e};
  expect(inspectBorrowingDeltas(f).verified).toBe(true);expect(inspectBorrowingDeltas({...f,balances:[f.balances[0]!,{...native,wallet_amount:'99.9000000'}]}).verified).toBe(false);
 });
});

function positionValue(liabilities:Map<number,bigint>,collateral=new Map([[0,20000000n]])){
 const m=(map:Map<number,bigint>)=>xdr.ScVal.scvMap([...map].map(([index,n])=>new xdr.ScMapEntry({key:xdr.ScVal.scvU32(index),val:nativeToScVal(n,{type:'i128'})})));
 return xdr.ScVal.scvMap([['liabilities',m(liabilities)],['collateral',m(collateral)],['supply',m(new Map())]].map(([name,val])=>new xdr.ScMapEntry({key:xdr.ScVal.scvSymbol(name as string),val:val as xdr.ScVal})));
}
function entry(name:string,target:string,value:xdr.ScVal){return new xdr.LedgerEntry({lastModifiedLedgerSeq:101,data:xdr.LedgerEntryData.contractData(new xdr.ContractDataEntry({ext:new xdr.ExtensionPoint(0),contract:Address.fromString(BORROW_POOL_ID).toScAddress(),key:xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(name),Address.fromString(target).toScVal()]),durability:xdr.ContractDataDurability.persistent(),val:value})),ext:new xdr.LedgerEntryExt(0)});}
function meta(changes:xdr.LedgerEntryChange[]){return new xdr.TransactionMeta(3,new xdr.TransactionMetaV3({ext:new xdr.ExtensionPoint(0),txChangesBefore:[],operations:[new xdr.OperationMeta({changes})],txChangesAfter:[],sorobanMeta:null}));}
function metadataFixture(){
 const res=xdr.ScVal.scvMap(['d_rate','b_rate','ir_mod','d_supply','b_supply','backstop_credit','last_time'].map(name=>new xdr.ScMapEntry({key:xdr.ScVal.scvSymbol(name),val:name==='d_rate'||name==='b_rate'?nativeToScVal(1000000000000n,{type:'i128'}):name==='last_time'?xdr.ScVal.scvU64(xdr.Uint64.fromString('1')):nativeToScVal(0n,{type:'i128'})})));
 return [xdr.LedgerEntryChange.ledgerEntryState(entry('Positions',wallet,positionValue(new Map()))),xdr.LedgerEntryChange.ledgerEntryUpdated(entry('Positions',wallet,positionValue(new Map([[0,10000000n]])))),xdr.LedgerEntryChange.ledgerEntryUpdated(entry('ResData',reserve,res))];
}
describe('Exact borrowing transaction metadata extraction',()=>{
 it('extracts actual before/after tokens and the same execution rates',()=>expect(extractBorrowTransactionEvidence({meta:meta(metadataFixture()),baseline,action:'borrow',txHash:hash,confirmedLedger:101})).toEqual(evidence));
 it('supports current V4 operation metadata with exactly one operation',()=>{
  const current=new xdr.TransactionMeta(4,new xdr.TransactionMetaV4({ext:new xdr.ExtensionPoint(0),txChangesBefore:[],operations:[new xdr.OperationMetaV2({ext:new xdr.ExtensionPoint(0),changes:metadataFixture(),events:[]})],txChangesAfter:[],sorobanMeta:null,events:[],diagnosticEvents:[]}));
  expect(extractBorrowTransactionEvidence({meta:current,baseline,action:'borrow',txHash:hash,confirmedLedger:101})).toEqual(evidence);
  current.v4().operations([...current.v4().operations(),...current.v4().operations()]);
  expect(extractBorrowTransactionEvidence({meta:current,baseline,action:'borrow',txHash:hash,confirmedLedger:101})).toBeNull();
 });
 it('rejects missing, duplicate or unrelated position changes',()=>{
  const f=metadataFixture();for(const changes of [f.slice(1),[...f,f[1]!],[f[0]!,xdr.LedgerEntryChange.ledgerEntryUpdated(entry('Positions',wallet,positionValue(new Map([[0,10000000n],[3,1n]])))),f[2]!]])expect(extractBorrowTransactionEvidence({meta:meta(changes),baseline,action:'borrow',txHash:hash,confirmedLedger:101})).toBeNull();
 });
 it('does not accept an absent pre-state as zero unless the position entry was created',()=>{
  const f=metadataFixture();const created=[xdr.LedgerEntryChange.ledgerEntryCreated(entry('Positions',wallet,positionValue(new Map([[0,10000000n]]),new Map()))),f[2]!];
  const zero={...baseline,collateral:'0',collateral_tokens:'0'};
  expect(extractBorrowTransactionEvidence({meta:meta(created),baseline:zero,action:'borrow',txHash:hash,confirmedLedger:101})).toMatchObject({debt_tokens_before:'0',collateral_tokens_before:'0'});
 });
});
