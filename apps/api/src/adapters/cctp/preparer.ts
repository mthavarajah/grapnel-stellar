import {Account,Address,Operation,Transaction,TransactionBuilder,rpc,scValToNative,xdr,Contract} from '@stellar/stellar-sdk';
import {NETWORK,NETWORK_PASSPHRASE,PreparedActionSchema,fromAtomic,type CustomerContext,type PreparedAction} from '@grapnel/contracts';
import {CCTP_TESTNET} from './registry.js';
import {readStellarRegistry} from './reader.js';
import {CCTP_BURN_ACTION,CCTP_CIRCLE_ASSET_ID,buildCctpBurnOperation,cctpBurnIntent,cctpFail,inspectCctpBurnAuthorization,inspectCctpBurnFootprint,inspectPreparedCctpBurn,type CctpBurnRequest,type CctpRecipientBinding,type CctpBurnIntent} from './inspector.js';
export interface CctpBurnAvailability{balanceAtomic:bigint;allowanceAtomic:bigint;}
export interface CctpBurnPreparerDependencies{
 server?:Pick<rpc.Server,'getNetwork'|'getAccount'|'simulateTransaction'>;
 /** Trusted persisted binding and destination eligibility are owned by the root service. */
 readRecipientBinding?:(customer:CustomerContext)=>Promise<CctpRecipientBinding|null>;
 verifyRegistry?:()=>Promise<unknown>;
 readAvailability?:(customer:CustomerContext)=>Promise<CctpBurnAvailability>;
 now?:()=>number;
}
function simulationSuccess(sim:rpc.Api.SimulateTransactionResponse,intent:CctpBurnIntent):asserts sim is rpc.Api.SimulateTransactionSuccessResponse{
 if(!rpc.Api.isSimulationSuccess(sim)||rpc.Api.isSimulationRestore(sim)||!sim.result||sim.result.retval.switch().name!=='scvVoid')return cctpFail('CCTP_BURN_SIMULATION_FAILED');
 if(!/^[0-9]{1,12}$/.test(sim.minResourceFee)||BigInt(sim.minResourceFee)<=0n||BigInt(sim.minResourceFee)+100n>intent.feeCeiling)return cctpFail('CCTP_NETWORK_FEE_LIMIT');
 inspectCctpBurnAuthorization(sim.result.auth,intent);inspectCctpBurnFootprint(sim.transactionData.build(),intent);
}
/** Offline construction and unsigned record/enforce simulations only. No signing/submission API. */
export class CctpBurnPreparer{
 private server:NonNullable<CctpBurnPreparerDependencies['server']>;
 private now:()=>number;
 constructor(private deps:CctpBurnPreparerDependencies={}){this.server=deps.server??new rpc.Server(CCTP_TESTNET.stellar.rpc,{timeout:15});this.now=deps.now??Date.now;}
 async readAvailability(customer:CustomerContext):Promise<CctpBurnAvailability>{
  if((await this.server.getNetwork()).passphrase!==NETWORK_PASSPHRASE)return cctpFail('CCTP_NETWORK_MISMATCH');
  const account=await this.server.getAccount(customer.walletAddress),token=new Contract(CCTP_TESTNET.stellar.usdc),owner=new Address(customer.walletAddress).toScVal(),values:bigint[]=[];
  for(const [method,args]of [['balance',[owner]],['allowance',[owner,new Address(CCTP_TESTNET.stellar.messenger).toScVal()]]] as const){
   const source=new Account(account.accountId(),account.sequenceNumber());
   const tx=new TransactionBuilder(source,{fee:'100',networkPassphrase:NETWORK_PASSPHRASE}).addOperation(token.call(method,...args)).setTimeout(90).build(),sim=await this.server.simulateTransaction(tx,undefined,'record');
   if(rpc.Api.isSimulationError(sim))return cctpFail(sim.error.includes('trustline entry is missing')?'CCTP_CIRCLE_USDC_TRUSTLINE_REQUIRED':'CCTP_BALANCE_READ_UNAVAILABLE');
   if(!rpc.Api.isSimulationSuccess(sim)||rpc.Api.isSimulationRestore(sim)||!sim.result||sim.result.auth.length||sim.result.retval.switch().name!=='scvI128'||sim.transactionData.build().resources().footprint().readWrite().length)return cctpFail('CCTP_BALANCE_READ_UNAVAILABLE');
   const value:unknown=scValToNative(sim.result.retval);if(typeof value!=='bigint'||value<0n)return cctpFail('CCTP_BALANCE_READ_UNAVAILABLE');values.push(value);
  }
  return {balanceAtomic:values[0]!,allowanceAtomic:values[1]!};
 }
 async prepare(request:CctpBurnRequest):Promise<PreparedAction>{
  // Do not retain mutable browser-derived objects across RPC awaits.
  const snapshot={...request,customer:{...request.customer}},binding=await this.deps.readRecipientBinding?.({...snapshot.customer})??null;
  const intent=cctpBurnIntent(snapshot,binding,this.now());
  if((await this.server.getNetwork()).passphrase!==NETWORK_PASSPHRASE)return cctpFail('CCTP_NETWORK_MISMATCH');
  await(this.deps.verifyRegistry??readStellarRegistry)();
  const available=await(this.deps.readAvailability?this.deps.readAvailability({...snapshot.customer}):this.readAvailability(snapshot.customer));
  if(typeof available.balanceAtomic!=='bigint'||available.balanceAtomic<intent.amountAtomic)return cctpFail('CCTP_CIRCLE_USDC_BALANCE_REQUIRED');
  if(typeof available.allowanceAtomic!=='bigint'||available.allowanceAtomic<intent.amountAtomic)return cctpFail('CCTP_ALLOWANCE_REVIEW_REQUIRED');
  const source=await this.server.getAccount(intent.walletAddress),expectedSequence=BigInt(source.sequenceNumber())+1n;
  if(this.now()>=Date.parse(intent.expiresAt))return cctpFail('CCTP_APPROVAL_EXPIRED');
  const tx=new TransactionBuilder(source,{fee:'100',networkPassphrase:NETWORK_PASSPHRASE,timebounds:{minTime:0,maxTime:Date.parse(intent.expiresAt)/1000}}).addOperation(buildCctpBurnOperation(intent)).build();
  const recorded=await this.server.simulateTransaction(tx,{cpuInstructions:500000},'record');simulationSuccess(recorded,intent);
  const data=recorded.transactionData.build(),resources=data.resources();
  resources.instructions(Math.ceil(resources.instructions()*1.1));resources.diskReadBytes(Math.ceil(resources.diskReadBytes()*1.1));resources.writeBytes(Math.ceil(resources.writeBytes()*1.1));data.resources(resources);
  data.resourceFee(xdr.Int64.fromString(((BigInt(recorded.minResourceFee)*110n+99n)/100n).toString()));
  inspectCctpBurnFootprint(data,intent);
  const op=tx.operations[0];if(op?.type!=='invokeHostFunction')return cctpFail('CCTP_OPERATION_INVALID');
  const prepared=TransactionBuilder.cloneFrom(tx,{fee:'100',networkPassphrase:NETWORK_PASSPHRASE,sorobanData:data}).clearOperations().addOperation(Operation.invokeHostFunction({func:op.func,auth:recorded.result!.auth})).build();
  const action=PreparedActionSchema.parse({operationId:intent.operationId,customerId:intent.customerId,network:NETWORK,walletAddress:intent.walletAddress,unsignedXdr:prepared.toXDR(),signingHashHex:prepared.hash().toString('hex'),summary:{action:CCTP_BURN_ACTION,fromAssetId:CCTP_CIRCLE_ASSET_ID,amount:fromAtomic(intent.amountAtomic,7),recipient:intent.evmRecipient,contractId:CCTP_TESTNET.stellar.messenger,maxFeeStroops:prepared.fee,expiresAt:intent.expiresAt},authorization:{method:'privy_stellar',expiresAt:intent.expiresAt}});
  inspectPreparedCctpBurn(action,prepared,intent,expectedSequence,this.now());
  const enforced=await this.server.simulateTransaction(prepared,undefined,'enforce');simulationSuccess(enforced,intent);
  const actual=enforced.transactionData.build().resources(),approved=prepared.toEnvelope().v1().tx().ext().sorobanData().resources();
  if(actual.footprint().toXDR('base64')!==approved.footprint().toXDR('base64')||actual.instructions()>approved.instructions()||actual.diskReadBytes()>approved.diskReadBytes()||actual.writeBytes()>approved.writeBytes()||BigInt(enforced.minResourceFee)+100n>BigInt(prepared.fee)||recorded.result!.auth.map(a=>a.toXDR('base64')).join(':')!==enforced.result!.auth.map(a=>a.toXDR('base64')).join(':'))return cctpFail('CCTP_FRESH_SIMULATION_CHANGED');
  if(BigInt((await this.server.getAccount(intent.walletAddress)).sequenceNumber())+1n!==expectedSequence||this.now()>=Date.parse(intent.expiresAt))return cctpFail('CCTP_APPROVAL_STATE_CHANGED');
  return action;
 }
}
