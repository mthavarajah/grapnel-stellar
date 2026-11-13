"use client";
import {changeDirection,chartTimeDomain,chartSegments} from "../lib/chart-presentation";
import {matchesSpotQuote,validSpotAmount,readSpotQuoteWithRetry,type SpotQuoteIntent} from "../lib/spot-quote";
import {earnAmountMessage} from "../lib/earn-amount";
import {currentCustomerOperation} from "../lib/prepared-operation";
import {ZenexPerpetualExecution} from "./zenex-perpetual-execution";
import {ActionDialog} from './action-dialog';
import {PerpetualActivity} from './perpetual-activity';
import {StockActivity} from "./stock-activity";
import {RobinhoodExecution} from "./robinhood-execution";
import {groupedUsd} from '../lib/grouped-assets';
import {GroupedAssets} from "./grouped-assets";
import {createIdentityTokenResolver} from '@/lib/identity-token';
import Link from "next/link";
import {VelocityBrand} from "./velocity-brand";
import {OperationProgress,ProgressIndicator} from "./operation-progress";
import {trackApproval,operationPollDelay,type ApprovalPhase} from "@/lib/operation-progress";
import { AssetLogo } from "./asset-logo";
import {GmxPerpetualExecution} from "./gmx-perpetual-execution";
import {PrivyPerpetualExecution} from "./perpetual-execution";
import {PerpetualOrderPreview,PerpetualMarketMetrics} from "./perpetual-order-preview";
import {isCurrentDerivativeMarket,isRecognizedDerivativeMarket,bindMarketDetail,clearMarketLiveFields} from "@/lib/perpetual-market";
import {assertMarginPositionBinding,marginPositionAction,type MarginReviewBinding} from "@/lib/margin-workflow";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  getIdentityToken,
  usePrivy,
  useIdentityToken,
} from "@privy-io/react-auth";
import { useSignRawHash } from "@privy-io/react-auth/extended-chains";
import { formatTokenAmount, fromAtomic, toAtomic, type PreparedAction, type AssetIdentity } from "@grapnel/contracts";
import {borrowingReasonMessage,borrowingAmountMessage} from "@/lib/borrowing-feedback";
import { api, ClientError, operationRequestKey, clearOperationRequest } from "@/lib/client";
import { signPreparedAction } from "@/lib/privy-signer";
type Capability = {
  module: string;
  enabled: boolean;
  execution_status: string;
  reason: string | null;
  name?: string;
  provider: string;
};
type Session = {
  customer_id: string;
  wallet_id: string;
  stellar_address: string;
};
type WalletValuation = {assets?:{asset_id:string;wallet_amount:string;value_usd:string|null}[];wallet_id:string;total_usd:string|null;priced_subtotal_usd:string;unpriced_asset_count:number;unknown_source_count?:number;as_of:string};
type BorrowAsset = {
  market_id:string;asset:AssetIdentity;borrow_apr:string|null;borrow_apy:string|null;
  available_liquidity:string|null;borrowed:string;repayable:string;
  collateral_value:string|null;borrow_limit:string|null;available_to_borrow:string|null;health_factor:string|null;
  can_prepare_borrow:boolean;can_prepare_repay:boolean;reason:string|null;
  collateral?:string;can_prepare_collateral_supply?:boolean;can_prepare_collateral_withdraw?:boolean;
  repay_all_amount?:string|null;can_prepare_repay_all?:boolean;
};
type Borrowing = {pool_id:string;as_of:string;assets:BorrowAsset[]};
function borrowingRate(value:string|null):string {
  if(value==null||!/^\d+(?:\.\d+)?$/.test(value))return "—";
  const ratio=Number(value);return Number.isFinite(ratio)?new Intl.NumberFormat(undefined,{style:"percent",maximumFractionDigits:2}).format(ratio):"—";
}
const loanAmount=(value:string|null|undefined)=>value==null?"—":formatTokenAmount(value);
type EarnBalance = {
  asset_id: string;
  wallet_amount?: string | null;
  spendable?: string | null;
  in_earn?: string | null;
  earned?: string | null;
  earned_since?: string | null;
  as_of?: string | null;
  trustline_required: boolean;
};
const XLM_ASSET = "stellar-testnet:native:XLM";
const USDC_ASSET = "stellar-testnet:classic:USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56";
type Operation = {
  operation_id: string;
  customer_id: string;
  wallet_id: string;
  status: string;
  type: string;
  tx_hash: string | null;
  prepared_action?: PreparedAction;
  customer_action_token?: string;
  error?: { message: string } | null;
  created_at: string;
  display_side?: 'long'|'short';
  display_amount?: string;
  display_asset_id?: string;
};
type Auth = {
  ready: boolean;
  authenticated: boolean;
  login: () => void;
  connect: () => Promise<void>;
  logout: () => Promise<void>;
  sign: (action: PreparedAction, address: string) => Promise<string>;
  signRawHash?: (input:{address:string;chainType:"stellar";hash:`0x${string}`})=>Promise<{signature:`0x${string}`}>;
};
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    home: (
      <>
        <path d="m3 10 9-7 9 7v10H3Z" />
        <path d="M9 20v-7h6v7" />
      </>
    ),
    fund: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5" />
        <path d="M4 15v5h16v-5" />
      </>
    ),
    return: (
      <>
        <path d="M12 16V4m-5 5 5-5 5 5" />
        <path d="M4 15v5h16v-5" />
      </>
    ),
    markets: (
      <>
        <path d="M3 19h18M5 15l4-5 4 3 6-8" />
        <path d="M15 5h4v4" />
      </>
    ),
    earn: (
      <>
        <path d="M12 21V11M12 13C4 14 3 8 3 4c6 0 10 2 9 9Zm0-3c0-5 4-7 9-7 0 5-2 9-9 9" />
      </>
    ),
    borrow: (<><path d="M4 8h16M4 16h16M16 4l4 4-4 4M8 12l-4 4 4 4" /></>),
    activity: (
      <>
        <path d="M3 12h4l3-8 4 16 3-8h4" />
      </>
    ),
    arrow: (
      <>
        <path d="M5 12h14m-5-5 5 5-5 5" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    wallet: (
      <>
        <rect x="3" y="5" width="18" height="15" rx="3" />
        <path d="M3 9h18m-5 5h2" />
      </>
    ),
    shield: (
      <>
        <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.arrow}
    </svg>
  );
}
const tradeCategories = [["crypto_spot", "Crypto"], ["stocks", "Stocks"], ["perps", "Perpetuals"]] as const;
const nav = [
  ["home", "Overview"],
  ["funds", "Funds"],
  ["markets", "Markets"],
  ["earn", "Earn"],
  ["borrow", "Borrow"],
  ["activity", "Activity"],
];
function customerMessage(message: string): string {
  if (/GATE_1_SIGNING_PROOF_REQUIRED|Gate 1|[A-Z]+(?:_[A-Z0-9]+)+|Privy|Stellar|Soroswap|Blend|provider|protocol/i.test(message)) return "This action is unavailable right now. Please try again.";
  if (message.includes("MODULE_NOT_ENABLED") || /module.*(disabled|not enabled)/i.test(message)) return "This module is unavailable.";
  return message;
}
const assetCode = (id?: string): string => id === XLM_ASSET ? "XLM" : id === USDC_ASSET ? "USDC" : "Asset";
type MarketHistory = {
  market_id:string; base_asset_id:string; base_symbol:string; quote_symbol:string;
  latest_price:string|null; as_of:string|null;
  points:{timestamp:string;price:string}[];
  change_absolute:string|null; change_percent:string|null;
  price_basis?:string; reference_symbol?:string; source_url?:string; interval?:string;
  requested_range?:HistoryRange;
  coverage?:{kind?:string;first_generated_at?:string|null;complete_requested_range?:boolean};
  metrics?:{day_high?:string|null;day_low?:string|null;day_volume?:string|null;fifty_two_week_high?:string|null;fifty_two_week_low?:string|null;previous_close?:string|null;market_time?:string|null};
};
type OverviewSection = {id:"spot"|"perps"|"stocks"|"lending";label:string;items:{symbol:string;name:string;value:string;unit:"USD"|"percent";unit_detail?:string;as_of:string}[];available:boolean};
const overviewGroups = [
  {id:"spot",label:"Spot prices",module:"trade.spot",href:"/markets?category=crypto_spot"},
  {id:"perps",label:"Perpetual prices",module:"trade.perps",href:"/markets?category=perps"},
  {id:"stocks",label:"Stock prices",module:"trade.stocks",href:"/markets?category=stocks"},
  {id:"lending",label:"Lending rates",module:"capital.lending",href:"/earn"},
] as const;
type HistoryRange = "live"|"1d"|"1w"|"1m"|"1y"|"all";
function displayPublicNotional(value:unknown):string {
  if(typeof value!=="string"||!/^[-]?\d+$/.test(value))return "—";
  try{const amount=BigInt(value);return `${amount<0n?"-":""}${formatTokenAmount(fromAtomic(amount<0n?-amount:amount,7))} USDC`;}catch{return "—";}
}
function balanceTimestamp(value:string):string {
  const date=new Date(value);if(!Number.isFinite(date.getTime()))return "—";
  const parts=new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:true}).formatToParts(date),part=(type:string)=>parts.find(p=>p.type===type)?.value??"";
  return `${part("month")}. ${part("day")}, ${part("year")} ${part("hour")}:${part("minute")} ${part("dayPeriod")}`;
}
function marketDate(value:string|number,includeTime=false,includeSeconds=false):string {
  const date=new Date(value);if(!Number.isFinite(date.getTime()))return "Date unavailable";
  const parts=new Intl.DateTimeFormat("en-US",{month:"short",day:"2-digit",year:"numeric"}).formatToParts(date);
  const part=(type:string)=>parts.find(item=>item.type===type)?.value??"";
  return `${part("month")}. ${part("day")}, ${part("year")}${includeTime?` · ${date.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit",...(includeSeconds?{second:"2-digit" as const}:{})})}`:""}`;
}
function displayChange(value:string|null|undefined):string {
  if(typeof value!=="string"||!/^[-+]?\d+(?:\.\d+)?$/.test(value))return "—";
  const amount=value.replace(/^[-+]/, ""), formatted=formatTokenAmount(amount);
  return formatted==="Unavailable"?"—":`${value.startsWith("-")?"-":"+"}${formatted}`;
}
function PriceChart({history,loading,range}:{history:MarketHistory|null;loading:boolean;range:HistoryRange}) {
  const [selectedIndex,setSelectedIndex]=useState<number|null>(null);
  const chartRef=useRef<SVGSVGElement|null>(null);
  useEffect(()=>{setSelectedIndex(null);},[history?.market_id,history?.as_of,history?.points]);
  const points=useMemo(()=>(history?.points??[]).flatMap(point=>{
    try {const timestamp=Date.parse(point.timestamp),price=toAtomic(point.price,38);return Number.isFinite(timestamp)?[{timestamp,price,originalPrice:point.price,originalTimestamp:point.timestamp}]:[];}catch{return [];}
  }).sort((a,b)=>a.timestamp-b.timestamp).filter((point,index,all)=>index===0||point.timestamp!==all[index-1]!.timestamp),[history?.points]);
  const domain=useMemo(()=>chartTimeDomain(points.map(p=>p.timestamp),range,history?.as_of),[points,range,history?.as_of]);
  const coordinates=useMemo(()=>{
    if(!points.length)return [];
    const min=points.reduce((current,p)=>p.price<current?p.price:current,points[0]!.price),max=points.reduce((current,p)=>p.price>current?p.price:current,points[0]!.price),[first,last]=domain;
    return points.map(point=>({x:last===first?300:20+(point.timestamp-first)*560/(last-first),y:max===min?140:260-Number((point.price-min)*240000n/(max-min))/1000}));
  },[points,domain]);
  const lineSegments=useMemo(()=>chartSegments(points.map(p=>p.timestamp),history?.interval).filter(segment=>segment.length>1).map(segment=>segment.map(index=>`${coordinates[index]!.x},${coordinates[index]!.y}`).join(" ")),[coordinates,points,history?.interval]);
  if(loading&&!points.length)return <div className="market-chart-empty" role="status">Loading price history…</div>;
  if(!points.length)return <div className="market-chart-empty" role="status">Price history is not available yet.</div>;
  const [first,last]=domain;
  const index=selectedIndex==null?null:Math.max(0,Math.min(selectedIndex,points.length-1));
  const selected=index==null?null:points[index]!,coordinate=index==null?null:coordinates[index]!;
  const selectAtX=(clientX:number)=>{
    const bounds=chartRef.current?.getBoundingClientRect();if(!bounds||!bounds.width)return;
    const timestamp=first+(((clientX-bounds.left)/bounds.width*600-20)/560)*(last-first);
    let closest=0;for(let i=1;i<points.length;i++)if(Math.abs(points[i]!.timestamp-timestamp)<Math.abs(points[closest]!.timestamp-timestamp))closest=i;
    setSelectedIndex(closest);
  };
  return <div className={`market-chart-wrap ${changeDirection(history?.change_absolute)}`}>
    <div className="interactive-price-chart">
      <svg ref={chartRef} viewBox="0 0 600 280" role="img" aria-label="Price history" aria-describedby="price-chart-help" tabIndex={0} data-testid="price-chart" className="market-chart"
        onPointerMove={event=>selectAtX(event.clientX)} onPointerDown={event=>{event.currentTarget.focus({preventScroll:true});selectAtX(event.clientX);}}
        onPointerLeave={event=>{if(event.pointerType!=="touch")setSelectedIndex(null);}} onFocus={()=>setSelectedIndex(current=>current??points.length-1)} onBlur={()=>setSelectedIndex(null)}
        onKeyDown={event=>{
          if(!["ArrowLeft","ArrowRight","Home","End","Escape"].includes(event.key))return;event.preventDefault();
          if(event.key==="Escape"){setSelectedIndex(null);return;}
          if(event.key==="Home"){setSelectedIndex(0);return;}if(event.key==="End"){setSelectedIndex(points.length-1);return;}
          setSelectedIndex(current=>Math.max(0,Math.min(points.length-1,(current??points.length-1)+(event.key==="ArrowRight"?1:-1))));
        }}>
        <title>{`${history!.base_symbol} price in ${history!.quote_symbol}`}</title>
        {[60,140,220].map(y=><line key={y} x1="20" x2="580" y1={y} y2={y} className="market-chart-grid" />)}
        {lineSegments.map((line,index)=><polyline key={index} points={line} className="market-chart-line" />)}
        <circle cx={coordinates.at(-1)!.x} cy={coordinates.at(-1)!.y} r="4" className="market-chart-dot" />
        {coordinate&&<><line x1={coordinate.x} x2={coordinate.x} y1="15" y2="265" className="market-chart-crosshair" data-testid="price-chart-crosshair"/><circle cx={coordinate.x} cy={coordinate.y} r="5" className="market-chart-dot" data-testid="price-chart-selected-point"/></>}
      </svg>
      <span className="chart-assistive" id="price-chart-help">Use left and right arrow keys to inspect each recorded price. Home and End select the first and latest observations.</span>
      {selected&&<div className="market-chart-tooltip" role="tooltip" data-testid="price-chart-tooltip"><strong>{selected.originalPrice} {history!.quote_symbol}</strong><time dateTime={selected.originalTimestamp}>{marketDate(selected.originalTimestamp,true,true)}</time></div>}
    </div>
    {history?.coverage?.kind==="observed_only"&&history.coverage.first_generated_at&&<p className="market-chart-caption">Recorded prices since {marketDate(history.coverage.first_generated_at,true)}</p>}
    {history?.coverage?.kind==="provider_available"&&history.coverage.first_generated_at&&<p className="market-chart-caption">Available history since {marketDate(history.coverage.first_generated_at)}</p>}
    {points.length===1?<p className="market-chart-caption">One price observation. More history is not available yet.</p>:<div className="market-chart-dates"><span>{marketDate(first,true)}</span><span>{marketDate(last,true)}</span></div>}
  </div>;
}
type SwapAsset = {id:string;code:string;name?:string;decimals?:number};
function displayAssetIdentity(item: SwapAsset, identities: SwapAsset[]): string {
  if(item.id===USDC_ASSET&&!item.name)return item.code;
  const matchingCode=identities.filter(other=>other.code===item.code);
  if(matchingCode.length<2)return item.code;
  const idLabel=identities.some(other=>other.id!==item.id&&short(other.id)===short(item.id))?item.id:short(item.id);
  if(!item.name)return `${item.code} — ${idLabel}`;
  const sameName=matchingCode.filter(other=>other.name===item.name).length>1;
  return `${item.code} — ${item.name}${sameName?` (${idLabel})`:""}`;
}
function quoteUnitRate(quote: any, input?: SwapAsset, output?: SwapAsset): string | null {
  if (!input || !output || !Number.isInteger(input.decimals) || !Number.isInteger(output.decimals)) return null;
  try {
    const amountIn = toAtomic(quote.amount_in, input.decimals!);
    const amountOut = toAtomic(quote.expected_out, output.decimals!);
    const scaled = amountOut * 10n ** BigInt(input.decimals!) * 10n ** 38n / (amountIn * 10n ** BigInt(output.decimals!));
    if (scaled <= 0n) return null;
    const display = formatTokenAmount(fromAtomic(scaled,38));
    return display === "Unavailable" ? null : display;
  } catch { return null; }
}
const approvalFee = (value?: string): string => value && /^\d+$/.test(value) ? `${fromAtomic(BigInt(value), 7)} XLM` : "Unavailable";

function activityLabel(op: Operation): string {
  if(op.type.startsWith('zenex.')){const done=op.status==='completed',p=op.prepared_action?.summary.perpetual;if(op.type==='zenex.faucet')return done?`Received ${formatTokenAmount(op.display_amount)} trading USDC`:'Receive trading USDC';if(op.type==='zenex.trustline')return done?'Enabled trading USDC':'Enable trading USDC';if(op.type==='zenex.cancel')return done?'Cancelled XLM order':'Cancel XLM order';return `${op.type==='zenex.open'?(done?'Opened':'Open'):(done?'Closed':'Close')} XLM${p?' '+(p.is_long?'Long':'Short')+' · $'+formatTokenAmount(p.size_usd):op.display_side?' '+(op.display_side==='long'?'Long':'Short')+' · $'+formatTokenAmount(op.display_amount):''}`;}

  if (op.type === "perps.usdc_trustline") return op.status === "completed" ? "Enabled trading USDC" : "Enable trading USDC";
  if (op.type === "perps.usdc_allowance") return op.status === "completed" ? "Approved trading funding" : "Approve trading funding";
  if (op.type === "wallet.usdc_trustline") return op.status === "completed" ? "Enabled USDC" : "Enable USDC";
  const labels: Record<string, [string, string]> = {
    "blend.supply": ["Supply", "Supplied"], "blend.withdraw": ["Withdraw", "Withdrew"],
    "blend.borrow": ["Borrow", "Borrowed"], "blend.repay": ["Repay", "Repaid"],
    "blend.borrow_collateral_supply": ["Add collateral", "Added collateral"], "blend.borrow_collateral_withdraw": ["Remove collateral", "Removed collateral"],
    "testnet.fund": ["Receive funds", "Received"], "testnet.return": ["Return funds", "Returned"],
    "wallet.test_payment": ["Payment", "Sent"], "spot.swap": ["Swap", "Swapped"],
  };
  const label = labels[op.type];
  if (!label) return "Wallet activity";
  const amount = op.display_amount ?? op.prepared_action?.summary.amount;
  const id = op.display_asset_id ?? op.prepared_action?.summary.fromAssetId;
  const shown = formatTokenAmount(amount);
  return `${label[op.status === "completed" ? 1 : 0]}${shown === "Unavailable" ? "" : ` ${shown} ${assetCode(id)}`}`;
}
const short = (v: string) =>
  v.length > 22 ? v.slice(0, 10) + "…" + v.slice(-7) : v;
const title: Record<string, string> = {
  home: "Overview",
  login: "Your wallet. Your approval.",
  fund: "Get funds",
  funds: "Funds",
  return: "Return funds",
  markets: "Swap",
  trade: "Swap",
  earn: "Earn",
  borrow: "Borrow",
  activity: "Activity",
};
export default function Finance({page,initialCategory}:{page:string;initialCategory?:string}){
 return process.env.NEXT_PUBLIC_PRIVY_APP_ID?<PrivyFinance page={page} initialCategory={initialCategory}/>:<FinanceShell page={page} initialCategory={initialCategory}/>;
}
const identityTokens=createIdentityTokenResolver();
function PrivyFinance({ page, initialCategory }: { page: string; initialCategory?:string }) {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { identityToken } = useIdentityToken();
  const privyAppId=process.env.NEXT_PUBLIC_PRIVY_APP_ID??"";
  if(ready)identityTokens.setIdentity({appId:privyAppId,userId:authenticated?user?.id??null:null});
  const { signRawHash } = useSignRawHash();
  const connect = async () => {
    const token = await identityTokens.resolve({currentToken:identityToken,refresh:getIdentityToken});
    if (!token) throw Error("Please sign in first");
    await api("session", { identity_token: token });
  };
  const auth: Auth = {
    ready,
    authenticated,
    login,
    connect,
    logout: async () => {
      identityTokens.setIdentity({appId:privyAppId,userId:null});
      await api("session", undefined, "DELETE");
      await logout();
    },
    sign: (a, address) => signPreparedAction(a, signRawHash, address),
    signRawHash,
  };
  return <FinanceShell key={`${privyAppId}:${user?.id??"signed-out"}`} page={page} auth={auth} initialCategory={initialCategory} />;
}
function FinanceShell({ page, auth, initialCategory }: { page: string; auth?: Auth;initialCategory?:string }) {
  const router = useRouter();
  const [navigationTarget,setNavigationTarget]=useState<string|null>(null);
  useEffect(()=>{setNavigationTarget(null);setProfileOpen(false);},[page]);
  const [sessionChecked, setSessionChecked] = useState(false);
  const attemptedConnection = useRef(false);
  const [loginTimedOut, setLoginTimedOut] = useState(false);
  useEffect(() => {
    if (sessionChecked && (!auth || auth.ready)) { setLoginTimedOut(false); return; }
    const timer = setTimeout(() => setLoginTimedOut(true), 15000);
    return () => clearTimeout(timer);
  }, [sessionChecked, auth?.ready]);
  const [status, setStatus] = useState<any>(null);
  const [session, setSession] = useState<Session | null>(null);
  const marginSession=useRef(session);marginSession.current=session;
  useEffect(()=>()=>{marginSession.current=null;},[]);
  const marginReviewBindings=useRef(new Map<string,{owner:{customer_id:string;wallet_id:string};binding:MarginReviewBinding}>());
  useEffect(()=>{marginReviewBindings.current.clear();},[session?.customer_id,session?.wallet_id]);
  const [profileOpen,setProfileOpen]=useState(false);
  const [walletValuation,setWalletValuation]=useState<WalletValuation|null>(null);
  const [valuationLoading,setValuationLoading]=useState(false);
  const [valuationUnavailable,setValuationUnavailable]=useState(false);
  const profileContainer=useRef<HTMLDivElement|null>(null),profilePanel=useRef<HTMLElement|null>(null),profileTrigger=useRef<HTMLButtonElement|null>(null);
  const valuationFlight=useRef<{owner:string;promise:Promise<WalletValuation>}|null>(null);
  const valuationOwner=useRef("");valuationOwner.current=`${session?.customer_id??""}:${session?.wallet_id??""}`;
  useEffect(()=>{setProfileOpen(false);setWalletValuation(null);setValuationUnavailable(false);},[session?.customer_id,session?.wallet_id]);
  useEffect(()=>{
    if((!profileOpen&&page!=="home"&&page!=="funds")||!session)return;
    let alive=true;const owner=`${session.customer_id}:${session.wallet_id}`,walletId=session.wallet_id;
    setValuationLoading(!walletValuation);setValuationUnavailable(false);
    let pending=valuationFlight.current?.owner===owner?valuationFlight.current.promise:null;
    if(!pending){
      pending=api("grapnel/wallet-valuation").then(value=>{
        const money=(amount:unknown)=>typeof amount==="string"&&/^\d+(?:\.\d+)?$/.test(amount)&&formatTokenAmount(amount)!=="Unavailable";
        if(value?.wallet_id!==walletId||!Number.isInteger(value.unpriced_asset_count)||value.unpriced_asset_count<0||!Number.isFinite(Date.parse(value.as_of))||!(value.total_usd===null||money(value.total_usd))||!money(value.priced_subtotal_usd))throw Error("Wallet value is unavailable.");
        return value as WalletValuation;
      });
      const flight={owner,promise:pending};valuationFlight.current=flight;
      void pending.then(()=>{if(valuationFlight.current===flight)valuationFlight.current=null;},()=>{if(valuationFlight.current===flight)valuationFlight.current=null;});
    }
    void pending.then(value=>{if(alive&&valuationOwner.current===owner)setWalletValuation(value);}).catch(()=>{if(alive&&valuationOwner.current===owner)setValuationUnavailable(true);}).finally(()=>{if(alive&&valuationOwner.current===owner)setValuationLoading(false);});
    return()=>{alive=false;};
  },[profileOpen,page,session?.customer_id,session?.wallet_id]);
  useEffect(()=>{
    if(!profileOpen)return;
    profilePanel.current?.focus();
    const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!profileContainer.current?.contains(event.target))setProfileOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.preventDefault();setProfileOpen(false);profileTrigger.current?.focus();}};
    document.addEventListener("pointerdown",outside,true);document.addEventListener("keydown",escape);
    return()=>{document.removeEventListener("pointerdown",outside,true);document.removeEventListener("keydown",escape);};
  },[profileOpen]);

  const profileValue=walletValuation ? (walletValuation.unpriced_asset_count>0?walletValuation.priced_subtotal_usd:walletValuation.total_usd) : null;
  const [accountValuation,setAccountValuation]=useState<WalletValuation|null>(null);
  const [accountValueLoading,setAccountValueLoading]=useState(false);
  const [accountValueUnavailable,setAccountValueUnavailable]=useState(false);
  const accountPartial=!!accountValuation&&(accountValuation.unpriced_asset_count>0||(accountValuation.unknown_source_count??0)>0);
  const accountTotal=accountValuation?(accountPartial?accountValuation.priced_subtotal_usd:accountValuation.total_usd):null;
  const accountValueOwner=useRef("");accountValueOwner.current=`${session?.customer_id??""}:${session?.wallet_id??""}`;
  const [caps, setCaps] = useState<Capability[]>([]);
  const [overviewSections,setOverviewSections] = useState<OverviewSection[]>([]);
  const [overviewLoading,setOverviewLoading] = useState(false);
  const [balances, setBalances] = useState<any[]>([]);
  const [networkAssets,setNetworkAssets]=useState<any[]>([]);
  const showNetworkAssets=page==="home"||page==="funds"||profileOpen;
  useEffect(()=>{setNetworkAssets([]);},[session?.customer_id,session?.wallet_id]);
  useEffect(()=>{
    if(!showNetworkAssets)return;
    let alive=true,inFlight=false,queued=false;
    const read=async()=>{if(!session||!alive)return;if(inFlight){queued=true;return;}inFlight=true;
      try{const value=await api("grapnel/network-assets");if(alive&&value.scope?.customer_id===session.customer_id&&value.scope?.wallet_id===session.wallet_id&&Array.isArray(value.balances))setNetworkAssets(value.balances);}
      catch{}finally{inFlight=false;if(alive&&queued){queued=false;void read();}}
    };
    void read();const changed=()=>{void read();},visible=()=>{if(document.visibilityState==="visible")void read();};
    const timer=setInterval(()=>{if(document.visibilityState==="visible")void read();},15000);
    window.addEventListener('grapnel:stocks-updated',changed);window.addEventListener('grapnel:perps-updated',changed);document.addEventListener('visibilitychange',visible);
    return()=>{alive=false;clearInterval(timer);window.removeEventListener('grapnel:stocks-updated',changed);window.removeEventListener('grapnel:perps-updated',changed);document.removeEventListener('visibilitychange',visible);};
  },[session?.customer_id,session?.wallet_id,showNetworkAssets]);
  const [assets, setAssets] = useState<any[]>([]);
  const [fundingError, setFundingError] = useState("");
  const [markets, setMarkets] = useState<any[]>([]);
  const [marketsLoading, setMarketsLoading] = useState(false);
  const [marketSearch, setMarketSearch] = useState("");
  const [selectedDetail,setSelectedDetail]=useState<{scope:string;data:Record<string,unknown>}|null>(null);
  const [detailState,setDetailState]=useState<{scope:string;loading:boolean;error:string}>({scope:"",loading:false,error:""});
  const [marketResultsOpen, setMarketResultsOpen] = useState(false);

  const [lending, setLending] = useState<any[]>([]);
  const [lendingLoading,setLendingLoading]=useState(true);
  const [borrowing,setBorrowing] = useState<Borrowing|null>(null);
  const [borrowingLoading,setBorrowingLoading] = useState(false);
  const [borrowingError,setBorrowingError] = useState("");
  const [loanActions,setLoanActions] = useState<Record<string,"borrow"|"repay"|"collateral-supply"|"collateral-withdraw">>({});
  const [loanAmounts,setLoanAmounts] = useState<Record<string,string>>({});
  const [repayAllAmounts,setRepayAllAmounts] = useState<Record<string,string>>({});
  const [repayAllErrors,setRepayAllErrors] = useState<Record<string,string>>({});
  const borrowerOwner=useRef("");borrowerOwner.current=`${session?.customer_id??""}:${session?.wallet_id??""}`;
  useEffect(()=>{setBorrowing(null);setLoanActions({});setLoanAmounts({});setRepayAllAmounts({});setRepayAllErrors({});setBorrowingError("");},[session?.customer_id,session?.wallet_id]);
  const refreshBorrowing=useCallback(async()=>{
    const customer=session?.customer_id,wallet=session?.wallet_id;if(!customer||!wallet)return;
    const owner=`${customer}:${wallet}`;setBorrowingLoading(true);setBorrowingError("");
    try{
      const response=await api("grapnel/borrowing");
      if(!Array.isArray(response?.assets))throw Error("Loan information is unavailable. Please try again.");
      if(borrowerOwner.current===owner){const current:Borrowing={...response,assets:response.assets.filter((row:BorrowAsset)=>row.asset?.network==="stellar-testnet"&&row.asset?.verified===true&&["XLM","USDC"].includes(row.asset.code))};setBorrowing(current);return current;}
    }catch(cause){if(borrowerOwner.current===owner){setBorrowing(null);setBorrowingError(cause instanceof Error?cause.message:"Loan information is unavailable. Please try again.");}}
    finally{if(borrowerOwner.current===owner)setBorrowingLoading(false);}
  },[session?.customer_id,session?.wallet_id]);
  const borrowingIdentity=(id?:string)=>borrowing?.assets.find(row=>row.asset.id===id)?.asset;
  const borrowingCode=(id?:string)=>borrowingIdentity(id)?.code??assetCode(id);



  const [historyRange,setHistoryRange] = useState<HistoryRange>("live");
  const [marketHistory,setMarketHistory] = useState<MarketHistory|null>(null);
  const [historyScope,setHistoryScope] = useState("");
  const [historyLoading,setHistoryLoading] = useState(false);
  const [earnBalances, setEarnBalances] = useState<EarnBalance[]>([]);
  const [earnBalancesLoading, setEarnBalancesLoading] = useState(false);
  const [earnBalancesError, setEarnBalancesError] = useState("");
  const [earnAmounts, setEarnAmounts] = useState<Record<string, string>>({});
  const [earnActions, setEarnActions] = useState<Record<string, "supply" | "withdraw">>({});
  const earnBalanceOwner = useRef<string | null>(null);
  earnBalanceOwner.current = session?.customer_id ?? null;
  useEffect(() => { setEarnBalances([]); setEarnAmounts({}); setEarnActions({}); setEarnBalancesError(""); }, [session?.customer_id]);
  const refreshEarnBalances = useCallback(async () => {
    const customerId = session?.customer_id;
    if (!customerId) return;
    setEarnBalancesLoading(true);
    setEarnBalancesError("");
    try {
      const result = await api("grapnel/earn-balances");
      if (earnBalanceOwner.current !== customerId) return;
      if (!Array.isArray(result.balances)) throw Error("Earn balances are unavailable.");
      setEarnBalances(result.balances);
    } catch (cause) {
      if (earnBalanceOwner.current !== customerId) return;
      setEarnBalances([]);
      setEarnBalancesError(cause instanceof Error ? cause.message : "Earn balances are unavailable.");
    } finally { if (earnBalanceOwner.current === customerId) setEarnBalancesLoading(false); }
  }, [session?.customer_id]);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [active, setActive] = useState<Operation | null>(null);
  const [preparingAction,setPreparingAction]=useState<string|null>(null);
  const isMaximumRepayment=active?.type==="blend.repay"&&!!active.prepared_action&&Object.entries(repayAllAmounts).some(([marketId,value])=>{
    const row=borrowing?.assets.find(entry=>entry.market_id===marketId);if(!row||row.asset.id!==active.prepared_action?.summary.fromAssetId)return false;
    try{return toAtomic(value,row.asset.decimals)===toAtomic(active.prepared_action.summary.amount??"",row.asset.decimals);}catch{return false;}
  });
  const [approvalClock, setApprovalClock] = useState(Date.now());
  useEffect(() => {
    if (active?.status !== "awaiting_customer_authorization") return;
    setApprovalClock(Date.now());
    const timer = setInterval(() => setApprovalClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active?.status, active?.operation_id]);
  const [error, setError] = useState("");
  const [actionErrors,setActionErrors]=useState<Record<string,string>>({});
  const [swapError, setSwapError] = useState("");
  useEffect(() => { setSwapError(""); }, [session?.customer_id]);
  const [busy, setBusy] = useState(false);
  const [busyLocation,setBusyLocation]=useState<string|null>(null);
  const [operationError,setOperationError]=useState('');
  useEffect(()=>{setOperationError('');},[active?.operation_id]);
  const [approvalPhase,setApprovalPhase]=useState<{operationId:string;phase:ApprovalPhase}|null>(null);
  const authorizationAttempts=useRef(new Set<string>()),signingOperations=useRef(new Set<string>());
  const visibleOperation=useRef(active?.operation_id);visibleOperation.current=active?.operation_id;
  useEffect(()=>{setApprovalPhase(current=>current&&active?.operation_id===current.operationId&&active.status==='awaiting_customer_authorization'?current:null);},[active?.operation_id,active?.status,session?.customer_id]);
  const [amount, setAmount] = useState("1");
  const [fundsDirection, setFundsDirection] = useState<"fund" | "return">("fund");
  const fundingPage = page === "funds" ? fundsDirection : page;
  const [asset, setAsset] = useState("stellar-testnet:native:XLM");
  const [market, setMarket] = useState("");
  const [quote, setQuote] = useState<any>(null);
  const [swapAmount, setSwapAmount] = useState("");
  const [category, setCategory] = useState(initialCategory??"crypto_spot");
  useLayoutEffect(()=>{if(initialCategory&&(page==="markets"||page==="trade"))setCategory(initialCategory);},[initialCategory,page]);
  const [slippageBps, setSlippageBps] = useState(50);
  const [quoteClock, setQuoteClock] = useState(Date.now());
  const [usdcStatus, setUsdcStatus] = useState<{enabled:boolean;wallet_amount?:string;spendable?:string;as_of?:string} | null>(null);
  const [usdcStatusError, setUsdcStatusError] = useState("");
  const spotCustomer = useRef<string | null>(null);
  spotCustomer.current = session?.customer_id ?? null;
  const refreshUsdcStatus = useCallback(async () => {
    const customerId = session?.customer_id;
    if (!customerId) return;
    setUsdcStatusError("");
    try {
      const value = await api("grapnel/usdc-status");
      if (spotCustomer.current !== customerId) return;
      if (typeof value.enabled !== "boolean") throw Error("USDC wallet status is unavailable.");
      setUsdcStatus(value);
    } catch (cause) {
      if (spotCustomer.current === customerId) setUsdcStatusError(cause instanceof Error ? cause.message : "USDC wallet status is unavailable.");
    }
  }, [session?.customer_id]);
  useEffect(() => { setQuote(null); setMarket(""); setUsdcStatus(null); }, [session?.customer_id]);
  useEffect(() => {
    if (!quote) return;
    setQuoteClock(Date.now());
    const timer = setInterval(() => {const now=Date.now();setQuoteClock(now);if(now>=Date.parse(quote.expires_at))clearInterval(timer);}, 1000);
    return () => clearInterval(timer);
  }, [quote]);
  const polling = useRef({ id: "", attempt: 0 });
  const capability = (module: string) => caps.find((c) => c.module === module);
  useEffect(()=>{setOverviewSections([]);setAccountValuation(null);setAccountValueUnavailable(false);},[session?.customer_id,session?.wallet_id]);
  useEffect(()=>{
    if(!session||!(page==="home"||page==="login")||!capability("capital.wallets")?.enabled){setOverviewLoading(false);return;}
    let alive=true;setOverviewLoading(true);
    void api("grapnel/market-overview").then(result=>{
      if(alive&&Array.isArray(result?.sections))setOverviewSections(result.sections.filter((section:any)=>overviewGroups.some(group=>group.id===section.id)&&Array.isArray(section.items)));
    }).catch(()=>{}).finally(()=>{if(alive)setOverviewLoading(false);});
    return()=>{alive=false;};
  },[session?.customer_id,page,caps]);
  useEffect(()=>{
    if(page==="borrow"&&session&&capability("capital.lending")?.enabled)void refreshBorrowing();
    else if(page==="borrow"){setBorrowing(null);setBorrowingError("");}
  },[page,session?.customer_id,caps,refreshBorrowing]);
  useEffect(()=>{
    setAccountValueUnavailable(false);
    if(!session||!(page==="home"||page==="login")||!capability("capital.wallets")?.enabled){setAccountValueLoading(false);return;}
    let alive=true;const owner=`${session.customer_id}:${session.wallet_id}`,walletId=session.wallet_id;
    setAccountValueLoading(!accountValuation);
    void api("grapnel/account-valuation").then(value=>{
      const money=(amount:unknown)=>typeof amount==="string"&&/^\d+(?:\.\d+)?$/.test(amount)&&formatTokenAmount(amount)!=="Unavailable";
      if(value?.wallet_id!==walletId||!Number.isInteger(value.unpriced_asset_count)||value.unpriced_asset_count<0||!(value.total_usd===null||money(value.total_usd))||!money(value.priced_subtotal_usd)||!Number.isFinite(Date.parse(value.as_of)))throw Error("Account value is unavailable.");
      if(alive&&accountValueOwner.current===owner)setAccountValuation(value);
    }).catch(()=>{if(alive&&accountValueOwner.current===owner)setAccountValueUnavailable(true);}).finally(()=>{if(alive&&accountValueOwner.current===owner)setAccountValueLoading(false);});
    return()=>{alive=false;};
  },[session?.customer_id,session?.wallet_id,page,caps]);
  const enabledTradeCategories = tradeCategories.filter(([id]) => capability("trade." + (id === "crypto_spot" ? "spot" : id))?.enabled);
  useEffect(() => {
    if (!caps.length || enabledTradeCategories.some(([id]) => id === category)) return;
    setCategory(enabledTradeCategories[0]?.[0] ?? "unavailable"); setMarket(""); setMarkets([]); setQuote(null);
  }, [caps, category]);

  const executable = (module: string) =>
    capability(module)?.enabled &&
    capability(module)?.execution_status === "testnet_verified";
  // First-time Blend writes need a customer-preflight path before the module can
  // become testnet_verified. The API rechecks Gate 1 and live simulation before
  // returning any signable action.
  const canPrepareBlendAction = () =>
    capability("capital.lending")?.enabled &&
    ["discovery_only", "testnet_verified"].includes(
      capability("capital.lending")?.execution_status ?? "",
    ) &&
    capability("capital.wallets")?.execution_status === "testnet_verified";
  // Funding must allow the first real round trip after Gate 1. Capability stays
  // discovery_only until the first grant and customer return are chain-verified.
  const fundingCanStart = capability("capital.testnet_funding")?.enabled && assets.some((entry: any) => entry.available === true);
  const publicOwner=`${session?.customer_id??""}:${session?.wallet_id??""}:${category}:${page}`;
  const selectedCatalogMarket=markets.find(entry=>(entry.market_id??entry.id)===market);
  const selectedDetailScope=`${publicOwner}:${selectedCatalogMarket?.market_id??""}`;
  const selectedSpotMarket=selectedDetail?.scope===selectedDetailScope?{...selectedCatalogMarket,...selectedDetail.data}:selectedCatalogMarket;
  const detailLoading=detailState.scope===selectedDetailScope&&detailState.loading;
  const detailError=detailState.scope===selectedDetailScope?detailState.error:"";
  const publicMarketOwner=useRef("");publicMarketOwner.current=publicOwner;
  const detailRequestOwner=useRef("");detailRequestOwner.current=selectedDetailScope;
  useEffect(()=>{
    if(!session||!(category==="perps"||category==="stocks")||!(page==="markets"||page==="trade")||!capability("trade."+category)?.enabled)return;
    const owner=publicOwner,assetClass=category;let alive=true,inFlight=false,firstLoad=true;
    const isCurrent=()=>alive&&publicMarketOwner.current===owner;
    const refreshPublicMarkets=async()=>{
      if(inFlight||document.visibilityState!=="visible"||!isCurrent())return;
      inFlight=true;if(firstLoad)setMarketsLoading(!markets.some(entry=>isRecognizedDerivativeMarket(entry,assetClass)));
      try{const result=await api("grapnel/markets?asset_class="+assetClass),rows=Array.isArray(result)?result:result?.markets;
        if(!Array.isArray(rows))throw Error("Market data is unavailable.");
        if(isCurrent())setMarkets(rows.filter((entry:unknown)=>isRecognizedDerivativeMarket(entry,assetClass)));
      }catch{if(isCurrent())setMarkets(current=>current.map(clearMarketLiveFields));}
      finally{inFlight=false;firstLoad=false;if(isCurrent())setMarketsLoading(false);}
    };
    void refreshPublicMarkets();const timer=setInterval(()=>void refreshPublicMarkets(),15000);
    const visible=()=>{if(document.visibilityState==="visible")void refreshPublicMarkets();};document.addEventListener("visibilitychange",visible);
    return()=>{alive=false;clearInterval(timer);document.removeEventListener("visibilitychange",visible);};
  },[session?.customer_id,session?.wallet_id,category,page,caps]);
  useEffect(()=>{
    if(!session||!(category==="perps"||category==="stocks")||!isCurrentDerivativeMarket(selectedCatalogMarket,category)||!(page==="markets"||page==="trade")||!capability("trade."+category)?.enabled)return;
    const id=selectedCatalogMarket.market_id,assetClass=category,scope=selectedDetailScope;let alive=true,inFlight=false;
    const isCurrent=()=>alive&&detailRequestOwner.current===scope;
    setSelectedDetail({scope,data:clearMarketLiveFields(selectedCatalogMarket)});setDetailState({scope,loading:true,error:""});
    const load=async()=>{
      if(inFlight||document.visibilityState!=="visible"||!isCurrent())return;inFlight=true;
      if(isCurrent())setDetailState({scope,loading:true,error:""});
      try{const row=bindMarketDetail(await api("grapnel/market-detail?market_id="+encodeURIComponent(id)),id,assetClass);
        if(isCurrent()){setSelectedDetail({scope,data:row});setDetailState({scope,loading:false,error:""});}
      }catch{if(isCurrent()){setSelectedDetail({scope,data:clearMarketLiveFields(selectedCatalogMarket)});setDetailState({scope,loading:false,error:"Current market data could not be loaded. Refresh or select another market."});}}
      finally{inFlight=false;}
    };
    void load();const timer=setInterval(()=>void load(),15000);const visible=()=>{if(document.visibilityState==="visible")void load();};document.addEventListener("visibilitychange",visible);
    return()=>{alive=false;clearInterval(timer);document.removeEventListener("visibilitychange",visible);};
  },[session?.customer_id,session?.wallet_id,selectedCatalogMarket?.market_id,category,page,caps]);
  useEffect(() => { setMarketSearch(""); setMarketResultsOpen(false); }, [category]);
  useEffect(() => {
    if (category === "crypto_spot" || !markets.length || selectedSpotMarket) return;
    setMarket(markets[0].market_id ?? markets[0].id);
  }, [markets, category, market]);
  const activePublicHistory = marketHistory?.market_id===(selectedSpotMarket?.market_id??selectedSpotMarket?.id)&&historyScope===`${selectedSpotMarket?.market_id??selectedSpotMarket?.id}:${historyRange}`?marketHistory:null;
  const visiblePublicMarkets = markets.filter(entry => `${entry.underlying?.symbol ?? ""} ${entry.underlying?.name ?? ""} ${entry.provider_symbol??""} ${entry.label ?? ""}`.toLowerCase().includes(marketSearch.trim().toLowerCase()));
  useEffect(()=>{
    if((selectedSpotMarket?.network==="stellar-mainnet"||String(selectedSpotMarket?.market_id??"").startsWith("sodax:catalog:"))&&selectedSpotMarket?.history_available!==true){setHistoryLoading(false);return;}
    if(!session||!selectedSpotMarket||!(page==="markets"||page==="trade")||!capability("trade."+(category==="crypto_spot"?"spot":category))?.enabled){setHistoryLoading(false);return;}
    let alive=true,inFlight=false;setHistoryLoading(true);
    const expectedMarket=selectedSpotMarket.market_id??selectedSpotMarket.id;
    const refreshHistory=async()=>{if(inFlight)return;inFlight=true;await api(`grapnel/market-history?market_id=${encodeURIComponent(expectedMarket)}&range=${historyRange}`).then(result=>{
      if(alive&&result?.market_id===expectedMarket&&result.requested_range===historyRange&&typeof result.base_asset_id==="string"&&typeof result.base_symbol==="string"&&typeof result.quote_symbol==="string"&&Array.isArray(result.points)){setMarketHistory(result);setHistoryScope(`${expectedMarket}:${historyRange}`);}
    }).catch(()=>{}).finally(()=>{inFlight=false;if(alive)setHistoryLoading(false);});};
    void refreshHistory();
    const timer=setInterval(()=>{if(document.visibilityState==='visible')void refreshHistory();},historyRange==='live'?15000:60000);
    const visible=()=>{if(document.visibilityState==='visible')void refreshHistory();};document.addEventListener('visibilitychange',visible);
    return()=>{alive=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
  },[session?.customer_id,selectedSpotMarket?.market_id,selectedSpotMarket?.id,selectedSpotMarket?.history_available,category,page,historyRange,caps]);
  const swapAssetMap = new Map<string, SwapAsset>();
  for (const entry of markets) {
    for (const side of ["in", "out"] as const) {
      const id = entry[`asset_${side}_id`];
      if (typeof id !== "string" || !id) continue;
      const metadata = entry[`asset_${side}`];
      const sameIdentity = metadata?.id === id;
      const prior = swapAssetMap.get(id);
      swapAssetMap.set(id, {id, name: sameIdentity && metadata.verified === true && typeof metadata.name === "string" && metadata.name.trim() ? metadata.name.trim() : prior?.name, code: sameIdentity && typeof metadata.code === "string" && metadata.code ? metadata.code : id === XLM_ASSET ? "XLM" : id === USDC_ASSET ? "USDC" : "Token",
        decimals: sameIdentity && Number.isInteger(metadata.decimals) ? metadata.decimals : id === XLM_ASSET || id === USDC_ASSET ? 7 : undefined});
    }
  }
  const swapAssets = [...swapAssetMap.values()];
  const sellAssets = swapAssets.filter(item => markets.some(entry => entry.asset_in_id === item.id));
  const buyAssets = swapAssets.filter(item => markets.some(entry => entry.asset_in_id === selectedSpotMarket?.asset_in_id && entry.asset_out_id === item.id));
  const swapCode = (id?: string) => swapAssetMap.get(id ?? "")?.code ?? assetCode(id);
  const swapAssetLabel = (item: SwapAsset) => displayAssetIdentity(item,swapAssets);
  const swapIdentity = (id?: string) => { const item=swapAssetMap.get(id ?? ""); return item ? swapAssetLabel(item) : assetCode(id); };
  const swapBalance = (id: string | undefined, available = true) => {
    const observed = balances.find(entry => entry.asset_id === id);
    if (observed) return available ? observed.spendable : observed.wallet_amount;
    if (id === USDC_ASSET && usdcStatus) return available ? usdcStatus.spendable : usdcStatus.wallet_amount;
    return undefined;
  };
  const chooseSpotMarket = (next: any, clearAmount = true) => {
    if (!next) return;
    setMarket(next.market_id ?? next.id); setAsset(next.asset_in_id); setQuote(null); setSwapError("");
    if (clearAmount) setSwapAmount("");
  };
  useEffect(() => {
    if (category !== "crypto_spot" || !markets.length || selectedSpotMarket) return;
    chooseSpotMarket(markets.find(entry => entry.preparation_available || entry.executable) ?? markets[0], false);
  }, [markets, category, market]);
  const canPrepareSpot = !!session && category === "crypto_spot" && capability("trade.spot")?.enabled === true &&
    capability("capital.wallets")?.execution_status === "testnet_verified" &&
    typeof selectedSpotMarket?.asset_in_id === "string" && typeof selectedSpotMarket?.asset_out_id === "string" &&
    (selectedSpotMarket?.preparation_available === true || selectedSpotMarket?.executable === true);
  const pairUsesUsdc = selectedSpotMarket?.asset_in_id === USDC_ASSET || selectedSpotMarket?.asset_out_id === USDC_ASSET;
  const walletReadyForPair = !pairUsesUsdc || usdcStatus?.enabled === true;
  const quoteExpired = !quote || !Number.isFinite(Date.parse(quote.expires_at)) || Date.parse(quote.expires_at) <= quoteClock;
  const spotIntent:SpotQuoteIntent={market,input:selectedSpotMarket?.asset_in_id??"",output:selectedSpotMarket?.asset_out_id??"",amount:swapAmount,inputDecimals:swapAssetMap.get(selectedSpotMarket?.asset_in_id)?.decimals??7,outputDecimals:swapAssetMap.get(selectedSpotMarket?.asset_out_id)?.decimals??7,slippage:slippageBps};
  const validSwapAmount=validSpotAmount(swapAmount,spotIntent.inputDecimals);
  const quoteMatchesMarket=matchesSpotQuote(quote,spotIntent,quoteClock,false);
  const quoteContextKey=JSON.stringify([session?.customer_id,session?.wallet_id,page,category,spotIntent]);
  const quoteContext=useRef({key:quoteContextKey,intent:spotIntent});quoteContext.current={key:quoteContextKey,intent:spotIntent};
  const [quoteRead,setQuoteRead]=useState({key:"",loading:false});
  const quoteLoading=quoteRead.key===quoteContextKey&&quoteRead.loading;
  const quoteFlight=useRef<{key:string;promise:Promise<void>}|null>(null);
  const requestSwapQuote=useCallback(()=>{
    const {key,intent}=quoteContext.current;
    if(quoteFlight.current?.key===key)return quoteFlight.current.promise;
    setQuoteRead({key,loading:true});setSwapError("");
    const promise=(async()=>{
      const next=await readSpotQuoteWithRetry(()=>api("grapnel/quote",{market_id:intent.market,asset_id:intent.input,amount:intent.amount,slippage_bps:intent.slippage}),()=>quoteContext.current.key===key);
      if(quoteContext.current.key!==key)return;
      if(!matchesSpotQuote(next,intent))throw Error("The returned quote does not match your selected amount and assets.");
      setQuoteClock(Date.now());setQuote(next);
    })().finally(()=>{if(quoteContext.current.key===key)setQuoteRead({key,loading:false});if(quoteFlight.current?.promise===promise)quoteFlight.current=null;});
    quoteFlight.current={key,promise};return promise;
  },[]);
  useEffect(()=>{
    if(!session||!['markets','trade'].includes(page)||category!=="crypto_spot"||!canPrepareSpot||!walletReadyForPair||!validSwapAmount||busy||active||preparingAction||quoteMatchesMarket&&!quoteExpired)return;
    let alive=true;const load=()=>{if(document.visibilityState==='visible')void requestSwapQuote().catch(cause=>{if(alive)setSwapError(cause instanceof ClientError&&cause.status>=500?"The quote could not refresh. Try Get quote again.":cause instanceof Error?cause.message:"The quote could not be loaded. Try again.");});};
    const timer=setTimeout(load,450);document.addEventListener('visibilitychange',load);
    return()=>{alive=false;clearTimeout(timer);document.removeEventListener('visibilitychange',load);};
  },[quoteContextKey,canPrepareSpot,walletReadyForPair,validSwapAmount,busy,active,preparingAction,quoteMatchesMarket,quoteExpired,requestSwapQuote]);
  const spotInputCode = swapCode(selectedSpotMarket?.asset_in_id);
  const spotOutputCode = swapCode(selectedSpotMarket?.asset_out_id);
  const reverseSpotMarket = markets.find(entry => entry.asset_in_id === selectedSpotMarket?.asset_out_id && entry.asset_out_id === selectedSpotMarket?.asset_in_id);
  const quotedRate = quoteMatchesMarket && !quoteExpired ? quoteUnitRate(quote,swapAssetMap.get(quote.asset_in_id),swapAssetMap.get(quote.asset_out_id)) : null;

  const refresh = useCallback(async () => {
    let identity: Session | null = null;
    try {
      identity = await api("session");
      setSession(identity);
    } catch (error) {
      setSession(null);
      setBalances([]); setOperations([]); setAssets([]); setMarkets([]); setLending([]); setEarnBalances([]); setActive(null);setActionErrors({});
      if (!(error instanceof ClientError && error.status === 401))
        setError(error instanceof Error ? error.message : "Session check failed. Please retry.");
    } finally {
      setSessionChecked(true);
    }
    // Market and chain reads must never hold the login gate open.
    void Promise.allSettled([api("status"), api("grapnel/capabilities?readiness=omit")]).then(([configuration, capabilities]) => {
      if (configuration.status === "fulfilled") setStatus(configuration.value);
      if (capabilities.status === "fulfilled") setCaps(capabilities.value.capabilities ?? []);
      void api("grapnel/capabilities").then(result=>setCaps(result.capabilities??[])).catch(()=>{});
    });
    if (identity) {
      void Promise.allSettled([api("grapnel/balances"), api("grapnel/operations")]).then(([b, o]) => {
        if (b.status === "fulfilled") setBalances(Array.isArray(b.value) ? b.value : (b.value.balances ?? []));
        if (o.status === "fulfilled") setOperations(o.value.operations ?? []);
      });
    }
  }, []);
  useEffect(() => {
    void refresh().finally(() => setSessionChecked(true));
  }, [refresh]);
  useEffect(() => {
    if (!sessionChecked || (auth && !auth.ready)) return;
    if (!session && page !== "login") router.replace("/login");
    if (session && page === "login") router.replace("/home");
  }, [sessionChecked, session, auth?.ready, page, router]);
  useEffect(() => {
    if (!auth?.authenticated) { attemptedConnection.current = false; return; }
    if (!sessionChecked || !auth.ready || session || attemptedConnection.current) return;
    attemptedConnection.current = true;
    void action(async () => { await auth.connect(); await refresh(); });
  }, [sessionChecked, auth?.ready, auth?.authenticated, session, refresh]);
  useEffect(() => {
    if (!session) return;
    let alive = true;
    (async () => {
      try {
        if (fundingPage === "fund" || fundingPage === "return") {
          try {
            const a = await api("grapnel/funding-assets");
            if (alive) { setAssets(Array.isArray(a) ? a : (a.assets ?? [])); setFundingError(""); }
          } catch (error) {
            if (page !== "fund") throw error;
            if (alive) { setAssets([]); setFundingError(error instanceof Error ? error.message : "Treasury funding unavailable"); }
          }
        }
        if (page === "markets" || page === "trade") {
          const selected = caps.find(c => c.module === "trade." + (category === "crypto_spot" ? "spot" : category));
          if (category === "perps" || category === "stocks") {
            // Dedicated metadata and selected-detail polling above own these categories.
          } else if (selected?.enabled) {
            if (alive) setMarketsLoading(true);
            try {
              const m = await api("grapnel/markets?asset_class=" + category);
              const rows=Array.isArray(m)?m:(m.markets??[]);
              if (alive) setMarkets(rows.filter((entry:any) => category === "crypto_spot"
                ? typeof entry.asset_in_id === "string" && typeof entry.asset_out_id === "string" && entry.asset_in_id !== entry.asset_out_id
                : typeof (entry.market_id??entry.id) === "string" && (!entry.asset_class || entry.asset_class===category)));
              if (alive && category === "crypto_spot") void refreshUsdcStatus();
            } finally { if (alive) setMarketsLoading(false); }
          } else if (alive) { setMarkets([]); setMarketsLoading(false); }
        }
        if (page === "earn") {
          void refreshEarnBalances();
          setLendingLoading(true);
          try {
          const m = await api("grapnel/lending-markets");
          if (alive) setLending((Array.isArray(m) ? m : (m.markets ?? [])).filter((market: {asset_id:string}) => [
            "stellar-testnet:native:XLM",
            "stellar-testnet:classic:USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56",
          ].includes(market.asset_id)));
          } finally {if(alive)setLendingLoading(false);}
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Request failed");
      }
    })();
    return () => {
      alive = false;
    };
  }, [page, fundingPage, session, category, caps, refreshEarnBalances, refreshUsdcStatus]);
  useEffect(() => {
    if (active?.status !== "completed" || !session) return;
    if (page === "earn") void refreshEarnBalances();
    if (page === "borrow") void refreshBorrowing();
    if (page === "markets" || page === "trade") { setQuote(null); void refreshUsdcStatus(); }
  }, [page, session, active?.status, active?.operation_id, refreshEarnBalances, refreshUsdcStatus, refreshBorrowing]);
  useEffect(() => {
    if (
      !active ||
      [
        "completed",
        "failed",
        "rejected",
        "expired",
        "recovery_required",
        "awaiting_customer_authorization",
      ].includes(active.status)
    )
      return;
    let alive = true;
    if (polling.current.id !== active.operation_id)
      polling.current = { id: active.operation_id, attempt: 0 };
    const delay=operationPollDelay(polling.current.attempt++,document.visibilityState==='visible');
    const timer = setTimeout(async () => {
      try {
        const op = await api("grapnel/operations/" + active.operation_id);
        if (alive) {
          openOperation(op);
          if (op.status === "completed") await refresh();
        }
      } catch (e) {
        if (alive)
          setError(e instanceof Error ? e.message : "Status unavailable");
      }
    }, delay);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [active, refresh]);
  async function action(task: () => Promise<unknown>, location: string = "page") {
    setBusy(true);
    setBusyLocation(location);
    setError("");
    setSwapError("");
    if(location!=="page"&&location!=="swap")setActionErrors(current=>({...current,[location]:""}));
    try {
      await task();
    } catch (e) {
      if (location === "swap") {
        if (e instanceof ClientError && ["QUOTE_EXPIRED", "QUOTE_ALREADY_USED"].includes(e.code)) {
          setQuote(null);
          setSwapError(e.code === "QUOTE_EXPIRED" ? "This quote expired. Get a new quote to continue." : "This quote has already been used. Get a new quote to continue.");
        } else setSwapError(e instanceof Error ? e.message : "Request failed");
      } else if(location!=="page")setActionErrors(current=>({...current,[location]:e instanceof Error?e.message:"Request failed"}));
      else setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
      setBusyLocation(null);
    }
  }
  function openOperation(op: Operation) {
    const approved=marginReviewBindings.current.get(op.operation_id);
    if(approved){
      if(marginSession.current?.customer_id!==approved.owner.customer_id||marginSession.current?.wallet_id!==approved.owner.wallet_id||op.customer_id!==approved.owner.customer_id||op.wallet_id!==approved.owner.wallet_id)throw Error("Wallet action could not be found.");
      assertMarginPositionBinding(op,approved.binding.position_id);
    }
    visibleOperation.current=op.operation_id;
    setPreparingAction(null);setActive(op);
    setOperations(current => [op, ...current.filter(item => item.operation_id !== op.operation_id)]);
  }
  async function resumeOperation(id: string) {
    if (!session || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw Error("Wallet action could not be found.");
    const cached=operations.find(op=>op.operation_id===id&&op.customer_id===session.customer_id&&op.wallet_id===session.wallet_id);
    if(cached)openOperation(cached);else setPreparingAction('Transaction details');
    let op:Operation;try{op=await api("grapnel/operations/"+id);}catch(cause){setPreparingAction(null);throw cause;}
    if (op.customer_id !== session.customer_id || op.wallet_id !== session.wallet_id) throw Error("Wallet action could not be found.");
    if(marginPositionAction(op)&&["accepted","validating","preparing","awaiting_customer_authorization"].includes(op.status)){
      const parents=await api("grapnel/margin/workflows");
      const parent=parents.workflows?.find((entry:{active_operation_id:string|null})=>entry.active_operation_id===id);
      if(!parent||parent.customer_id!==session.customer_id||parent.wallet_id!==session.wallet_id)throw Error("Open the saved margin setup to review this position transaction.");
      await reviewMarginOperation(id,session,{workflow_id:parent.workflow_id,position_id:parent.position_id});return;
    }
    openOperation(op);
    return op as Operation;
  }
  async function reviewMarginOperation(id:string,owner:{customer_id:string;wallet_id:string},binding?:MarginReviewBinding) {
    const current=marginSession.current;
    if(!current||current.customer_id!==owner.customer_id||current.wallet_id!==owner.wallet_id||!/^[0-9a-f-]{36}$/i.test(id))throw Error("Wallet action could not be found.");
    const op=await api("grapnel/operations/"+id);
    if(marginSession.current?.customer_id!==owner.customer_id||marginSession.current.wallet_id!==owner.wallet_id||op.customer_id!==owner.customer_id||op.wallet_id!==owner.wallet_id)throw Error("Wallet action could not be found.");
    if(marginPositionAction(op)){
      if(!binding)throw Error("Position binding is unavailable.");
      const parent=await api("grapnel/margin/workflows/"+binding.workflow_id);
      if(marginSession.current?.customer_id!==owner.customer_id||marginSession.current.wallet_id!==owner.wallet_id||parent.workflow_id!==binding.workflow_id||parent.customer_id!==owner.customer_id||parent.wallet_id!==owner.wallet_id||parent.position_id!==binding.position_id)throw Error("Margin workflow does not match this transaction. Check progress before approving.");
      if(["accepted","validating","preparing","awaiting_customer_authorization"].includes(op.status)&&parent.active_operation_id!==id)throw Error("Margin workflow does not match this transaction. Check progress before approving.");
      assertMarginPositionBinding(op,parent.position_id);
      marginReviewBindings.current.set(id,{owner,binding});
    }
    openOperation(op);
  }
  async function recoverPendingWalletAction(cause: ClientError) {
    const result = await api("grapnel/operations");
    const rows: Operation[] = Array.isArray(result.operations) ? result.operations : [];
    setOperations(rows);
    const detailId = cause.details.operation_id;
    const pending = rows.find(op => op.wallet_id === session?.wallet_id && !["completed", "failed", "rejected", "expired"].includes(op.status));
    const id = typeof detailId === "string" ? detailId : pending?.operation_id;
    if (!id) throw Error("The earlier wallet action has ended. Try your action again to prepare a fresh transaction.");
    await resumeOperation(id);
  }
  async function start(path: string, body: unknown) {
    if(!session)throw Error('A current customer session is required');
    const key=operationRequestKey(session.customer_id,path,body);
    const preparingTitle=path==='fund'?'Get funds':path==='return'?'Return funds':path==='order'?'Swap':path.includes('withdraw')?'Withdraw':path.includes('supply')?'Supply':path.includes('borrow')?'Borrow':path.includes('repay')?'Repay':'Wallet action';
    setPreparingAction(preparingTitle);
    let op;
    try{
      op=await api('grapnel/'+path,body,'POST',key);
    }catch(error){
      setPreparingAction(null);
      if(error instanceof ClientError && error.status<500 && error.status!==408)clearOperationRequest(session.customer_id,path,body);
      if (error instanceof ClientError && error.code === "WALLET_OPERATION_PENDING") {
        await recoverPendingWalletAction(error);
        return;
      }
      throw error;
    }
    if(marginSession.current?.customer_id!==session.customer_id||marginSession.current?.wallet_id!==session.wallet_id){setPreparingAction(null);throw Error('Your wallet session changed.');}
    if(!op?.operation_id){setPreparingAction(null);throw Error('Operation status is uncertain; retry this same action to recover it');}
    clearOperationRequest(session.customer_id,path,body);
    openOperation(op);
    const owner={customer_id:session.customer_id,wallet_id:session.wallet_id};
    for(let attempt=0;['accepted','validating','preparing'].includes(op.status)&&attempt<20;attempt++){
      await new Promise(resolve=>setTimeout(resolve,1000));
      if(marginSession.current?.customer_id!==owner.customer_id||marginSession.current?.wallet_id!==owner.wallet_id)throw Error('Your wallet session changed.');
      op=await api('grapnel/operations/'+op.operation_id);
      if(op.customer_id!==owner.customer_id||op.wallet_id!==owner.wallet_id)throw Error('This action belongs to another wallet session.');
      openOperation(op);
    }
    if(op.status==='awaiting_customer_authorization'){
      op=await currentCustomerOperation(op,owner,id=>api('grapnel/operations/'+id));
      if(marginSession.current?.customer_id!==owner.customer_id||marginSession.current?.wallet_id!==owner.wallet_id)throw Error('Your wallet session changed.');
      openOperation(op);
      if(op.status==='awaiting_customer_authorization')await approve(op);
    }
  }
  async function approve(operation:Operation|null=active) {
    if (
      !operation?.prepared_action ||
      !operation.customer_action_token ||
      !auth ||
      !session
    )
      throw Error("A current customer authorization is required");
    if(marginSession.current?.customer_id!==session.customer_id||marginSession.current?.wallet_id!==session.wallet_id)throw Error('Your wallet session changed.');
    if(Date.parse(operation.prepared_action.summary.expiresAt)<=Date.now())throw Error("This approval has expired. Refresh the operation before continuing.");
    if(operation.customer_id!==session.customer_id||operation.wallet_id!==session.wallet_id)throw Error("This action belongs to another wallet session.");
    if(authorizationAttempts.current.has(operation.operation_id))throw Error('Check this transaction’s status before trying again.');
    setOperationError('');
    try{await trackApproval(async()=>{
      if(signingOperations.current.has(operation.operation_id))throw Error('Wallet authorization is already open.');
      signingOperations.current.add(operation.operation_id);
      try{return await auth.sign(operation.prepared_action!,session.stellar_address);}finally{signingOperations.current.delete(operation.operation_id);}
    },async signed=>{
      if(marginSession.current?.customer_id!==session.customer_id||marginSession.current?.wallet_id!==session.wallet_id)throw Error('Your wallet session changed.');
      if(authorizationAttempts.current.has(operation.operation_id))throw Error('This signed transaction is already being checked.');
      authorizationAttempts.current.add(operation.operation_id);
      try {
        openOperation(await api(`grapnel/operations/${operation.operation_id}/authorize`, {
          customer_action_token: operation.customer_action_token,
          signed_xdr: signed,
        }));
      } catch (cause) {
        // Recover status only: authorization may have committed before a timeout.
        // Never automatically sign again or resend a financial request here.
        try { openOperation(await api(`grapnel/operations/${operation.operation_id}`)); } catch { /* retain the known operation for manual recovery */ }
        throw cause;
      }
    },phase=>{
      if(phase){if(visibleOperation.current===operation.operation_id)setApprovalPhase({operationId:operation.operation_id,phase});}
      else setApprovalPhase(current=>current?.operationId===operation.operation_id?null:current);
    });}catch(cause){setOperationError(cause instanceof Error?cause.message:'Transaction authorization could not be completed.');throw cause;}
  }

  const connect = () =>
    action(async () => {
      if (!auth) throw Error("Customer sign-in is unavailable");
      if (!auth.authenticated) {
        auth.login();
        return;
      }
      await auth.connect();
      await refresh();
    });
  const pendingWalletAction = operations.find(op => op.wallet_id === session?.wallet_id && !["completed", "failed", "rejected", "expired"].includes(op.status));
  const approvalExpired = active?.status === "awaiting_customer_authorization" && !!active.prepared_action && Date.parse(active.prepared_action.summary.expiresAt) <= approvalClock;
  if (!sessionChecked || (auth && !auth.ready) || !session) {
    const loading = !loginTimedOut && (!sessionChecked || (auth && !auth.ready));
    return (
      <main className="login-screen">
        <section className="login-card">
          <div className="velocity-login-brand"><VelocityBrand/></div>

          <h1>{loading ? "Opening your workspace…" : "Welcome to Velocity."}</h1>
          <p>Sign in to connect your wallet and open your dashboard.</p>
          {loginTimedOut && <p className="login-error" role="alert">Sign-in is taking too long. Retry the connection.</p>}
          {error && <p className="login-error" role="alert">{customerMessage(error)}</p>}
          <button className="button" onClick={loginTimedOut ? () => action(async () => { if (!auth) throw Error("Customer sign-in is unavailable"); await auth.logout(); window.location.reload(); }) : connect} disabled={loading || busy || !auth}>
            {loginTimedOut ? "Retry connection" : loading ? "Checking session…" : busy ? "Connecting wallet…" : auth?.authenticated ? "Connect wallet" : "Sign in"}
            {!loading && !busy && <Icon name="arrow" size={16} />}
          </button>
          {!auth && <p className="login-error">Customer login is currently unavailable.</p>}

        </section>
      </main>
    );
  }
  return (
    <div className="app">
      <aside className="sidebar">
        <Link className="brand velocity-brand" href="/home" aria-label="Velocity home">
          <VelocityBrand/>
          <VelocityBrand compact/>
        </Link>
        <nav aria-label="Main navigation">
          {nav.filter(([id])=>id!=="borrow"||capability("capital.lending")?.enabled).map(([id, label]) => (
            <Link
              key={id}
              href={id==="markets"?`/markets?category=${category==="unavailable"?"crypto_spot":category}`:"/" + id}
              prefetch={true}
              onNavigate={()=>setNavigationTarget(id)}
              className={
                (navigationTarget??page) === id || (id === "markets" && (navigationTarget??page) === "trade")
                  ? "nav-link current"
                  : "nav-link"
              }
            >
              <Icon name={id === "funds" ? "fund" : id!} />
              {label}{navigationTarget===id&&<span className="nav-loading" aria-label="Opening page"><span className="operation-spinner" aria-hidden="true"/></span>}

            </Link>
          ))}
        </nav>
        <div className="sidebar-account">
            {session ? (
              <div className="profile-container" ref={profileContainer} onBlur={event=>{if(event.relatedTarget instanceof Node&&!event.currentTarget.contains(event.relatedTarget))setProfileOpen(false);}}>
                <button className="avatar" ref={profileTrigger} type="button" aria-label="Open account menu" aria-expanded={profileOpen} aria-controls="account-profile-menu" aria-haspopup="dialog" data-testid="profile-button" onClick={()=>setProfileOpen(current=>!current)}>V</button>
                {profileOpen&&<section className="profile-panel" id="account-profile-menu" ref={profilePanel} tabIndex={-1} role="dialog" aria-label="Your account" data-testid="account-menu">
                  <div className="profile-panel-heading"><strong>Your account</strong><span className="profile-connected"><span aria-hidden="true"/>Wallet connected</span></div>
                  <div className="profile-valuation" aria-live="polite" aria-busy={valuationLoading}>
                    <span>Wallet value</span>
                    {valuationLoading?<p className="small muted" role="status">Loading wallet value…</p>:valuationUnavailable||!walletValuation?<><strong>—</strong><p className="small muted" role="status">Value unavailable</p></>:<>
                      {walletValuation.unpriced_asset_count>0&&<small>Priced assets</small>}
                      <strong data-testid="profile-wallet-value">{profileValue==null?"—":formatTokenAmount(profileValue)}{profileValue!=null?" USD":""}</strong>
                      {walletValuation.unpriced_asset_count>0&&<p className="small muted">{walletValuation.unpriced_asset_count} {walletValuation.unpriced_asset_count===1?"asset":"assets"} not priced</p>}
                      <time dateTime={walletValuation.as_of} title={marketDate(walletValuation.as_of,true,true)}>Updated {new Date(walletValuation.as_of).toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"})}</time>
                    </>}
                  </div>
                  <button className="profile-logout" type="button" disabled={busy} onClick={()=>action(async()=>{
                    if(auth)await auth.logout();else await api("session",undefined,"DELETE");
                    setProfileOpen(false);setWalletValuation(null);setSession(null);setBalances([]);setOperations([]);setAssets([]);setMarkets([]);setLending([]);setEarnBalances([]);setActive(null);setActionErrors({});
                  })}>Logout</button>
                </section>}
              </div>
            ) : (
              <button
                className="button small-button"
                onClick={connect}
                disabled={busy || (!auth?.ready && !!auth)}
              >
                Connect wallet <Icon name="arrow" size={16} />
              </button>
            )}
        </div>
      </aside>
      <div className="main">
        <main>
          <div className="page-heading">
            <div>

              <h1>{(page==="markets"||page==="trade")&&category!=="crypto_spot"?"Markets":title[page]}</h1>

            </div>
          </div>
          {pendingWalletAction && !active && (
            <div className="notice neutral" role="status">
              <Icon name="wallet" />
              <div><strong>{pendingWalletAction.status === "awaiting_customer_authorization" ? "Wallet approval waiting" : "Wallet action in progress"}</strong>
                <p>{activityLabel(pendingWalletAction)} · <OperationProgress status={pendingWalletAction.status}/>. Open the existing action before preparing another.</p>
              </div>
              <button className="button outline" disabled={busy} onClick={() => action(() => resumeOperation(pendingWalletAction.operation_id))}>
                {pendingWalletAction.status === "awaiting_customer_authorization" ? "Resume approval" : "Check status"}
              </button>
            </div>
          )}
          {error && !active && !((page === "markets" || page === "trade") && swapError) && (
            <div className="notice error" role="alert">
              <strong>Request unavailable</strong>
              <span>{customerMessage(error)}</span>
              <button onClick={() => setError("")} aria-label="Dismiss error">
                ×
              </button>
            </div>
          )}
          {status &&
            (!status.grapnel_configured ||
              !status.privy_configured ||
              !status.session_configured) && (
              <div className="notice setup">
                <Icon name="shield" />
                <div>
                  <strong>Connection unavailable</strong>
                  <p>Some wallet services are unavailable. Please try again.</p>
                </div>
              </div>
            )}
          {(page === "home" || page === "login") && (
            <>
              <section className="overview-grid">
                <div className="wallet-hero">
                  <div className="wallet-label">
                    <span>
                      <Icon name="wallet" /> YOUR WALLET
                    </span>
                    <span className="hero-dot">●</span>
                  </div>
                  <div className="wallet-hero-content"><div className="wallet-hero-account">
                  <h2>
                    {session
                      ? "Your wallet is connected."
                      : "Your next step starts here."}
                  </h2>
                  {!session&&<p>Sign in to connect your wallet.</p>}
                  <div className="wallet-address">
                    {session ? (
                      <>
                        <a
                          href={
                            "https://stellar.expert/explorer/testnet/account/" +
                            session.stellar_address
                          }
                          target="_blank"
                          rel="noreferrer"
                        >
                          View Account ↗
                        </a>
                      </>
                    ) : (
                      <span>Wallet not connected</span>
                    )}
                  </div>
                  <div className="hero-buttons">
                    {session ? (
                      <>
                        <Link className="button light" href="/funds">
                          <Icon name="fund" size={17} /> Get funds
                        </Link>
                        <Link className="button ghost" href="/funds">
                          Return funds <Icon name="arrow" size={16} />
                        </Link>
                      </>
                    ) : (
                      <button
                        className="button light"
                        onClick={connect}
                        disabled={busy || !auth}
                      >
                        {auth?.authenticated
                          ? "Connect my wallet"
                          : "Sign in"}
                        <Icon name="arrow" size={17} />
                      </button>
                    )}
                  </div>
                  </div><section className="account-assets-total" aria-label="Account assets" data-testid="account-assets-total" title={accountValuation?.as_of?`As of ${marketDate(accountValuation.as_of,true,true)}`:undefined}>
                    <span className="account-assets-label">{accountPartial?"Estimated priced assets":"Total Assets"}</span>
                    <strong className="account-assets-value" aria-live="polite">{accountValueLoading||accountValueUnavailable||!accountValuation?"—":accountTotal==null?"—":groupedUsd(accountTotal)}</strong>
                    {accountValuation?.as_of&&<small><time dateTime={accountValuation.as_of}>as of {balanceTimestamp(accountValuation.as_of)}</time></small>}
                  </section></div>
                </div>
              </section>
              <section className="section">
                <div className="section-heading">
                  <h2>Your assets</h2>

                </div>
                <BalanceTable valuation={walletValuation} balances={[...balances.map(b=>({...b,network_label:"Stellar",feature_label:"Wallet"})),...networkAssets.filter(b=>!(["TSLA","AMZN","PLTR","NFLX","AMD"].includes(b.asset?.code)&&typeof b.wallet_amount==="string"&&/^0+(?:\.0+)?$/.test(b.wallet_amount)))]} connected={!!session} hideZeroBalances />
              </section>
              <section className="market-overview" aria-label="Market overview" data-testid="market-overview">
                {overviewGroups.filter(group=>capability(group.module)?.enabled).map(group=>{
                  const section=overviewSections.find(entry=>entry.id===group.id);
                  const items=(section?.available?section.items:[]).filter(item=>typeof item.value==="string"&&/^\d+(?:\.\d+)?$/.test(item.value)&&(item.unit==="USD"||item.unit==="percent")&&Number.isFinite(Date.parse(item.as_of))).slice(0,3);
                  return <section className="overview-market-group" key={group.id} aria-label={group.label} data-testid={`overview-${group.id}`}>
                    <Link className="overview-market-heading" href={group.href}><h3>{group.label}</h3><Icon name="arrow" size={15} /></Link>
                    {items.length?<ul>{items.map(item=><li key={`${item.symbol}:${item.name}`}><div className="overview-asset-identity"><AssetLogo symbol={item.symbol} name={item.name} size={26} /><div><strong title={item.name}>{item.symbol}</strong></div></div><span className="overview-market-value">{item.unit==="USD"?groupedUsd(item.value):formatTokenAmount(item.value)+"%"}{item.unit_detail&&<small>{item.unit_detail}</small>}</span></li>)}</ul>:<p className="small muted" role="status">{overviewLoading?"Loading prices":"Prices updating"}</p>}
                  </section>;
                })}
              </section>
              {session && capability("capital.wallets")?.execution_status !== "testnet_verified" && (
                <section className="proof-card">
                  <div>
                    <strong>Enable transfers</strong>
                    <p>
                      Review a 0.1 XLM payment to enable transfers.
                    </p>
                  </div>
                  <button
                    className="button outline"
                    disabled={busy}
                    onClick={() =>
                      action(() => start("test-payment", { amount: "0.1" }))
                    }
                  >
                    Prepare payment <Icon name="arrow" size={16} />
                  </button>
                </section>
              )}
            </>
          )}
          {(fundingPage === "fund"||fundingPage === "return") && <>
            <section className="section" aria-label="Current wallet balances">
              <div className="section-heading"><h2>Your wallet balances</h2></div>
              <BalanceTable valuation={walletValuation} balances={[...balances.map(b=>({...b,network_label:"Stellar",feature_label:"Wallet"})),...networkAssets.filter(b=>!(["TSLA","AMZN","PLTR","NFLX","AMD"].includes(b.asset?.code)&&typeof b.wallet_amount==="string"&&/^0+(?:\.0+)?$/.test(b.wallet_amount)))]} connected={!!session} hideZeroBalances />
            </section>
          </>}
          {(fundingPage === "fund" || fundingPage === "return") && (
            <div className="form-layout">
              <section className="card transaction-form" id={fundingPage === "fund" ? "treasury-funding" : undefined}>
                <div className="tabs funds-tabs" role="tablist" aria-label="Funds action">
                  <button role="tab" aria-selected={fundingPage === "fund"} className={fundingPage === "fund" ? "selected" : ""} disabled={busy}
                    onClick={() => { setFundsDirection("fund"); setError(""); }}>Get funds</button>
                  <button role="tab" aria-selected={fundingPage === "return"} className={fundingPage === "return" ? "selected" : ""} disabled={busy}
                    onClick={() => { setFundsDirection("return"); setError(""); }}>Return funds</button>
                </div>
                <span className="feature-icon blue">
                  <Icon name={fundingPage} />
                </span>
                <h2>
                  {fundingPage === "fund"
                    ? "Get funds"
                    : "Return funds"}
                </h2>

                <label htmlFor="asset">Asset</label>
                <div className="funding-asset-field"><AssetLogo symbol={assets.find(entry=>entry.asset_id===asset)?.asset?.code??assetCode(asset)} name={assets.find(entry=>entry.asset_id===asset)?.asset?.name} assetId={asset} size={28} />
                <select
                  id="asset"
                  value={asset}
                  onChange={(e) => setAsset(e.target.value)}
                >
                  {assets.length ? (
                    assets.map((a) => (
                      <option key={a.asset_id} value={a.asset_id}>
                        {a.asset?.code ?? a.code ?? assetCode(a.asset_id)}
                      </option>
                    ))
                  ) : (
                    <option value="stellar-testnet:native:XLM">
                      XLM
                    </option>
                  )}
                </select></div>
                <label htmlFor="amount">Amount</label>
                <div className="amount-input">
                  <input
                    id="amount"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    inputMode="decimal"
                    autoComplete="off"
                  />
                  <span>
                    {assets.find((a) => a.asset_id === asset)?.asset?.code ??
                      "XLM"}
                  </span>
                </div>

                {fundingPage==="fund"&&<div className="detail-row"><span>Treasury inventory</span><strong>{assets.find(entry=>entry.asset_id===asset)?.treasury_available?formatTokenAmount(assets.find(entry=>entry.asset_id===asset).treasury_available)+" "+(assets.find(entry=>entry.asset_id===asset)?.asset?.code??assetCode(asset)):"Not yet available"}</strong></div>}
                <div className="inline-note funding-available">Available: <strong>{formatTokenAmount(swapBalance(asset))} {assets.find(entry=>entry.asset_id===asset)?.asset?.code??assetCode(asset)}</strong></div>
                {(fundingError||!fundingCanStart&&capability("capital.testnet_funding")?.reason)&&<p className="swap-action-error" role="alert">{customerMessage(fundingError||capability("capital.testnet_funding")?.reason||"")}</p>}
                {actionErrors.funds&&<p className="swap-action-error" role="alert">{customerMessage(actionErrors.funds)}</p>}
                <button
                  className="button wide"
                  aria-label={fundingPage==="fund"?"Get funds":"Return funds"}
                  disabled={
                    busy || !session || !(executable("capital.testnet_funding") || (fundingPage === "fund" || fundingPage === "return") && fundingCanStart)
                  }
                  onClick={() =>
                    action(() => start(fundingPage, { asset_id: asset, amount }), "funds")
                  }
                >
                  {busy
                    ? <ProgressIndicator label="Processing" spinning/>
                    : fundingPage === "fund"
                      ? "Get funds"
                      : "Return funds"}
                  <Icon name="arrow" size={17} />
                </button>

              </section>

            </div>
          )}
          {(page === "markets" || page === "trade") && (
            <>
              <div className="tabs">
                {enabledTradeCategories.map(([id, label]) => (
                  <button
                    className={category === id ? "selected" : ""}
                    data-testid={`markets-category-${id}`}
                    key={id}
                    disabled={busy}
                    onClick={() => {
                      if(category===id)return;
                      setCategory(id!);
                      router.replace(`/${page}?category=${id}`,{scroll:false});
                      setError("");
                      setMarket("");
                      setMarkets([]);
                      setMarketsLoading(true);
                      setQuote(null);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {category !== "crypto_spot" && category !== "unavailable" && (
                <section className="card public-market-browser" aria-label="Available markets" data-testid="market-list">
                  <div className="section-heading"><h2>Find a market</h2><span className="small muted">{markets.length} markets</span></div>
                  <div className="public-market-search-row"><label className="market-search-label">Search markets<input type="search" aria-label="Search markets" data-testid="market-search" value={marketSearch} onFocus={()=>setMarketResultsOpen(true)} onChange={event=>{setMarketSearch(event.target.value);setMarketResultsOpen(true);}} placeholder="Search by name or symbol" /></label><button type="button" className="button outline" data-testid="market-browse-toggle" aria-expanded={marketResultsOpen} aria-controls="public-market-options" onClick={()=>setMarketResultsOpen(current=>!current)}>Browse markets</button></div>
                  {marketsLoading ? <p className="small muted" role="status">Loading markets…</p> : marketResultsOpen && visiblePublicMarkets.length ? <div className="public-market-options" id="public-market-options">
                    {visiblePublicMarkets.map(entry=><button type="button" key={entry.market_id??entry.id} data-testid={`market-option-${entry.underlying?.symbol??entry.market_id}`} aria-label={`${entry.underlying?.symbol??entry.label} ${(category==="perps"||entry.instrument_type==="perpetual_futures")?(entry.asset_category==="equity"?"stock perpetual":entry.asset_category==="index"?"index perpetual":"perpetual"):"stock"}`} aria-pressed={(entry.market_id??entry.id)===market}
                      onClick={()=>{setMarket(entry.market_id??entry.id);setMarketResultsOpen(false);}}><span className="public-market-symbol"><AssetLogo symbol={entry.underlying?.symbol??entry.label} name={entry.underlying?.name} assetId={entry.market_id??entry.id} providerSymbol={entry.provider_symbol} size={24} />{entry.underlying?.symbol??entry.label}</span><span className="public-market-name">{entry.underlying?.name??entry.label}</span><strong>{entry.reference_price==null?"—":formatTokenAmount(entry.reference_price)}{entry.reference_price!=null&&<small> {entry.reference_quote_symbol??entry.quote_symbol??"—"}</small>}</strong>{entry.price_status==="stale"&&<span className="public-market-delay">Delayed</span>}</button>)}
                  </div> : (!markets.length||marketResultsOpen) ? <p className="small muted" role="status">{markets.length?"No matching markets.":"No markets available."}</p> : null}
                </section>
              )}
              {(category === "perps" || category === "stocks") && selectedSpotMarket ? (
                <>
                  <div className="market-detail-layout">
                    <section className="market-price-card" aria-label="Asset price" data-testid={category==="perps"?"perps-market-detail":"stocks-market-detail"}>
                      <div className="market-asset-heading"><AssetLogo symbol={selectedSpotMarket.underlying?.symbol??selectedSpotMarket.label} name={selectedSpotMarket.underlying?.name} assetId={selectedSpotMarket.market_id??selectedSpotMarket.id} providerSymbol={selectedSpotMarket.provider_symbol} size={48} /><div><h2>{selectedSpotMarket.underlying?.name??selectedSpotMarket.label}</h2><span>{selectedSpotMarket.underlying?.symbol} {(category==="perps"||selectedSpotMarket.instrument_type==="perpetual_futures")?(selectedSpotMarket.asset_category==="equity"?"stock perpetual":selectedSpotMarket.asset_category==="index"?"index perpetual":"perpetual"):"stock"}</span></div></div>
                      <div className="market-price-heading"><strong>{selectedSpotMarket.reference_price==null?"—":formatTokenAmount(selectedSpotMarket.reference_price)}</strong><span>{selectedSpotMarket.reference_quote_symbol??selectedSpotMarket.quote_symbol??activePublicHistory?.quote_symbol??"—"} per {selectedSpotMarket.underlying?.symbol}</span></div>
                      <div className={`public-market-freshness ${selectedSpotMarket.price_status==="stale"?"delayed":""}`} data-testid="market-price-freshness">{detailLoading&&selectedSpotMarket.reference_price==null?<ProgressIndicator label="Loading current price" spinning/>:selectedSpotMarket.price_status==="current"?"Current price":selectedSpotMarket.price_status==="stale"?"Price delayed":"—"}</div>
                      <div className={`market-price-change ${changeDirection(activePublicHistory?.change_absolute)}`} aria-label="Price change"><strong>{activePublicHistory&&activePublicHistory.points.length>1?displayChange(activePublicHistory.change_absolute):"—"}</strong><span>{activePublicHistory&&activePublicHistory.points.length>1?`${selectedSpotMarket.reference_quote_symbol??selectedSpotMarket.quote_symbol??activePublicHistory.quote_symbol} (${displayChange(activePublicHistory.change_percent)}%)`: "(—)"}</span></div>
                      <PriceChart history={activePublicHistory} loading={historyLoading} range={historyRange} />
                      <div className="market-periods" role="group" aria-label="Price timeframe">{(["live","1d","1w","1m","1y","all"] as const).map(period=><button type="button" key={period} aria-pressed={historyRange===period} onClick={()=>setHistoryRange(period)}>{period.toUpperCase()}</button>)}</div>
                      {category==="stocks"&&selectedSpotMarket.instrument_type!=="perpetual_futures"&&activePublicHistory?.metrics&&<dl className="public-market-stats" data-testid="stock-market-metrics">
                        {([["day_high","Day high"],["day_low","Day low"],["previous_close","Previous close"],["fifty_two_week_high","52-week high"],["fifty_two_week_low","52-week low"],["day_volume","Day volume"]] as const).map(([field,label])=><div key={field}><dt>{label}</dt><dd>{activePublicHistory.metrics?.[field]==null?"—":`${formatTokenAmount(activePublicHistory.metrics[field])} ${field==="day_volume"?"shares":activePublicHistory.quote_symbol}`}</dd></div>)}
                      </dl>}
                      {(category==="perps"||selectedSpotMarket.instrument_type==="perpetual_futures")&&<PerpetualMarketMetrics stats={selectedSpotMarket.perpetuals_stats} symbol={selectedSpotMarket.underlying?.symbol??selectedSpotMarket.label} maxLeverage={selectedSpotMarket.max_leverage} quoteSymbol={selectedSpotMarket.quote_symbol} settlementAsset={selectedSpotMarket.settlement_asset}/>}
                      {category==="stocks"&&selectedSpotMarket.instrument_type!=="perpetual_futures"&&selectedSpotMarket.stats&&<>
                        <dl className="public-market-stats" data-testid="market-stats">
                          <div><dt>24h volume</dt><dd>{displayPublicNotional(selectedSpotMarket.stats.volume_24h_atomic)}</dd></div>
                          <div><dt>Open positions</dt><dd>{selectedSpotMarket.stats.open_positions??"—"}</dd></div>
                          <div><dt>Long open interest</dt><dd>{displayPublicNotional(selectedSpotMarket.stats.open_interest_long_atomic)}</dd></div>
                          <div><dt>Short open interest</dt><dd>{displayPublicNotional(selectedSpotMarket.stats.open_interest_short_atomic)}</dd></div>
                          <div><dt>Net open interest</dt><dd>{displayPublicNotional(selectedSpotMarket.stats.open_interest_net_atomic)}</dd></div>
                          <div><dt>Maximum position</dt><dd>{displayPublicNotional(selectedSpotMarket.stats.capacity?.max_position_size_atomic)}</dd></div>
                          <div><dt>Long capacity available</dt><dd>{displayPublicNotional(selectedSpotMarket.stats.capacity?.headroom_long_atomic)}</dd></div>
                          <div><dt>Short capacity available</dt><dd>{displayPublicNotional(selectedSpotMarket.stats.capacity?.headroom_short_atomic)}</dd></div>
                        </dl>
                        {(selectedSpotMarket.stats.pool?.stale===true||selectedSpotMarket.stats.custody?.stale===true)&&<p className="small muted">Market activity delayed</p>}
                      </>}
                    </section>
                    {selectedSpotMarket.provider==="zenex"&&session&&auth?.signRawHash ? <ZenexPerpetualExecution key={`${session.customer_id}:${session.wallet_id}`} api={api} customerId={session.customer_id} walletId={session.wallet_id} address={session.stellar_address} sign={auth.signRawHash}/> : selectedSpotMarket.provider==="robinhood"&&session ? <RobinhoodExecution key={`${session.customer_id}:${session.wallet_id}:${selectedSpotMarket.market_id}`} api={api} customerId={session.customer_id} walletId={session.wallet_id} symbol={selectedSpotMarket.underlying?.symbol as "TSLA"|"AMZN"|"PLTR"|"NFLX"|"AMD"}/> : selectedSpotMarket.provider==="gmx"&&session ? <GmxPerpetualExecution key={`${session.customer_id}:${session.wallet_id}:${selectedSpotMarket.market_id}`} api={api} customerId={session.customer_id} walletId={session.wallet_id} symbol={selectedSpotMarket.provider_symbol as import("../lib/gmx-customer").GmxCustomerSymbol} onSelectMarket={next=>setMarket(`gmx-testnet:perps:${next}`)}/> : (category==="perps"||selectedSpotMarket.instrument_type==="perpetual_futures") ? (auth?.signRawHash&&session?<PrivyPerpetualExecution key={`${session.customer_id}:${session.wallet_id}:${selectedSpotMarket.market_id}`} api={api} customerId={session.customer_id} walletId={session.wallet_id} stellarAddress={session.stellar_address} signRawHash={auth.signRawHash} market={selectedSpotMarket} onSetup={async(kind,amount)=>{openOperation(await api(`grapnel/perps-funding-${kind}`,{asset_class:"perps",...(amount?{amount}:{})}));}}/>:<PerpetualOrderPreview symbol={selectedSpotMarket.underlying?.symbol??selectedSpotMarket.label} price={selectedSpotMarket.reference_price} quoteSymbol={selectedSpotMarket.quote_symbol} settlementAsset={selectedSpotMarket.settlement_asset} stock={category==="stocks"||selectedSpotMarket.asset_category==="equity"} index={selectedSpotMarket.asset_category==="index"} error={detailError} loading={detailLoading}/>) : <section className="market-order-card" aria-label="Trade market" data-testid="market-order-card">
                      <h2>Trade {selectedSpotMarket.underlying?.symbol}</h2>
                      <div className="public-order-direction" role="group" aria-label="Order direction"><button type="button" disabled>Buy</button><button type="button" disabled>Sell</button></div>
                      <p className="small muted">Available: {formatTokenAmount(swapBalance(selectedSpotMarket.base?.id??selectedSpotMarket.asset_in_id))} {selectedSpotMarket.base?.code??selectedSpotMarket.underlying?.symbol}</p>
                      <label>Amount<input aria-label="Order amount" placeholder="0.00" inputMode="decimal" disabled /></label>
                      <div className="detail-row"><span>Market price</span><strong>{category==="stocks" ? (activePublicHistory?.latest_price==null?"—":`${formatTokenAmount(activePublicHistory.latest_price)} ${activePublicHistory.quote_symbol}`) : selectedSpotMarket.reference_price==null?"—":`${formatTokenAmount(selectedSpotMarket.reference_price)} USD`}</strong></div>
                      <button className="button wide" disabled>Trading unavailable</button>
                    </section>}
                  </div>
                </>
              ) : category === "crypto_spot" && markets.length && selectedSpotMarket ? (
                <>
                <div className="market-detail-layout">
                  <section className="market-price-card" aria-label="Asset price">
                    <div className="market-asset-heading">
                      {activePublicHistory&&<AssetLogo symbol={activePublicHistory.base_symbol} name={swapAssetMap.get(activePublicHistory.base_asset_id)?.name} assetId={activePublicHistory.base_asset_id} size={48} />}
                      <div><h2>{activePublicHistory ? (swapAssetMap.get(activePublicHistory.base_asset_id)?.name ?? activePublicHistory.base_symbol) : "Asset price"}</h2><span>{activePublicHistory?.price_basis==="underlying_reference"?`${activePublicHistory.base_symbol} reference`:activePublicHistory?.base_symbol??""}</span></div>
                    </div>
                    <div className="market-price-heading"><strong>{activePublicHistory?.latest_price ? formatTokenAmount(activePublicHistory.latest_price) : "—"}</strong><span>{activePublicHistory?.latest_price ? `${activePublicHistory.quote_symbol} per ${activePublicHistory.base_symbol}` : historyLoading ? "Loading current price…" : "Price unavailable"}</span></div>
                    <div className={`market-price-change ${changeDirection(activePublicHistory?.change_absolute)}`} aria-label="Price change"><strong>{activePublicHistory&&activePublicHistory.points.length>1?displayChange(activePublicHistory.change_absolute):"—"}</strong>{activePublicHistory?.change_absolute&&activePublicHistory.points.length>1&&<span>{activePublicHistory.quote_symbol}</span>}<span>({activePublicHistory&&activePublicHistory.points.length>1?displayChange(activePublicHistory.change_percent):"—"}{activePublicHistory?.change_percent&&activePublicHistory.points.length>1?"%":""})</span></div>
                    <PriceChart history={activePublicHistory} loading={historyLoading} range={historyRange} />
                    <div className="market-periods" role="group" aria-label="Price timeframe">{(["live","1d","1w","1m","1y","all"] as const).map(period => <button type="button" key={period} aria-pressed={historyRange===period} onClick={()=>setHistoryRange(period)}>{period.toUpperCase()}</button>)}</div>
                  </section>
                <section className="swap-card" aria-label="Swap assets">
                  <h2 className="swap-card-title">Swap</h2>
                  <div className="swap-token-panel">
                    <span className="swap-panel-label">Sell</span>
                    <div className="swap-panel-main">
                      <input className="swap-amount" aria-label="Sell amount" inputMode="decimal" placeholder="0.00" value={swapAmount} disabled={busy}
                        onChange={event => { setSwapAmount(event.target.value); setQuote(null); setSwapError(""); }} />
                      <div className="swap-token-pill">
                        <AssetLogo symbol={spotInputCode} name={swapAssetMap.get(selectedSpotMarket.asset_in_id)?.name} assetId={selectedSpotMarket.asset_in_id} size={28} />
                        <select aria-label="Sell asset" title={swapIdentity(selectedSpotMarket.asset_in_id)} value={selectedSpotMarket.asset_in_id} disabled={busy} onChange={event => {
                          const options = markets.filter(entry => entry.asset_in_id === event.target.value);
                          chooseSpotMarket(options.find(entry => entry.asset_out_id === selectedSpotMarket.asset_out_id) ?? options.find(entry => entry.preparation_available || entry.executable) ?? options[0]);
                        }}>{sellAssets.map(item => <option value={item.id} key={item.id}>{swapAssetLabel(item)}</option>)}</select>
                      </div>
                    </div>
                    <div className="swap-panel-balance">Available: <strong>{formatTokenAmount(swapBalance(selectedSpotMarket.asset_in_id))} {spotInputCode}</strong></div>
                  </div>
                  <div className="swap-flip-row"><button type="button" className="swap-flip" aria-label="Flip assets" disabled={busy || !reverseSpotMarket}
                    onClick={() => chooseSpotMarket(reverseSpotMarket)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M8 3v14m-4-4 4 4 4-4M16 21V7m-4 4 4-4 4 4" /></svg></button></div>
                  <div className="swap-token-panel">
                    <span className="swap-panel-label">Buy</span>
                    <div className="swap-panel-main">
                      <output className="swap-output" aria-label="Estimated buy amount" aria-live="polite" aria-busy={quoteLoading} data-loading={!quoteMatchesMarket&&validSwapAmount}>{quoteMatchesMarket ? formatTokenAmount(quote.expected_out) : !validSwapAmount ? "0.00" : swapError ? "Quote unavailable" : "Calculating…"}</output>
                      <div className="swap-token-pill">
                        <AssetLogo symbol={spotOutputCode} name={swapAssetMap.get(selectedSpotMarket.asset_out_id)?.name} assetId={selectedSpotMarket.asset_out_id} size={28} />
                        <select aria-label="Buy asset" title={swapIdentity(selectedSpotMarket.asset_out_id)} value={selectedSpotMarket.asset_out_id} disabled={busy} onChange={event => {
                          chooseSpotMarket(markets.find(entry => entry.asset_in_id === selectedSpotMarket.asset_in_id && entry.asset_out_id === event.target.value),false);
                        }}>{buyAssets.map(item => <option value={item.id} key={item.id}>{swapAssetLabel(item)}</option>)}</select>
                      </div>
                    </div>
                    <div className="swap-panel-balance">Balance: <strong>{formatTokenAmount(swapBalance(selectedSpotMarket.asset_out_id,false))} {spotOutputCode}</strong></div>
                  </div>
                  {pairUsesUsdc && usdcStatusError && <p className="inline-note" role="alert">{customerMessage(usdcStatusError)} <button className="text-button" onClick={() => action(refreshUsdcStatus)} disabled={busy}>Retry wallet check</button></p>}
                  {pairUsesUsdc && !usdcStatus && !usdcStatusError && <p className="small muted" role="status">Checking wallet setup…</p>}
                  {pairUsesUsdc && usdcStatus?.enabled === false && <div className="spot-setup"><p>Enable USDC in your wallet to continue.</p><button className="button outline" disabled={busy || !canPrepareSpot}
                    onClick={() => { setQuote(null); void action(() => start("usdc-trustline", {limit:"1000"})); }}>Enable USDC</button></div>}
                  <div className="swap-settings"><label htmlFor="swap-slippage">Maximum slippage</label><select id="swap-slippage" value={slippageBps} disabled={busy}
                    onChange={event => {setSlippageBps(Number(event.target.value));setQuote(null);setSwapError("");}}><option value={10}>0.1%</option><option value={50}>0.5%</option><option value={100}>1%</option></select></div>
                  <details className="swap-details" key={`${market}:${quote?.quote_id ?? "none"}`}>
                    <summary><span>{quotedRate ? `1 ${spotInputCode} = ${quotedRate} ${spotOutputCode}` : "Quote details"}</span><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m5 7 5 5 5-5" /></svg></summary>
                    <div className="swap-details-content">
                      <div className="detail-row"><span>{selectedSpotMarket.asset_out_id === XLM_ASSET ? "Expected output before fee" : "Expected output"}</span><strong>{quoteMatchesMarket ? `${quote.expected_out} ${spotOutputCode}` : "Not quoted"}</strong></div>
                      <div className="detail-row"><span>{selectedSpotMarket.asset_out_id === XLM_ASSET ? "Minimum received before fee" : "Minimum received"}</span><strong>{quoteMatchesMarket ? `${quote.min_receive} ${spotOutputCode}` : "Not quoted"}</strong></div>
                      <div className="detail-row"><span>Fee</span><strong>Shown in transaction review</strong></div>
                      {quoteMatchesMarket && <div className="detail-row"><span>Quote expires</span><strong>{new Date(quote.expires_at).toLocaleTimeString()}</strong></div>}
                    </div>
                  </details>
                  <p className="small muted">Available to sell: {formatTokenAmount(swapBalance(selectedSpotMarket.asset_in_id))} {spotInputCode}</p>
                  {swapError && <p className="swap-action-error" role="alert" id="swap-action-error">{customerMessage(swapError)}</p>}
                  {!canPrepareSpot && <p className="small muted">This pair is currently unavailable.</p>}
                  {quoteMatchesMarket && !quoteExpired ? <button className="button swap-submit" aria-label="Swap" aria-describedby={swapError ? "swap-action-error" : undefined} disabled={busy || !canPrepareSpot || !walletReadyForPair}
                    onClick={() => action(async () => {
                      if (!quoteMatchesMarket || Date.parse(quote.expires_at) <= Date.now()) {setQuoteClock(Date.now());throw Error("This quote expired. Request a new quote.");}
                      await start("order",{quote_id:quote.quote_id});setQuote(null);
                    }, "swap")}>{busy&&busyLocation==="swap" ? <ProgressIndicator label="Processing" spinning/> : "Swap"}</button>
                    : <button className="button swap-submit" aria-describedby={swapError ? "swap-action-error" : undefined} disabled={busy || quoteLoading || !canPrepareSpot || !walletReadyForPair || !validSwapAmount}
                      onClick={() => action(async () => {
                        setQuote(null);
                        await requestSwapQuote();
                      }, "swap")}>{(quoteLoading||busy&&busyLocation==="swap") ? <ProgressIndicator label="Getting quote" spinning/> : "Get quote"}</button>}
                </section>
                </div>
                </>
              ) : category === "crypto_spot" && marketsLoading ? <section className="card" role="status"><ProgressIndicator label="Loading markets" spinning/></section> : category === "crypto_spot" || category === "unavailable" ? <section className="card"><Empty icon="markets" title="No markets available." text={category === "crypto_spot" ? "Try refreshing to check available assets." : "This category is currently unavailable."} /></section> : null}
            </>
          )}
          {page === "earn" && (
            <>

              <section className="card earn-section" aria-label="Earn assets">
                {lending.length ? (
                  <div className="pool-grid">
                    {lending.map((m) => {
                      const balance = earnBalances.find(entry => entry.asset_id === m.asset_id);
                      const earnAction = earnActions[m.asset_id] ?? "supply";
                      const amountKey = `${m.asset_id}:${earnAction}`;
                      const isUsdc = m.asset_id === USDC_ASSET;
                      const needsTrustline = isUsdc && balance?.trustline_required === true;
                      const canPrepare = canPrepareBlendAction() &&
                        (m.asset_id === XLM_ASSET || (isUsdc && balance?.trustline_required === false));
                      const amountFeedback=earnAmountMessage(earnAmounts[amountKey]??"",earnAction==="supply"?balance?.spendable:balance?.in_earn,m.asset?.decimals??7,earnAction);
                      const shown = (value: string | null | undefined) => earnBalancesLoading&&value==null ? "Loading…" : formatTokenAmount(value);
                      return <div className="pool" key={m.market_id ?? m.id}>
                        <AssetLogo symbol={m.asset?.code??m.code??m.symbol??assetCode(m.asset_id)} name={m.asset?.name} assetId={m.asset_id} size={48} />
                        <h3>
                          {m.asset?.code ?? m.code ?? m.symbol ?? "Reserve"}
                        </h3>
                        <p className="small muted">Estimated variable APY</p>
                        <strong className="apy">
                          {m.supply_apy_variable == null
                            ? "Unavailable"
                            : new Intl.NumberFormat(undefined, {
                                style: "percent",
                                maximumFractionDigits: 2,
                              }).format(m.supply_apy_variable)}
                        </strong>


                        <dl className="earn-balances" aria-label={`${m.asset?.code ?? "Asset"} balances`}>
                          <div><dt>Available</dt><dd>{shown(balance?.spendable)}</dd></div>
                          <div><dt>In Earn</dt><dd>{shown(balance?.in_earn)}</dd></div>
                          <div><dt>Earned</dt><dd title={balance?.earned_since ? `Since ${new Date(balance.earned_since).toLocaleString()}` : undefined}>{balance?.earned == null ? "—" : shown(balance.earned)}</dd></div>
                        </dl>
                        {earnBalancesError && <p className="small earn-balance-error" role="alert">{customerMessage(earnBalancesError)}</p>}
                        {actionErrors[`earn:${m.asset_id}`]&&<p className="swap-action-error" role="alert">{customerMessage(actionErrors[`earn:${m.asset_id}`])}</p>}
                        {needsTrustline ? (
                          <div className="earn-setup">
                            <p className="small">Enable USDC in your wallet before supplying it.</p>
                            <button className="button outline" disabled={busy || !session || !canPrepareBlendAction()}
                              onClick={() => action(() => start("usdc-trustline", {limit: "1000"}),`earn:${m.asset_id}`)}>Enable USDC</button>
                          </div>
                        ) : (
                          <div className="earn-actions">
                            <div className="earn-action-toggle" role="group" aria-label={`${m.asset?.code ?? "Asset"} Earn action`}>
                              {(["supply", "withdraw"] as const).map(a => <button type="button" key={a}
                                aria-pressed={earnAction === a} onClick={() => setEarnActions(current => ({...current, [m.asset_id]: a}))}>
                                {a === "supply" ? "Supply" : "Withdraw"}
                              </button>)}
                            </div>
                            <p className="small muted">{earnAction==="supply"?"Available to supply":"In Earn"}: {shown(earnAction==="supply"?balance?.spendable:balance?.in_earn)} {m.asset?.code??assetCode(m.asset_id)}</p>
                            <div className="earn-action">
                              <label>{earnAction === "supply" ? "Supply amount" : "Withdraw amount"}
                                <input inputMode="decimal" value={earnAmounts[amountKey] ?? ""} placeholder="0.00"
                                  onChange={e => {setEarnAmounts(current => ({...current, [amountKey]: e.target.value}));setActionErrors(current=>({...current,[`earn:${m.asset_id}`]:""}));}} />
                              </label>
                              <button className="button" disabled={busy || !session || !canPrepare || !earnAmounts[amountKey] || !!amountFeedback}
                                onClick={() => action(() => start("lending/" + earnAction, {
                                  market_id: m.market_id ?? m.id, asset_id: m.asset_id, amount: earnAmounts[amountKey],
                                }), `earn:${m.asset_id}`)}>{busy&&busyLocation===`earn:${m.asset_id}`?<ProgressIndicator label="Processing" spinning/>:earnAction === "supply" ? "Supply" : "Withdraw"}</button>
                            </div>
                            {amountFeedback&&<p className="small muted" role="status">{amountFeedback}</p>}
                          </div>
                        )}
                      </div>;
                    })}
                  </div>
                ) : lendingLoading ? <ProgressIndicator label="Loading earning options" spinning/> : (
                  <Empty
                    icon="earn"
                    title={
                      session
                        ? "No pool data available."
                        : "Connect your wallet to view earning options."
                    }
                    text="Try refreshing to load available pools."
                  />
                )}
              </section>
            </>
          )}
          {page === "borrow" && <section className="card borrowing-section" aria-label="Borrowing" data-testid="borrowing">

            {borrowingError&&<p className="inline-note" role="alert">{customerMessage(borrowingError)}</p>}
            {borrowingLoading&&!borrowing?<p className="small muted"><ProgressIndicator label="Loading loan information" spinning/></p>:borrowing?.assets.length?<div className="borrowing-grid">{borrowing.assets.map(row=>{
              const collateralNeeded=row.reason==="COLLATERAL_REQUIRED"||/^0(?:\.0+)?$/.test(row.collateral_value??"");
              const direction=loanActions[row.market_id]??(collateralNeeded&&row.can_prepare_collateral_supply===true?"collateral-supply":"borrow"),amountKey=`${row.market_id}:${direction}`;
              const canPrepare=direction==="borrow"?row.can_prepare_borrow:direction==="repay"?row.can_prepare_repay:direction==="collateral-supply"?row.can_prepare_collateral_supply===true:row.can_prepare_collateral_withdraw===true;
              const loanFeedback=direction==="borrow"?(borrowingAmountMessage(loanAmounts[amountKey]??"",row.available_to_borrow,row.asset.code,row.asset.decimals)||(!row.can_prepare_borrow?borrowingReasonMessage(row.reason):null)):direction==="repay"&&!canPrepare?"There is no debt available to repay, or your wallet balance is too low.":direction==="collateral-withdraw"&&!canPrepare?(/^0(?:\.0+)?$/.test(row.collateral??"")?"You have no collateral to remove.":borrowing.assets.some(entry=>!/^0(?:\.0+)?$/.test(entry.borrowed))?"Repay your outstanding loans before removing collateral.":"Collateral removal is unavailable. Refresh to check available funds."):null;
              const maximumSelected=direction==="repay"&&repayAllAmounts[row.market_id]!=null&&repayAllAmounts[row.market_id]===loanAmounts[amountKey];
              const reviewLabel=direction==="borrow"?"Borrow":direction==="repay"?(maximumSelected?"Repay all":"Repay"):direction==="collateral-supply"?"Add collateral":"Remove collateral";
              return <section className="borrowing-asset" key={row.market_id} aria-label={`${row.asset.code} loan`} data-testid={`loan-${row.asset.code.toLowerCase()}`}>
                <div className="loan-asset-heading"><AssetLogo symbol={row.asset.code} name={row.asset.name} assetId={row.asset.id} size={40}/><h3>{row.asset.code}</h3></div>
                <div className="loan-rate"><span>Variable borrow APR</span><strong>{borrowingRate(row.borrow_apr)}</strong>{row.borrow_apy!=null&&<small>APY {borrowingRate(row.borrow_apy)}</small>}</div>
                <dl className="loan-balances">
                  <div><dt>Your debt</dt><dd>{loanAmount(row.borrowed)} {row.asset.code}</dd></div>
                  <div><dt>Available to borrow</dt><dd>{loanAmount(row.available_to_borrow)}{row.available_to_borrow!=null?` ${row.asset.code}`:""}</dd></div>
                  <div><dt>Available to repay</dt><dd>{loanAmount(row.repayable)} {row.asset.code}</dd></div>
                  <div><dt>Pool liquidity</dt><dd>{loanAmount(row.available_liquidity)}{row.available_liquidity!=null?` ${row.asset.code}`:""}</dd></div>
                  <div><dt>Your collateral</dt><dd>{loanAmount(row.collateral)}{row.collateral!=null?` ${row.asset.code}`:""}</dd></div>
                  <div><dt>Collateral value</dt><dd>{loanAmount(row.collateral_value)}{row.collateral_value!=null?" USD":""}</dd></div>
                  <div><dt>Borrow limit</dt><dd>{loanAmount(row.borrow_limit)}{row.borrow_limit!=null?" USD":""}</dd></div>
                  <div><dt>Health factor</dt><dd>{loanAmount(row.health_factor)}</dd></div>
                </dl>


                <div className="earn-action-toggle loan-action-toggle" role="group" aria-label={`${row.asset.code} loan action`}>{(["borrow","repay","collateral-supply","collateral-withdraw"] as const).map(action=><button key={action} type="button" disabled={busy} aria-pressed={direction===action} onClick={()=>setLoanActions(current=>({...current,[row.market_id]:action}))}>{action==="borrow"?"Borrow":action==="repay"?"Repay":action==="collateral-supply"?"Add collateral":"Remove collateral"}</button>)}</div>
                <p className="small muted">Available in wallet: {formatTokenAmount(swapBalance(row.asset.id))} {row.asset.code}</p>
                {loanFeedback&&<p className="loan-context" role="status">{loanFeedback}</p>}
                {actionErrors[`loan:${row.market_id}`]&&<p className="swap-action-error" role="alert">{customerMessage(actionErrors[`loan:${row.market_id}`])}</p>}
                <div className="loan-action"><div className="loan-amount-field"><div className="loan-amount-heading"><label htmlFor={`loan-amount-${row.asset.code}`}>{direction==="borrow"?"Borrow amount":direction==="repay"?"Repay amount":"Collateral amount"}</label>{direction==="repay"&&<button type="button" className="loan-repay-max" disabled={busy||borrowingLoading||row.can_prepare_repay_all!==true||row.repay_all_amount==null} onClick={()=>action(async()=>{
                  setRepayAllErrors(current=>({...current,[row.market_id]:""}));const owner=`${session?.customer_id??""}:${session?.wallet_id??""}`;const current=await refreshBorrowing();if(!current||borrowerOwner.current!==owner)return;
                  const latest=current.assets.find(entry=>entry.market_id===row.market_id);let valid=false;
                  try{valid=latest?.can_prepare_repay_all===true&&typeof latest.repay_all_amount==="string"&&toAtomic(latest.repay_all_amount,latest.asset.decimals)>0n;}catch{}
                  if(!valid||!latest?.repay_all_amount){setRepayAllErrors(current=>({...current,[row.market_id]:"A full repayment maximum is unavailable. Check your current loan."}));return;}
                  setLoanAmounts(current=>({...current,[`${row.market_id}:repay`]:latest.repay_all_amount!}));setRepayAllAmounts(current=>({...current,[row.market_id]:latest.repay_all_amount!}));
                },`loan:${row.market_id}`)}>Repay all · MAX</button>}</div><input id={`loan-amount-${row.asset.code}`} aria-label={direction==="borrow"?"Borrow amount":direction==="repay"?"Repay amount":"Collateral amount"} inputMode="decimal" placeholder="0.00" disabled={busy} value={loanAmounts[amountKey]??""} onChange={event=>{setLoanAmounts(current=>({...current,[amountKey]:event.target.value}));setActionErrors(current=>({...current,[`loan:${row.market_id}`]:""}));if(direction==="repay"){setRepayAllAmounts(current=>{const next={...current};delete next[row.market_id];return next;});setRepayAllErrors(current=>({...current,[row.market_id]:""}));}}}/></div><button className="button" aria-label={reviewLabel} disabled={busy||borrowingLoading||!session||!canPrepare||!loanAmounts[amountKey]||capability("capital.wallets")?.execution_status!=="testnet_verified"} onClick={()=>action(()=>start(direction.startsWith("collateral-")?`borrow-${direction}`:`lending/${direction}`,{market_id:row.market_id,amount:loanAmounts[amountKey]}),`loan:${row.market_id}`)}>{busy&&busyLocation===`loan:${row.market_id}`?<ProgressIndicator label="Processing" spinning/>:reviewLabel}</button></div>
                {!loanAmounts[amountKey]&&<p className="small muted">Enter an amount to review {direction==="collateral-supply"?"your collateral deposit":direction==="collateral-withdraw"?"your collateral removal":direction==="repay"?"your repayment":"your loan"}.</p>}
                {maximumSelected&&<p className="small muted">Maximum repayment amount selected. Review the full token debit before approving.</p>}
                {repayAllErrors[row.market_id]&&<p className="swap-action-error" role="alert">{repayAllErrors[row.market_id]}</p>}
              </section>;
            })}</div>:<Empty icon="borrow" title="Loan information is unavailable." text="Try refreshing to check current borrowing options."/>}
          </section>}
          {page === "activity" && (
            <section className="card">
              <div className="section-heading">
                <h2>Your activity</h2>
                <span className="muted small">
                  {session
                    ? "Latest activity"
                    : "Sign in to view your activity"}
                </span>
              </div>
              {session&&capability("trade.stocks")?.enabled&&<StockActivity api={api} customerId={session.customer_id} walletId={session.wallet_id}/>}
              {session&&capability("trade.perps")?.enabled&&<PerpetualActivity api={api} customerId={session.customer_id} walletId={session.wallet_id}/>}
              {operations.length ? (
                <div className="activity-list">
                  {operations.map((op) => (
                    <button
                      className="activity-item"
                      key={op.operation_id}
                      onClick={() =>
                        action(() => resumeOperation(op.operation_id))
                      }
                    >
                      <span className="activity-icon">
                        <Icon
                          name={
                            op.type.includes("fund")
                              ? "fund"
                              : op.type.includes("return")
                                ? "return"
                                : "activity"
                          }
                        />
                      </span>
                      <div>
                        <strong>{activityLabel(op)}</strong>
                        <small>
                          {new Date(op.created_at).toLocaleString()}
                        </small>
                      </div>
                      <span
                        className={
                          "status-pill " +
                          (op.status === "completed" ? "success" : "")
                        }
                      >
                        <OperationProgress status={op.status}/>
                      </span>
                      <Icon name="arrow" size={16} />
                    </button>
                  ))}
                </div>
              ) : !capability("trade.stocks")?.enabled&&!capability("trade.perps")?.enabled ? (
                <Empty
                  icon="activity"
                  title="No activity yet."
                  text="Your confirmed transfers and trades appear here."
                />
              ) : null}
            </section>
          )}

        </main>
      </div>
      {preparingAction&&!active&&<ActionDialog title={preparingAction} transactionLabel="Wallet action" onClose={()=>setPreparingAction(null)}><ProgressIndicator label="Preparing transaction" spinning/></ActionDialog>}
      {active && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="operation-title"
          >
            <button
              className="close"
              aria-label="Close operation"
              onClick={() => setActive(null)}
            >
              ×
            </button>
            <span className="feature-icon blue">
              <Icon name="shield" />
            </span>
            <p className="eyebrow">WALLET ACTION</p>
            <h2 id="operation-title">
              {active.type === "spot.swap" && active.status === "awaiting_customer_authorization"
                ? `Swap ${swapIdentity(active.prepared_action?.summary.fromAssetId)} → ${swapIdentity(active.prepared_action?.summary.toAssetId)}`
                : active.type === "wallet.usdc_trustline"
                ? active.status === "completed" ? "USDC enabled." : "Enable USDC"
                : active.status === "awaiting_customer_authorization"
                ? "Authorizing transaction"
                : active.status === "completed"
                  ? activityLabel(active)
                  : [
                        "failed",
                        "expired",
                        "rejected",
                        "recovery_required",
                      ].includes(active.status)
                    ? "Operation needs attention."
                    : activityLabel(active)}
            </h2>
            <span
              className={
                "status-pill " +
                (active.status === "completed" ? "success" : "")
              }
            >
              <OperationProgress status={active.status} approvalPhase={approvalPhase?.operationId===active.operation_id?approvalPhase.phase:null}/>
            </span>
            {active.prepared_action && active.type === "perps.usdc_trustline" ? (
              <div className="approval-summary"><div><span>Asset</span><strong>Trading USDC</strong></div><div><span>Holding limit</span><code>{active.prepared_action.summary.amount} USDC</code></div><div><span>Maximum network fee</span><code>{approvalFee(active.prepared_action.summary.maxFeeStroops)}</code></div><p className="small muted">This enables the asset in your wallet. No USDC is transferred.</p></div>
            ) : active.prepared_action && active.type === "perps.usdc_allowance" ? (
              <div className="approval-summary"><div><span>Spending limit</span><code>{active.prepared_action.summary.amount} USDC</code></div><div><span>Approval expires at ledger</span><code>{active.prepared_action.summary.allowanceExpirationLedger}</code></div><div><span>Maximum network fee</span><code>{approvalFee(active.prepared_action.summary.maxFeeStroops)}</code></div><p className="small muted">This grants a bounded funding approval. It does not transfer USDC.</p></div>
            ) : active.prepared_action && active.type === "wallet.usdc_trustline" ? (
              <div className="approval-summary">
                <div><span>USDC holding limit</span><code>{active.prepared_action.summary.amount === "1000" ? "1,000" : active.prepared_action.summary.amount ?? "Unavailable"} USDC</code></div>
                <div><span>XLM held for USDC</span><code>0.5 XLM</code></div>
                <div><span>Maximum fee</span><code>{approvalFee(active.prepared_action.summary.maxFeeStroops)}</code></div>
                <div><span>Expires</span><code>{new Date(active.prepared_action.summary.expiresAt).toLocaleString()}</code></div>
                <p className="small muted">This enables USDC in your wallet. The limit is the maximum amount you can hold; no USDC is transferred.</p>
              </div>
            ) : active.prepared_action?.summary.action === "spot.swap" ? (
              <div className="approval-summary">
                <div><span>You send</span><code>{active.prepared_action.summary.amount} {swapIdentity(active.prepared_action.summary.fromAssetId)}</code></div>
                <div><span>{active.prepared_action.summary.toAssetId === XLM_ASSET ? "You receive at least before fee" : "You receive at least"}</span><code>{active.prepared_action.summary.minReceive} {swapIdentity(active.prepared_action.summary.toAssetId)}</code></div>
                <div><span>Maximum fee</span><code>{approvalFee(active.prepared_action.summary.maxFeeStroops)}</code></div>
                <div><span>Expires</span><code>{new Date(active.prepared_action.summary.expiresAt).toLocaleString()}</code></div>
              </div>
            ) : active.prepared_action?.summary.action.startsWith("margin.") ? (
              <div className="approval-summary">
                <div><span>Action</span><code>{({"margin.collateral_swap":"Acquire collateral","margin.vault_deposit":"Deposit collateral","margin.vault_withdraw":"Withdraw collateral","margin.transfer":"Move collateral","margin.return":"Return collateral","margin.open_begin":"Start opening","margin.open_swap":"Swap opening assets","margin.open_activate":"Activate position","margin.open_cancel":"Cancel opening","margin.close_atomic":"Close position","margin.close_prepare":"Start closing","margin.close_swap":"Swap closing assets","margin.close_short_swap":"Repay closing debt","margin.close_finish":"Finish closing","margin.close_cancel":"Cancel closing"} as Record<string,string>)[active.prepared_action.summary.action]??"Margin transaction"}</code></div>
                {active.prepared_action.summary.amount&&<div><span>Amount</span><code>{active.prepared_action.summary.amount} {markets.flatMap(entry=>[entry.base,entry.collateral]).find(entry=>entry?.id===active.prepared_action?.summary.fromAssetId)?.name??assetCode(active.prepared_action.summary.fromAssetId)}</code></div>}
                {active.prepared_action.summary.minReceive&&<div><span>Minimum receive</span><code>{active.prepared_action.summary.minReceive} {markets.flatMap(entry=>[entry.base,entry.collateral]).find(entry=>entry?.id===active.prepared_action?.summary.toAssetId)?.name??assetCode(active.prepared_action.summary.toAssetId)}</code></div>}
                <div><span>Maximum fee</span><code>{approvalFee(active.prepared_action.summary.maxFeeStroops)}</code></div>
                <div><span>Expires</span><code>{marketDate(active.prepared_action.summary.expiresAt,true,true)}</code></div>
              </div>
            ) : active.prepared_action && ["blend.borrow","blend.repay","blend.borrow_collateral_supply","blend.borrow_collateral_withdraw"].includes(active.type) ? (
              <div className="approval-summary">
                <div><span>{active.type==="blend.borrow"?"You receive":active.type==="blend.repay"?(isMaximumRepayment?"Maximum approved repayment":"You repay"):active.type==="blend.borrow_collateral_supply"?"You add as collateral":"You remove"}</span><code>{active.prepared_action.summary.amount} {borrowingCode(active.prepared_action.summary.fromAssetId)}</code></div>
                <div><span>Destination</span><code>{active.type==="blend.borrow"||active.type==="blend.borrow_collateral_withdraw"?"Your wallet":active.type==="blend.repay"?"Your loan":"Your loan collateral"}</code></div>
                <div><span>Maximum fee</span><code>{approvalFee(active.prepared_action.summary.maxFeeStroops)}</code></div>
                <div><span>Expires</span><code>{marketDate(active.prepared_action.summary.expiresAt,true)}</code></div>
                {active.type==="blend.repay"&&isMaximumRepayment&&<p className="small muted">This is the maximum approved token amount. Confirmed debt and any returned amount are checked after execution.</p>}
                {active.type==="blend.borrow"&&<p className="small muted">This creates debt at a variable rate. Collateral may be liquidated if your loan becomes unhealthy.</p>}
                {active.type==="blend.borrow_collateral_supply"&&<p className="small muted">This collateral supports borrowing. It may be liquidated if your loan becomes unhealthy.</p>}
                {active.type==="blend.borrow_collateral_withdraw"&&<p className="small muted">Removing collateral reduces your borrowing capacity.</p>}
              </div>
            ) : active.prepared_action && (
              <div className="approval-summary">
                <div><span>Asset</span><code>{assetCode(active.prepared_action.summary.fromAssetId)}</code></div>
                {["blend.supply", "blend.withdraw", "testnet.fund", "testnet.return", "wallet.test_payment"].includes(active.type) && <div><span>Destination</span><code>{active.type === "blend.supply" ? "Your Earn balance" : active.type === "testnet.return" || active.type === "wallet.test_payment" ? "Funds account" : "Your wallet"}</code></div>}
                {active.prepared_action.summary.amount && <div><span>Amount</span><code>{active.prepared_action.summary.amount}</code></div>}
                {active.prepared_action.summary.minReceive && <div><span>Minimum receive</span><code>{active.prepared_action.summary.minReceive} {swapIdentity(active.prepared_action.summary.toAssetId)}</code></div>}
                <div><span>Maximum fee</span><code>{approvalFee(active.prepared_action.summary.maxFeeStroops)}</code></div>
                <div><span>Expires</span><code>{new Date(active.prepared_action.summary.expiresAt).toLocaleString()}</code></div>
              </div>
            )}

            {error && <div className="inline-note" role="alert">{customerMessage(error)}</div>}
            {active.error && (
              <div className="inline-note">{customerMessage(active.error.message)}</div>
            )}
            {active.tx_hash && (
              <a
                className="explorer"
                href={
                  "https://stellar.expert/explorer/testnet/tx/" + active.tx_hash
                }
                target="_blank"
                rel="noreferrer"
              >
                View transaction ↗
              </a>
            )}
            {active.status === "expired" && !active.tx_hash && (
              <div className="inline-note">
                <p>This unsigned approval expired. It cannot be signed or submitted.</p>
                {active.type === "wallet.usdc_trustline" ? <button className="button wide" disabled={busy}
                  onClick={() => action(async () => { await start("usdc-trustline", {limit:"1000"}); })}>Prepare USDC again</button>
                  : <button className="button outline" disabled={busy} onClick={() => setActive(null)}>Choose action again</button>}
              </div>
            )}
            {operationError&&<p className="swap-action-error" role="alert">{operationError}</p>}
            {active.status === "awaiting_customer_authorization" && (
              <>
                {approvalExpired && <p className="inline-note" role="status">This approval expired. Start a new review to continue.</p>}
                <button className="button outline" disabled={busy} onClick={() => action(async () => {
                  if(!approvalExpired){await resumeOperation(active.operation_id);return;}
                  const op=await api("grapnel/operations/"+active.operation_id);
                  if(!session||op.customer_id!==session.customer_id||op.wallet_id!==session.wallet_id)throw Error("Wallet action could not be found.");
                  // Only dismiss an authoritatively expired, unsigned action. An
                  // uncertain or submitted action must stay in status recovery.
                  if(op.status==="expired"&&!op.tx_hash){setActive(null);return;}
                  await resumeOperation(active.operation_id);
                })}>{approvalExpired?"Start a new review":"Check action status"}</button>
                <p className="small muted">
                  {active.type === "wallet.usdc_trustline"
                    ? "Your wallet will authorize the holding limit and network fee."
                    : "Your wallet authorizes this exact transaction."}
                </p>
                <button
                  className="button wide"
                  disabled={busy || !auth || approvalExpired}
                  onClick={() => action(()=>approve())}
                >
                  {busy ? <OperationProgress status="awaiting_customer_authorization" approvalPhase={approvalPhase?.operationId===active.operation_id?approvalPhase.phase:null}/> : "Continue"}
                  <Icon name="arrow" size={16} />
                </button>
              </>
            )}
            {["failed", "expired", "rejected", "recovery_required"].includes(
              active.status,
            ) && (
              <p className="small muted">
                No new transaction will be sent automatically. Check the
                recorded hash before attempting another action.
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function Empty({
  icon,
  title,
  text,
}: {
  icon: string;
  title: string;
  text: string;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} size={26} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function BalanceTable({
  valuation,
  balances,
  connected,
  hideZeroBalances=false,
}: {
  valuation?: WalletValuation|null;
  balances: any[];
  connected: boolean;
  hideZeroBalances?: boolean;
}) {
  return <GroupedAssets valuation={valuation} balances={balances} connected={connected} hideZeroBalances={hideZeroBalances}/>;
}
