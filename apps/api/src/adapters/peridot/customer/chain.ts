import {createHash} from 'node:crypto';
import {Address,Contract,Transaction,TransactionBuilder,rpc,scValToNative,nativeToScVal,xdr} from '@stellar/stellar-sdk';
import {NETWORK_PASSPHRASE,XLM,toAtomic,type CustomerContext,type WalletBalance} from '@grapnel/contracts';
import {PERIDOT_TESTNET_PINS as P} from '../config.js';
import {PeridotPositionReader,validateMarginPositionSnapshot,type MarginPositionSnapshot} from '../execution/state.js';
import {fail,invalid,unsigned} from './policy.js';
export interface CustomerSnapshot {
 walletUnderlyingAtomic:string;walletReceiptAtomic:string;marginReceiptAtomic:string;marginDebtAtomic:string;
 nativeWalletAtomic:string;nativeSpendableAtomic:string;observedAt:string;ledger:number;
 position:MarginPositionSnapshot|null;
}
export interface ConfirmedPeridotTransaction {hash:string;ledger:number;createdAt?:number;feeAtomic:string;meta:xdr.TransactionMeta;returnValue:xdr.ScVal|undefined;transaction:Transaction;}
export interface CustomerChainDependencies {
 server?:rpc.Server;
 nativeBalance(customer:CustomerContext):Promise<WalletBalance>;
 horizonTransaction(hash:string):Promise<{successful:boolean;hash:string;source_account:string;ledger_attr:number;fee_charged:string|number}>;
 now?:()=>number;
}
const asAtomic=(value:unknown)=>typeof value==='bigint'&&value>=0n?unsigned(value.toString()).toString():invalid('CHAIN_BALANCE');
export class PeridotCustomerChain {
 readonly server:rpc.Server;readonly now:()=>number;
 constructor(private readonly deps:CustomerChainDependencies){this.server=deps.server??new rpc.Server('https://soroban-testnet.stellar.org');this.now=deps.now??Date.now;}
 async verifyPins():Promise<void>{
  if((await this.server.getNetwork()).passphrase!==NETWORK_PASSPHRASE)return fail('NETWORK_MISMATCH');
  for(const pin of [P.mock_usdt,P.mock_usdt_vault,P.margin,P.aquarius_pool]){
   const entry=await this.server.getContractData(pin.address,xdr.ScVal.scvLedgerKeyContractInstance()),executable=entry.val.contractData().val().instance().executable();
   if(executable.switch().name!=='contractExecutableWasm'||executable.wasmHash().toString('hex')!==pin.wasmHash)return fail('PERIDOT_CODE_CHANGED');
   const code=await this.server.getLedgerEntries(xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({hash:Buffer.from(pin.wasmHash,'hex')})));
   if(code.entries.length!==1||createHash('sha256').update(code.entries[0]!.val.contractCode().code()).digest('hex')!==pin.wasmHash)return fail('PERIDOT_CODE_BYTES_CHANGED');
  }
 }
 async view(owner:string,contract:string,method:string,args:xdr.ScVal[]=[]):Promise<{value:unknown;ledger:number}>{
  const tx=new TransactionBuilder(await this.server.getAccount(owner),{fee:'100',networkPassphrase:NETWORK_PASSPHRASE}).addOperation(new Contract(contract).call(method,...args)).setTimeout(30).build(),sim=await this.server.simulateTransaction(tx);
  if(!rpc.Api.isSimulationSuccess(sim)||rpc.Api.isSimulationRestore(sim)||!sim.result||sim.result.auth.length||!Number.isSafeInteger(sim.latestLedger)||sim.latestLedger<=0)return fail('PERIDOT_VIEW_UNAVAILABLE');
  return{value:scValToNative(sim.result.retval),ledger:sim.latestLedger};
 }
 async snapshot(customer:CustomerContext,positionId:string|null=null,allowRemovedPosition=false):Promise<CustomerSnapshot>{
  await this.verifyPins();const owner=new Address(customer.walletAddress).toScVal();
  const [underlying,receipt,margin,position,debt]=await Promise.all([
   this.view(customer.walletAddress,P.mock_usdt.address,'balance',[owner]),
   this.view(customer.walletAddress,P.mock_usdt_vault.address,'balance',[owner]),
   this.view(customer.walletAddress,P.margin.address,'get_margin_balance_ptokens',[owner,new Address(P.mock_usdt.address).toScVal()]),
   positionId===null?Promise.resolve(null):this.positionSnapshot(customer,positionId,allowRemovedPosition),
   positionId===null?Promise.resolve(null):this.view(customer.walletAddress,P.mock_usdt_vault.address,'get_margin_borrow_balance',[nativeToScVal(BigInt(positionId),{type:'u64'})]),
  ]);
  const native=await this.deps.nativeBalance(customer),now=this.now(),at=Date.parse(native.as_of),ledgers=[underlying.ledger,receipt.ledger,margin.ledger,...(position?[position.observedLedger]:[]),...(debt?[debt.ledger]:[])];
  if(native.asset_id!==XLM.id||native.source!=='stellar_horizon_testnet'||!Number.isFinite(at)||at>now+1000||now-at>15000||Math.max(...ledgers)-Math.min(...ledgers)>2)return fail('PERIDOT_SNAPSHOT_UNAVAILABLE');
  const parse=(value:string)=>/^0(?:\.0+)?$/.test(value)?'0':toAtomic(value,7).toString();
  return{walletUnderlyingAtomic:asAtomic(underlying.value),walletReceiptAtomic:asAtomic(receipt.value),marginReceiptAtomic:asAtomic(margin.value),marginDebtAtomic:debt?asAtomic(debt.value):'0',nativeWalletAtomic:parse(native.wallet_amount),nativeSpendableAtomic:parse(native.spendable),observedAt:new Date(now).toISOString(),ledger:Math.min(...ledgers),position};
 }
 async positionSnapshot(customer:CustomerContext,id:string,allowRemoved:boolean):Promise<MarginPositionSnapshot|null>{
  if(!allowRemoved)return new PeridotPositionReader(customer.walletAddress,this.server,this.now).read(customer.walletAddress,id,'long');
  const argument=nativeToScVal(unsigned(id,true),{type:'u64'}),methods=['get_position','get_perps_position','get_pending_perps_open','get_pending_perps_open_execution','get_pending_perps_close'];
  const records=await Promise.all(methods.map(method=>this.view(customer.walletAddress,P.margin.address,method,[argument])));
  if(records[0]!.value!==null)return validateMarginPositionSnapshot({walletAddress:customer.walletAddress,positionId:id,direction:'long',position:records[0]!.value,perps:records[1]!.value,pendingOpen:records[2]!.value,openExecution:records[3]!.value,pendingClose:records[4]!.value,observedLedger:Math.max(...records.map(r=>r.ledger)),observedAt:new Date(this.now()).toISOString()});
  const [debt,positions]=await Promise.all([this.view(customer.walletAddress,P.mock_usdt_vault.address,'get_margin_borrow_balance',[argument]),this.view(customer.walletAddress,P.margin.address,'get_user_positions',[new Address(customer.walletAddress).toScVal()])]);
  const ledgers=[...records.map(r=>r.ledger),debt.ledger,positions.ledger];
  if(records.some(r=>r.value!==null)||debt.value!==0n||!Array.isArray(positions.value)||positions.value.some(value=>typeof value!=='bigint'||value===BigInt(id))||Math.max(...ledgers)-Math.min(...ledgers)>2)return invalid('REMOVED_POSITION_NOT_INDEPENDENTLY_VERIFIED');
  return null;
 }
 async confirmed(hash:string,customer:CustomerContext):Promise<ConfirmedPeridotTransaction>{
  if(!/^[a-f0-9]{64}$/.test(hash))return invalid('CHAIN_HASH');
  if((await this.server.getNetwork()).passphrase!==NETWORK_PASSPHRASE)return fail('NETWORK_MISMATCH');
  const tx=await this.server.getTransaction(hash);if(tx.status!=='SUCCESS'||tx.feeBump)return fail('PERIDOT_TRANSACTION_NOT_CONFIRMED');
  const parsed=TransactionBuilder.fromXDR(tx.envelopeXdr.toXDR('base64'),NETWORK_PASSPHRASE);
  if(!(parsed instanceof Transaction)||parsed.source!==customer.walletAddress||parsed.hash().toString('hex')!==hash)return invalid('CONFIRMED_ENVELOPE');
  const horizon=await this.deps.horizonTransaction(hash),fee=unsigned(tx.resultXdr.feeCharged().toString(),true);
  if(!horizon.successful||horizon.hash!==hash||horizon.source_account!==customer.walletAddress||horizon.ledger_attr!==tx.ledger||unsigned(String(horizon.fee_charged),true)!==fee)return invalid('CONFIRMED_HORIZON_OR_FEE');
  const timestamp:unknown=tx.createdAt,createdAt=typeof timestamp==='string'&&/^[1-9]\d{0,10}$/.test(timestamp)?Number(timestamp):timestamp;
  if(typeof createdAt!=='number'||!Number.isSafeInteger(createdAt)||createdAt<=0)return invalid('CONFIRMED_TIMESTAMP');
  return{hash,ledger:tx.ledger,createdAt,feeAtomic:fee.toString(),meta:tx.resultMetaXdr,returnValue:tx.returnValue,transaction:parsed};
 }
}
