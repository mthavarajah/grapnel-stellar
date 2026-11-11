import{createHash}from'node:crypto';
import{Address,Keypair,Operation,StrKey,Transaction,TransactionBuilder,rpc,xdr}from'@stellar/stellar-sdk';
import{GrapnelError,NETWORK_PASSPHRASE}from'@grapnel/contracts';
import{PERIDOT_TESTNET_PINS as P}from'../config.js';
import{buildPeridotStepOperation}from'./intents.js';
export interface QaVaultDepositIntent{step:'vault_deposit';walletAddress:string;underlyingAtomic:string;}
export interface QaVaultDepositPolicy{allowInitialPinnedColdRestore?:boolean;}
export interface QaPreparedVaultDeposit{intent:QaVaultDepositIntent;unsignedXdr:string;signingHashHex:string;expiresAt:string;feeStroops:string;networkPassphrase:typeof NETWORK_PASSPHRASE;signingMode:'ephemeral_qa_ed25519_NOT_Privy_customer_flow';}
const fail=(reason:string):never=>{throw new GrapnelError(403,'PERIDOT_DEPOSIT_SCOPE_MISMATCH','The QA vault deposit exceeds its exact reviewed Testnet scope',false,{reason});};
const bytes=(v:{toXDR(format:'base64'):string})=>v.toXDR('base64');
const key=(contract:string,value:xdr.ScVal)=>xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({contract:new Address(contract).toScAddress(),key:value,durability:xdr.ContractDataDurability.persistent()}));
const instance=(contract:string)=>key(contract,xdr.ScVal.scvLedgerKeyContractInstance());
const field=(contract:string,name:string,owner?:string)=>key(contract,xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(name),...(owner?[new Address(owner).toScVal()]:[])]));
const code=(hash:string)=>xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({hash:Buffer.from(hash,'hex')}));
const same=(a:xdr.LedgerKey[],b:xdr.LedgerKey[])=>a.length===b.length&&a.map(bytes).sort().join(':')===b.map(bytes).sort().join(':');
const fee=(n:string)=>/^\d{1,12}$/.test(n)?BigInt(n):fail('FEE');
const vaultRo=['AccumulatedInterest','Admin','AdminFeeScaled','BoostedUnderlyingCached','BoostedUnderlyingUpdatedAt','BoostedVault','BorrowCap','BorrowIndex','BorrowYearlyRateScaled','CollateralFactorScaled','FlashLoanActive','FlashLoanFeeScaled','IdleCashBufferBps','InitialExchangeRate','Initialized','InterestModel','MarginController','PendingAdmin','Peridottroller','ReserveFactorScaled','SupplyCap','TotalAdminFees','TotalBadDebt','TotalBorrowPrincipal','TotalBorrowed','TotalReserves','UnderlyingToken','YearlyRateScaled'];
const trollerRo=['Admin','CloseFactorScaled','LiquidationFeeScaled','LiquidationIncentiveScaled','Oracle','OracleMaxAgeMultiplier','PauseDeposit','PeridotToken','ReserveRecipient','SupportedMarkets'];
export function buildQaVaultDeposit(intent:QaVaultDepositIntent):string{
 if(intent.step!=='vault_deposit'||!StrKey.isValidEd25519PublicKey(intent.walletAddress)||!/^[1-9]\d{0,8}$/.test(intent.underlyingAtomic)||BigInt(intent.underlyingAtomic)>100000000n)return fail('QA_DEPOSIT_BUDGET');
 return buildPeridotStepOperation(intent);
}
export function inspectQaVaultDepositAuth(auth:xdr.SorobanAuthorizationEntry[],intent:QaVaultDepositIntent):void{
 if(auth.length!==1||auth[0]!.credentials().switch().name!=='sorobanCredentialsSourceAccount')return fail('AUTH_SOURCE');
 const root=auth[0]!.rootInvocation(),expected=xdr.Operation.fromXDR(buildQaVaultDeposit(intent),'base64').body().invokeHostFunctionOp().hostFunction().invokeContract();
 if(root.function().switch().name!=='sorobanAuthorizedFunctionTypeContractFn'||bytes(root.function().contractFn())!==bytes(expected)||root.subInvocations().length!==1)return fail('AUTH_ROOT');
 const child=root.subInvocations()[0]!;if(child.subInvocations().length||child.function().switch().name!=='sorobanAuthorizedFunctionTypeContractFn')return fail('AUTH_CHILD');
 const fn=child.function().contractFn(),expectedTransfer=Operation.invokeContractFunction({contract:P.mock_usdt.address,function:'transfer',args:[new Address(intent.walletAddress).toScVal(),new Address(P.mock_usdt_vault.address).toScVal(),xdr.ScVal.scvI128(new xdr.Int128Parts({hi:xdr.Int64.fromString('0'),lo:xdr.Uint64.fromString(intent.underlyingAtomic)}))]});
 if(bytes(fn)!==bytes(expectedTransfer.body().invokeHostFunctionOp().hostFunction().invokeContract()))return fail('AUTH_TRANSFER');
}
/** Exactly observed deployment storage and only the approved nonempty cold subset may be restored. */
export function inspectQaVaultDepositFootprint(data:xdr.SorobanTransactionData,intent:QaVaultDepositIntent,policy:QaVaultDepositPolicy={}):bigint{
 buildQaVaultDeposit(intent);const resources=data.resources(),ro=resources.footprint().readOnly(),rw=resources.footprint().readWrite(),all=[...ro,...rw];
 if(new Set(all.map(bytes)).size!==all.length||resources.instructions()<=0||resources.instructions()>50000000||resources.diskReadBytes()>1048576||resources.writeBytes()>131072)return fail('RESOURCES');
 const restoreKeys=[instance(P.mock_usdt_vault.address),code(P.mock_usdt.wasmHash),code(P.mock_usdt_vault.wasmHash)],roBase=[...vaultRo.map(n=>field(P.mock_usdt_vault.address,n)),...['BorrowPrincipal','BorrowSnapshots','HasBorrowed'].map(n=>field(P.mock_usdt_vault.address,n,intent.walletAddress)),...trollerRo.map(n=>field(P.troller.address,n)),instance(P.troller.address),instance(P.mock_usdt.address),code(P.troller.wasmHash)];
 const rwBase=[field(P.mock_usdt_vault.address,'Balance',intent.walletAddress),...['LastUpdateTime','ManagedCash','TotalDeposited'].map(n=>field(P.mock_usdt_vault.address,n)),field(P.mock_usdt.address,'Balance',intent.walletAddress),field(P.mock_usdt.address,'Balance',P.mock_usdt_vault.address)];
 // Approved cold entries are RW only while archived; all already-live keys remain RO.
 const rwRestore=restoreKeys.filter(k=>rw.some(e=>bytes(e)===bytes(k))),roRestore=restoreKeys.filter(k=>!rwRestore.some(e=>bytes(e)===bytes(k)));
 if(!same(ro,[...roBase,...roRestore])||!same(rw,[...rwBase,...rwRestore]))return fail('FOOTPRINT');
 let cap=10000000n;
 if(data.ext().switch()===0){if(rwRestore.length)return fail('LIVE_RESTORE_KEY_WRITABLE');}
 else if(data.ext().switch()===1&&policy.allowInitialPinnedColdRestore){
  const indices=data.ext().resourceExt().archivedSorobanEntries();if(!indices.length||indices.some((n,i)=>!Number.isSafeInteger(n)||n<0||n>=rw.length||i>0&&n<=indices[i-1]!))return fail('ARCHIVE_INDICES');
  const restored=indices.map(i=>rw[i]!);if(!same(restored,rwRestore)||restored.some(k=>!restoreKeys.some(e=>bytes(e)===bytes(k))))return fail('RESTORATION_SCOPE');cap=80000000n;
 }else return fail('COLD_RESTORE_NOT_APPROVED');
 if(fee(data.resourceFee().toString())<=0n||fee(data.resourceFee().toString())>cap)return fail('RESOURCE_FEE');return cap;
}
export function inspectQaVaultDepositTransaction(tx:Transaction,intent:QaVaultDepositIntent,expiresAt:string,policy:QaVaultDepositPolicy={}):void{
 const expires=Date.parse(expiresAt);if(tx.networkPassphrase!==NETWORK_PASSPHRASE||tx.source!==intent.walletAddress||BigInt(tx.sequence)<=0n||tx.operations.length!==1||tx.memo.type!=='none'||tx.extraSigners?.length||!tx.timeBounds||tx.timeBounds.minTime!=='0'||!Number.isFinite(expires)||BigInt(tx.timeBounds.maxTime)*1000n!==BigInt(expires))return fail('ENVELOPE');
 const op=tx.operations[0],expected=xdr.Operation.fromXDR(buildQaVaultDeposit(intent),'base64').body().invokeHostFunctionOp().hostFunction();if(op?.type!=='invokeHostFunction'||op.source||bytes(op.func)!==bytes(expected))return fail('INVOCATION');inspectQaVaultDepositAuth(op.auth??[],intent);
 const ext=tx.toEnvelope().v1().tx().ext();if(ext.switch()!==1)return fail('RESOURCE_EXTENSION');const data=ext.sorobanData(),cap=inspectQaVaultDepositFootprint(data,intent,policy);if(fee(tx.fee)>cap||fee(tx.fee)<fee(data.resourceFee().toString())+100n)return fail('TOTAL_FEE');
}
/** No signer or broadcaster. The one approved cold-restore exception is QA-only. */
export class PeridotQaVaultDepositPreparer{
 constructor(private server=new rpc.Server('https://soroban-testnet.stellar.org'),private policy:QaVaultDepositPolicy={},private now=Date.now){}
 private async verifyPins(){
  if((await this.server.getNetwork()).passphrase!==NETWORK_PASSPHRASE)return fail('NETWORK');
  for(const pin of [P.mock_usdt,P.mock_usdt_vault,P.troller]){const exe=(await this.server.getContractData(pin.address,xdr.ScVal.scvLedgerKeyContractInstance())).val.contractData().val().instance().executable();if(exe.switch().name!=='contractExecutableWasm'||exe.wasmHash().toString('hex')!==pin.wasmHash)return fail('CODE_CHANGED');const result=await this.server.getLedgerEntries(code(pin.wasmHash));if(result.entries.length!==1||createHash('sha256').update(result.entries[0]!.val.contractCode().code()).digest('hex')!==pin.wasmHash)return fail('CODE_BYTES_CHANGED_OR_UNAVAILABLE');}
 }
 private successful(sim:rpc.Api.SimulateTransactionResponse,intent:QaVaultDepositIntent):rpc.Api.SimulateTransactionSuccessResponse{if(!rpc.Api.isSimulationSuccess(sim)||rpc.Api.isSimulationRestore(sim)||!sim.result)return fail('SIMULATION');inspectQaVaultDepositAuth(sim.result.auth,intent);inspectQaVaultDepositFootprint(sim.transactionData.build(),intent,this.policy);return sim;}
 private covered(tx:Transaction,sim:rpc.Api.SimulateTransactionSuccessResponse){const a=tx.toEnvelope().v1().tx().ext().sorobanData(),b=sim.transactionData.build();if(bytes(a.ext())!==bytes(b.ext())||bytes(a.resources().footprint())!==bytes(b.resources().footprint())||a.resources().instructions()<b.resources().instructions()||a.resources().diskReadBytes()<b.resources().diskReadBytes()||a.resources().writeBytes()<b.resources().writeBytes()||fee(tx.fee)<BigInt(sim.minResourceFee)+100n)return fail('FRESH_SCOPE_CHANGED');}
 async prepare(intent:QaVaultDepositIntent):Promise<QaPreparedVaultDeposit>{
  await this.verifyPins();const tx=new TransactionBuilder(await this.server.getAccount(intent.walletAddress),{fee:'100',networkPassphrase:NETWORK_PASSPHRASE}).addOperation(xdr.Operation.fromXDR(buildQaVaultDeposit(intent),'base64')).setTimeout(90).build(),sim=this.successful(await this.server.simulateTransaction(tx,{cpuInstructions:500000},'record'),intent),data=sim.transactionData.build(),r=data.resources();r.instructions(Math.ceil(r.instructions()*1.1));r.diskReadBytes(Math.ceil(r.diskReadBytes()*1.1));r.writeBytes(Math.ceil(r.writeBytes()*1.1));data.resources(r);data.resourceFee(xdr.Int64.fromString(((BigInt(sim.minResourceFee)*110n+99n)/100n).toString()));
  const op=tx.operations[0];if(op?.type!=='invokeHostFunction')return fail('OPERATION');const prepared=TransactionBuilder.cloneFrom(tx,{fee:'100',networkPassphrase:NETWORK_PASSPHRASE,sorobanData:data}).clearOperations().addOperation(Operation.invokeHostFunction({func:op.func,auth:sim.result!.auth})).build(),expiresAt=new Date(Number(prepared.timeBounds!.maxTime)*1000).toISOString();inspectQaVaultDepositTransaction(prepared,intent,expiresAt,this.policy);if(prepared.signatures.length)return fail('SIGNATURE');const fresh=this.successful(await this.server.simulateTransaction(prepared,undefined,'enforce'),intent);this.covered(prepared,fresh);if(bytes(sim.result!.auth[0]!)!==bytes(fresh.result!.auth[0]!))return fail('AUTH_CHANGED');return{intent,unsignedXdr:prepared.toXDR(),signingHashHex:prepared.hash().toString('hex'),expiresAt,feeStroops:prepared.fee,networkPassphrase:NETWORK_PASSPHRASE,signingMode:'ephemeral_qa_ed25519_NOT_Privy_customer_flow'};
 }
 async verifySigned(prepared:QaPreparedVaultDeposit,signedXdr:string):Promise<void>{
  const tx=TransactionBuilder.fromXDR(signedXdr,NETWORK_PASSPHRASE);if(!(tx instanceof Transaction)||prepared.networkPassphrase!==NETWORK_PASSPHRASE||this.now()>=Date.parse(prepared.expiresAt)||tx.hash().toString('hex')!==prepared.signingHashHex||tx.signatures.length!==1)return fail('SIGNATURE');inspectQaVaultDepositTransaction(tx,prepared.intent,prepared.expiresAt,this.policy);const sig=tx.signatures[0]!,key=Keypair.fromPublicKey(prepared.intent.walletAddress);if(!key.verify(tx.hash(),sig.signature())||!sig.hint().equals(key.signatureHint()))return fail('SIGNATURE');await this.verifyPins();if(BigInt((await this.server.getAccount(prepared.intent.walletAddress)).sequenceNumber())+1n!==BigInt(tx.sequence))return fail('SEQUENCE_CHANGED');const sim=this.successful(await this.server.simulateTransaction(tx,undefined,'enforce'),prepared.intent),op=tx.operations[0];if(op?.type!=='invokeHostFunction'||bytes(op.auth![0]!)!==bytes(sim.result!.auth[0]!))return fail('AUTH_CHANGED');this.covered(tx,sim);
 }
}
