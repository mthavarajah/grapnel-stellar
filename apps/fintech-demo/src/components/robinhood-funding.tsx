"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {useCreateWallet} from '@privy-io/react-auth';
export type RobinhoodFundingSnapshot={funding:{chainId:number;asset:{symbol:string;address:string;decimals:number};faucetUrl:string;gasFaucetUrl:string};accounts:{address:string}[];selectedAddress:string|null;balances:{USDG:string|null;ETH:string|null};balanceStatus:'ready'|'unavailable'|'no_account';observedAt:string|null};
export type RobinhoodFundingProps={api:(path:string)=>Promise<unknown>;onAccountSelected?:(address:string|null)=>void;};
const USDG='0x7e955252e15c84f5768b83c41a71f9eba181802f';
const FAUCET='https://faucet.paxos.com/?token=USDG&network=ROBINHOOD';
const GAS='https://faucet.testnet.chain.robinhood.com/';
function inspect(value:unknown):RobinhoodFundingSnapshot{
 const s=value as RobinhoodFundingSnapshot;
 if(!s||s.funding?.chainId!==46630||s.funding.asset?.address?.toLowerCase()!==USDG||s.funding.asset.symbol!=='USDG'||s.funding.asset.decimals!==6||!Array.isArray(s.accounts)||s.accounts.some(a=>!/^0x[0-9a-f]{40}$/i.test(a.address))||s.selectedAddress!==null&&!s.accounts.some(a=>a.address.toLowerCase()===s.selectedAddress!.toLowerCase())||!s.balances||Object.values(s.balances).some(v=>v!==null&&!/^\d+(?:\.\d+)?$/.test(v))||!['ready','unavailable','no_account'].includes(s.balanceStatus))throw Error('Wallet details could not be verified. Refresh to try again.');
 return s;
}
export function formatStockFundingBalance(value:string|null,decimals:number):string{
 if(value===null)return '—';const [whole='0',fraction='']=value.split('.');const tail=fraction.slice(0,decimals).replace(/0+$/,'');
 if(!/[1-9]/.test(whole)&&!/[1-9]/.test(tail)&&/[1-9]/.test(fraction))return '<0.'+'0'.repeat(decimals-1)+'1';
 return whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(tail?'.'+tail:'');
}
/** Wallet creation only occurs after the customer clicks Enable stocks. */
export function RobinhoodFunding(props:RobinhoodFundingProps){const{createWallet}=useCreateWallet();return <RobinhoodFundingCard {...props} onCreateWallet={()=>createWallet()}/>;}
export function RobinhoodFundingCard({api,onAccountSelected,onCreateWallet,initialData=null}:RobinhoodFundingProps&{onCreateWallet:()=>Promise<unknown>;initialData?:RobinhoodFundingSnapshot|null}){
 const[data,setData]=useState<RobinhoodFundingSnapshot|null>(initialData),[loading,setLoading]=useState(!initialData),[creating,setCreating]=useState(false),[error,setError]=useState(''),[copied,setCopied]=useState(false);
 const sequence=useRef(0),alive=useRef(true);const onSelected=useRef(onAccountSelected);onSelected.current=onAccountSelected;
 const refresh=useCallback(async(address?:string)=>{const current=++sequence.current;setLoading(true);setError('');try{const s=inspect(await api('grapnel/stocks-funding'+(address?'?account_address='+encodeURIComponent(address):'')));if(alive.current&&current===sequence.current){setData(s);setCopied(false);onSelected.current?.(s.selectedAddress);}}catch{if(alive.current&&current===sequence.current){setData(null);onSelected.current?.(null);setError('Wallet details are unavailable. Refresh to try again.');}}finally{if(alive.current&&current===sequence.current)setLoading(false);}},[api]);
 useEffect(()=>{alive.current=true;void refresh();return()=>{alive.current=false;sequence.current++;};},[refresh]);
 const create=async()=>{if(creating)return;setCreating(true);setError('');try{await onCreateWallet();if(alive.current)await refresh();}catch{if(alive.current)setError('Stocks setup could not be completed. Try again.');}finally{if(alive.current)setCreating(false);}};
 const copy=async()=>{if(!data?.selectedAddress)return;try{await navigator.clipboard.writeText(data.selectedAddress);setCopied(true);}catch{setError('Copy the wallet address shown below.');}};
 return <section className="card" aria-label="Stock funds"><div className="flex items-center justify-between gap-3"><h3>Stock funds</h3><button type="button" onClick={()=>void refresh(data?.selectedAddress??undefined)} disabled={loading||creating}>{loading?'Refreshing…':'Refresh'}</button></div>
 {data?.accounts.length?<>{data.accounts.length>1&&<label>Funding account<select aria-label="Funding account" value={data.selectedAddress??''} disabled={loading||creating} onChange={e=>void refresh(e.target.value)}>{data.accounts.map((a,index)=><option key={a.address} value={a.address}>Account {index+1}</option>)}</select></label>}
 <div className="grid grid-cols-2 gap-3 my-3"><div><span>USDG</span><strong className="block">{formatStockFundingBalance(data.balances.USDG,2)}</strong></div><div><span>ETH for fees</span><strong className="block">{formatStockFundingBalance(data.balances.ETH,6)}</strong></div></div>
 <details className="my-3"><summary>Funding details</summary><p className="break-all text-sm">{data.selectedAddress}</p><button type="button" onClick={()=>void copy()} disabled={!data.selectedAddress}>{copied?'Copied':'Copy funding address'}</button></details><div className="flex flex-wrap gap-2"><a className="button" href={FAUCET} target="_blank" rel="noopener noreferrer">Get USDG</a><a className="button" href={GAS} target="_blank" rel="noopener noreferrer">Get gas ETH</a></div>{data.balanceStatus==='unavailable'&&<p role="status">Balances are unavailable. Refresh to try again.</p>}</>:!loading&&data?.accounts.length===0&&<button type="button" onClick={()=>void create()} disabled={creating}>{creating?'Creating…':'Enable stocks'}</button>}
 {loading&&<p role="status">Checking balances…</p>}{error&&<p role="alert">{error}</p>}</section>;
}
