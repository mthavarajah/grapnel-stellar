import {z} from 'zod';
import {decimal,stable,units} from '../execution/guards.js';
import {info,snapshot,subaccounts,cash} from './reads.js';
import type {HyperliquidSolverDependencies,SolverProviderAction,SolverSignedPayload,SolverReconciliation} from './types.js';
export async function reconcileCreation(d:HyperliquidSolverDependencies,action:SolverProviderAction,p:SolverSignedPayload):Promise<SolverReconciliation>{
 const rows=await subaccounts(d,p.wallet),matches=rows.filter(row=>row.name===p.subaccountName);
 if(matches.length!==1)return{state:'unknown',reason:'VERIFIED_SUBACCOUNT_CREATION_REQUIRED'};
 return{state:'verified',reason:'SUBACCOUNT_OWNERSHIP_VERIFIED',subaccount:{network:'hyperliquid-testnet',masterAddress:p.wallet.masterAddress,subAccountAddress:matches[0]!.subAccountUser.toLowerCase() as `0x${string}`,name:p.subaccountName,observedAt:new Date(d.now?.()??Date.now()).toISOString()}};
}
const update=z.object({time:z.number().int().positive().safe(),hash:z.string().regex(/^0x[a-fA-F0-9]{64}$/),delta:z.object({type:z.string()}).passthrough()}).passthrough();
const transfer=z.object({type:z.literal('subAccountTransfer'),usdc:decimal,user:z.string().regex(/^0x[a-fA-F0-9]{40}$/),destination:z.string().regex(/^0x[a-fA-F0-9]{40}$/)}).passthrough();
export async function reconcileCash(d:HyperliquidSolverDependencies,action:SolverProviderAction,p:SolverSignedPayload):Promise<SolverReconciliation>{
 const now=d.now?.()??Date.now(),master=p.wallet.masterAddress,sub=p.wallet.subAccountAddress!,startTime=Math.min(p.before.master.time,p.before.subaccount!.time),query=(user:string)=>({type:'userNonFundingLedgerUpdates',user,startTime,endTime:Math.min(now,p.wire.expiresAfter)});
 const[masterRaw,subRaw,afterMaster,afterSub]=await Promise.all([info(d,query(master)),info(d,query(sub)),snapshot(d,master),snapshot(d,sub)]);
 const masterRows=z.array(update).max(499).parse(masterRaw),subRows=z.array(update).max(499).parse(subRaw);
 const source=action.kind==='fund'?master:sub,destination=action.kind==='fund'?sub:master,amount=BigInt(p.amountAtomic6!);
 const match=(rows:z.infer<typeof update>[])=>rows.filter(row=>{const parsed=transfer.safeParse(row.delta);return parsed.success&&parsed.data.user.toLowerCase()===source&&parsed.data.destination.toLowerCase()===destination&&units(parsed.data.usdc,6)===amount&&row.time>=action.nonce&&row.time<=p.wire.expiresAfter&&row.time<=now+1000;});
 const ma=match(masterRows),sa=match(subRows);
 // No ambiguous matching deposits or unrelated ledger activity may establish credit.
 if(ma.length!==1||sa.length!==1||ma[0]!.hash.toLowerCase()!==sa[0]!.hash.toLowerCase()||ma[0]!.time!==sa[0]!.time||new Set(masterRows.map(row=>row.hash.toLowerCase())).size!==masterRows.length||new Set(subRows.map(row=>row.hash.toLowerCase())).size!==subRows.length||masterRows.some(row=>row.time>=startTime&&row!==ma[0])||subRows.some(row=>row.time>=startTime&&row!==sa[0]))return{state:'unknown',reason:'EXACT_UNIQUE_CASH_LEDGER_EVENT_REQUIRED'};
 const delta=amount*10n**12n,masterDelta=cash(afterMaster.cashBalance)-cash(p.before.master.cashBalance),subDelta=cash(afterSub.cashBalance)-cash(p.before.subaccount!.cashBalance);
 if(masterDelta!==(action.kind==='fund'?-delta:delta)||subDelta!==(action.kind==='fund'?delta:-delta)||stable(afterMaster.positions)!==stable(p.before.master.positions)||stable(afterSub.positions)!==stable(p.before.subaccount!.positions))return{state:'unknown',reason:'ACTUAL_MASTER_AND_SUBACCOUNT_CASH_DELTA_REQUIRED'};
 return{state:'verified',reason:'ACTUAL_SCOPED_USDC_TRANSFER_VERIFIED',cash:{network:'hyperliquid-testnet',actionId:action.id,masterAddress:master,subAccountAddress:sub,direction:action.kind==='fund'?'fund':'return',amountAtomic6:amount.toString(),masterBefore:p.before.master.cashBalance,masterAfter:afterMaster.cashBalance,subaccountBefore:p.before.subaccount!.cashBalance,subaccountAfter:afterSub.cashBalance,observedAt:new Date(now).toISOString(),providerReference:ma[0]!.hash.toLowerCase()}};
}
