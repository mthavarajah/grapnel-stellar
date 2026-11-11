"use client";
import Link from "next/link";
import { AssetLogo } from "./asset-logo";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  PrivyProvider,
  getIdentityToken,
  usePrivy,
  useUser,
} from "@privy-io/react-auth";
import { useSignRawHash } from "@privy-io/react-auth/extended-chains";
import { formatTokenAmount, fromAtomic, toAtomic, type PreparedAction } from "@grapnel/contracts";
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
const tradeCategories = [["crypto_spot", "Crypto spot"], ["stocks", "Stocks"], ["perps", "Perpetuals"], ["commodities", "Commodities"]] as const;
const nav = [
  ["home", "Overview"],
  ["funds", "Funds"],
  ["markets", "Markets"],
  ["earn", "Earn"],
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
  price_basis?:string; source_url?:string; interval?:string;
  metrics?:{day_high?:string|null;day_low?:string|null;day_volume?:string|null;fifty_two_week_high?:string|null;fifty_two_week_low?:string|null;previous_close?:string|null;market_time?:string|null};
};
type OverviewSection = {id:"spot"|"perps"|"stocks"|"commodities"|"lending";label:string;items:{symbol:string;name:string;value:string;unit:"USD"|"percent";unit_detail?:string;as_of:string}[];available:boolean};
const overviewGroups = [
  {id:"spot",label:"Spot prices",module:"trade.spot",href:"/markets?category=crypto_spot"},
  {id:"perps",label:"Futures prices",module:"trade.perps",href:"/markets?category=perps"},
  {id:"stocks",label:"Stock prices",module:"trade.stocks",href:"/markets?category=stocks"},
  {id:"commodities",label:"Commodity prices",module:"trade.commodities",href:"/markets?category=commodities"},
  {id:"lending",label:"Lending rates",module:"capital.lending",href:"/earn"},
] as const;
type HistoryRange = "live"|"1d"|"1w"|"1m"|"1y"|"all";
function displayPublicNotional(value:unknown):string {
  if(typeof value!=="string"||!/^[-]?\d+$/.test(value))return "—";
  try{const amount=BigInt(value);return `${amount<0n?"-":""}${formatTokenAmount(fromAtomic(amount<0n?-amount:amount,7))} USDC`;}catch{return "—";}
}
function marketDate(value:string|number,includeTime=false):string {
  const date=new Date(value);if(!Number.isFinite(date.getTime()))return "Date unavailable";
  const parts=new Intl.DateTimeFormat("en-US",{month:"short",day:"2-digit",year:"numeric"}).formatToParts(date);
  const part=(type:string)=>parts.find(item=>item.type===type)?.value??"";
  return `${part("month")}. ${part("day")}, ${part("year")}${includeTime?` · ${date.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"})}`:""}`;
}
function displayChange(value:string|null|undefined):string {
  if(typeof value!=="string"||!/^[-+]?\d+(?:\.\d+)?$/.test(value))return "—";
  const amount=value.replace(/^[-+]/, ""), formatted=formatTokenAmount(amount);
  return formatted==="Unavailable"?"—":`${value.startsWith("-")?"-":"+"}${formatted}`;
}
function PriceChart({history,loading}:{history:MarketHistory|null;loading:boolean}) {
  const points=(history?.points??[]).flatMap(point=>{
    try {const timestamp=Date.parse(point.timestamp),price=toAtomic(point.price,38);return Number.isFinite(timestamp)?[{timestamp,price}]:[];}catch{return [];}
  }).sort((a,b)=>a.timestamp-b.timestamp).filter((point,index,all)=>index===0||point.timestamp!==all[index-1]!.timestamp);
  if(loading)return <div className="market-chart-empty" role="status">Loading price history…</div>;
  if(!points.length)return <div className="market-chart-empty" role="status">Price history is not available yet.</div>;
  const min=points.reduce((current,p)=>p.price<current?p.price:current,points[0]!.price);
  const max=points.reduce((current,p)=>p.price>current?p.price:current,points[0]!.price);
  const first=points[0]!.timestamp,last=points[points.length-1]!.timestamp;
  const coordinates=points.map(point=>({x:last===first?300:20+(point.timestamp-first)*560/(last-first),y:max===min?140:260-Number((point.price-min)*240000n/(max-min))/1000}));
  return <div className="market-chart-wrap">
    <svg viewBox="0 0 600 280" role="img" aria-label="Price history" className="market-chart">
      <title>{`${history!.base_symbol} price in ${history!.quote_symbol}`}</title>
      {[60,140,220].map(y=><line key={y} x1="20" x2="580" y1={y} y2={y} className="market-chart-grid" />)}
      {coordinates.length>1&&<polyline points={coordinates.map(p=>`${p.x},${p.y}`).join(" ")} className="market-chart-line" />}
      <circle cx={coordinates.at(-1)!.x} cy={coordinates.at(-1)!.y} r="4" className="market-chart-dot" />
    </svg>
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
const statusLabel = (status: string): string => ({completed:"Completed",awaiting_customer_authorization:"Needs approval",preparing:"Preparing",submitted:"Submitted",confirming:"Confirming",failed:"Failed",rejected:"Declined",expired:"Expired",recovery_required:"Check transaction"}[status] ?? "In progress");
function activityLabel(op: Operation): string {
  if (op.type === "wallet.usdc_trustline") return op.status === "completed" ? "Enabled USDC" : "Enable USDC";
  const labels: Record<string, [string, string]> = {
    "blend.supply": ["Supply", "Supplied"], "blend.withdraw": ["Withdraw", "Withdrew"],
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
  activity: "Activity",
};
export default function Finance({ page, initialCategory }: { page: string; initialCategory?:string }) {
  const id = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  return id ? (
    <PrivyProvider
      appId={id}
      config={{
        loginMethods: ["email"],
        appearance: { theme: "light", accentColor: "#2555d7" },
      }}
    >
      <PrivyFinance page={page} initialCategory={initialCategory} />
    </PrivyProvider>
  ) : (
    <FinanceShell page={page} initialCategory={initialCategory} />
  );
}
async function loginToken(): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([getIdentityToken(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error("Sign-in timed out. Please try again.")), 15000);
    })]);
  } finally { clearTimeout(timer!); }
}
function PrivyFinance({ page, initialCategory }: { page: string; initialCategory?:string }) {
  const { ready, authenticated, login, logout } = usePrivy();
  const { refreshUser } = useUser();
  const { signRawHash } = useSignRawHash();
  const connect = async () => {
    const token = await loginToken();
    if (!token) throw Error("Please sign in first");
    await api("session", { identity_token: token });
    void refreshUser().catch(() => {});
  };
  const auth: Auth = {
    ready,
    authenticated,
    login,
    connect,
    logout: async () => {
      await api("session", undefined, "DELETE");
      await logout();
    },
    sign: (a, address) => signPreparedAction(a, signRawHash, address),
  };
  return <FinanceShell page={page} auth={auth} initialCategory={initialCategory} />;
}
function FinanceShell({ page, auth, initialCategory }: { page: string; auth?: Auth;initialCategory?:string }) {
  const router = useRouter();
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
  const [caps, setCaps] = useState<Capability[]>([]);
  const [overviewSections,setOverviewSections] = useState<OverviewSection[]>([]);
  const [overviewLoading,setOverviewLoading] = useState(false);
  const [balances, setBalances] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [fundingError, setFundingError] = useState("");
  const [markets, setMarkets] = useState<any[]>([]);
  const [marketsLoading, setMarketsLoading] = useState(false);
  const [marketSearch, setMarketSearch] = useState("");
  const [marketResultsOpen, setMarketResultsOpen] = useState(false);

  const [lending, setLending] = useState<any[]>([]);
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
  const [approvalClock, setApprovalClock] = useState(Date.now());
  useEffect(() => {
    if (active?.status !== "awaiting_customer_authorization") return;
    setApprovalClock(Date.now());
    const timer = setInterval(() => setApprovalClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active?.status, active?.operation_id]);
  const [error, setError] = useState("");
  const [swapError, setSwapError] = useState("");
  useEffect(() => { setSwapError(""); }, [session?.customer_id]);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("1");
  const [fundsDirection, setFundsDirection] = useState<"fund" | "return">("fund");
  const fundingPage = page === "funds" ? fundsDirection : page;
  const [asset, setAsset] = useState("stellar-testnet:native:XLM");
  const [market, setMarket] = useState("");
  const [quote, setQuote] = useState<any>(null);
  const [swapAmount, setSwapAmount] = useState("");
  const [category, setCategory] = useState(initialCategory??"crypto_spot");
  useEffect(()=>{if(initialCategory&&(page==="markets"||page==="trade"))setCategory(initialCategory);},[initialCategory,page]);
  const [slippageBps, setSlippageBps] = useState(50);
  const [quoteClock, setQuoteClock] = useState(Date.now());
  const [usdcStatus, setUsdcStatus] = useState<{enabled:boolean;wallet_amount?:string;spendable?:string;as_of?:string} | null>(null);
  const [usdcStatusError, setUsdcStatusError] = useState("");
  const spotCustomer = useRef<string | null>(null);
  spotCustomer.current = session?.customer_id ?? null;
  const refreshUsdcStatus = useCallback(async () => {
    const customerId = session?.customer_id;
    if (!customerId) return;
    setUsdcStatus(null); setUsdcStatusError("");
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
    const timer = setInterval(() => setQuoteClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [quote]);
  const polling = useRef({ id: "", attempt: 0 });
  const capability = (module: string) => caps.find((c) => c.module === module);
  useEffect(()=>{
    setOverviewSections([]);
    if(!session||!(page==="home"||page==="login")||!capability("capital.wallets")?.enabled){setOverviewLoading(false);return;}
    let alive=true;setOverviewLoading(true);
    void api("grapnel/market-overview").then(result=>{
      if(alive&&Array.isArray(result?.sections))setOverviewSections(result.sections.filter((section:any)=>overviewGroups.some(group=>group.id===section.id)&&Array.isArray(section.items)));
    }).catch(()=>{}).finally(()=>{if(alive)setOverviewLoading(false);});
    return()=>{alive=false;};
  },[session?.customer_id,page,caps]);
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
  const selectedSpotMarket = markets.find(entry => (entry.market_id ?? entry.id) === market);
  const publicMarketOwner = useRef("");
  publicMarketOwner.current = `${session?.customer_id??""}:${category}:${page}`;
  useEffect(() => {
    if (!session || category !== "perps" || !(page === "markets" || page === "trade") || !capability("trade.perps")?.enabled) return;
    const owner = `${session.customer_id}:${category}:${page}`;
    let alive=true,inFlight=false,firstLoad=true;
    const isCurrent=()=>alive&&publicMarketOwner.current===owner;
    const refreshPublicMarkets=async()=>{
      if(inFlight||document.visibilityState!=="visible"||!isCurrent())return;
      inFlight=true;if(firstLoad)setMarketsLoading(true);
      try {
        const result=await api("grapnel/markets?asset_class=perps");
        const rows=Array.isArray(result)?result:result?.markets;
        if(!Array.isArray(rows))throw Error("Market data is unavailable.");
        if(isCurrent())setMarkets(rows.filter((entry:any)=>typeof (entry.market_id??entry.id)==="string"&&entry.asset_class==="perps"));
      } catch {
        if(isCurrent())setMarkets(current=>current.map(entry=>({...entry,price_status:"unavailable",reference_price:null,reference_price_atomic:null,stats:null})));
      } finally {
        inFlight=false;firstLoad=false;if(isCurrent())setMarketsLoading(false);
      }
    };
    void refreshPublicMarkets();
    const timer=setInterval(()=>{void refreshPublicMarkets();},15000);
    const visible=()=>{if(document.visibilityState==="visible")void refreshPublicMarkets();};
    document.addEventListener("visibilitychange",visible);
    return()=>{alive=false;clearInterval(timer);document.removeEventListener("visibilitychange",visible);};
  },[session?.customer_id,category,page,caps]);
  useEffect(() => { setMarketSearch(""); setMarketResultsOpen(false); }, [category]);
  useEffect(() => {
    if (category === "crypto_spot" || !markets.length || selectedSpotMarket) return;
    setMarket(markets[0].market_id ?? markets[0].id);
  }, [markets, category, market]);
  const activePublicHistory = marketHistory?.market_id===(selectedSpotMarket?.market_id??selectedSpotMarket?.id)&&historyScope===`${selectedSpotMarket?.market_id??selectedSpotMarket?.id}:${historyRange}`?marketHistory:null;
  const visiblePublicMarkets = markets.filter(entry => `${entry.underlying?.symbol ?? ""} ${entry.underlying?.name ?? ""} ${entry.label ?? ""}`.toLowerCase().includes(marketSearch.trim().toLowerCase()));
  useEffect(()=>{
    setMarketHistory(null);
    if((selectedSpotMarket?.network==="stellar-mainnet"||String(selectedSpotMarket?.market_id??"").startsWith("sodax:catalog:"))&&selectedSpotMarket?.history_available!==true){setHistoryLoading(false);return;}
    if(!session||!selectedSpotMarket||!(page==="markets"||page==="trade")||!capability("trade."+(category==="crypto_spot"?"spot":category))?.enabled){setHistoryLoading(false);return;}
    let alive=true,inFlight=false;setHistoryLoading(true);
    const expectedMarket=selectedSpotMarket.market_id??selectedSpotMarket.id;
    const refreshHistory=async()=>{if(inFlight)return;inFlight=true;await api(`grapnel/market-history?market_id=${encodeURIComponent(expectedMarket)}&range=${historyRange}`).then(result=>{
      if(alive&&result?.market_id===expectedMarket&&typeof result.base_asset_id==="string"&&typeof result.base_symbol==="string"&&typeof result.quote_symbol==="string"&&Array.isArray(result.points)){setMarketHistory(result);setHistoryScope(`${expectedMarket}:${historyRange}`);}
    }).catch(()=>{}).finally(()=>{inFlight=false;if(alive)setHistoryLoading(false);});};
    void refreshHistory();
    const timer=historyRange==='live'?setInterval(()=>{if(document.visibilityState==='visible')void refreshHistory();},15000):undefined;
    return()=>{alive=false;if(timer)clearInterval(timer);};
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
  const quoteMatchesMarket = quote && quote.market_id === market && quote.asset_in_id === selectedSpotMarket?.asset_in_id && quote.asset_out_id === selectedSpotMarket?.asset_out_id;
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
      setBalances([]); setOperations([]); setAssets([]); setMarkets([]); setLending([]); setEarnBalances([]); setActive(null);
      if (!(error instanceof ClientError && error.status === 401))
        setError(error instanceof Error ? error.message : "Session check failed. Please retry.");
    } finally {
      setSessionChecked(true);
    }
    // Market and chain reads must never hold the login gate open.
    void Promise.allSettled([api("status"), api("grapnel/capabilities")]).then(([configuration, capabilities]) => {
      if (configuration.status === "fulfilled") setStatus(configuration.value);
      if (capabilities.status === "fulfilled") setCaps(capabilities.value.capabilities ?? []);
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
          if (category === "perps") {
            // Dedicated guarded polling above owns this read-only category.
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
          const m = await api("grapnel/lending-markets");
          if (alive) setLending((Array.isArray(m) ? m : (m.markets ?? [])).filter((market: {asset_id:string}) => [
            "stellar-testnet:native:XLM",
            "stellar-testnet:classic:USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56",
          ].includes(market.asset_id)));
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
    if (page === "markets" || page === "trade") { setQuote(null); void refreshUsdcStatus(); }
  }, [page, session, active?.status, active?.operation_id, refreshEarnBalances, refreshUsdcStatus]);
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
    const delay = Math.min(
      15000,
      2000 * 2 ** Math.min(polling.current.attempt++, 3),
    );
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
  async function action(task: () => Promise<void>, location: "page" | "swap" = "page") {
    setBusy(true);
    setError("");
    setSwapError("");
    try {
      await task();
    } catch (e) {
      if (location === "swap") {
        if (e instanceof ClientError && ["QUOTE_EXPIRED", "QUOTE_ALREADY_USED"].includes(e.code)) {
          setQuote(null);
          setSwapError(e.code === "QUOTE_EXPIRED" ? "This quote expired. Get a new quote to continue." : "This quote has already been used. Get a new quote to continue.");
        } else setSwapError(e instanceof Error ? e.message : "Request failed");
      } else setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  function openOperation(op: Operation) {
    setActive(op);
    setOperations(current => [op, ...current.filter(item => item.operation_id !== op.operation_id)]);
  }
  async function resumeOperation(id: string) {
    if (!session || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw Error("Wallet action could not be found.");
    const op = await api("grapnel/operations/" + id);
    if (op.customer_id !== session.customer_id || op.wallet_id !== session.wallet_id) throw Error("Wallet action could not be found.");
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
    let op;
    try{
      op=await api('grapnel/'+path,body,'POST',key);
    }catch(error){
      if(error instanceof ClientError && error.status<500 && error.status!==408)clearOperationRequest(session.customer_id,path,body);
      if (error instanceof ClientError && error.code === "WALLET_OPERATION_PENDING") {
        await recoverPendingWalletAction(error);
        return;
      }
      throw error;
    }
    if(!op?.operation_id)throw Error('Operation status is uncertain; retry this same action to recover it');
    clearOperationRequest(session.customer_id,path,body);
    if(op.status==='awaiting_customer_authorization')await resumeOperation(op.operation_id);
    else openOperation(op);
  }
  async function approve() {
    if (
      !active?.prepared_action ||
      !active.customer_action_token ||
      !auth ||
      !session
    )
      throw Error("A current customer authorization is required");
    if(Date.parse(active.prepared_action.summary.expiresAt)<=Date.now())throw Error("This approval has expired. Refresh the operation before continuing.");
    const signed = await auth.sign(
      active.prepared_action,
      session.stellar_address,
    );
    try {
      openOperation(await api(`grapnel/operations/${active.operation_id}/authorize`, {
        customer_action_token: active.customer_action_token,
        signed_xdr: signed,
      }));
    } catch (cause) {
      // Recover status only: authorization may have committed before a timeout.
      // Never automatically sign again or resend a financial request here.
      try { openOperation(await api(`grapnel/operations/${active.operation_id}`)); } catch { /* retain the known operation for manual recovery */ }
      throw cause;
    }
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
          <div className="brand"><span className="brandmark">l<span>f</span></span><span>local finance</span></div>

          <h1>{loading ? "Opening your workspace…" : "Welcome to Local Finance."}</h1>
          <p>Sign in to connect your wallet and open your dashboard.</p>
          {loginTimedOut && <p className="login-error" role="alert">Sign-in is taking too long. Retry the connection.</p>}
          {error && <p className="login-error" role="alert">{customerMessage(error)}</p>}
          <button className="button" onClick={loginTimedOut ? () => window.location.reload() : connect} disabled={loading || busy || !auth}>
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
        <Link className="brand" href="/home">
          <span className="brandmark">
            l<span>f</span>
          </span>
          <span>
            local finance
          </span>
        </Link>
        <div className="workspace">
          <span className="workspace-avatar">L</span>
          <div>
            Personal workspace
          </div>
          <span className="chevron">⌄</span>
        </div>
        <nav aria-label="Main navigation">
          {nav.map(([id, label]) => (
            <Link
              key={id}
              href={"/" + id}
              className={
                page === id || (id === "markets" && page === "trade")
                  ? "nav-link current"
                  : "nav-link"
              }
            >
              <Icon name={id === "funds" ? "fund" : id!} />
              {label}

            </Link>
          ))}
        </nav>

      </aside>
      <div className="main">
        <header className="topbar">
          <span className="crumb">
            Personal /{" "}
            <strong>
              {nav.find((n) => n[0] === page)?.[1] ?? "Connect wallet"}
            </strong>
          </span>
          <div className="top-actions">

            {session ? (
              <button
                className="avatar"
                onClick={() =>
                  action(async () => {
                    if (auth) await auth.logout();
                    else await api("session", undefined, "DELETE");
                    setSession(null);
                    setBalances([]);
                    setOperations([]);
                    setAssets([]);
                    setMarkets([]);
                    setLending([]);
                    setEarnBalances([]);
                    setActive(null);
                  })
                }
                title="Sign out"
              >
                LF
              </button>
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
        </header>
        <main>
          <div className="page-heading">
            <div>
              <p className="eyebrow">YOUR LOCAL FINANCE WORKSPACE</p>
              <h1>{(page==="markets"||page==="trade")&&category!=="crypto_spot"?"Markets":title[page]}</h1>

            </div>
            <button
              className="refresh"
              onClick={() => action(refresh)}
              disabled={busy}
              title="Refresh live data"
            >
              ↻
            </button>
          </div>
          {pendingWalletAction && !active && (
            <div className="notice neutral" role="status">
              <Icon name="wallet" />
              <div><strong>{pendingWalletAction.status === "awaiting_customer_authorization" ? "Wallet approval waiting" : "Wallet action in progress"}</strong>
                <p>{activityLabel(pendingWalletAction)} · {statusLabel(pendingWalletAction.status)}. Open the existing action before preparing another.</p>
              </div>
              <button className="button outline" disabled={busy} onClick={() => action(() => resumeOperation(pendingWalletAction.operation_id))}>
                {pendingWalletAction.status === "awaiting_customer_authorization" ? "Resume approval" : "Check status"}
              </button>
            </div>
          )}
          {error && !((page === "markets" || page === "trade") && swapError) && (
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
                  <h2>
                    {session
                      ? "Your wallet is connected."
                      : "Your next step starts here."}
                  </h2>
                  <p>
                    {session
                      ? "Your wallet is ready."
                      : "Sign in to connect your wallet."}
                  </p>
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
                          View account ↗
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
                </div>
              </section>
              <section className="section">
                <div className="section-heading">
                  <h2>Your assets</h2>
                  <span className="muted small">
                    Wallet balances · no estimated USD value
                  </span>
                </div>
                <BalanceTable balances={balances} connected={!!session} />
              </section>
              <section className="market-overview" aria-label="Market overview" data-testid="market-overview">
                {overviewGroups.filter(group=>capability(group.module)?.enabled).map(group=>{
                  const section=overviewSections.find(entry=>entry.id===group.id);
                  const items=(section?.available?section.items:[]).filter(item=>typeof item.value==="string"&&/^\d+(?:\.\d+)?$/.test(item.value)&&(item.unit==="USD"||item.unit==="percent")&&Number.isFinite(Date.parse(item.as_of))).slice(0,3);
                  return <section className="overview-market-group" key={group.id} aria-label={group.label} data-testid={`overview-${group.id}`}>
                    <Link className="overview-market-heading" href={group.href}><h3>{group.label}</h3><Icon name="arrow" size={15} /></Link>
                    {items.length?<ul>{items.map(item=><li key={`${item.symbol}:${item.name}`}><div className="overview-asset-identity"><AssetLogo symbol={item.symbol} name={item.name} size={26} /><div><strong title={item.name}>{item.symbol}</strong><time dateTime={item.as_of} title={marketDate(item.as_of,true)}>{marketDate(item.as_of)}</time></div></div><span className="overview-market-value">{formatTokenAmount(item.value)}{item.unit==="percent"?"%":" USD"}{item.unit_detail&&<small>{item.unit_detail}</small>}</span></li>)}</ul>:<p className="small muted" role="status">{overviewLoading?"Loading prices":"Prices updating"}</p>}
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
          {fundingPage === "fund" && <>
            <section className="section" aria-label="Current wallet balances">
              <div className="section-heading"><h2>Your wallet balances</h2></div>
              <BalanceTable balances={balances} connected={!!session} />
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

                <div className="detail-row">
                  <span>
                    {fundingPage === "fund" ? "Treasury inventory" : "Authorization"}
                  </span>
                  <strong>
                    {fundingPage === "fund"
                      ? assets[0]?.treasury_available
                        ? formatTokenAmount(assets[0].treasury_available) + " XLM"
                        : "Not yet available"
                      : "Your wallet signature"}
                  </strong>
                </div>
                <div className="inline-note">
                  {customerMessage(fundingError || (!fundingCanStart ? capability("capital.testnet_funding")?.reason : "") || "Your wallet keeps the XLM required for network fees and account reserve.")}
                </div>
                <button
                  className="button wide"
                  disabled={
                    busy || !session || !(executable("capital.testnet_funding") || (fundingPage === "fund" || fundingPage === "return") && fundingCanStart)
                  }
                  onClick={() =>
                    action(() => start(fundingPage, { asset_id: asset, amount }))
                  }
                >
                  {busy
                    ? "Preparing…"
                    : fundingPage === "fund"
                      ? "Get funds"
                      : "Review return transaction"}
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
                      setError("");
                      setMarket("");
                      setMarkets([]);
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
                    {visiblePublicMarkets.map(entry=><button type="button" key={entry.market_id??entry.id} data-testid={`market-option-${entry.underlying?.symbol??entry.market_id}`} aria-label={`${entry.underlying?.symbol??entry.label} ${category==="perps"?"perpetual":"stock"}`} aria-pressed={(entry.market_id??entry.id)===market}
                      onClick={()=>{setMarket(entry.market_id??entry.id);setMarketResultsOpen(false);}}><span className="public-market-symbol"><AssetLogo symbol={entry.underlying?.symbol??entry.label} name={entry.underlying?.name} assetId={entry.market_id??entry.id} size={24} />{entry.underlying?.symbol??entry.label}</span><span className="public-market-name">{entry.underlying?.name??entry.label}</span><strong>{entry.reference_price==null?"—":formatTokenAmount(entry.reference_price)}{entry.reference_price!=null&&<small> USD</small>}</strong>{entry.price_status==="stale"&&<span className="public-market-delay">Delayed</span>}</button>)}
                  </div> : (!markets.length||marketResultsOpen) ? <p className="small muted" role="status">{markets.length?"No matching markets.":"No markets available."}</p> : null}
                </section>
              )}
              {(category === "perps" || category === "stocks") && selectedSpotMarket ? (
                <>
                  <nav className="market-breadcrumb" aria-label="Breadcrumb"><Link href="/home">Home</Link><span>/</span><Link href="/markets">Markets</Link><span>/</span><strong>{selectedSpotMarket.underlying?.symbol??selectedSpotMarket.label}</strong></nav>
                  <div className="market-detail-layout">
                    <section className="market-price-card" aria-label="Asset price" data-testid={category==="perps"?"perps-market-detail":"stocks-market-detail"}>
                      <div className="market-asset-heading"><AssetLogo symbol={selectedSpotMarket.underlying?.symbol??selectedSpotMarket.label} name={selectedSpotMarket.underlying?.name} assetId={selectedSpotMarket.market_id??selectedSpotMarket.id} size={48} /><div><h2>{selectedSpotMarket.underlying?.name??selectedSpotMarket.label}</h2><span>{selectedSpotMarket.underlying?.symbol} {category==="perps"?"perpetual":"stock"}</span></div></div>
                      <div className="market-price-heading"><strong>{category==="stocks" ? (activePublicHistory?.latest_price==null?"—":formatTokenAmount(activePublicHistory.latest_price)) : selectedSpotMarket.reference_price==null?"—":formatTokenAmount(selectedSpotMarket.reference_price)}</strong><span>{activePublicHistory?.quote_symbol??"USD"} per {selectedSpotMarket.underlying?.symbol}</span></div>
                      <div className={`public-market-freshness ${selectedSpotMarket.price_status==="stale"?"delayed":""}`} data-testid="market-price-freshness">{category==="stocks" ? (activePublicHistory?.latest_price?"Stock reference price":"Price unavailable") : selectedSpotMarket.price_status==="current"?"Current price":selectedSpotMarket.price_status==="stale"?"Price delayed":"Price unavailable"}{(category==="stocks"?activePublicHistory?.metrics?.market_time:selectedSpotMarket.oracle_timestamp)&&<time dateTime={category==="stocks"?activePublicHistory?.metrics?.market_time??undefined:selectedSpotMarket.oracle_timestamp}>{marketDate(category==="stocks"?activePublicHistory!.metrics!.market_time!:selectedSpotMarket.oracle_timestamp,true)}</time>}</div>
                      <div className="market-price-change" aria-label="Price change"><strong>{activePublicHistory&&activePublicHistory.points.length>1?displayChange(activePublicHistory.change_absolute):"—"}</strong><span>{activePublicHistory&&activePublicHistory.points.length>1?`USD (${displayChange(activePublicHistory.change_percent)}%)`: "(—)"}</span></div>
                      {category==="stocks"&&selectedSpotMarket.history_available!==true ? <div className="market-chart-empty" role="status">Price data unavailable</div> : <PriceChart history={activePublicHistory} loading={historyLoading} />}
                      <div className="market-periods" role="group" aria-label="Price timeframe">{(["live","1d","1w","1m","1y","all"] as const).map(period=><button type="button" key={period} aria-pressed={historyRange===period} onClick={()=>setHistoryRange(period)}>{period.toUpperCase()}</button>)}</div>
                      {(activePublicHistory?.as_of??selectedSpotMarket.observed_at)&&<p className="market-price-observed">Updated {marketDate(activePublicHistory?.as_of??selectedSpotMarket.observed_at,true)}</p>}
                      {category==="stocks"&&activePublicHistory?.metrics&&<dl className="public-market-stats" data-testid="stock-market-metrics">
                        {([["day_high","Day high"],["day_low","Day low"],["previous_close","Previous close"],["fifty_two_week_high","52-week high"],["fifty_two_week_low","52-week low"],["day_volume","Day volume"]] as const).map(([field,label])=><div key={field}><dt>{label}</dt><dd>{activePublicHistory.metrics?.[field]==null?"—":`${formatTokenAmount(activePublicHistory.metrics[field])} ${field==="day_volume"?"shares":activePublicHistory.quote_symbol}`}</dd></div>)}
                      </dl>}
                      {selectedSpotMarket.stats&&<>
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
                    <section className="market-order-card" aria-label="Trade market" data-testid="market-order-card">
                      <h2>Trade {selectedSpotMarket.underlying?.symbol}</h2>
                      <div className="public-order-direction" role="group" aria-label={category==="perps"?"Position direction":"Order direction"}><button type="button" disabled>{category==="perps"?"Long":"Buy"}</button><button type="button" disabled>{category==="perps"?"Short":"Sell"}</button></div>
                      <label>Amount<input aria-label="Order amount" placeholder="0.00" inputMode="decimal" disabled /></label>
                      <div className="detail-row"><span>Market price</span><strong>{category==="stocks" ? (activePublicHistory?.latest_price==null?"—":`${formatTokenAmount(activePublicHistory.latest_price)} ${activePublicHistory.quote_symbol}`) : selectedSpotMarket.reference_price==null?"—":`${formatTokenAmount(selectedSpotMarket.reference_price)} USD`}</strong></div>
                      <button className="button wide" disabled>Trading unavailable</button>
                    </section>
                  </div>
                </>
              ) : category === "crypto_spot" && markets.length && selectedSpotMarket ? (
                <>
                <nav className="market-breadcrumb" aria-label="Breadcrumb"><Link href="/home">Home</Link><span>/</span><Link href="/markets">Markets</Link><span>/</span><strong>{marketHistory ? (swapAssetMap.has(marketHistory.base_asset_id) ? swapIdentity(marketHistory.base_asset_id) : marketHistory.base_symbol) : "Asset"}</strong></nav>
                <div className="market-detail-layout">
                  <section className="market-price-card" aria-label="Asset price">
                    <div className="market-asset-heading">
                      {marketHistory&&<AssetLogo symbol={marketHistory.base_symbol} name={swapAssetMap.get(marketHistory.base_asset_id)?.name} assetId={marketHistory.base_asset_id} size={48} />}
                      <div><h2>{marketHistory ? (swapAssetMap.get(marketHistory.base_asset_id)?.name ?? marketHistory.base_symbol) : "Asset price"}</h2><span>{marketHistory?.base_symbol??""}</span></div>
                    </div>
                    <div className="market-price-heading"><strong>{marketHistory?.latest_price ? formatTokenAmount(marketHistory.latest_price) : "—"}</strong><span>{marketHistory?.latest_price ? `${marketHistory.quote_symbol} per ${marketHistory.base_symbol}` : "Price unavailable"}</span></div>
                    <div className="market-price-change" aria-label="Price change"><strong>{marketHistory&&marketHistory.points.length>1?displayChange(marketHistory.change_absolute):"—"}</strong>{marketHistory?.change_absolute&&marketHistory.points.length>1&&<span>{marketHistory.quote_symbol}</span>}<span>({marketHistory&&marketHistory.points.length>1?displayChange(marketHistory.change_percent):"—"}{marketHistory?.change_percent&&marketHistory.points.length>1?"%":""})</span></div>
                    <PriceChart history={marketHistory} loading={historyLoading} />
                    <div className="market-periods" role="group" aria-label="Price timeframe">{(["live","1d","1w","1m","1y","all"] as const).map(period => <button type="button" key={period} aria-pressed={historyRange===period} onClick={()=>setHistoryRange(period)}>{period.toUpperCase()}</button>)}</div>
                    {marketHistory?.as_of&&<p className="market-price-observed">Updated {marketDate(marketHistory.as_of,true)}</p>}
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
                      <output className="swap-output" aria-label="Estimated buy amount">{quoteMatchesMarket && !quoteExpired ? formatTokenAmount(quote.expected_out) : "—"}</output>
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
                  {swapError && <p className="swap-action-error" role="alert" id="swap-action-error">{customerMessage(swapError)}</p>}
                  {quote && quoteExpired && !swapError && <p className="inline-note" role="alert">This quote expired. Request a new quote before reviewing a swap.</p>}
                  {!canPrepareSpot && <p className="small muted">This pair is currently unavailable.</p>}
                  {quoteMatchesMarket && !quoteExpired ? <button className="button swap-submit" aria-describedby={swapError ? "swap-action-error" : undefined} disabled={busy || !canPrepareSpot || !walletReadyForPair}
                    onClick={() => action(async () => {
                      if (!quoteMatchesMarket || Date.parse(quote.expires_at) <= Date.now()) {setQuoteClock(Date.now());throw Error("This quote expired. Request a new quote.");}
                      await start("order",{quote_id:quote.quote_id});setQuote(null);
                    }, "swap")}>{busy ? "Preparing…" : "Review swap"}</button>
                    : <button className="button swap-submit" aria-describedby={swapError ? "swap-action-error" : undefined} disabled={busy || !canPrepareSpot || !walletReadyForPair || !swapAmount}
                      onClick={() => action(async () => {
                        setQuote(null);
                        const customerId=session?.customer_id, expectedMarket=market, expectedInput=selectedSpotMarket.asset_in_id, expectedOutput=selectedSpotMarket.asset_out_id;
                        const next=await api("grapnel/quote",{market_id:expectedMarket,asset_id:expectedInput,amount:swapAmount,slippage_bps:slippageBps});
                        if(spotCustomer.current!==customerId)return;
                        if(next.market_id!==expectedMarket||next.asset_in_id!==expectedInput||next.asset_out_id!==expectedOutput||!next.quote_id||!Number.isFinite(Date.parse(next.expires_at)))throw Error("The returned quote does not match your selected assets.");
                        setQuoteClock(Date.now());setQuote(next);
                      }, "swap")}>{busy ? "Getting quote…" : "Get quote"}</button>}
                </section>
                </div>
                </>
              ) : category === "crypto_spot" || category === "unavailable" ? <section className="card"><Empty icon="markets" title="No markets available." text={category === "crypto_spot" ? "Try refreshing to check available assets." : "This category is currently unavailable."} /></section> : null}
            </>
          )}
          {page === "earn" && (
            <>

              <section className="card">
                <div className="section-heading">
                  <h2>Earn</h2>
                  <span className="status-pill">
                    {canPrepareBlendAction() ? "Available" : "Unavailable"}
                  </span>
                </div>
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
                      const shown = (value: string | null | undefined) => earnBalancesLoading ? "Loading…" : formatTokenAmount(value);
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

                        {m.as_of && <p className="small muted">Observed {new Date(m.as_of).toLocaleString()}. Variable pool estimate.</p>}

                        <dl className="earn-balances" aria-label={`${m.asset?.code ?? "Asset"} balances`}>
                          <div><dt>Available</dt><dd>{shown(balance?.spendable)}</dd></div>
                          <div><dt>In Earn</dt><dd>{shown(balance?.in_earn)}</dd></div>
                          <div><dt>Earned</dt><dd title={balance?.earned_since ? `Since ${new Date(balance.earned_since).toLocaleString()}` : undefined}>{balance?.earned == null ? "—" : shown(balance.earned)}</dd></div>
                        </dl>
                        {earnBalancesError && <p className="small earn-balance-error" role="alert">{customerMessage(earnBalancesError)}</p>}
                        {needsTrustline ? (
                          <div className="earn-setup">
                            <p className="small">Enable USDC in your wallet before supplying it.</p>
                            <button className="button outline" disabled={busy || !session || !canPrepareBlendAction()}
                              onClick={() => action(() => start("usdc-trustline", {limit: "1000"}))}>Enable USDC</button>
                          </div>
                        ) : (
                          <div className="earn-actions">
                            <div className="earn-action-toggle" role="group" aria-label={`${m.asset?.code ?? "Asset"} Earn action`}>
                              {(["supply", "withdraw"] as const).map(a => <button type="button" key={a}
                                aria-pressed={earnAction === a} onClick={() => setEarnActions(current => ({...current, [m.asset_id]: a}))}>
                                {a === "supply" ? "Supply" : "Withdraw"}
                              </button>)}
                            </div>
                            <div className="earn-action">
                              <label>{earnAction === "supply" ? "Supply amount" : "Withdraw amount"}
                                <input inputMode="decimal" value={earnAmounts[amountKey] ?? ""} placeholder="0.00"
                                  onChange={e => setEarnAmounts(current => ({...current, [amountKey]: e.target.value}))} />
                              </label>
                              <button className="button" disabled={busy || !session || !canPrepare || !earnAmounts[amountKey]}
                                onClick={() => action(() => start("lending/" + earnAction, {
                                  market_id: m.market_id ?? m.id, asset_id: m.asset_id, amount: earnAmounts[amountKey],
                                }))}>{earnAction === "supply" ? "Supply" : "Withdraw"}</button>
                            </div>
                          </div>
                        )}
                      </div>;
                    })}
                  </div>
                ) : (
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
                        {statusLabel(op.status)}
                      </span>
                      <Icon name="arrow" size={16} />
                    </button>
                  ))}
                </div>
              ) : (
                <Empty
                  icon="activity"
                  title="No activity yet."
                  text="Your transfers and Earn actions will appear here."
                />
              )}
            </section>
          )}

        </main>
      </div>
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
                ? `Review your ${swapIdentity(active.prepared_action?.summary.fromAssetId)} → ${swapIdentity(active.prepared_action?.summary.toAssetId)} swap`
                : active.type === "wallet.usdc_trustline"
                ? active.status === "completed" ? "USDC enabled." : "Enable USDC"
                : active.status === "awaiting_customer_authorization"
                ? "Review before you approve."
                : active.status === "completed"
                  ? activityLabel(active)
                  : [
                        "failed",
                        "expired",
                        "rejected",
                        "recovery_required",
                      ].includes(active.status)
                    ? "Operation needs attention."
                    : "Your operation is in progress."}
            </h2>
            <span
              className={
                "status-pill " +
                (active.status === "completed" ? "success" : "")
              }
            >
              {statusLabel(active.status)}
            </span>
            {active.prepared_action && active.type === "wallet.usdc_trustline" ? (
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
            {active.status === "awaiting_customer_authorization" && (
              <>
                {approvalExpired && <p className="inline-note" role="status">This approval timed out. Check its status before preparing a new action.</p>}
                <button className="button outline" disabled={busy} onClick={() => action(() => resumeOperation(active.operation_id))}>Check action status</button>
                <p className="small muted">
                  {active.type === "wallet.usdc_trustline"
                    ? "Review the holding limit, XLM held, fee and expiry before approving."
                    : "Review the assets, amount, destination, fee and expiry before approving."}
                </p>
                <button
                  className="button wide"
                  disabled={busy || !auth || approvalExpired}
                  onClick={() => action(approve)}
                >
                  {busy ? "Waiting for approval…" : "Approve transaction"}
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
  balances,
  connected,
}: {
  balances: any[];
  connected: boolean;
}) {
  const identities: SwapAsset[] = balances.map(balance => {
    const metadata=balance.asset?.id===balance.asset_id?balance.asset:null;
    return {id:balance.asset_id,code:typeof metadata?.code==="string"&&metadata.code?metadata.code:assetCode(balance.asset_id),name:metadata?.verified===true&&typeof metadata.name==="string"&&metadata.name.trim()?metadata.name.trim():undefined};
  });
  const zero=(value:unknown)=>typeof value==="string"&&/^0+(?:\.0+)?$/.test(value);
  const visibleBalances=balances.filter(balance=>{
    const standalone=balance.asset?.id===balance.asset_id&&balance.asset.kind==="soroban"||typeof balance.asset_id==="string"&&balance.asset_id.startsWith("stellar-testnet:soroban:");
    return !(standalone&&zero(balance.wallet_amount)&&(!balance.reserved||zero(balance.reserved))&&(!balance.spendable||zero(balance.spendable)));
  });
  return visibleBalances.length ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Asset</th>
            <th>Wallet amount</th>
            <th>Reserved</th>
            <th>Spendable</th>
          </tr>
        </thead>
        <tbody>
          {visibleBalances.map((b) => {
            const identity=identities.find(item=>item.id===b.asset_id)!;
            const label=displayAssetIdentity(identity,identities);
            return <tr key={b.asset_id}>
              <td>
                <span className="asset-mark" aria-hidden="true">
                  <AssetLogo symbol={identity.code} name={identity.name} assetId={identity.id} size={26} />
                </span>
                <div>
                  <strong>{label}</strong>
                  {identity.name&&identity.name!==identity.code&&!label.includes(identity.name)&&<small>{identity.name}</small>}

                </div>
              </td>
              <td>{formatTokenAmount(b.wallet_amount)}</td>
              <td>{formatTokenAmount(b.reserved)}</td>
              <td>
                <strong>{formatTokenAmount(b.spendable)}</strong>
              </td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty
      icon="wallet"
      title={
        connected
          ? balances.length ? "No assets with a balance." : "Waiting for a live balance read."
          : "Connect to see your assets."
      }
      text="Refresh to check your current balances."
    />
  );
}
