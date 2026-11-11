import {Address,scValToNative,xdr} from '@stellar/stellar-sdk';
import {invalid,unsigned} from './policy.js';

export interface EntryChange {before:xdr.ScVal|null;after:xdr.ScVal|null;created:boolean;removed:boolean;}
const fingerprint=(contract:string,key:xdr.ScVal)=>`${contract}:${key.toXDR('base64')}`;
/** Exact operation-local state only. Restoration is never mistaken for creation or a principal change. */
export class PeridotTransactionChanges {
 private readonly entries=new Map<string,EntryChange>();
 constructor(meta:xdr.TransactionMeta){
  const operations=meta.switch()===3?meta.v3().operations():meta.switch()===4?meta.v4().operations():null;
  if(!operations||operations.length!==1)return invalid('TRANSACTION_META_VERSION_OR_OPERATIONS');
  for(const change of operations[0]!.changes()){
   const kind=change.switch().name;
   if(kind==='ledgerEntryRemoved'){
    const key=change.removed();if(key.switch().name!=='contractData')continue;
    const data=key.contractData(),id=fingerprint(Address.fromScAddress(data.contract()).toString(),data.key()),previous=this.entries.get(id);
    if(!previous?.before||previous.after||previous.removed)return invalid('REMOVED_ENTRY_WITHOUT_STATE');previous.removed=true;continue;
   }
   if(!['ledgerEntryState','ledgerEntryCreated','ledgerEntryUpdated','ledgerEntryRestored'].includes(kind))continue;
   const entry=kind==='ledgerEntryState'?change.state():kind==='ledgerEntryCreated'?change.created():kind==='ledgerEntryUpdated'?change.updated():change.restored();
   if(entry.data().switch().name!=='contractData')continue;
   const data=entry.data().contractData();if(data.durability().name!=='persistent')continue;
   const id=fingerprint(Address.fromScAddress(data.contract()).toString(),data.key());
   const row=this.entries.get(id)??{before:null,after:null,created:false,removed:false};
   if(kind==='ledgerEntryRestored')continue;
   if(kind==='ledgerEntryState'){if(row.before||row.created||row.after)return invalid('DUPLICATE_META_STATE');row.before=data.val();}
   else{if(row.after||row.removed||kind==='ledgerEntryCreated'&&row.before)return invalid('DUPLICATE_META_UPDATE');row.after=data.val();row.created=kind==='ledgerEntryCreated';}
   this.entries.set(id,row);
  }
 }
 entry(contract:string,key:xdr.ScVal):EntryChange|null{return this.entries.get(fingerprint(contract,key))??null;}
 balance(contract:string,key:xdr.ScVal):{before:string;after:string}|null {
  const row=this.entry(contract,key);if(!row)return null;
  if(!row.after||row.removed||!row.before&&!row.created)return invalid('INCOMPLETE_BALANCE_CHANGE');
  const value=(v:xdr.ScVal)=>{const n=scValToNative(v);if(typeof n!=='bigint'||n<0n)return invalid('BALANCE_VALUE');return unsigned(n.toString()).toString();};
  return{before:row.created?'0':value(row.before!),after:value(row.after)};
 }
}
export const contractKey=(name:string,...values:xdr.ScVal[])=>xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(name),...values]);
export const addressValue=(address:string)=>new Address(address).toScVal();

/** Reformat actual committed ledger entry changes for the provider's pure state predicates.
 * This never runs a simulation or establishes success; the caller already binds RPC/Horizon SUCCESS. */
export function committedStateCheckInput(meta:xdr.TransactionMeta,ledger:number,retval=xdr.ScVal.scvVoid()):import('@stellar/stellar-sdk').rpc.Api.SimulateTransactionSuccessResponse {
 const operations=meta.switch()===3?meta.v3().operations():meta.switch()===4?meta.v4().operations():null;if(!operations||operations.length!==1)return invalid('TRANSACTION_META_VERSION_OR_OPERATIONS');
 const rows=new Map<string,{key:xdr.LedgerKey;before:xdr.LedgerEntry|null;after:xdr.LedgerEntry|null;removed:boolean;created:boolean}>();
 for(const change of operations[0]!.changes()){
  const kind=change.switch().name;
  if(kind==='ledgerEntryRemoved'){
   const key=change.removed();if(key.switch().name!=='contractData')continue;const id=key.toXDR('base64'),row=rows.get(id);if(!row?.before||row.after||row.removed)return invalid('COMMITTED_REMOVAL_STATE');row.removed=true;continue;
  }
  if(!['ledgerEntryState','ledgerEntryCreated','ledgerEntryUpdated'].includes(kind))continue;
  const entry=kind==='ledgerEntryState'?change.state():kind==='ledgerEntryCreated'?change.created():change.updated();if(entry.data().switch().name!=='contractData')continue;
  const data=entry.data().contractData(),key=xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({contract:data.contract(),key:data.key(),durability:data.durability()})),id=key.toXDR('base64'),row=rows.get(id)??{key,before:null,after:null,removed:false,created:false};
  if(kind==='ledgerEntryState'){if(row.before||row.after||row.created)return invalid('COMMITTED_DUPLICATE_STATE');row.before=entry;}else{if(row.after||row.removed||kind==='ledgerEntryCreated'&&row.before)return invalid('COMMITTED_DUPLICATE_UPDATE');row.after=entry;row.created=kind==='ledgerEntryCreated';}rows.set(id,row);
 }
 const stateChanges=[...rows.values()].filter(r=>r.after||r.removed).map(r=>({key:r.key,before:r.before,after:r.after,type:r.removed?'deleted':r.created?'created':'updated'}));
 return{latestLedger:ledger,result:{retval,auth:[]},stateChanges}as unknown as import('@stellar/stellar-sdk').rpc.Api.SimulateTransactionSuccessResponse;
}
