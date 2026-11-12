import {scValToNative,nativeToScVal,xdr} from '@stellar/stellar-sdk';
import type {CustomerContext} from '@grapnel/contracts';
import type {MarginEvidence,MarginStepContext} from '../../../modules/margin/types.js';
import {PERIDOT_MARKET_ID,PERIDOT_TESTNET_PINS as P} from '../config.js';
import type {PrivateMarginBaseline} from './bindings.js';
import type {ConfirmedPeridotTransaction,CustomerSnapshot} from './chain.js';
import {PeridotTransactionChanges,contractKey,addressValue} from './metadata.js';
import {phaseEvidenceBase} from './phase-evidence.js';
import {invalid,unsigned} from './policy.js';
import {createHash} from 'node:crypto';
const equal=(a:unknown,b:unknown)=>JSON.stringify(a,(_,v)=>typeof v==='bigint'?v.toString():v)===JSON.stringify(b,(_,v)=>typeof v==='bigint'?v.toString():v);
const n=(v:unknown)=>typeof v==='bigint'?unsigned(v.toString()):invalid('ATOMIC_CLOSE_INTEGER');
const object=(v:unknown)=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:invalid('ATOMIC_CLOSE_RECORD');
/** Actual transaction-local conservation. Uses actual mint/burn/borrow index metadata, never a guessed exchange rate. */
export function inspectCommittedAtomicClose(changes:PeridotTransactionChanges,input:{owner:string;positionId:string;position:Record<string,unknown>;perps:Record<string,unknown>;principalAtomic:string;minimumOutputAtomic:string}){
 const owner=addressValue(input.owner),id=nativeToScVal(unsigned(input.positionId,true),{type:'u64'}),entry=(contract:string,name:string,args:xdr.ScVal[]=[])=>changes.entry(contract,contractKey(name,...args));
 const values=(contract:string,name:string,args:xdr.ScVal[]=[])=>{const row=entry(contract,name,args);if(!row?.before||!row.after)return invalid('ATOMIC_REQUIRED_'+name);return{before:scValToNative(row.before),after:scValToNative(row.after)};};
 const delta=(contract:string,name:string,args:xdr.ScVal[]=[])=>{const row=changes.balance(contract,contractKey(name,...args));if(!row)return invalid('ATOMIC_REQUIRED_'+name);return unsigned(row.after)-unsigned(row.before);};
 const position=entry(P.margin.address,'Position',[id]),perps=entry(P.margin.address,'PerpsPositionData',[id]);
 if(!position?.removed||!position.before||!perps?.removed||!perps.before||!equal(scValToNative(position.before),input.position)||!equal(scValToNative(perps.before),input.perps)||input.position.owner!==input.owner||!equal(input.position.status,['Open']))return invalid('ATOMIC_OWNED_POSITION_REMOVAL');
 for(const [name,expected]of [['PositionCollateralVault',P.mock_usdt_vault.address],['PositionDebtVault',P.mock_usdt_vault.address],['PositionPositionVault',P.native_vault.address],['PositionMode',['PerpsV3']]]as const){const row=entry(P.margin.address,name,[id]);if(!row?.before||!row.removed||!equal(scValToNative(row.before),expected))return invalid('ATOMIC_MAPPING_REMOVAL');}
 const list=values(P.margin.address,'UserPositions',[owner]);if(!equal(list.before,[BigInt(input.positionId)])||!equal(list.after,[]))return invalid('ATOMIC_USER_POSITION_REMOVAL');
 const principal=values(P.mock_usdt_vault.address,'MarginBorrowPrincipal',[id]),snapshots=values(P.mock_usdt_vault.address,'MarginBorrowSnapshots',[id]),borrowed=values(P.mock_usdt_vault.address,'MarginHasBorrowed',[id]),before=object(snapshots.before),after=object(snapshots.after),expected=unsigned(input.principalAtomic,true);
 if(n(principal.before)!==expected||n(principal.after)!==0n||n(before.principal)!==expected||n(after.principal)!==0n||borrowed.before!==true||borrowed.after!==false||n(before.interest_index)<=0n||n(after.interest_index)<n(before.interest_index))return invalid('ATOMIC_CANONICAL_DEBT_RESET');
 const product=expected*n(after.interest_index);if(product>=(1n<<128n))return invalid('ATOMIC_DEBT_OVERFLOW');const debt=product/n(before.interest_index);
 if(debt<expected||delta(P.mock_usdt_vault.address,'TotalBorrowed')!==-debt)return invalid('ATOMIC_FULL_DEBT_REPAYMENT');
 const output=-delta(P.mock_usdt.address,'Balance',[addressValue(P.aquarius_pool.address)]),residual=output-debt,minted=delta(P.mock_usdt_vault.address,'Balance',[addressValue(P.margin.address)]),collateral=n(input.position.collateral_ptokens);
 const native=(recipient:string)=>{const row=values(P.native_token.address,'Balance',[addressValue(recipient)]),balance=(v:unknown)=>{const b=object(v);if(b.authorized!==true||b.clawback!==false)return invalid('ATOMIC_NATIVE_FLAGS');return n(b.amount);};return balance(row.after)-balance(row.before);};
 const nativeInput=native(P.aquarius_pool.address);
 const supply=(contract:string)=>{const row=changes.entry(contract,xdr.ScVal.scvLedgerKeyContractInstance());if(!row?.before||!row.after)return invalid('ATOMIC_SUPPLY_INSTANCE');const value=(v:xdr.ScVal)=>{if(v.switch().name!=='scvContractInstance')return invalid('ATOMIC_SUPPLY_ABI');const rows=(v.instance().storage()??[]).filter(e=>equal(scValToNative(e.key()),['TotalSupply']));if(rows.length!==1)return invalid('ATOMIC_SUPPLY_KEY');return n(scValToNative(rows[0]!.val()));};return value(row.after)-value(row.before);};
 if(output<unsigned(input.minimumOutputAtomic,true)||residual<=0n||minted<=0n||nativeInput<=0n||collateral<=0n||delta(P.native_vault.address,'Balance',[addressValue(P.margin.address)])!==-collateral||supply(P.native_vault.address)!==-collateral||delta(P.native_vault.address,'ManagedCash')!==-nativeInput||delta(P.native_vault.address,'TotalDeposited')!==-nativeInput||native(P.native_vault.address)!==-nativeInput||native(P.margin.address)!==0n||delta(P.mock_usdt.address,'Balance',[addressValue(P.margin.address)])!==0n||delta(P.mock_usdt.address,'Balance',[addressValue(P.mock_usdt_vault.address)])!==output||delta(P.mock_usdt_vault.address,'ManagedCash')!==output||delta(P.mock_usdt_vault.address,'TotalDeposited')!==residual||delta(P.margin.address,'MarginBalancePtokens',[owner,addressValue(P.mock_usdt_vault.address)])!==minted||delta(P.margin.address,'TotalMarginPtokens',[addressValue(P.mock_usdt_vault.address)])!==minted||supply(P.mock_usdt_vault.address)!==minted)return invalid('ATOMIC_COLLATERAL_REPAYMENT_CONSERVATION');
 const fee=values(P.margin.address,'UserMarginFeeIndex',[owner,addressValue(P.mock_usdt_vault.address)]);if(n(fee.before)!==n(fee.after))return invalid('ATOMIC_FEE_INDEX_CHANGE');
 return{inputAtomic:nativeInput.toString(),outputAtomic:output.toString(),repaidDebtAtomic:debt.toString(),remainingUnderlyingAtomic:residual.toString(),returnedReceiptAtomic:minted.toString()};
}
export function atomicCloseEvidence(context:MarginStepContext,baseline:PrivateMarginBaseline,confirmed:ConfirmedPeridotTransaction,after:CustomerSnapshot,customer:CustomerContext,now=Date.now()):MarginEvidence{
 const {before,changes,evidence}=phaseEvidenceBase(context,baseline,confirmed,after,customer,now);
 if(context.step!=='close_atomic'||!before.position||!before.position.perps||after.position!==null||after.marginDebtAtomic!=='0'||unsigned(before.marginDebtAtomic)<=0n)return invalid('ATOMIC_CLOSED_INDEPENDENT_STATE');
 const digest=createHash('sha256').update(JSON.stringify({position:before.position.position,perps:before.position.perps},(_,v)=>typeof v==='bigint'?v.toString():v)).digest('hex');if(baseline.helper.positionDigest!==digest)return invalid('ATOMIC_FROZEN_POSITION_DIGEST');
 const result=inspectCommittedAtomicClose(changes,{owner:customer.walletAddress,positionId:unsigned(context.workflow.positionId,true).toString(),position:before.position.position,perps:before.position.perps,principalAtomic:unsigned(baseline.helper.principalAtomic,true).toString(),minimumOutputAtomic:unsigned(context.terms.minimumOutputAtomic,true).toString()});
 if(unsigned(result.repaidDebtAtomic)<unsigned(before.marginDebtAtomic)||unsigned(after.marginReceiptAtomic)-unsigned(before.marginReceiptAtomic)!==unsigned(result.returnedReceiptAtomic))return invalid('ATOMIC_ACTUAL_DEBT_AND_RETURN');
 return{...evidence,after:{...evidence.after,position:{positionId:context.workflow.positionId!,owner:customer.walletAddress,marketId:PERIDOT_MARKET_ID,direction:'long',status:'Closed',debtAtomic:'0',swapOutputAtomic:result.outputAtomic,pendingExpiresAt:null}}};
}
