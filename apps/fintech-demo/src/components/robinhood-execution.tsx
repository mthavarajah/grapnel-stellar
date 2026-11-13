"use client";
import { useEffect, useRef, useState,type ReactNode } from 'react';
import {executeStockTrade} from '../lib/stock-action-flow';
import {reportStockSigningFailure} from '../lib/stock-signing-diagnostic';
import {ClientError} from '../lib/client';
import {ActionDialog} from './action-dialog';
import {RobinhoodFunding} from './robinhood-funding';
import { useCreateWallet, useSignTransaction, useWallets } from '@privy-io/react-auth';
import { formatTokenAmount, fromAtomic, toAtomic } from '@grapnel/contracts';
import { ProgressIndicator } from './operation-progress';
import { inspectRobinhoodStatus, inspectRobinhoodRecord, inspectRobinhoodApproval, signRobinhoodApproval, robinhoodMarketSymbol, robinhoodRequestDraft, robinhoodRequestLabel, type RobinhoodStatus, type RobinhoodRequest, type RobinhoodScope, type RobinhoodDraft, type RobinhoodSymbol, type RobinhoodProvider, type RobinhoodSigner } from '../lib/robinhood-customer';
import type { PerpetualApi } from '../lib/perpetual-approval';
export type RobinhoodExecutionProps = {
    api: PerpetualApi;
    customerId: string;
    walletId: string;
    symbol: RobinhoodSymbol;
};
export type RobinhoodCustomerWallet = {
    address: string;
    provider: () => Promise<RobinhoodProvider>;
    sign: RobinhoodSigner;
    switchNetwork: () => Promise<void>;
};
export type RobinhoodExecutionCardProps = RobinhoodExecutionProps & {
    wallet: RobinhoodCustomerWallet | null;
    walletsReady: boolean;
    onCreate: () => Promise<unknown>;
    funding?:ReactNode;
};
const terminal = new Set(['completed', 'cancelled', 'reverted']);
const display = (v: string | null | undefined) => v == null ? '—' : formatTokenAmount(v);
const safeError = (cause: unknown) => { const message = cause instanceof Error ? cause.message : 'This request could not be completed.'; return /private|secret|Privy|provider|[A-Z]+(?:_[A-Z0-9]+)+/.test(message) ? 'This action is unavailable. Check its status before trying again.' : message; };
export function stockBalanceAtomic(value:string,decimals:number):bigint{return /^0+(?:\.0+)?$/.test(value)?0n:toAtomic(value,decimals);}
export function stockAmountFeedback(value:string,side:'buy'|'sell',symbol:string,balance:string|null|undefined,feeBalance:string|null|undefined):string|null{try{const decimals=side==='buy'?6:18,n=stockBalanceAtomic(value,decimals),cap=side==='buy'?20000000n:10n*10n**18n,asset=side==='buy'?'USDG':symbol;if(n<=0n)return 'Enter an amount greater than zero.';if(n>cap)return `Maximum per order: ${side==='buy'?'20 USDG':'10 '+symbol}.`;if(balance==null)return 'Your balance is updating.';if(n>stockBalanceAtomic(balance,decimals))return `Available: ${display(balance)} ${asset}.`;if(feeBalance==null)return 'Checking your fee balance.';if(stockBalanceAtomic(feeBalance,18)<=0n)return 'Get stock funds above to cover transaction fees.';return null;}catch{return 'Enter a valid amount.';}}
export function stockTradeInput(value:string,side:'buy'|'sell',symbol:string,balance:string|null|undefined,allowance:string|null|undefined,feeBalance:string|null|undefined){let feedback=stockAmountFeedback(value,side,symbol,balance,feeBalance);if(!feedback&&allowance==null)feedback='Your spending approval is updating.';try{const decimals=side==='buy'?6:18,n=stockBalanceAtomic(value,decimals),approved=allowance==null?null:stockBalanceAtomic(allowance,decimals);return{valid:feedback===null,needsApproval:feedback===null&&approved!==null&&n>approved,feedback};}catch{return{valid:false,needsApproval:false,feedback:'Enter a valid amount.'};}}
/** Uses only the currently authenticated embedded wallet; rendering never creates or signs. */
export function RobinhoodExecution(props: RobinhoodExecutionProps) { const { wallets, ready } = useWallets(), { createWallet } = useCreateWallet(), { signTransaction } = useSignTransaction(), selected = wallets.find(w => w.walletClientType === 'privy'); const wallet: RobinhoodCustomerWallet | null = selected ? { address: selected.address, provider: async () => { const p = await selected.getEthereumProvider(); return { request: input => p.request(input as Parameters<typeof p.request>[0]) }; }, sign: async (input) => (await signTransaction(input, { address: selected.address,uiOptions:{showWalletUIs:false} })).signature, switchNetwork: async () => { await selected.switchChain(46630); } } : null; return <RobinhoodExecutionCard {...props} wallet={wallet} walletsReady={ready} onCreate={() => createWallet()} funding={wallet?<RobinhoodFunding api={props.api} customerId={props.customerId} walletId={props.walletId} compact/>:null}/>; }
export function RobinhoodExecutionCard({ api, customerId, walletId, symbol, wallet, walletsReady, onCreate,funding }: RobinhoodExecutionCardProps) {
    const [snapshot, setSnapshot] = useState<RobinhoodStatus | null>(null), [record, setRecord] = useState<RobinhoodRequest | null>(null), [draft, setDraft] = useState<RobinhoodDraft | null>(null), [side, setSide] = useState<'buy' | 'sell'>('buy'), [amount, setAmount] = useState('1'), [loading, setLoading] = useState(true), [busy, setBusy] = useState<string | null>(null), [error, setError] = useState(''), [connectionNote,setConnectionNote]=useState(''), [uncertain, setUncertain] = useState(false), [dialogOpen,setDialogOpen]=useState(false), [clock, setClock] = useState(Date.now()), [attempted, setAttempted] = useState<Set<string>>(new Set());
    const account = wallet?.address ?? '', identity = `${customerId}:${walletId}:${account.toLowerCase()}`, ownerKey = `${identity}:${symbol}`, ownership = useRef({ key: ownerKey, epoch: 0 });
    if (ownership.current.key !== ownerKey)
        ownership.current = { key: ownerKey, epoch: ownership.current.epoch + 1 };
    const owner = `${ownerKey}:${ownership.current.epoch}`, ownerRef = useRef(owner);
    ownerRef.current = owner;
    const tenant = useRef<{
        identity: string;
        businessId: string;
    } | null>(null), active = useRef(false), pollingRead=useRef(false), preparationKey = useRef<string | null>(null), attempts = useRef(new Set<string>()), recordRef = useRef<RobinhoodRequest | null>(record);
    recordRef.current = record;
    const scope = (): RobinhoodScope => ({ customerId, walletId, businessId: tenant.current?.identity === identity ? tenant.current.businessId : undefined });
    const reviewedScope = () => { const s = scope(); if (!s.businessId)
        throw Error('Refresh the stock account before reviewing.'); return s; };
    const guard = (captured: string) => { if (ownerRef.current !== captured)
        throw Error('Your account or stock changed. Review the current request again.'); };
    const markAttempt = (id: string) => { attempts.current.add(id); setAttempted(new Set(attempts.current)); try {
        sessionStorage.setItem('grapnel:stock-signed:' + identity, JSON.stringify([...attempts.current].slice(-20)));
    }
    catch { /* The server retains the authoritative one-use send claim. */ } };
    const refresh = async (captured = owner) => { const status = inspectRobinhoodStatus(await api(`grapnel/stocks-status?market_id=robinhood-testnet:stocks:${symbol}` + (account ? '&account_address=' + encodeURIComponent(account) : '')), scope(), account || null, symbol); guard(captured); tenant.current = { identity, businessId: status.scope.business_id }; setSnapshot(status);setConnectionNote(''); return status; };
    const accept = (value: unknown, captured: string, id?: string) => { const checked = inspectRobinhoodRecord(value, reviewedScope(), account, undefined, id); guard(captured); setRecord(checked.state==='cancelled'&&!checked.tx_hash?null:checked); setUncertain(false);if(terminal.has(checked.state))window.dispatchEvent(new Event('grapnel:stocks-updated')); return checked; };
    const recover = async (captured = owner, id?: string) => { await refresh(captured); if (!account)
        return; const value = await api('grapnel/stocks-request' + (id ? '?request_id=' + encodeURIComponent(id) : '')); guard(captured); if (value) {
        accept(value, captured, id);
    }
    else {
        setRecord(null);
        setUncertain(false);
    } return value; };
    const run = async (task: (captured: string) => Promise<void>, label = 'Processing') => { if (active.current)
        return; active.current = true; const captured = owner; setBusy(label); setError(''); try {
        await task(captured);
    }
    catch (cause) {
        reportStockSigningFailure('execution',cause);
        if (ownerRef.current === captured){
            const retained=recordRef.current,ambiguous=retained&&attempts.current.has(retained.id)&&!terminal.has(retained.state)&&(!(cause instanceof ClientError)||cause.status>=500||cause.status===408);
            if(ambiguous)setUncertain(true);else setError(safeError(cause));
        }
    }
    finally {
        active.current = false;
        if (ownerRef.current === captured)
            setBusy(null);
    } };
    useEffect(() => { let alive = true; const captured = owner; ownerRef.current = owner; setDialogOpen(false); setSnapshot(null); setRecord(null); setDraft(null); setLoading(true); setError(''); setUncertain(false); setBusy(null); preparationKey.current = null; try {
        const ids = JSON.parse(sessionStorage.getItem('grapnel:stock-signed:' + identity) ?? '[]');
        attempts.current = new Set(Array.isArray(ids) ? ids.filter((v: unknown) => typeof v === 'string') : []);
    }
    catch {
        attempts.current = new Set();
    } setAttempted(new Set(attempts.current)); void recover(captured).catch(cause => { if (alive && ownerRef.current === captured) {
        if(cause instanceof ClientError&&cause.status<500&&cause.status!==429)setError(safeError(cause));else setConnectionNote('Reconnecting to your account…');
        setUncertain(!!account);
    } }).finally(() => { if (alive && ownerRef.current === captured)
        setLoading(false); }); return () => { alive = false; if (ownerRef.current === captured)
        ownerRef.current = 'disposed:' + captured; }; }, [owner]);
    useEffect(()=>{const captured=owner,updated=()=>{if(active.current)return;void refresh(captured).catch(()=>{});};window.addEventListener('grapnel:stocks-updated',updated);return()=>window.removeEventListener('grapnel:stocks-updated',updated);},[owner]);
    useEffect(() => { if (!account || !uncertain && (!record || terminal.has(record.state)))
        return; const captured = owner; const timer = setInterval(() => { if (active.current||pollingRead.current)
        return; pollingRead.current=true;void (async()=>{try{guard(captured);if(!scope().businessId)await refresh(captured);const id=recordRef.current?.id;const value=await api('grapnel/stocks-request'+(id?'?request_id='+encodeURIComponent(id):''));guard(captured);if(active.current)return;if(value)accept(value,captured,id);else{setRecord(null);setUncertain(false);}void refresh(captured).catch(()=>{});}catch{/* Keep checking the retained request; transient reads are not execution errors. */}finally{pollingRead.current=false;}})(); }, 2500); return () => clearInterval(timer); }, [owner, account, uncertain, record?.id, record?.state]);
    useEffect(() => { if (!record||terminal.has(record.state))
        return; const timer = setInterval(() => setClock(Date.now()), 500); return () => clearInterval(timer); }, [record?.id,record?.state]);
    const foreign = !!record && record.market_id !== `robinhood-testnet:stocks:${symbol}`, pending = !!record && !terminal.has(record.state), ready = !!wallet && !!snapshot?.execution_available && !loading, expired = !!record && Date.parse(record.expires_at) <= clock;
    const balance = side === 'buy' ? snapshot?.settlement_balance : snapshot?.stock_balance, allowance = side === 'buy' ? snapshot?.settlement_allowance : snapshot?.stock_allowance, source = side === 'buy' ? 'USDG' : symbol, output = side === 'buy' ? symbol : 'USDG';
    const {valid,needsApproval,feedback:amountFeedback}=stockTradeInput(amount,side,symbol,balance,allowance,snapshot?.native_balance);
    const prepareExact=async(input:RobinhoodDraft,captured:string)=>{
      preparationKey.current??=crypto.randomUUID();setDraft(input);setUncertain(true);setBusy(input.kind==='approval'?'Preparing approval':'Preparing trade');
      const value=await api('grapnel/stocks-prepare',{account_address:account,kind:input.kind,market_id:`robinhood-testnet:stocks:${symbol}`,side:input.side,amount:input.amount,slippage_bps:input.slippageBps},'POST',preparationKey.current);
      guard(captured);const checked=inspectRobinhoodApproval(value,reviewedScope(),account,input);setRecord(checked);setUncertain(false);preparationKey.current=null;return checked;
    };
    const tradePorts=(captured:string)=>({prepare:(value:RobinhoodDraft)=>prepareExact(value,captured),authorize:(value:RobinhoodRequest,d:RobinhoodDraft)=>authorizePrepared(value,d,captured),read:async(id:string)=>accept(await api('grapnel/stocks-request?request_id='+encodeURIComponent(id)),captured,id),approvalConfirmed:(value:RobinhoodRequest)=>value.kind==='approval'&&robinhoodRequestLabel(value)==='Approved',current:()=>guard(captured),waiting:()=>setBusy('Confirming approval'),wait:()=>new Promise<void>(resolve=>setTimeout(resolve,1500))});
    const prepare=()=>run(async captured=>{
      if(!ready||!valid||pending||uncertain||foreign)throw Error('Check the current balance and transaction status first.');
      setDialogOpen(true);setRecord(null);setBusy('Connecting wallet');if(!wallet)throw Error('Connect your wallet first.');try{await wallet.switchNetwork();}catch(cause){reportStockSigningFailure('network',cause);throw cause;}guard(captured);const input:RobinhoodDraft={symbol,side,amount,kind:needsApproval?'approval':'swap',slippageBps:50};
      await executeStockTrade(input,tradePorts(captured));
    },'Preparing trade');
    const resume = () => run(async (captured) => { if (!record || foreign || attempts.current.has(record.id))
        throw Error('Check this transaction’s status before another approval.'); setDialogOpen(true);if(!wallet)throw Error('Connect your wallet first.');setBusy('Connecting wallet');await wallet.switchNetwork();guard(captured); const value = await api('grapnel/stocks-request?request_id=' + record.id); guard(captured); const checked = inspectRobinhoodRecord(value, reviewedScope(), account, symbol, record.id), input = robinhoodRequestDraft(checked); inspectRobinhoodApproval(checked, reviewedScope(), account, input); guard(captured); setRecord(checked); setDraft(input); setUncertain(false); await executeStockTrade(input,tradePorts(captured),checked); });
    const authorizePrepared = async (prepared:RobinhoodRequest,input:RobinhoodDraft,captured:string) => { if(!wallet||attempts.current.has(prepared.id))throw Error('Check this transaction’s status before approving again.'); const checked = inspectRobinhoodApproval(prepared, reviewedScope(), account, input); setBusy('Authorizing'); guard(captured); let provider:RobinhoodProvider;try{provider=await wallet.provider();}catch(cause){reportStockSigningFailure('provider',cause);throw cause;} guard(captured); let signed:`0x${string}`,signerCalled=false,signatureReturned=false;try{signed=await signRobinhoodApproval(checked, reviewedScope(), account, input, provider, async tx=>{signerCalled=true;const raw=await wallet.sign(tx);signatureReturned=true;return raw;}, () => ownerRef.current === captured);}catch(cause){reportStockSigningFailure(signatureReturned?'execution':signerCalled?'signing':'provider',cause);throw cause;} guard(captured); markAttempt(checked.id); setBusy('Submitting'); setUncertain(true); const value = await api('grapnel/stocks-authorize', { request_id: checked.id, signed_transaction: signed }, 'POST', crypto.randomUUID()); guard(captured); const result=accept(value, captured, checked.id); await refresh(captured).catch(()=>{guard(captured);}); return result; };
    const check = () => run(async (captured) => { await recover(captured, record?.id); });
    const label = record ? robinhoodRequestLabel(record) : '', completed = label === 'Approved' || /^(Bought|Sold) /.test(label);
    const progressLabel=error&&!busy?'Action needs attention':busy??(record?.state==='prepared'?(attempted.has(record.id)?'Checking submission':'Waiting for wallet'):label==='Approved'?'Spending approval confirmed':label);
    return <section className="market-order-card" aria-label="Stock trading" data-testid="robinhood-execution" aria-busy={!!busy || loading}>
  <h2>Trade {symbol}</h2>
  {!walletsReady ? <ProgressIndicator label="Loading account" spinning/> : !wallet ? <button type="button" className="button outline wide" disabled={!!busy} onClick={() => run(async (captured) => { await onCreate(); guard(captured); }, 'Creating account')}>Enable stocks</button> : null}
  <div className="stock-balance-status">{(loading&&walletsReady&&wallet||connectionNote)&&<ProgressIndicator label={connectionNote||"Loading balances"} spinning/>}</div>
  <div className="public-order-direction stock-order-sides" role="group" aria-label="Trade direction"><button type="button" className="stock-side-buy" aria-pressed={side === 'buy'} disabled={loading || !!busy || pending || uncertain} onClick={() => setSide('buy')}>Buy</button><button type="button" className="stock-side-sell" aria-pressed={side === 'sell'} disabled={loading || !!busy || pending || uncertain} onClick={() => setSide('sell')}>Sell</button></div>
  <div className="detail-row"><span>Amount ({source})</span><button type="button" className="text-button" disabled={!!busy||pending||uncertain||!balance} onClick={()=>{if(!balance)return;try{const decimals=side==='buy'?6:18,n=stockBalanceAtomic(balance,decimals),cap=side==='buy'?20000000n:10n*10n**18n;setAmount(fromAtomic(n<cap?n:cap,decimals));}catch{setError('Your available balance is updating.');}}}>Max</button></div>
  <label className="sr-only">Amount ({source})</label><label><input aria-label="Stock trade amount" inputMode="decimal" value={amount} disabled={loading || !!busy || pending || uncertain} onChange={event => setAmount(event.target.value)}/></label>
  <div className="detail-row"><span>Available {source}</span><strong>{display(balance)} {source}</strong></div>
  <div className="detail-row"><span>{side === 'buy' ? symbol : 'USDG'} balance</span><strong>{display(side === 'buy' ? snapshot?.stock_balance : snapshot?.settlement_balance)} {output}</strong></div>
  <p className="small muted">ETH for fees: {display(snapshot?.native_balance)}</p><button type="button" className="button wide" disabled={!!busy || !ready || !valid || pending || uncertain || foreign} onClick={prepare}>{side==='buy'?'Buy '+symbol:'Sell '+symbol}</button>
  {!loading&&!busy&&!pending&&!uncertain&&!dialogOpen&&amountFeedback&&<p className={/updating|Checking/.test(amountFeedback)?"small muted":"swap-action-error"} role="status">{amountFeedback}</p>}
  {funding}
  {needsApproval && valid && !pending && <p className="small muted">A spending approval is included with this trade.</p>}
  {wallet && snapshot && !snapshot.execution_available && !loading && <p className="small muted" role="status">Trading for this stock is being verified.</p>}
  {foreign && record && <p className="small muted" role="status">Select {robinhoodMarketSymbol(record.market_id)} to finish the pending request.</p>}
  {dialogOpen&&<ActionDialog title={record?.state==='reverted'?'Transaction failed':completed&&record?.kind==='swap'?label:(draft?.side??side)==='buy'?'Buy '+symbol:'Sell '+symbol} onClose={()=>setDialogOpen(false)} suspendFocus={busy==='Authorizing'}>
   {!record&&<div className="stock-modal-progress"><ProgressIndicator label={busy??(error?'Needs attention':'Preparing transaction')} spinning={!!busy}/></div>}
  {record && <div className="stock-request-result" aria-label="Stock request status"><ProgressIndicator label={progressLabel} completed={!busy&&completed&&record.kind==='swap'} spinning={!!busy||attempted.has(record.id)&&!terminal.has(record.state)||['sending', 'confirming', 'unknown'].includes(record.state)}/>{record.tx_hash && <a className="text-button" href={'https://explorer.testnet.chain.robinhood.com/tx/' + record.tx_hash} target="_blank" rel="noreferrer">View transaction ↗</a>}{record.state === 'prepared' && !foreign && !attempted.has(record.id) && <button type="button" className="button outline" disabled={!!busy || !ready || expired} onClick={resume}>Retry</button>}{terminal.has(record.state) && <button type="button" className="text-button" disabled={!!busy} onClick={() => { setDialogOpen(false); setRecord(null); setDraft(null); setUncertain(false); preparationKey.current = null; }}>New request</button>}</div>}
   {busy==='Authorizing'&&<p className="small muted" role="status">Authorizing this transaction with your connected wallet.</p>}
   {error&&!busy&&<p className="swap-action-error" role="alert">{error}</p>}
   {!busy&&(!record||uncertain)&&<button type="button" className="button outline wide" onClick={check}>Check status</button>}
  </ActionDialog>}
  {!dialogOpen&&<div className="stock-ticket-status" aria-live="polite">{busy?<ProgressIndicator label={busy} spinning/>:record?<><ProgressIndicator label={progressLabel} completed={completed&&record.kind==='swap'} spinning={attempted.has(record.id)&&!terminal.has(record.state)||['sending','confirming','unknown'].includes(record.state)}/><button type="button" className="text-button" onClick={()=>setDialogOpen(true)}>View transaction</button>{record.state==='prepared'&&!foreign&&!attempted.has(record.id)&&<button type="button" className="text-button" disabled={!ready||expired} onClick={resume}>Retry</button>}{terminal.has(record.state)&&<button type="button" className="text-button" onClick={()=>{setRecord(null);setDraft(null);setUncertain(false);preparationKey.current=null;}}>New request</button>}</>:null}</div>}
  {uncertain && <p className="small muted" role="status">Checking the existing request before another approval.</p>}
  <button type="button" className="text-button" disabled={!!busy} onClick={check}>Check status</button>
  {!dialogOpen&&error && <p className="swap-action-error" role="alert">{error}</p>}
 </section>;
}
