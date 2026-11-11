import{createHash}from'node:crypto';
import{Address,Contract,Keypair,Operation,StrKey,Transaction,TransactionBuilder,nativeToScVal,rpc,scValToNative,xdr}from'@stellar/stellar-sdk';
import{GrapnelError,NETWORK_PASSPHRASE}from'@grapnel/contracts';
import{PERIDOT_TESTNET_PINS as P}from'../config.js';

export interface PeridotQaPoolSwapIntent{purpose:'qa_rebalance';walletAddress:string;inputXlmAtomic:string;minimumMockUsdtAtomic:string;}
export interface PoolSwapPolicy{allowPinnedMockCodeRestore?:boolean;}
export interface QaPreparedPoolSwap{intent:PeridotQaPoolSwapIntent;unsignedXdr:string;signingHashHex:string;expiresAt:string;feeStroops:string;networkPassphrase:typeof NETWORK_PASSPHRASE;signingMode:'ephemeral_qa_ed25519_NOT_Privy_customer_flow';}
const MAX_INPUT=28000n*10000000n,MAX_FEE=10000000n;
const fail=(reason:string):never=>{throw new GrapnelError(403,'PERIDOT_SWAP_SCOPE_MISMATCH','The QA swap exceeds its exact reviewed Testnet scope',false,{reason});};
const unsigned=(v:unknown)=>{if(typeof v!=='string'||!/^[1-9]\d{0,38}$/.test(v))return fail('INVALID_AMOUNT');const n=BigInt(v);if(n>=(1n<<127n))return fail('INVALID_AMOUNT');return n;};
const addr=(v:string)=>new Address(v).toScVal();
const dataKey=(contract:string,value:xdr.ScVal)=>xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({contract:new Address(contract).toScAddress(),key:value,durability:xdr.ContractDataDurability.persistent()}));
const instance=(contract:string)=>dataKey(contract,xdr.ScVal.scvLedgerKeyContractInstance());
const balance=(contract:string,owner:string)=>dataKey(contract,xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Balance'),addr(owner)]));
const code=(hash:string)=>xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({hash:Buffer.from(hash,'hex')}));
const account=(wallet:string)=>xdr.LedgerKey.account(new xdr.LedgerKeyAccount({accountId:xdr.PublicKey.publicKeyTypeEd25519(StrKey.decodeEd25519PublicKey(wallet))}));
const bytes=(v:{toXDR(format:'base64'):string})=>v.toXDR('base64');
const keys=(list:xdr.LedgerKey[])=>list.map(bytes).sort().join(':');
const sameKeys=(a:xdr.LedgerKey[],b:xdr.LedgerKey[])=>a.length===b.length&&keys(a)===keys(b);
const nonnegativeFee=(v:string)=>{if(!/^\d{1,12}$/.test(v))return fail('FEE_INVALID');return BigInt(v);};
export function buildPeridotQaPoolSwap(intent:PeridotQaPoolSwapIntent):string{
 if(intent.purpose!=='qa_rebalance'||!StrKey.isValidEd25519PublicKey(intent.walletAddress)||unsigned(intent.inputXlmAtomic)>MAX_INPUT) return fail('QA_BUDGET_EXCEEDED');
 unsigned(intent.minimumMockUsdtAtomic);
 return new Contract(P.aquarius_pool.address).call('swap',addr(intent.walletAddress),nativeToScVal(0,{type:'u32'}),nativeToScVal(1,{type:'u32'}),nativeToScVal(BigInt(intent.inputXlmAtomic),{type:'u128'}),nativeToScVal(BigInt(intent.minimumMockUsdtAtomic),{type:'u128'})).toXDR('base64');
}
export function inspectQaPoolSwapAuthorization(auth:xdr.SorobanAuthorizationEntry[],intent:PeridotQaPoolSwapIntent):void{
 try{
  if(auth.length!==1||auth[0]!.credentials().switch().name!=='sorobanCredentialsSourceAccount')return fail('AUTH_SOURCE');
  const root=auth[0]!.rootInvocation(),expected=xdr.Operation.fromXDR(buildPeridotQaPoolSwap(intent),'base64').body().invokeHostFunctionOp().hostFunction().invokeContract();
  if(root.function().switch().name!=='sorobanAuthorizedFunctionTypeContractFn'||bytes(root.function().contractFn())!==bytes(expected)||root.subInvocations().length!==1)return fail('AUTH_ROOT');
  const transfer=root.subInvocations()[0]!;if(transfer.subInvocations().length||transfer.function().switch().name!=='sorobanAuthorizedFunctionTypeContractFn')return fail('AUTH_CHILD');
  const fn=transfer.function().contractFn(),args=fn.args();if(Address.fromScAddress(fn.contractAddress()).toString()!==P.native_token.address||fn.functionName().toString()!=='transfer'||args.length!==3||args[0]!.switch().name!=='scvAddress'||args[1]!.switch().name!=='scvAddress'||args[2]!.switch().name!=='scvI128')return fail('AUTH_TRANSFER');
  const values=args.map(scValToNative);if(values[0]!==intent.walletAddress||values[1]!==P.aquarius_pool.address||values[2]!==BigInt(intent.inputXlmAtomic))return fail('AUTH_TRANSFER');
 }catch(error){if(error instanceof GrapnelError)throw error;return fail('AUTH_INVALID');}
}
export function inspectQaPoolSwapFootprint(data:xdr.SorobanTransactionData,intent:PeridotQaPoolSwapIntent,policy:PoolSwapPolicy={}):void{
 const r=data.resources(),ro=r.footprint().readOnly(),rw=r.footprint().readWrite(),all=[...ro,...rw];
 if(new Set(all.map(bytes)).size!==all.length||r.instructions()<=0||r.instructions()>30000000||r.diskReadBytes()>1048576||r.writeBytes()>131072||nonnegativeFee(data.resourceFee().toString())<=0n||nonnegativeFee(data.resourceFee().toString())>MAX_FEE)return fail('RESOURCES');
 const baseRo=[instance(P.native_token.address),instance(P.mock_usdt.address),code(P.aquarius_pool.wasmHash)],mockCode=code(P.mock_usdt.wasmHash);
 const baseRw=[account(intent.walletAddress),instance(P.aquarius_pool.address),balance(P.native_token.address,P.aquarius_pool.address),balance(P.mock_usdt.address,intent.walletAddress),balance(P.mock_usdt.address,P.aquarius_pool.address)];
 if(data.ext().switch()===0){if(!sameKeys(ro,[...baseRo,mockCode])||!sameKeys(rw,baseRw))return fail('FOOTPRINT');return;}
 if(data.ext().switch()!==1||!policy.allowPinnedMockCodeRestore||!sameKeys(ro,baseRo)||!sameKeys(rw,[...baseRw,mockCode]))return fail('PINNED_CODE_RESTORE_NOT_APPROVED');
 const index=rw.findIndex(k=>bytes(k)===bytes(mockCode)),archived=data.ext().resourceExt().archivedSorobanEntries();
 if(index<0||archived.length!==1||archived[0]!==index)return fail('RESTORATION_SCOPE');
}
export function inspectQaPoolSwapTransaction(tx:Transaction,intent:PeridotQaPoolSwapIntent,expiresAt:string,policy:PoolSwapPolicy={}):void{
 const expires=Date.parse(expiresAt),fee=nonnegativeFee(tx.fee);
 if(tx.networkPassphrase!==NETWORK_PASSPHRASE||tx.source!==intent.walletAddress||BigInt(tx.sequence)<=0n||tx.operations.length!==1||tx.memo.type!=='none'||tx.extraSigners?.length||!tx.timeBounds||tx.timeBounds.minTime!=='0'||!Number.isFinite(expires)||BigInt(tx.timeBounds.maxTime)*1000n!==BigInt(expires)||fee<=100n||fee>MAX_FEE)return fail('ENVELOPE');
 const op=tx.operations[0];if(op?.type!=='invokeHostFunction'||op.source)return fail('OPERATION');
 const expected=xdr.Operation.fromXDR(buildPeridotQaPoolSwap(intent),'base64').body().invokeHostFunctionOp().hostFunction();
 if(bytes(op.func)!==bytes(expected))return fail('INVOCATION');inspectQaPoolSwapAuthorization(op.auth??[],intent);
 const extension=tx.toEnvelope().v1().tx().ext();if(extension.switch()!==1)return fail('RESOURCE_EXTENSION');const data=extension.sorobanData();inspectQaPoolSwapFootprint(data,intent,policy);
 if(fee<nonnegativeFee(data.resourceFee().toString())+100n)return fail('FEE_INSUFFICIENT');
}
export interface PoolSwapPreparerDependencies{server?:rpc.Server;now?:()=>number;policy?:PoolSwapPolicy;}
/** QA-owned, finite Testnet preparation only. There is no signer, sender or customer identity. */
export class PeridotQaPoolSwapPreparer{
 private server:rpc.Server;private now:()=>number;private policy:PoolSwapPolicy;
 constructor(deps:PoolSwapPreparerDependencies={}){this.server=deps.server??new rpc.Server('https://soroban-testnet.stellar.org');this.now=deps.now??Date.now;this.policy=deps.policy??{};}
 private async verifyPins(){
  if((await this.server.getNetwork()).passphrase!==NETWORK_PASSPHRASE)return fail('NETWORK');
  for(const pin of [P.native_token,P.mock_usdt,P.aquarius_pool]){const value=(await this.server.getContractData(pin.address,xdr.ScVal.scvLedgerKeyContractInstance())).val.contractData().val().instance();const exe=value.executable();if('wasmHash'in pin){if(exe.switch().name!=='contractExecutableWasm'||exe.wasmHash().toString('hex')!==pin.wasmHash)return fail('CODE_CHANGED');const result=await this.server.getLedgerEntries(code(pin.wasmHash));if(result.entries.length!==1||createHash('sha256').update(result.entries[0]!.val.contractCode().code()).digest('hex')!==pin.wasmHash)return fail('CODE_BYTES_CHANGED_OR_UNAVAILABLE');}else if(exe.switch().name!=='contractExecutableStellarAsset')return fail('NATIVE_CHANGED');}
 }
 private successful(sim:rpc.Api.SimulateTransactionResponse,intent:PeridotQaPoolSwapIntent):rpc.Api.SimulateTransactionSuccessResponse{
  if(!rpc.Api.isSimulationSuccess(sim)||rpc.Api.isSimulationRestore(sim)||!sim.result)return fail('SIMULATION_FAILED');
  inspectQaPoolSwapAuthorization(sim.result.auth,intent);inspectQaPoolSwapFootprint(sim.transactionData.build(),intent,this.policy);return sim;
 }
 async prepare(intent:PeridotQaPoolSwapIntent):Promise<QaPreparedPoolSwap>{
  await this.verifyPins();const op=xdr.Operation.fromXDR(buildPeridotQaPoolSwap(intent),'base64'),account=await this.server.getAccount(intent.walletAddress),tx=new TransactionBuilder(account,{fee:'100',networkPassphrase:NETWORK_PASSPHRASE}).addOperation(op).setTimeout(90).build();
  const sim=this.successful(await this.server.simulateTransaction(tx,{cpuInstructions:500000},'record'),intent),data=sim.transactionData.build(),resource=data.resources();
  resource.instructions(Math.ceil(resource.instructions()*1.1));resource.diskReadBytes(Math.ceil(resource.diskReadBytes()*1.1));resource.writeBytes(Math.ceil(resource.writeBytes()*1.1));data.resources(resource);
  data.resourceFee(xdr.Int64.fromString(((BigInt(sim.minResourceFee)*110n+99n)/100n).toString()));
  const rawOp=tx.operations[0];if(rawOp?.type!=='invokeHostFunction')return fail('OPERATION');
  const prepared=TransactionBuilder.cloneFrom(tx,{fee:'100',networkPassphrase:NETWORK_PASSPHRASE,sorobanData:data}).clearOperations().addOperation(Operation.invokeHostFunction({func:rawOp.func,auth:sim.result!.auth})).build(),expiresAt=new Date(Number(prepared.timeBounds!.maxTime)*1000).toISOString();
  inspectQaPoolSwapTransaction(prepared,intent,expiresAt,this.policy);if(prepared.signatures.length)return fail('UNEXPECTED_SIGNATURE');
  const enforced=this.successful(await this.server.simulateTransaction(prepared,undefined,'enforce'),intent);this.covered(prepared,enforced);if(bytes(sim.result!.auth[0]!)!==bytes(enforced.result!.auth[0]!))return fail('AUTH_CHANGED');
  return{intent,unsignedXdr:prepared.toXDR(),signingHashHex:prepared.hash().toString('hex'),expiresAt,feeStroops:prepared.fee,networkPassphrase:NETWORK_PASSPHRASE,signingMode:'ephemeral_qa_ed25519_NOT_Privy_customer_flow'};
 }
 private covered(tx:Transaction,sim:rpc.Api.SimulateTransactionSuccessResponse){const a=tx.toEnvelope().v1().tx().ext().sorobanData(),b=sim.transactionData.build();if(bytes(a.ext())!==bytes(b.ext())||bytes(a.resources().footprint())!==bytes(b.resources().footprint())||a.resources().instructions()<b.resources().instructions()||a.resources().diskReadBytes()<b.resources().diskReadBytes()||a.resources().writeBytes()<b.resources().writeBytes()||nonnegativeFee(tx.fee)<BigInt(sim.minResourceFee)+100n)return fail('FRESH_SCOPE_CHANGED');}
 async verifySigned(prepared:QaPreparedPoolSwap,signedXdr:string):Promise<void>{
  const tx=TransactionBuilder.fromXDR(signedXdr,NETWORK_PASSPHRASE);if(!(tx instanceof Transaction)||prepared.networkPassphrase!==NETWORK_PASSPHRASE||this.now()>=Date.parse(prepared.expiresAt)||tx.hash().toString('hex')!==prepared.signingHashHex||tx.signatures.length!==1)return fail('SIGNATURE');
  inspectQaPoolSwapTransaction(tx,prepared.intent,prepared.expiresAt,this.policy);const signature=tx.signatures[0]!,publicKey=Keypair.fromPublicKey(prepared.intent.walletAddress);if(!publicKey.verify(tx.hash(),signature.signature())||!signature.hint().equals(publicKey.signatureHint()))return fail('SIGNATURE');
  await this.verifyPins();if(BigInt((await this.server.getAccount(prepared.intent.walletAddress)).sequenceNumber())+1n!==BigInt(tx.sequence))return fail('SEQUENCE_CHANGED');const sim=this.successful(await this.server.simulateTransaction(tx,undefined,'enforce'),prepared.intent);const op=tx.operations[0];if(op?.type!=='invokeHostFunction'||bytes(op.auth![0]!)!==bytes(sim.result!.auth[0]!))return fail('AUTH_CHANGED');this.covered(tx,sim);
 }
}
