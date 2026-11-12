'use client';
import{useEffect,useRef,useState}from'react';
import{MarginCollateralFunding}from'./margin-collateral-funding';
import{MarginWorkflowPublicSchema,MarginStepQuoteSchema,fromAtomic,formatTokenAmount,type MarginWorkflowPublic,type MarginStepQuote,type AssetIdentity}from'@grapnel/contracts';
import{api,ClientError,operationRequestKey,clearOperationRequest}from'@/lib/client';
import{MARGIN_MARKET_ID,MarginBrowserInputSchema,marginStepLabels,marginPhaseLabels,marginStorageKey,type MarginReviewBinding}from'@/lib/margin-workflow';
type Binding={customer_id:string;wallet_id:string};
type Market={market_id:string;network?:string;instrument_type?:string;preparation_available?:boolean;min_leverage?:number;max_leverage?:number;directions?:string[];collateral?:AssetIdentity;reference_price?:string|null;};
type Recovery={workflow_id?:string;draft?:ReturnType<typeof MarginBrowserInputSchema.parse>;request_key?:string};
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function recoveryRead(key:string):Recovery|null{for(const storage of ['localStorage','sessionStorage']as const){try{const value=JSON.parse(window[storage].getItem(key)??'null');if(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(field=>['workflow_id','draft','request_key'].includes(field))&&(!value.workflow_id||uuid(value.workflow_id))&&(!value.request_key||uuid(value.request_key))&&(!value.draft||MarginBrowserInputSchema.safeParse(value.draft).success))return value;}catch{}}return null;}
function recoverySave(key:string,value:Recovery|null){for(const storage of ['localStorage','sessionStorage']as const){try{if(value)window[storage].setItem(key,JSON.stringify(value));else window[storage].removeItem(key);}catch{}}}
export function MarginWorkflowCard({market,session,marginVerified,walletVerified,onReviewOperation,guardReason,balances}:{market:Market;session:Binding; marginVerified:boolean;walletVerified:boolean;onReviewOperation:(id:string,owner:Binding,binding?:MarginReviewBinding)=>Promise<void>;guardReason?:string;balances:{asset_id:string;wallet_amount?:string;spendable?:string}[]}){
 const owner=`${session.customer_id}:${session.wallet_id}`,ownerRef=useRef(owner);ownerRef.current=owner;
 const key=marginStorageKey(session.customer_id,session.wallet_id),recovery=useRef<Recovery>({});
 const[workflow,setWorkflow]=useState<MarginWorkflowPublic|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[errorTarget,setErrorTarget]=useState('status'),[savedId,setSavedId]=useState<string|null>(null),[recoveringDraft,setRecoveringDraft]=useState(false),[uncertainRecovery,setUncertainRecovery]=useState(false);
 const[direction,setDirection]=useState<'long'|'short'>('long'),[leverage,setLeverage]=useState<2|3|4|5>(2),[amount,setAmount]=useState(''),[slippage,setSlippage]=useState(50),[quote,setQuote]=useState<MarginStepQuote|null>(null),[clock,setClock]=useState(Date.now());
 const validMarket=market.market_id===MARGIN_MARKET_ID&&market.network==='stellar-testnet'&&market.instrument_type==='leveraged_margin'&&market.min_leverage===2&&market.max_leverage===5&&market.directions?.includes('long')===true&&market.directions.includes('short')&&market.collateral?.verified===true&&market.collateral.network==='stellar-testnet'&&market.collateral.decimals===7;
 const creationReady=validMarket&&market.preparation_available===true&&marginVerified&&walletVerified&&!guardReason;
 const intent={market_id:MARGIN_MARKET_ID,direction,leverage,amount,slippage_bps:slippage};
 const parsedIntent=MarginBrowserInputSchema.safeParse(intent);
 const scopedWorkflow=(value:unknown)=>{const parsed=MarginWorkflowPublicSchema.safeParse(value);if(!parsed.success||parsed.data.customer_id!==session.customer_id||parsed.data.wallet_id!==session.wallet_id||parsed.data.market_id!==MARGIN_MARKET_ID)throw Error('Margin setup could not be found.');return parsed.data;};
 const accept=(value:unknown)=>{const next=scopedWorkflow(value);setWorkflow(next);setSavedId(next.workflow_id);recovery.current={workflow_id:next.workflow_id};recoverySave(key,recovery.current);setRecoveringDraft(false);setQuote(current=>current&&current.revision===next.revision?current:null);return next;};
 useEffect(()=>{let alive=true;const captured=owner;setWorkflow(null);setQuote(null);setSavedId(null);setError('');setUncertainRecovery(false);setLoading(true);recovery.current=recoveryRead(key)??{};
  const saved=recovery.current;if(saved.draft){setDirection(saved.draft.direction);setLeverage(saved.draft.leverage);setAmount(saved.draft.amount);setSlippage(saved.draft.slippage_bps);setRecoveringDraft(true);}else{setDirection('long');setLeverage(2);setAmount('');setSlippage(50);setRecoveringDraft(false);}
  const restore=async()=>{
    if(saved.workflow_id){setSavedId(saved.workflow_id);try{return scopedWorkflow(await api(`grapnel/margin/workflows/${saved.workflow_id}`));}catch(cause){if(!(cause instanceof ClientError)||cause.status!==404)throw cause;}}
    const result=await api('grapnel/margin/workflows');if(!Array.isArray(result?.workflows))throw Error('Margin status is unavailable.');
    const rows=result.workflows.map(scopedWorkflow);return rows.find((row:MarginWorkflowPublic)=>row.phase!=='recovered')??rows[0]??null;
  };
  void restore().then(value=>{if(alive&&ownerRef.current===captured){if(value)accept(value);else if(saved.workflow_id){setSavedId(null);recovery.current={};recoverySave(key,null);}}}).catch(()=>{if(alive&&ownerRef.current===captured){setError('Margin status is unavailable. Check before starting another setup.');setUncertainRecovery(true);}}).finally(()=>{if(alive&&ownerRef.current===captured)setLoading(false);});
  return()=>{alive=false;};
 // Exact customer/wallet namespace owns all recovery data; response binding is checked separately.
 },[owner,key]);
 useEffect(()=>{if(!quote)return;setClock(Date.now());const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[quote]);
 const run=async(task:()=>Promise<void>,target='status')=>{if(busy)return;const captured=owner;setBusy(true);setError('');setErrorTarget(target);try{await task();}catch(cause){if(ownerRef.current===captured){if(cause instanceof ClientError&&['QUOTE_EXPIRED','QUOTE_CHANGED','QUOTE_ALREADY_USED'].includes(cause.code))setQuote(null);if(cause instanceof ClientError&&cause.code==='QUOTE_CHANGED'&&savedId){try{const latest=await api(`grapnel/margin/workflows/${savedId}`);if(ownerRef.current===captured)accept(latest);}catch{}}setError(cause instanceof Error?cause.message:'Margin status is unavailable.');}}finally{if(ownerRef.current===captured)setBusy(false);}};
 const runStep=(step:string,task:()=>Promise<void>)=>run(task,step);
 const post=async(path:string,body:unknown,requestKey?:string)=>{const idempotency=requestKey??operationRequestKey(session.customer_id,path,body);try{const result=await api(`grapnel/${path}`,body,'POST',idempotency);clearOperationRequest(session.customer_id,path,body);return result;}catch(cause){if(cause instanceof ClientError&&cause.status<500&&cause.status!==408)clearOperationRequest(session.customer_id,path,body);throw cause;}};
 const check=()=>run(async()=>{
  let value:MarginWorkflowPublic|null=null;
  if(savedId){try{value=scopedWorkflow(await post(`margin/workflows/${savedId}/reconcile`,{}));}catch(cause){if(!(cause instanceof ClientError)||cause.status!==404)throw cause;}}
  if(!value){const rows=await api('grapnel/margin/workflows');if(!Array.isArray(rows?.workflows))throw Error('Margin status is unavailable.');const parsed=rows.workflows.map(scopedWorkflow);value=parsed.find((row:MarginWorkflowPublic)=>row.phase!=='recovered')??parsed[0]??null;}
  if(ownerRef.current!==owner)return;setUncertainRecovery(false);if(value)accept(value);else{setWorkflow(null);setSavedId(null);recoverySave(key,null);recovery.current={};}
 });
 const getQuote=(step:MarginWorkflowPublic['next_steps'][number])=>runStep(step,async()=>{if(!workflow?.preparation_available||!workflow.next_steps.includes(step))throw Error('This margin action is unavailable right now.');setQuote(null);const parsed=MarginStepQuoteSchema.safeParse(await post(`margin/workflows/${workflow.workflow_id}/steps/${step}/quote`,{}));if(!parsed.success)throw Error('Margin quote is unavailable.');const result=parsed.data;if(result.workflow_id!==workflow.workflow_id||result.step!==step||result.revision!==workflow.revision||Date.parse(result.expires_at)<=Date.now())throw Error('Request a fresh margin quote.');if(ownerRef.current===owner){setQuote(result);setClock(Date.now());}});
 const expired=quote!=null&&Date.parse(quote.expires_at)<=clock;
 const collateral=market.collateral,displayAmount=workflow&&collateral?.id===workflow.asset_id&&collateral.decimals===7?formatTokenAmount(fromAtomic(BigInt(workflow.amount_atomic),7)):null;
 const amountText=(value:string|undefined,label:string)=>value!=null&&/^(0|[1-9]\d*)(\.\d+)?$/.test(value)?`${value} ${label}`:'Unknown';
 const receiptId='stellar-testnet:soroban:CCEW6NSPCV7XUEQV75ZMII5HK5DGXK5JP2QOTGLV4UFLDBPEKRGO4Y4B';
 const actionBalance=(step?:string)=>{
  const native=balances.find(row=>row.asset_id==='stellar-testnet:native:XLM');
  const wallet=step==='vault_deposit'?balances.find(row=>row.asset_id===collateral?.id):['margin_transfer','vault_withdraw'].includes(step??'')?balances.find(row=>row.asset_id===receiptId):undefined;
  return <div className="small muted margin-action-balance" data-testid="margin-action-balance">
   {step==='vault_deposit'?<p>Available: {amountText(wallet?.spendable,collateral?.name??collateral?.code??'Mock USDT')}</p>:['margin_transfer','vault_withdraw'].includes(step??'')?<p>Available: {amountText(wallet?.spendable,'collateral receipts')}</p>:['open_begin','margin_return'].includes(step??'')?<p>Setup collateral: {workflow?.receipt_atomic!=null?`${fromAtomic(BigInt(workflow.receipt_atomic),6)} collateral receipts`:'Unknown'}</p>:null}
   <p>Available for fees: {amountText(native?.spendable,'XLM')}</p>
  </div>;
 };
 const inlineError=<p className="swap-action-error" role="alert">{error}</p>;
 return <section className="market-order-card margin-workflow-card" aria-label="Margin setup" data-testid="margin-workflow-card" aria-busy={busy}>
  <h2>Margin {market.market_id===MARGIN_MARKET_ID?'XLM':''}</h2>
  {guardReason&&<p className="margin-trading-reason" role="status">{guardReason}</p>}
  {validMarket&&market.collateral&&<MarginCollateralFunding session={session} asset={market.collateral} walletVerified={walletVerified} balances={balances} onReviewOperation={onReviewOperation}/>}
  {busy&&<p className="small muted" role="status">Checking margin request…</p>}
  {loading?<p className="small muted" role="status">Checking saved margin setup…</p>:workflow?<>
   <p className="margin-workflow-phase" role="status" data-testid="margin-workflow-phase">{marginPhaseLabels[workflow.phase]}</p>
   <dl className="margin-workflow-summary"><div><dt>Direction</dt><dd>{workflow.direction==='long'?'Long':'Short'}</dd></div><div><dt>Leverage</dt><dd>{workflow.leverage}×</dd></div><div><dt>Collateral</dt><dd>{displayAmount?`${displayAmount} ${collateral?.name??collateral?.code}`:'Unavailable'}</dd></div></dl>
   {workflow.active_operation_id&&actionBalance()}
   {error&&errorTarget==='pending'&&inlineError}
   {workflow.active_operation_id&&<button type="button" className="button outline wide" aria-label="Review pending transaction" disabled={busy} onClick={()=>run(()=>onReviewOperation(workflow.active_operation_id!,session,{workflow_id:workflow.workflow_id,position_id:workflow.position_id}),'pending')}>Review</button>}
   {error&&(errorTarget==='status'||!['pending','create',...workflow.next_steps].includes(errorTarget))&&inlineError}
   <button type="button" className="text-button margin-check-status" disabled={busy} onClick={check}>Check progress</button>
   {!workflow.preparation_available&&<p className="small muted" role="status">Further margin actions are unavailable right now. Your setup is saved.</p>}
   {workflow.preparation_available&&walletVerified&&workflow.next_steps.map(step=><div className="margin-step" key={step}>
    <strong>{marginStepLabels[step]}</strong>
    {actionBalance(step)}
    {error&&errorTarget===step&&inlineError}
    {quote?.step===step&&!expired?<><p className="small muted">Limit ready. Review the exact transaction before approving.</p><p className="small muted"><time dateTime={quote.expires_at}>Valid until {new Date(quote.expires_at).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit',second:'2-digit'})}</time></p><button type="button" className="button wide" aria-label={`Review ${marginStepLabels[step].toLowerCase()}`} disabled={busy} onClick={()=>runStep(step,async()=>{if(!quote||Date.parse(quote.expires_at)<=Date.now())throw new ClientError('QUOTE_EXPIRED','Request a fresh margin quote.',409);const op=await post(`margin/workflows/${workflow.workflow_id}/steps/${step}`,{quote});if(ownerRef.current!==owner)return;if(!uuid(op?.operation_id)||op.customer_id!==session.customer_id||op.wallet_id!==session.wallet_id)throw Error('Wallet action could not be found.');setQuote(null);await onReviewOperation(op.operation_id,session,{workflow_id:workflow.workflow_id,position_id:workflow.position_id});const current=await api(`grapnel/margin/workflows/${workflow.workflow_id}`);if(ownerRef.current===owner)accept(current);})}>Review</button></>:<><p className="small muted">{quote?.step===step&&expired?'This quote expired. Request a fresh quote.':'Each transaction needs your approval.'}</p><button type="button" className="button outline wide" disabled={busy} onClick={()=>getQuote(step)}>Get quote for {marginStepLabels[step].toLowerCase()}</button></>}
   </div>)}
   {workflow.phase==='recovered'&&<button type="button" className="button outline wide" disabled={busy||!creationReady} onClick={()=>{recoverySave(key,null);recovery.current={};setWorkflow(null);setSavedId(null);setAmount('');}}>Start another setup</button>}
  </>:savedId||uncertainRecovery?<>{error&&inlineError}<p className="small muted">Check margin status before starting another setup.</p><button type="button" className="button outline wide" disabled={busy} onClick={check}>Check progress</button></>:<>
   <div className="public-order-direction" role="group" aria-label="Position direction">{(['long','short']as const).map(value=><button key={value} type="button" disabled={busy} aria-pressed={direction===value} onClick={()=>setDirection(value)}>{value==='long'?'Long':'Short'}</button>)}</div>
   <label>Leverage<select aria-label="Leverage" value={leverage} disabled={busy} onChange={event=>setLeverage(Number(event.target.value)as 2|3|4|5)}>{([2,3,4,5]as const).map(value=><option key={value} value={value}>{value}×</option>)}</select></label>
   <label>Collateral amount ({collateral?.name??'Mock USDT'})<input aria-label="Margin collateral amount" inputMode="decimal" placeholder="0.00" value={amount} disabled={busy} onChange={event=>setAmount(event.target.value)}/></label>
   <label>Maximum slippage<select aria-label="Margin maximum slippage" value={slippage} disabled={busy} onChange={event=>setSlippage(Number(event.target.value))}><option value={0}>0%</option><option value={10}>0.1%</option><option value={25}>0.25%</option><option value={50}>0.5%</option></select></label>
   {recoveringDraft&&<p className="small muted">Retry your saved setup to recover the same request.</p>}
   {!creationReady&&<p className="small muted" role="status">Margin setup is unavailable right now.</p>}
   {actionBalance('vault_deposit')}
   {error&&errorTarget==='create'&&inlineError}
   <button type="button" className="button wide" disabled={busy||!creationReady||!parsedIntent.success} onClick={()=>run(async()=>{if(!creationReady||!parsedIntent.success)throw Error('Margin setup is unavailable right now.');const requestKey=recovery.current.request_key&&JSON.stringify(recovery.current.draft)===JSON.stringify(parsedIntent.data)?recovery.current.request_key:operationRequestKey(session.customer_id,'margin/workflows',parsedIntent.data);recovery.current={draft:parsedIntent.data,request_key:requestKey};recoverySave(key,recovery.current);const result=await post('margin/workflows',parsedIntent.data,requestKey);if(ownerRef.current===owner)accept(result);},'create')}>{creationReady?'Start margin setup':'Trading unavailable'}</button>
  </>}
 </section>;
}
