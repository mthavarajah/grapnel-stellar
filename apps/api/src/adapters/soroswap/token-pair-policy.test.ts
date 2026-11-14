import{readFileSync}from'node:fs';import{describe,it,expect,vi,beforeEach,afterEach}from'vitest';
import{Address,Transaction,TransactionBuilder,nativeToScVal,xdr,Operation}from'@stellar/stellar-sdk';
import{NETWORK_PASSPHRASE,SPOT_TOKEN_PAIR_PINS}from'@grapnel/contracts';
import{APPROVED_TOKEN_WASM}from'./direct-assets.js';import{inspectTokenPairTransaction}from'./token-pair-policy.js';import{narrowSwapTimebounds,type SwapRegistry}from'./inspector.js';
const d=JSON.parse(readFileSync(new URL('./research/token-pair-raw-fixture.json',import.meta.url),'utf8')),pin=SPOT_TOKEN_PAIR_PINS[0],q=d.row.quote;
const reg:SwapRegistry={router:d.registry.ids.router,factory:d.registry.ids.factory,pair:pin.pair,routerHash:d.registry.hashes.router,pairHash:d.registry.hashes.pair,tokenWasmHash:APPROVED_TOKEN_WASM,protocolVersion:30,tokenPair:{tokenA:pin.a.contract,tokenB:pin.b.contract}};
const intent={wallet:d.source,amount:BigInt(q.amount_in_atomic),minimum:BigInt(q.min_out_atomic),expiresAt:q.expires_at,assetIn:pin.a.contract,assetOut:pin.b.contract};
const raw=()=>TransactionBuilder.fromXDR(d.row.unsigned_xdr,NETWORK_PASSPHRASE)as Transaction;
const mutate=(fn:(tx:xdr.Transaction)=>void)=>{const e=narrowSwapTimebounds(raw(),intent.expiresAt).toEnvelope();fn(e.v1().tx());return new Transaction(e,NETWORK_PASSPHRASE);};
describe('exact direct two-token swap policy — unsigned source replay, not execution proof',()=>{
 beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date(d.clock_for_replay));});afterEach(()=>vi.useRealTimers());
 it('accepts the actual11-key token/pair footprint and unchanged narrowed intent',()=>{expect(()=>inspectTokenPairTransaction(raw(),intent,reg,true)).not.toThrow();expect(()=>inspectTokenPairTransaction(narrowSwapTimebounds(raw(),intent.expiresAt),intent,reg)).not.toThrow();});
 it.each(['minimum','recipient','path','auth','extra-operation','code','balance','account','archive']as const)('rejects modified %s before signing',kind=>{
 const tx=mutate(t=>{const op=t.operations()[0]!.body().invokeHostFunctionOp(),fn=op.hostFunction().invokeContract(),fp=t.ext().sorobanData().resources().footprint();
 if(kind==='minimum')fn.args()[1]=nativeToScVal(intent.minimum-1n,{type:'i128'});
 if(kind==='recipient')fn.args()[3]=new Address(reg.factory).toScVal();
 if(kind==='path')fn.args()[2]=xdr.ScVal.scvVec([new Address(pin.a.contract).toScVal(),new Address(pin.b.contract).toScVal(),new Address(pin.a.contract).toScVal()]);
 if(kind==='auth')op.auth()[0]!.rootInvocation().subInvocations()[0]!.function().contractFn().args()[1]=new Address(reg.router).toScVal();
 if(kind==='extra-operation')t.operations().push(Operation.restoreFootprint({}));
 if(kind==='code')fp.readOnly().find(k=>k.switch().name==='contractCode')!.contractCode().hash(Buffer.alloc(32));
 if(kind==='balance')fp.readWrite().find(k=>k.contractData().key().switch().name==='scvVec')!.contractData().key(xdr.ScVal.scvVec([nativeToScVal('Balance',{type:'symbol'}),new Address(reg.router).toScVal()]));
 if(kind==='account')fp.readWrite().push(xdr.LedgerKey.account(new xdr.LedgerKeyAccount({accountId:new Address(intent.wallet).toScAddress().accountId()})));
 if(kind==='archive')t.ext().sorobanData().ext().resourceExt().archivedSorobanEntries([0,0]);
 });expect(()=>inspectTokenPairTransaction(tx,intent,reg)).toThrow();
 });
 it('rejects unpinned pair, token identity, protocol, amount and fee changes',()=>{for(const patch of[{pair:SPOT_TOKEN_PAIR_PINS[1].pair},{tokenPair:{tokenA:pin.b.contract,tokenB:pin.a.contract}},{tokenWasmHash:'0'.repeat(64)},{protocolVersion:22}])expect(()=>inspectTokenPairTransaction(raw(),intent,{...reg,...patch},true)).toThrow();expect(()=>inspectTokenPairTransaction(raw(),{...intent,amount:intent.amount+1n},reg,true)).toThrow();expect(()=>inspectTokenPairTransaction(mutate(t=>t.fee(10000001)),intent,reg)).toThrow();});
});
