import{describe,it,expect}from'vitest';
import{Address,Contract,Keypair,scValToNative,xdr}from'@stellar/stellar-sdk';
import{PERIDOT_POOL_ID,PERIDOT_TESTNET_PINS as P}from'../config.js';
import{buildPeridotStepOperation,inspectPeridotStepOperation,strictMarginMinimum,type PeridotStepIntent}from'./intents.js';
const wallet=Keypair.random().publicKey();
const begin:PeridotStepIntent={walletAddress:wallet,step:'open_begin',marginReceiptAtomic:'10000000',leverage:2,direction:'long',minimumOutputAtomic:'120000000'};
const invocation=(op:string)=>xdr.Operation.fromXDR(op,'base64').body().invokeHostFunctionOp().hostFunction().invokeContract();
describe('finite Peridot execution intent builders (offline only)',()=>{
 it('binds exact v3 begin types, owner, token order, margin, leverage, pool and minimum',()=>{
  const call=invocation(buildPeridotStepOperation(begin));expect(Address.fromScAddress(call.contractAddress()).toString()).toBe(P.margin.address);expect(call.functionName().toString()).toBe('begin_open_position_v3');
  const args=call.args().map(scValToNative);expect(args).toEqual([wallet,P.mock_usdt.address,P.native_token.address,10000000n,2n,['Long'],[P.native_token.address,P.mock_usdt.address],Buffer.from(PERIDOT_POOL_ID,'hex'),P.aquarius_pool.address,120000000n]);
  expect(call.args().map(a=>a.switch().name)).toEqual(['scvAddress','scvAddress','scvAddress','scvU128','scvU128','scvVec','scvVec','scvBytes','scvAddress','scvU128']);
 });
 it.each(['long','short'] as const)('accepts only reviewed %s direction with 2–5 leverage',direction=>{for(const leverage of [2,3,4,5] as const)expect(()=>buildPeridotStepOperation({...begin,direction,leverage})).not.toThrow();});
 it.each([0,1,6,2.5,NaN])('rejects unapproved leverage %s',leverage=>{expect(()=>buildPeridotStepOperation({...begin,leverage}as PeridotStepIntent)).toThrow();});
 it.each(['0','-1','1.0','01','1e7',(1n<<127n).toString()])('rejects unsafe amount %s',marginReceiptAtomic=>expect(()=>buildPeridotStepOperation({...begin,marginReceiptAtomic})).toThrow());
 it('rejects arbitrary source/asset/pool/method/amount changes by canonical equality',()=>{
  const original=buildPeridotStepOperation(begin);expect(()=>inspectPeridotStepOperation(original,begin)).not.toThrow();
  for(const changed of [{...begin,walletAddress:Keypair.random().publicKey()},{...begin,minimumOutputAtomic:'1'},{...begin,direction:'short' as const}])expect(()=>inspectPeridotStepOperation(original,changed)).toThrow('exact approved step');
  const other=new Contract(P.aquarius_pool.address).call('begin_open_position_v3',...invocation(original).args()).toXDR('base64');expect(()=>inspectPeridotStepOperation(other,begin)).toThrow();
 });
 it.each([
  [{step:'vault_deposit',underlyingAtomic:'10000000'},P.mock_usdt_vault.address,'deposit'],
  [{step:'vault_withdraw',receiptAtomic:'10000000'},P.mock_usdt_vault.address,'withdraw'],
  [{step:'margin_transfer',receiptAtomic:'10000000'},P.margin.address,'transfer_spot_to_margin'],
  [{step:'margin_return',receiptAtomic:'10000000'},P.margin.address,'transfer_margin_to_spot'],
  [{step:'open_swap',positionId:'42'},P.margin.address,'swap_open_position_v3'],
  [{step:'open_activate',positionId:'42'},P.margin.address,'activate_open_position_v3'],
  [{step:'open_cancel',positionId:'42'},P.margin.address,'cancel_pending_open_v3'],
  [{step:'close_prepare',positionId:'42'},P.margin.address,'prepare_close_position_v3'],
  [{step:'close_swap',positionId:'42',minimumOutputAtomic:'1000'},P.margin.address,'swap_close_position_v3'],
  [{step:'close_short_swap',positionId:'42',maximumInputAtomic:'1000',minimumDebtOutputAtomic:'900'},P.margin.address,'swap_close_short_position_v3'],
  [{step:'close_finish',positionId:'42'},P.margin.address,'finish_close_position_v3'],
  [{step:'close_cancel',positionId:'42'},P.margin.address,'cancel_close_position_v3'],
 ]as const)('constructs exact $0.step call', (fields,contract,method)=>{const op=buildPeridotStepOperation({walletAddress:wallet,...fields}as PeridotStepIntent);const call=invocation(op);expect(call.functionName().toString()).toBe(method);expect(Address.fromScAddress(call.contractAddress()).toString()).toBe(contract);expect(()=>inspectPeridotStepOperation(op,{walletAddress:wallet,...fields}as PeridotStepIntent)).not.toThrow();});
 it('rejects altered position id and extra invocation argument',()=>{
  const intent:PeridotStepIntent={walletAddress:wallet,step:'open_swap',positionId:'42'},op=buildPeridotStepOperation(intent);expect(()=>inspectPeridotStepOperation(op,{...intent,positionId:'43'})).toThrow();
  expect(()=>buildPeridotStepOperation({...intent,positionId:'18446744073709551616'})).toThrow();
 });
 it('keeps the strict ceiling minimum and never widens the oracle guard',()=>{expect(strictMarginMinimum('390','389',50)).toBe('389');expect(strictMarginMinimum('10000','9900',50)).toBe('9950');expect(()=>strictMarginMinimum('10000','10001',50)).toThrow('oracle band');expect(()=>strictMarginMinimum('10000','9000',501)).toThrow();});
});
