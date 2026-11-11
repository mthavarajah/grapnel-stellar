import{readFileSync}from'node:fs';
import{describe,it,expect}from'vitest';
import{Account,Address,Contract,Keypair,Operation,Transaction,TransactionBuilder,nativeToScVal,xdr}from'@stellar/stellar-sdk';
import{NETWORK_PASSPHRASE}from'@grapnel/contracts';
import{PERIDOT_TESTNET_PINS as P}from'../config.js';
import{buildPeridotQaPoolSwap,inspectQaPoolSwapAuthorization,inspectQaPoolSwapFootprint,inspectQaPoolSwapTransaction,type PeridotQaPoolSwapIntent}from'./pool-swap.js';
// Captured unsigned record simulation, never a confirmed transaction or execution fixture.
const raw=JSON.parse(readFileSync(new URL('./research/swap-scope-readonly.json',import.meta.url),'utf8'));
const intent:PeridotQaPoolSwapIntent={purpose:'qa_rebalance',walletAddress:raw.source,inputXlmAtomic:'10000000',minimumMockUsdtAtomic:'1700000'};
const originalData=()=>xdr.SorobanTransactionData.fromXDR(raw.details.resource,'base64');
const auth=()=>raw.details.auth.map((a:{xdr:string})=>xdr.SorobanAuthorizationEntry.fromXDR(a.xdr,'base64'));
const approvedPolicy={allowPinnedMockCodeRestore:true};
function transaction(data=originalData(),entries=auth(),network=NETWORK_PASSPHRASE):Transaction{const host=xdr.Operation.fromXDR(buildPeridotQaPoolSwap(intent),'base64').body().invokeHostFunctionOp().hostFunction();return new TransactionBuilder(new Account(intent.walletAddress,'123'),{fee:'100',networkPassphrase:network,sorobanData:data}).addOperation(Operation.invokeHostFunction({func:host,auth:entries})).setTimeout(90).build();}
const expiry=(tx:Transaction)=>new Date(Number(tx.timeBounds!.maxTime)*1000).toISOString();
describe('QA-only pinned Peridot pool swap scope (no writes)',()=>{
 it('inspects actual auth and nine-key restored-code scope only with explicit new policy',()=>{const tx=transaction();expect(()=>inspectQaPoolSwapAuthorization(auth(),intent)).not.toThrow();expect(()=>inspectQaPoolSwapFootprint(originalData(),intent,approvedPolicy)).not.toThrow();expect(()=>inspectQaPoolSwapTransaction(tx,intent,expiry(tx),approvedPolicy)).not.toThrow();expect(()=>inspectQaPoolSwapFootprint(originalData(),intent)).toThrow();});
 it('accepts live-code read-only placement without any archive indices',()=>{const data=originalData(),fp=data.resources().footprint(),mock=fp.readWrite().at(-1)!;fp.readOnly([...fp.readOnly(),mock]);fp.readWrite(fp.readWrite().slice(0,-1));data.ext(new xdr.SorobanTransactionDataExt(0));expect(()=>inspectQaPoolSwapFootprint(data,intent)).not.toThrow();});
 it.each(['0','280000000001','-1','1.0','01'])('rejects input outside canonical QA budget %s',inputXlmAtomic=>expect(()=>buildPeridotQaPoolSwap({...intent,inputXlmAtomic})).toThrow());
 it('bounds setup funding independently to ten XLM without permitting another rebalance',()=>{expect(()=>buildPeridotQaPoolSwap({...intent,purpose:'qa_funding',inputXlmAtomic:'100000000'})).not.toThrow();expect(()=>buildPeridotQaPoolSwap({...intent,purpose:'qa_funding',inputXlmAtomic:'100000001'})).toThrow();});
 it('rejects unknown purposes and sources',()=>{expect(()=>buildPeridotQaPoolSwap({...intent,purpose:'customer_trade'}as never)).toThrow();expect(()=>buildPeridotQaPoolSwap({...intent,walletAddress:P.margin.address})).toThrow();});
 it('rejects changed user transfer amount or destination, extra child and extra auth',()=>{
  const entries=auth(),root=entries[0]!.rootInvocation(),child=root.subInvocations()[0]!,fn=child.function().contractFn(),args=fn.args();args[2]=nativeToScVal(2n,{type:'i128'});fn.args(args);expect(()=>inspectQaPoolSwapAuthorization(entries,intent)).toThrow();
  const destination=auth();const f=destination[0]!.rootInvocation().subInvocations()[0]!.function().contractFn(),a=f.args();a[1]=new Address(Keypair.random().publicKey()).toScVal();f.args(a);expect(()=>inspectQaPoolSwapAuthorization(destination,intent)).toThrow();
  const extra=auth();extra[0]!.rootInvocation().subInvocations([extra[0]!.rootInvocation().subInvocations()[0]!,extra[0]!.rootInvocation().subInvocations()[0]!]);expect(()=>inspectQaPoolSwapAuthorization(extra,intent)).toThrow();expect(()=>inspectQaPoolSwapAuthorization([...auth(),...auth()],intent)).toThrow();
 });
 it.each([{indices:[0]},{indices:[5,5]},{indices:[5,6]},{indices:[]}])('rejects non-code or duplicated/extra archive indices %j',({indices})=>{const data=originalData();data.ext().resourceExt().archivedSorobanEntries(indices);expect(()=>inspectQaPoolSwapFootprint(data,intent,approvedPolicy)).toThrow();});
 it('rejects source/account and foreign token balance key substitutions',()=>{
  const data=originalData(),fp=data.resources().footprint(),rw=fp.readWrite();rw[0]=xdr.LedgerKey.account(new xdr.LedgerKeyAccount({accountId:xdr.PublicKey.publicKeyTypeEd25519(Keypair.random().rawPublicKey())}));fp.readWrite(rw);expect(()=>inspectQaPoolSwapFootprint(data,intent,approvedPolicy)).toThrow();
  const other=originalData(),fp2=other.resources().footprint(),rw2=fp2.readWrite();const key=rw2[3]!.contractData();key.key(xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Balance'),new Address(Keypair.random().publicKey()).toScVal()]));expect(()=>inspectQaPoolSwapFootprint(other,intent,approvedPolicy)).toThrow();
 });
 it('rejects arbitrary WASM code, duplicate footprint keys and extra contract scope',()=>{
  const data=originalData();data.resources().footprint().readWrite().at(-1)!.contractCode().hash(Buffer.alloc(32));expect(()=>inspectQaPoolSwapFootprint(data,intent,approvedPolicy)).toThrow();
  const dup=originalData(),fp=dup.resources().footprint();fp.readOnly([...fp.readOnly(),fp.readOnly()[0]!]);expect(()=>inspectQaPoolSwapFootprint(dup,intent,approvedPolicy)).toThrow();
 });
 it('rejects different network, source, invoke amount, excessive fee and unsupported resource extension',()=>{
  const wrong=transaction(originalData(),auth(),'Public Global Stellar Network ; September 2015' as never);expect(()=>inspectQaPoolSwapTransaction(wrong,intent,expiry(wrong),approvedPolicy)).toThrow();
  const tx=transaction();expect(()=>inspectQaPoolSwapTransaction(tx,{...intent,inputXlmAtomic:'2'},expiry(tx),approvedPolicy)).toThrow();
  const fee=TransactionBuilder.cloneFrom(tx,{fee:'10000001',networkPassphrase:NETWORK_PASSPHRASE}).build();expect(()=>inspectQaPoolSwapTransaction(fee,intent,expiry(fee),approvedPolicy)).toThrow();
  const data=originalData();data.resources().instructions(30000001);expect(()=>inspectQaPoolSwapFootprint(data,intent,approvedPolicy)).toThrow();
 });
 it('does not turn the fixture into signed or onchain evidence',()=>{expect(raw.broadcast).toBe(false);expect(raw.signatures).toBe(0);expect(raw.tx_hash).toBeNull();expect(transaction().signatures).toHaveLength(0);});
});
