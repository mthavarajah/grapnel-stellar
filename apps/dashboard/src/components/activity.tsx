"use client";
import { useCallback, useEffect, useState } from "react";
import { formatTokenAmount } from "@grapnel/contracts";
export type ActivityRow = {
 operation_id:string; customer_id:string; external_customer_id:string;
 wallet_address:string; action:string; status:string; provider:string; tx_hash:string;
 created_at:string; updated_at:string; amount:string|null; asset_id:string|null;
};
type Cursor = {before:string;before_id:string};
type Page = {activities:ActivityRow[];next_cursor:Cursor|null};
const actions:Record<string,string>={
 "funding.fund":"Funds received","funding.return":"Funds returned",
 "testnet.fund":"Funds received","testnet.return":"Funds returned",
 "spot.swap":"Crypto swap","blend.supply":"Lending deposit","blend.withdraw":"Lending withdrawal",
 "blend.borrow":"Borrow","blend.repay":"Repayment","blend.supply_collateral":"Collateral deposit",
 "blend.withdraw_collateral":"Collateral withdrawal","zenex.open":"Open perpetual position",
 "zenex.close":"Close perpetual position","zenex.cancel":"Cancel perpetual order",
 "zenex.faucet":"Trading funds received","zenex.trustline":"Enable trading USDC",
 "wallet.usdc_trustline":"Enable USDC","wallet.payment":"Payment",
};
const title=(action:string)=>actions[action]??action.replace(/[._]/g," ").replace(/^./,c=>c.toUpperCase());
const short=(value:string)=>value.length>20?`${value.slice(0,8)}…${value.slice(-6)}`:value;
export function ActivityTable({activities}:{activities:ActivityRow[]}) {
 return <div className="table-scroll"><table className="customer-amount-table"><thead><tr>
  <th>Activity</th><th>Customer</th><th>Amount</th><th>Status</th><th>Date</th><th>Transaction</th>
 </tr></thead><tbody>{activities.map(row=><tr key={row.operation_id}>
  <td><strong>{title(row.action)}</strong><small>{row.provider}</small></td>
  <td><strong title={row.external_customer_id}>{row.external_customer_id}</strong><small title={row.customer_id}>Customer {short(row.customer_id)}</small><small title={row.wallet_address}>{short(row.wallet_address)}</small></td>
  <td>{row.amount&&/^\d+(\.\d+)?$/.test(row.amount)?`${formatTokenAmount(row.amount,6)} ${row.asset_id==='stellar-testnet:native:XLM'?'XLM':/^stellar-testnet:classic:([^:]+):/.exec(row.asset_id??'')?.[1]??''}`:'—'}</td>
  <td><span className={`activity-status ${row.status==='completed'?'is-completed':row.status==='failed'||row.status==='rejected'?'is-failed':''}`}>{row.status.replace(/_/g,' ')}</span></td>
  <td>{new Date(row.created_at).toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})}</td>
  <td>{/^[a-fA-F0-9]{64}$/.test(row.tx_hash)?<a className="text-link" href={`https://stellar.expert/explorer/testnet/tx/${row.tx_hash}`} target="_blank" rel="noopener noreferrer" title={row.tx_hash}>{short(row.tx_hash)} ↗</a>:'—'}</td>
 </tr>)}</tbody></table></div>;
}
export default function Activity({api}:{api:(path:string,init?:RequestInit)=>Promise<any>}) {
 const [rows,setRows]=useState<ActivityRow[]>([]),[cursor,setCursor]=useState<Cursor|null>(null);
 const [loading,setLoading]=useState(true),[more,setMore]=useState(false),[error,setError]=useState('');
 const load=useCallback(async(signal:AbortSignal)=>{try{const page:Page=await api('activity',{signal});if(signal.aborted)return;setRows(page.activities);setCursor(page.next_cursor);setError('');}catch(e){if(!signal.aborted)setError(e instanceof Error?e.message:'Transactions could not be loaded');}finally{if(!signal.aborted)setLoading(false);}},[api]);
 useEffect(()=>{const controller=new AbortController();void load(controller.signal);return()=>controller.abort();},[load]);
 async function older(){if(!cursor||more)return;setMore(true);setError('');try{const page:Page=await api('activity?'+new URLSearchParams(cursor));setRows(current=>{const ids=new Set(current.map(r=>r.operation_id));return [...current,...page.activities.filter(r=>!ids.has(r.operation_id))];});setCursor(page.next_cursor);}catch(e){setError(e instanceof Error?e.message:'Transactions could not be loaded');}finally{setMore(false);}}
 return <section className="panel table-panel"><div className="panel-heading"><h2>Stellar transactions</h2><span className="count">{rows.length}</span></div>
 {error&&<div role="alert" className="customer-read-error">{error}<button className="secondary" onClick={()=>void load(new AbortController().signal)}>Try again</button></div>}
 {loading?<div className="loading">Loading transactions<span/></div>:rows.length?<ActivityTable activities={rows}/>:!error?<div className="customer-empty"><h3>No Stellar transactions yet</h3><p>Customer transactions submitted through Grapnel will appear here.</p></div>:null}
 {cursor&&<div className="activity-pagination"><button className="secondary activity-load-more" disabled={more} aria-busy={more} onClick={()=>void older()}>
  <svg className={more?'activity-page-spinner':undefined} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{more?<path d="M21 12a9 9 0 1 1-9-9"/>:<path d="m6 9 6 6 6-6"/>}</svg>
  {more?'Loading…':'Load more'}
 </button></div>}
 </section>;
}
