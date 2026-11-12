import {Address,Asset,Contract,Operation,StrKey,Transaction,TransactionBuilder,nativeToScVal,rpc,scValToNative,xdr} from '@stellar/stellar-sdk';
import {GrapnelError,NETWORK,NETWORK_PASSPHRASE,PreparedActionSchema,toAtomic,type ChainAction,type PreparedAction} from '@grapnel/contracts';
import {BlendBorrowAdapter,BORROW_ASSETS,BORROW_POOL_ID,BORROW_POOL_WASM,BORROW_ORACLE_ID,BORROW_ORACLE_WASM,BORROW_XLM_RESERVE,BORROW_USDC_RESERVE,BORROW_USDC_ISSUER,buildBorrowOperation,borrowSummaryAction,inspectBorrowOperation,borrowReadAtomic,borrowRepayAllMaximum,type BorrowIntent,type BorrowAction,type BorrowConfig,type BorrowDependencies} from '../blend/borrow.js';
import {verifySignedAction,parseTestnetTransaction} from './index.js';
export interface BorrowPreparerDependencies extends BorrowDependencies {server?:Pick<rpc.Server,'getNetwork'|'getAccount'|'getContractData'|'getLedgerEntries'|'simulateTransaction'>;}
const MAX_FEE=10_000_000n;
const fail=(code:string,message:string):never=>{throw new GrapnelError(403,code,message);};
const unavailable=(reason:string):never=>{throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','The borrowing transaction needs a fresh review',false,{reason});};
const code=(id:xdr.ScAddress)=>Address.fromScAddress(id).toString();
const key=(k:xdr.LedgerKey)=>k.toXDR('base64');
const keys=(k:xdr.LedgerKey[])=>k.map(key).sort().join(':');
const fee=(s:string)=>{if(!/^\d{1,12}$/.test(s))return fail('SOROBAN_FEE_INVALID','Invalid exact fee');return BigInt(s);};
const actionOf=(value:string):BorrowAction|null=>{for(const action of ['borrow','repay','collateral_supply','collateral_withdraw'] as const)if(value===borrowSummaryAction(action))return action;return null;};
export function borrowIntentFromAction(input:ChainAction):BorrowIntent{
 const action=actionOf(input.summary.action),asset=BORROW_ASSETS.find(a=>a.id===input.summary.fromAssetId),expires=Date.parse(input.summary.expiresAt);
 if(!action||!asset||input.summary.toAssetId!==undefined||input.summary.minReceive!==undefined||input.summary.contractId!==BORROW_POOL_ID||input.summary.recipient!==input.walletAddress||!StrKey.isValidEd25519PublicKey(input.walletAddress)||input.allowedContracts.length!==2||new Set(input.allowedContracts).size!==2||!input.allowedContracts.includes(BORROW_POOL_ID)||!input.allowedContracts.includes(asset.contractId!)||!Number.isFinite(expires)||expires<=Date.now()||expires>Date.now()+120_000)return fail('BLEND_INTENT_MISMATCH','Only an exact reviewed borrowing intent is supported');
 const intent={action,poolId:BORROW_POOL_ID,reserveId:asset.contractId!,walletAddress:input.walletAddress,amountAtomic:toAtomic(input.summary.amount??'',7)};inspectBorrowOperation(input.operationXdr,intent);return intent;
}
/** Customer authorization is one exact source-only pool submit, plus a bounded incoming transfer if necessary. */
export function inspectBorrowAuthorization(auth:xdr.SorobanAuthorizationEntry[],intent:BorrowIntent):void{
 try{
  if(auth.length!==1||auth[0]!.credentials().switch().name!=='sorobanCredentialsSourceAccount')throw Error();
  const root=auth[0]!.rootInvocation(),fn=xdr.Operation.fromXDR(buildBorrowOperation(intent),'base64').body().invokeHostFunctionOp().hostFunction().invokeContract();
  if(root.function().switch().name!=='sorobanAuthorizedFunctionTypeContractFn'||root.function().contractFn().toXDR('base64')!==fn.toXDR('base64'))throw Error();
  const incoming=intent.action==='repay'||intent.action==='collateral_supply';if(root.subInvocations().length!==(incoming?1:0))throw Error();
  if(incoming){const child=root.subInvocations()[0]!;if(child.function().switch().name!=='sorobanAuthorizedFunctionTypeContractFn'||child.subInvocations().length)throw Error();const transfer=child.function().contractFn(),args=transfer.args().map(scValToNative);if(code(transfer.contractAddress())!==intent.reserveId||transfer.functionName().toString()!=='transfer'||args.length!==3||args[0]!==intent.walletAddress||args[1]!==BORROW_POOL_ID||typeof args[2]!=='bigint'||args[2]<=0n||args[2]!==intent.amountAtomic)throw Error();}
 }catch{fail('SOROBAN_AUTH_MISMATCH','Authorization differs from the exact customer borrowing request');}
}
const objectKeys=(v:unknown,names:string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===names.sort().join(',');
/** Scope is only the source, its USDC trustline, selected pool/token balances, reviewed reserves and pinned oracle. */
export function inspectBorrowFootprint(data:xdr.SorobanTransactionData,intent:BorrowIntent,ceiling=MAX_FEE):void{
 try{
  const r=data.resources(),ro=r.footprint().readOnly(),rw=r.footprint().readWrite(),all=[...ro,...rw].map(key);
  if(data.ext().switch()!==0||fee(data.resourceFee().toString())>ceiling||r.instructions()<=0||r.instructions()>25_000_000||r.diskReadBytes()>1_048_576||r.writeBytes()>131_072||all.length>40||!rw.length||new Set(all).size!==all.length)throw Error();
  const reserves=[BORROW_XLM_RESERVE,BORROW_USDC_RESERVE];let poolInstance=false,tokenInstance=false,poolCode=false,position=false,selectedData=false,balance=false,source=false,trustline=false;
  for(const [write,list] of [[false,ro],[true,rw]] as const)for(const k of list){
   if(k.switch().name==='account'){if(!write||intent.reserveId!==BORROW_XLM_RESERVE||StrKey.encodeEd25519PublicKey(k.account().accountId().ed25519())!==intent.walletAddress)throw Error();source=true;continue;}
   if(k.switch().name==='trustline'){const t=k.trustLine(),a=t.asset();if(!write||intent.reserveId!==BORROW_USDC_RESERVE||StrKey.encodeEd25519PublicKey(t.accountId().ed25519())!==intent.walletAddress||a.switch().name!=='assetTypeCreditAlphanum4'||a.alphaNum4().assetCode().toString().replace(/\0+$/,'')!=='USDC'||StrKey.encodeEd25519PublicKey(a.alphaNum4().issuer().ed25519())!==BORROW_USDC_ISSUER)throw Error();trustline=true;continue;}
   if(k.switch().name==='contractCode'){const hash=k.contractCode().hash().toString('hex');if(write||![BORROW_POOL_WASM,BORROW_ORACLE_WASM].includes(hash))throw Error();if(hash===BORROW_POOL_WASM)poolCode=true;continue;}
   if(k.switch().name!=='contractData')throw Error();const cd=k.contractData(),id=code(cd.contract()),dur=cd.durability().name;
   if(cd.key().switch().name==='scvLedgerKeyContractInstance'){if(write||dur!=='persistent'||![BORROW_POOL_ID,BORROW_ORACLE_ID,...reserves].includes(id))throw Error();if(id===BORROW_POOL_ID)poolInstance=true;if(id===intent.reserveId)tokenInstance=true;continue;}
   const v=scValToNative(cd.key());
   if(id===BORROW_ORACLE_ID){if(write||dur!=='temporary'||!((typeof v==='bigint'&&(v===0n||v===1n))||v==='timestamp'))throw Error();continue;}
   if(reserves.includes(id)){if(!write||id!==intent.reserveId||dur!=='persistent'||!Array.isArray(v)||v.length!==2||v[0]!=='Balance'||v[1]!==BORROW_POOL_ID)throw Error();balance=true;continue;}
   if(id!==BORROW_POOL_ID)throw Error();
   if(v==='ResList'&&!write&&dur==='persistent')continue;
   if(!Array.isArray(v)||v.length!==2)throw Error();const [name,target]=v;
   if(name==='Auction'&&!write&&dur==='temporary'&&objectKeys(target,['auct_type','user'])&&target.auct_type===0&&target.user===intent.walletAddress)continue;
   if(dur!=='persistent')throw Error();
   if(name==='Positions'&&write&&target===intent.walletAddress){position=true;continue;}
   if(name==='ResConfig'&&!write&&reserves.includes(target))continue;
   if(name==='ResData'&&reserves.includes(target)&&((write&&target===intent.reserveId)||(!write&&intent.action==='borrow'&&target!==intent.reserveId))){if(write&&target===intent.reserveId)selectedData=true;continue;}
   if(name==='EmisData'&&[0,1,6,7].includes(target))continue;
   if(name==='UserEmis'&&objectKeys(target,['reserve_id','user'])&&[0,1,6,7].includes(Number(target.reserve_id))&&target.user===intent.walletAddress)continue;
   throw Error();
  }
  if(!poolInstance||!tokenInstance||!poolCode||!position||!selectedData||!balance||(intent.reserveId===BORROW_XLM_RESERVE?!source:!trustline))throw Error();
 }catch{fail('SOROBAN_FOOTPRINT_MISMATCH','Borrowing footprint exceeds the reviewed contracts, customer or resource budget');}
}
export function inspectPreparedBorrowTransaction(action:PreparedAction,tx:Transaction,ceiling=MAX_FEE):void{
 PreparedActionSchema.parse(action);const input:ChainAction={operationId:action.operationId,customerId:action.customerId,walletAddress:action.walletAddress,summary:action.summary,allowedContracts:[BORROW_POOL_ID,BORROW_ASSETS.find(a=>a.id===action.summary.fromAssetId)?.contractId??''],operationXdr:''};
 const actionType=actionOf(action.summary.action),asset=BORROW_ASSETS.find(a=>a.id===action.summary.fromAssetId);if(!actionType||!asset)return fail('BLEND_INTENT_MISMATCH','Unknown borrowing action');const intent:BorrowIntent={action:actionType,poolId:BORROW_POOL_ID,reserveId:asset.contractId!,walletAddress:action.walletAddress,amountAtomic:toAtomic(action.summary.amount??'',7)};input.operationXdr=buildBorrowOperation(intent);borrowIntentFromAction(input);
 if(action.network!==NETWORK||action.authorization.method!=='privy_stellar'||action.authorization.expiresAt!==action.summary.expiresAt||action.signingHashHex!==tx.hash().toString('hex')||action.summary.maxFeeStroops!==tx.fee||tx.networkPassphrase!==NETWORK_PASSPHRASE||tx.source!==intent.walletAddress||BigInt(tx.sequence)<=0n||tx.operations.length!==1||tx.memo.type!=='none'||tx.extraSigners?.length||!tx.timeBounds||tx.timeBounds.minTime!=='0'||tx.timeBounds.maxTime==='0'||BigInt(tx.timeBounds.maxTime)*1000n>BigInt(Date.parse(action.summary.expiresAt))||fee(tx.fee)<=100n||fee(tx.fee)>ceiling)return fail('SOROBAN_TRANSACTION_MISMATCH','Borrowing envelope differs from the approved source, time, fee or digest');
 const op=tx.operations[0];if(op?.type!=='invokeHostFunction'||op.source||op.func.switch().name!=='hostFunctionTypeInvokeContract'||op.func.toXDR('base64')!==xdr.Operation.fromXDR(input.operationXdr,'base64').body().invokeHostFunctionOp().hostFunction().toXDR('base64'))return fail('BLEND_INTENT_MISMATCH','Borrowing invocation differs from the approved request');inspectBorrowAuthorization(op.auth??[],intent);
 const ext=tx.toEnvelope().v1().tx().ext();if(ext.switch()!==1)return fail('SOROBAN_FOOTPRINT_MISMATCH','Borrowing requires Soroban resource data');inspectBorrowFootprint(ext.sorobanData(),intent,ceiling);if(fee(tx.fee)<fee(ext.sorobanData().resourceFee().toString())+100n)return fail('SOROBAN_FEE_LIMIT','Insufficient resource fee');
}
function successful(sim:rpc.Api.SimulateTransactionResponse,intent:BorrowIntent,ceiling=MAX_FEE):asserts sim is rpc.Api.SimulateTransactionSuccessResponse{if(!rpc.Api.isSimulationSuccess(sim)||rpc.Api.isSimulationRestore(sim)||!sim.result)return unavailable('BORROW_SIMULATION_FAILED');if(fee(sim.minResourceFee)<=0n||fee(sim.minResourceFee)+100n>ceiling)return unavailable('BORROW_FEE_LIMIT');inspectBorrowAuthorization(sim.result.auth,intent);inspectBorrowFootprint(sim.transactionData.build(),intent,ceiling);}
function covered(tx:Transaction,sim:rpc.Api.SimulateTransactionSuccessResponse){const a=tx.toEnvelope().v1().tx().ext().sorobanData().resources(),b=sim.transactionData.build().resources();if(a.instructions()<b.instructions()||a.diskReadBytes()<b.diskReadBytes()||a.writeBytes()<b.writeBytes()||keys(a.footprint().readOnly())!==keys(b.footprint().readOnly())||keys(a.footprint().readWrite())!==keys(b.footprint().readWrite())||fee(tx.fee)<fee(sim.minResourceFee)+100n)return unavailable('BORROW_RESOURCES_CHANGED');}
/** Preparation and fresh exact-envelope verification only. There is no signing or broadcasting method. */
export class BlendBorrowSorobanPreparer{
 private server:NonNullable<BorrowPreparerDependencies['server']>;private safety:BlendBorrowAdapter;
 constructor(readonly config:BorrowConfig,deps:BorrowPreparerDependencies={}){this.server=deps.server??new rpc.Server('https://soroban-testnet.stellar.org');this.safety=new BlendBorrowAdapter(config,{...deps,prepareAndSimulate:async()=>{throw Error('Read-only safety callback');}});}
 private async check(input:ChainAction,intent:BorrowIntent){await this.safety.verifyRegistry();if(!this.config.gate1Passed)return unavailable('GATE_1_SIGNING_PROOF_REQUIRED');if(intent.action==='borrow'||intent.action==='repay'){const read=await this.safety.readWallet(input.walletAddress);const asset=read.assets.find(a=>a.asset.contractId===intent.reserveId)!;if(intent.action==='borrow'&&(!asset.can_prepare_borrow||asset.available_to_borrow===null||toAtomic(asset.available_to_borrow,7)<intent.amountAtomic))return unavailable(asset.reason??'BORROW_CAPACITY_EXCEEDED');if(intent.action==='repay'){const maximum=borrowRepayAllMaximum(borrowReadAtomic(asset.borrowed)),wallet=await this.safety.walletBalance(intent.reserveId,input.walletAddress);if(!asset.can_prepare_repay||maximum===null||intent.amountAtomic>maximum||intent.amountAtomic>wallet)return unavailable('REPAY_AMOUNT_EXCEEDS_DEBT_OR_BALANCE');}}else if(intent.action==='collateral_supply'){const read=await this.safety.readWallet(input.walletAddress);if(read.assets.some(a=>a.reason==='BORROW_POOL_NOT_ACTIVE'))return unavailable('BORROW_POOL_NOT_ACTIVE');if(await this.safety.walletBalance(intent.reserveId,input.walletAddress)<intent.amountAtomic)return unavailable('COLLATERAL_BALANCE_INSUFFICIENT');}else{const positions=await this.safety.positionsWallet(input.walletAddress),selected=positions.find(p=>p.reserve_contract_id===intent.reserveId);if(!selected||borrowReadAtomic(selected.collateral)<intent.amountAtomic||positions.some(p=>borrowReadAtomic(p.borrowed)>0n))return unavailable('COLLATERAL_WITHDRAW_POSITION_CHANGED');}}
 async prepare(input:ChainAction):Promise<PreparedAction>{
  const intent=borrowIntentFromAction(input),ceiling=input.summary.maxFeeStroops===undefined?MAX_FEE:fee(input.summary.maxFeeStroops);if(ceiling<=100n||ceiling>MAX_FEE)return unavailable('BORROW_FEE_LIMIT');await this.check(input,intent);const account=await this.server.getAccount(intent.walletAddress),expectedSequence=BigInt(account.sequenceNumber())+1n;
  const tx=new TransactionBuilder(account,{fee:'100',networkPassphrase:NETWORK_PASSPHRASE,timebounds:{minTime:0,maxTime:Math.floor(Date.parse(input.summary.expiresAt)/1000)}}).addOperation(xdr.Operation.fromXDR(input.operationXdr,'base64')).build();
  const sim=await this.server.simulateTransaction(tx,{cpuInstructions:500_000},'record');successful(sim,intent,ceiling);const op=tx.operations[0];if(op?.type!=='invokeHostFunction')return fail('BLEND_INTENT_MISMATCH','Invalid borrowing invocation');
  const prepared=TransactionBuilder.cloneFrom(tx,{fee:'100',networkPassphrase:NETWORK_PASSPHRASE,sorobanData:sim.transactionData.build()}).clearOperations().addOperation(Operation.invokeHostFunction({func:op.func,auth:sim.result!.auth})).build();
  const expiresAt=new Date(Number(prepared.timeBounds!.maxTime)*1000).toISOString();const action=PreparedActionSchema.parse({operationId:input.operationId,customerId:input.customerId,network:NETWORK,walletAddress:intent.walletAddress,unsignedXdr:prepared.toXDR(),signingHashHex:prepared.hash().toString('hex'),summary:{...input.summary,maxFeeStroops:prepared.fee,expiresAt},authorization:{method:'privy_stellar',expiresAt}});inspectPreparedBorrowTransaction(action,prepared,ceiling);if(prepared.signatures.length||BigInt(prepared.sequence)!==expectedSequence)return fail('SOROBAN_TRANSACTION_MISMATCH','Unexpected signature or source sequence');
  const enforce=await this.server.simulateTransaction(prepared,undefined,'enforce');successful(enforce,intent,ceiling);if(sim.result!.auth[0]!.toXDR('base64')!==enforce.result!.auth[0]!.toXDR('base64'))return fail('SOROBAN_AUTH_MISMATCH','Borrowing authorization changed');covered(prepared,enforce);return action;
 }
 async verifyForSubmission(action:PreparedAction,signed:string):Promise<void>{
  const tx=parseTestnetTransaction(signed);verifySignedAction(action,signed,(approved,transaction)=>inspectPreparedBorrowTransaction(approved,transaction));const input:ChainAction={operationId:action.operationId,customerId:action.customerId,walletAddress:action.walletAddress,summary:action.summary,allowedContracts:[BORROW_POOL_ID,BORROW_ASSETS.find(a=>a.id===action.summary.fromAssetId)?.contractId??''],operationXdr:xdr.Operation.fromXDR(tx.operations[0]?.type==='invokeHostFunction'?Operation.invokeHostFunction({func:tx.operations[0].func}).toXDR('base64'):'','base64').toXDR('base64')};const intent=borrowIntentFromAction(input);await this.check(input,intent);if(BigInt((await this.server.getAccount(action.walletAddress)).sequenceNumber())+1n!==BigInt(tx.sequence))return unavailable('BORROW_SEQUENCE_CHANGED');const sim=await this.server.simulateTransaction(tx,undefined,'enforce');successful(sim,intent);covered(tx,sim);
 }
}
