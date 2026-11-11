"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  PrivyProvider,
  getIdentityToken,
  usePrivy,
  useUser,
} from "@privy-io/react-auth";
import { useSignRawHash } from "@privy-io/react-auth/extended-chains";
import type { PreparedAction } from "@grapnel/contracts";
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
const nav = [
  ["home", "Overview"],
  ["fund", "Get Testnet funds"],
  ["markets", "Markets"],
  ["earn", "Earn"],
  ["return", "Return Funds"],
  ["activity", "Activity"],
];
function customerMessage(message: string): string {
  if (message.includes("GATE_1_SIGNING_PROOF_REQUIRED") || /Gate 1.*proof/i.test(message)) return "Complete the signing check on Overview.";
  if (message.includes("MODULE_NOT_ENABLED") || /module.*(disabled|not enabled)/i.test(message)) return "This module is unavailable.";
  return message;
}
const short = (v: string) =>
  v.length > 22 ? v.slice(0, 10) + "…" + v.slice(-7) : v;
const title: Record<string, string> = {
  home: "A clearer view of your assets.",
  login: "Your wallet. Your approval.",
  fund: "Get Testnet funds",
  return: "Return Testnet Funds",
  markets: "Explore available markets.",
  trade: "Explore available markets.",
  earn: "Put Testnet assets to work.",
  activity: "Every step, accounted for.",
};
export default function Finance({ page }: { page: string }) {
  const id = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  return id ? (
    <PrivyProvider
      appId={id}
      config={{
        loginMethods: ["email"],
        appearance: { theme: "light", accentColor: "#2555d7" },
      }}
    >
      <PrivyFinance page={page} />
    </PrivyProvider>
  ) : (
    <FinanceShell page={page} />
  );
}
function PrivyFinance({ page }: { page: string }) {
  const { ready, authenticated, login, logout } = usePrivy();
  const { refreshUser } = useUser();
  const { signRawHash } = useSignRawHash();
  const connect = async () => {
    const token = await getIdentityToken();
    if (!token) throw Error("Sign in with Privy first");
    await api("session", { identity_token: token });
    await refreshUser();
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
  return <FinanceShell page={page} auth={auth} />;
}
function FinanceShell({ page, auth }: { page: string; auth?: Auth }) {
  const [status, setStatus] = useState<any>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [caps, setCaps] = useState<Capability[]>([]);
  const [balances, setBalances] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [fundingError, setFundingError] = useState("");
  const [markets, setMarkets] = useState<any[]>([]);
  const [lending, setLending] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [active, setActive] = useState<Operation | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("1");
  const [asset, setAsset] = useState("stellar-testnet:native:XLM");
  const [market, setMarket] = useState("");
  const [quote, setQuote] = useState<any>(null);
  const [category, setCategory] = useState("crypto_spot");
  const polling = useRef({ id: "", attempt: 0 });
  const capability = (module: string) => caps.find((c) => c.module === module);
  const executable = (module: string) =>
    capability(module)?.enabled &&
    capability(module)?.execution_status === "testnet_verified";
  // Blend supply needs a first real customer operation to earn testnet_verified.
  // Allow only the preparation attempt after the separate customer-signing gate;
  // the API rechecks Gate 1 and fresh simulation before returning anything signable.
  const canPrepareBlendSupply = () =>
    capability("capital.lending")?.enabled &&
    ["discovery_only", "testnet_verified"].includes(
      capability("capital.lending")?.execution_status ?? "",
    ) &&
    capability("capital.wallets")?.execution_status === "testnet_verified";
  // Funding must allow the first real round trip after Gate 1. Capability stays
  // discovery_only until the first grant and customer return are chain-verified.
  const fundingCanStart = capability("capital.testnet_funding")?.enabled && assets.some((entry: any) => entry.available === true);
  const refresh = useCallback(async () => {
    const [configuration, identity, capabilities] = await Promise.allSettled([
      api("status"),
      api("session"),
      api("grapnel/capabilities"),
    ]);
    if (configuration.status === "fulfilled") setStatus(configuration.value);
    if (capabilities.status === "fulfilled")
      setCaps(capabilities.value.capabilities ?? []);
    if (identity.status === "fulfilled") {
      setSession(identity.value);
      const [b, o] = await Promise.allSettled([
        api("grapnel/balances"),
        api("grapnel/operations"),
      ]);
      if (b.status === "fulfilled")
        setBalances(
          Array.isArray(b.value) ? b.value : (b.value.balances ?? []),
        );
      if (o.status === "fulfilled") setOperations(o.value.operations ?? []);
    } else {
      setSession(null);
      setBalances([]);
      setOperations([]);
      setPositions([]);
      setAssets([]);
      setMarkets([]);
      setLending([]);
      setActive(null);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!session) return;
    let alive = true;
    (async () => {
      try {
        if (page === "fund" || page === "return") {
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
          if (selected?.enabled && category === "crypto_spot") {
            const m = await api("grapnel/markets?asset_class=" + category);
            if (alive) setMarkets(Array.isArray(m) ? m : (m.markets ?? []));
          } else if (alive) setMarkets([]);
        }
        if (page === "earn") {
          const m = await api("grapnel/lending-markets");
          if (alive) setLending(Array.isArray(m) ? m : (m.markets ?? []));
          const p = await api("grapnel/lending-positions");
          if (alive) setPositions(Array.isArray(p) ? p : (p.positions ?? []));
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Request failed");
      }
    })();
    return () => {
      alive = false;
    };
  }, [page, session, category, caps]);
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
          setActive(op);
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
  async function action(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  async function start(path: string, body: unknown) {
    if(!session)throw Error('A current customer session is required');
    const key=operationRequestKey(session.customer_id,path,body);
    let op;
    try{
      op=await api('grapnel/'+path,body,'POST',key);
    }catch(error){
      if(error instanceof ClientError && error.status<500 && error.status!==408)clearOperationRequest(session.customer_id,path,body);
      throw error;
    }
    if(!op?.operation_id)throw Error('Operation status is uncertain; retry this same action to recover it');
    clearOperationRequest(session.customer_id,path,body);
    setActive(op);
    if(op.status==='awaiting_customer_authorization')setActive(await api('grapnel/operations/'+op.operation_id));
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
      setActive(await api(`grapnel/operations/${active.operation_id}/authorize`, {
        customer_action_token: active.customer_action_token,
        signed_xdr: signed,
      }));
    } catch (cause) {
      // Recover status only: authorization may have committed before a timeout.
      // Never automatically sign again or resend a financial request here.
      try { setActive(await api(`grapnel/operations/${active.operation_id}`)); } catch { /* retain the known operation for manual recovery */ }
      throw cause;
    }
  }
  const connect = () =>
    action(async () => {
      if (!auth) throw Error("Privy has not been configured for this demo");
      if (!auth.authenticated) {
        auth.login();
        return;
      }
      await auth.connect();
      await refresh();
    });
  return (
    <div className="app">
      <aside className="sidebar">
        <Link className="brand" href="/home">
          <span className="brandmark">
            l<span>f</span>
          </span>
          <span>
            local finance<small>INDEPENDENT DEMO</small>
          </span>
        </Link>
        <div className="workspace">
          <span className="workspace-avatar">L</span>
          <div>
            Personal workspace<small>Stellar Testnet</small>
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
              <Icon name={id!} />
              {label}
              {id === "markets" && <span className="tiny">4</span>}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="shield">
            <Icon name="shield" />
            <p>
              Built on Stellar.
              <br />
              <strong>Powered by</strong>
              <GrapnelMark />
            </p>
          </div>
          <p className="muted small">
            Testnet tokens only.
            <br />
            No fiat or real value.
          </p>
        </div>
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
            <span className="badge">
              <i /> STELLAR TESTNET
            </span>
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
                    setPositions([]);
                    setAssets([]);
                    setMarkets([]);
                    setLending([]);
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
              <h1>{title[page]}</h1>
              <p className="subtitle">
                {page === "home"
                  ? "One place for your wallet, Testnet transfers, and available opportunities."
                  : page === "earn"
                    ? "Explore Blend pools. Variable rates, transparent positions, customer-approved actions."
                    : page === "activity"
                      ? "Durable operation states from Grapnel, confirmed against Stellar Testnet."
                      : "Customer-owned assets. Every financial action goes through Grapnel."}
              </p>
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
          {error && (
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
                  <strong>This Testnet demo is awaiting connection.</strong>
                  <p>
                    {!status.grapnel_configured
                      ? "The business needs to configure its server-side Grapnel API connection. "
                      : ""}
                    {!status.privy_configured
                      ? "Privy customer login is not configured. "
                      : ""}
                    {!status.session_configured
                      ? "Secure customer sessions are not configured. "
                      : ""}
                    Balances and transaction results appear only after real
                    provider responses.
                  </p>
                </div>
              </div>
            )}
          {(page === "home" || page === "login") && (
            <>
              <section className="overview-grid">
                <div className="wallet-hero">
                  <div className="wallet-label">
                    <span>
                      <Icon name="wallet" /> YOUR TESTNET WALLET
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
                      ? "Your Stellar Testnet wallet."
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
                        <Link className="button light" href="/fund">
                          <Icon name="fund" size={17} /> Get Testnet funds
                        </Link>
                        <Link className="button ghost" href="/return">
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
                          : "Sign in with Privy"}
                        <Icon name="arrow" size={17} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="path-card">
                  <span className="eyebrow">WALLET DETAILS</span>
                  <h3>Stellar Testnet</h3>
                  <div className="detail-row"><span>Wallet provider</span><strong>Privy</strong></div>
                  <div className="detail-row"><span>Network</span><strong>Testnet</strong></div>
                  <div className="detail-row"><span>Status</span><strong>{session ? "Connected" : "Not connected"}</strong></div>
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
              <section className="opportunity-grid">
                <Link className="opportunity" href="/markets">
                  <span className="feature-icon blue">
                    <Icon name="markets" />
                  </span>
                  <span className="status-pill">
                    {capability("trade.spot")?.execution_status.replaceAll(
                      "_",
                      " ",
                    ) ?? "Awaiting connection"}
                  </span>
                  <h3>Find your next opportunity.</h3>
                  <p>
                    View available Testnet markets.
                  </p>
                  <strong>
                    Explore markets <Icon name="arrow" size={17} />
                  </strong>
                </Link>
                <Link className="opportunity" href="/earn">
                  <span className="feature-icon green">
                    <Icon name="earn" />
                  </span>
                  <span className="status-pill">Blend lending</span>
                  <h3>Understand what you supply.</h3>
                  <p>
                    View Blend pools and your positions.
                  </p>
                  <strong>
                    Explore Earn <Icon name="arrow" size={17} />
                  </strong>
                </Link>
              </section>
              {session && (
                <section className="proof-card">
                  <div>
                    <strong>Verify Testnet signing</strong>
                    <p>
                      Approve a 0.1 XLM Testnet payment to the demo treasury.
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
          {page === "fund" && <>
            <section className="section" aria-label="Current wallet balances">
              <div className="section-heading"><h2>Your wallet balances</h2><span className="muted small">Stellar Testnet</span></div>
              <BalanceTable balances={balances} connected={!!session} />
            </section>
          </>}
          {(page === "fund" || page === "return") && (
            <div className="form-layout">
              <section className="card transaction-form" id={page === "fund" ? "treasury-funding" : undefined}>
                <span className="feature-icon blue">
                  <Icon name={page} />
                </span>
                <h2>
                  {page === "fund"
                    ? "Request treasury funds."
                    : "Return available Testnet assets."}
                </h2>
                <p>
                  {page === "fund"
                    ? "Real tokens from a capped Grapnel Testnet treasury."
                    : "A customer-signed transfer to the fixed demo treasury."}
                </p>
                <label htmlFor="asset">Asset</label>
                <select
                  id="asset"
                  value={asset}
                  onChange={(e) => setAsset(e.target.value)}
                >
                  {assets.length ? (
                    assets.map((a) => (
                      <option key={a.asset_id} value={a.asset_id}>
                        {a.asset?.code ?? a.code ?? a.asset_id} ·{" "}
                        {a.asset?.kind ?? "Testnet"}
                      </option>
                    ))
                  ) : (
                    <option value="stellar-testnet:native:XLM">
                      XLM · native Stellar Testnet
                    </option>
                  )}
                </select>
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
                  <span>Network</span>
                  <strong>Stellar Testnet</strong>
                </div>
                <div className="detail-row">
                  <span>
                    {page === "fund" ? "Treasury inventory" : "Authorization"}
                  </span>
                  <strong>
                    {page === "fund"
                      ? assets[0]?.treasury_available
                        ? assets[0].treasury_available + " XLM"
                        : "Not yet available"
                      : "Your wallet signature"}
                  </strong>
                </div>
                <div className="inline-note">
                  {customerMessage((page === "fund" ? fundingError : "") || (fundingCanStart && capability("capital.testnet_funding")?.execution_status !== "testnet_verified" ? "Initial Testnet fund and return are enabled; capability promotion follows confirmed chain proof." : capability("capital.testnet_funding")?.reason) ||
                    (session ? "Requests use available Testnet assets and configured limits." : "Sign in to view availability."))}
                </div>
                <button
                  className="button wide"
                  disabled={
                    busy || !session || !(executable("capital.testnet_funding") || (page === "fund" || page === "return") && fundingCanStart)
                  }
                  onClick={() =>
                    action(() => start(page, { asset_id: asset, amount }))
                  }
                >
                  {busy
                    ? "Preparing…"
                    : page === "fund"
                      ? "Request Testnet Funds"
                      : "Review return transaction"}
                  <Icon name="arrow" size={17} />
                </button>
                <p className="small muted centered">
                  No fiat payment. Testnet assets have no real value.
                </p>
              </section>
              <section className="explain-card">
                <Icon name="shield" size={30} />
                <h3>
                  {page === "fund"
                    ? "An actual onchain transfer."
                    : "Approval before anything moves."}
                </h3>
                <p>
                  {page === "fund"
                    ? "Friendbot activates Stellar accounts with XLM. A separate treasury supplies existing allowlisted assets. A successful request must settle onchain before it appears as completed."
                    : "Grapnel builds the exact amount and treasury recipient. You review the summary and approve through Privy. Network reserves and active reservations remain protected."}
                </p>
                <hr />
                <span className="eyebrow">ASSET IDENTITY</span>
                <code>{asset}</code>
                <p className="small">
                  Native XLM, classic issuer-based tokens, and Soroban contract
                  assets are distinct. Matching a symbol is not proof of
                  compatibility.
                </p>
              </section>
            </div>
          )}
          {(page === "markets" || page === "trade") && (
            <>
              <div className="tabs">
                {[
                  ["crypto_spot", "Crypto spot"],
                  ["stocks", "Stocks"],
                  ["perps", "Perpetuals"],
                  ["commodities", "Commodities"],
                ].map(([id, label]) => (
                  <button
                    className={category === id ? "selected" : ""}
                    key={id}
                    onClick={() => {
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
              <div className="card">
                <div className="section-heading">
                  <h2>Testnet markets</h2>
                  <span className="status-pill">
                    {capability(
                      "trade." +
                        (category === "crypto_spot" ? "spot" : category),
                    )?.execution_status.replaceAll("_", " ") ?? "Unavailable"}
                  </span>
                </div>
                {markets.length ? (
                  <div className="market-list">
                    {markets.map((m) => (
                      <button
                        key={m.market_id ?? m.id}
                        className={
                          market === (m.market_id ?? m.id)
                            ? "market selected-market"
                            : "market"
                        }
                        onClick={() => setMarket(m.market_id ?? m.id)}
                      >
                        <Icon name="markets" />
                        <strong>{m.name ?? m.market_id ?? m.id}</strong>
                        <span>
                          {m.executable
                            ? "Route available"
                            : customerMessage(m.reason ?? "Execution unavailable")}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <Empty
                    icon="markets"
                    title={
                      session
                        ? "No verified route available."
                        : "Connect your wallet to explore."
                    }
                    text={category !== "crypto_spot"
                      ? "This category is discovery only. Execution is unavailable in this Testnet prototype."
                      : customerMessage(capability("trade.spot")?.reason ?? "Markets appear only after Grapnel verifies the provider, exact assets, and current Testnet route.")}

                  />
                )}
              </div>
              {market && (
                <section className="card compact-form">
                  <h3>Request an exact-input quote</h3>
                  <label>
                    Input asset ID
                    <input
                      value={asset}
                      onChange={(e) => setAsset(e.target.value)}
                    />
                  </label>
                  <label>
                    Amount
                    <input
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      inputMode="decimal"
                    />
                  </label>
                  <button
                    className="button"
                    disabled={busy || !executable("trade.spot")}
                    onClick={() =>
                      action(async () =>
                        setQuote(
                          await api("grapnel/quote", {
                            market_id: market,
                            asset_id: asset,
                            amount,
                            slippage_bps: 50,
                          }),
                        ),
                      )
                    }
                  >
                    Get quote
                  </button>
                  {quote && (
                    <>
                      <div className="quote-summary">
                        <div className="detail-row">
                          <span>Input amount</span>
                          <strong>
                            {quote.amount_in} · {quote.asset_in_id}
                          </strong>
                        </div>
                        <div className="detail-row">
                          <span>Expected receive</span>
                          <strong>
                            {quote.expected_out} · {quote.asset_out_id}
                          </strong>
                        </div>
                        <div className="detail-row">
                          <span>Minimum receive</span>
                          <strong>{quote.min_receive}</strong>
                        </div>
                        <div className="detail-row">
                          <span>Quote expires</span>
                          <strong>
                            {new Date(quote.expires_at).toLocaleTimeString()}
                          </strong>
                        </div>
                        <p className="small muted">
                          The final result appears only after confirmed
                          execution.
                        </p>
                      </div>
                      <button
                        className="button"
                        onClick={() =>
                          action(() =>
                            start("order", {
                              quote_id: quote.quote_id ?? quote.id,
                            }),
                          )
                        }
                        disabled={busy}
                      >
                        Review order
                      </button>
                    </>
                  )}
                </section>
              )}
              <div className="notice neutral">
                <Icon name="shield" />
                <p>
                  Stocks, perps and commodities are unavailable in this Testnet demo.
                </p>
              </div>
            </>
          )}
          {page === "earn" && (
            <>
              <div className="notice neutral">
                <Icon name="earn" />
                <p>
                  Variable Testnet rates. Lending carries liquidation and smart-contract risk.
                </p>
              </div>
              <section className="card">
                <div className="section-heading">
                  <h2>Blend Testnet pools</h2>
                  <span className="status-pill">
                    {capability("capital.lending")?.execution_status.replaceAll(
                      "_",
                      " ",
                    ) ?? "Awaiting connection"}
                  </span>
                </div>
                {lending.length ? (
                  <div className="pool-grid">
                    {lending.map((m) => (
                      <div className="pool" key={m.market_id ?? m.id}>
                        <span className="feature-icon green">
                          <Icon name="earn" />
                        </span>
                        <h3>
                          {m.asset?.code ?? m.code ?? m.symbol ?? "Reserve"}
                        </h3>
                        <p className="small muted">Estimated variable supply APY · Testnet pool</p>
                        <strong className="apy">
                          {m.supply_apy_variable == null
                            ? "Unavailable"
                            : new Intl.NumberFormat(undefined, {
                                style: "percent",
                                maximumFractionDigits: 2,
                              }).format(m.supply_apy_variable)}
                        </strong>
                        <code>{m.asset_id ?? m.reserve_contract_id}</code>
                        {m.as_of && <p className="small muted">Observed {new Date(m.as_of).toLocaleString()}. Variable pool estimate.</p>}
                        <p className="small">
                          {customerMessage(m.reason ?? m.readiness ?? "Live read; execution requires separate proof")}
                        </p>
                        <label>
                          Amount
                          <input
                            inputMode="decimal"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                          />
                        </label>
                        <div className="button-row">
                          {["supply", "withdraw"].map((a) => (
                            <button
                              className="button outline"
                              key={a}
                              disabled={
                                busy ||
                                !session ||
                                (a === "supply"
                                  ? !canPrepareBlendSupply() || m.asset_id !== "stellar-testnet:native:XLM"
                                  : !executable("capital.lending"))
                              }
                              onClick={() =>
                                action(() =>
                                  start("lending/" + a, {
                                    market_id: m.market_id ?? m.id,
                                    asset_id: m.asset_id,
                                    amount,
                                  }),
                                )
                              }
                            >
                              {a === "supply" && !executable("capital.lending")
                                ? "Prepare supply"
                                : a}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty
                    icon="earn"
                    title={
                      session
                        ? "No pool data available."
                        : "Connect to explore Blend."
                    }
                    text="Current rates and reserve identities are read through Grapnel. No estimated or invented yield is shown."
                  />
                )}
              </section>
              <section className="section">
                <div className="section-heading">
                  <h2>Your protocol positions</h2>
                  <span className="muted small">Separate from your wallet</span>
                </div>
                {positions.length ? (
                  <div className="card">
                    {positions.map((p, i) => (
                      <div className="position" key={i}>
                        <code>{p.asset_id ?? p.reserve_contract_id}</code>
                        <span>Supplied: {p.supplied ?? "Unavailable"}</span>
                        <span>Borrowed: {p.borrowed ?? "Unavailable"}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty
                    icon="wallet"
                    title="No verified positions to display."
                    text="Positions are loaded from the real pool for your connected wallet."
                  />
                )}
              </section>
            </>
          )}
          {page === "activity" && (
            <section className="card">
              <div className="section-heading">
                <h2>Operation history</h2>
                <span className="muted small">
                  {session
                    ? "Latest 100 operations"
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
                        action(async () =>
                          setActive(
                            await api("grapnel/operations/" + op.operation_id),
                          ),
                        )
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
                        <strong>{op.type.replaceAll(".", " · ")}</strong>
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
                        {op.status.replaceAll("_", " ")}
                      </span>
                      <Icon name="arrow" size={16} />
                    </button>
                  ))}
                </div>
              ) : (
                <Empty
                  icon="activity"
                  title="Your story starts with an action."
                  text="Real operations will appear here with durable status and a Stellar Testnet transaction link after submission."
                />
              )}
            </section>
          )}
          <footer>
            <span className="footer-credit">
              Built with <GrapnelMark /> APIs on Stellar Testnet.
            </span>
            <span>Independent sample fintech · no real money</span>
          </footer>
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
            <p className="eyebrow">STELLAR TESTNET OPERATION</p>
            <h2 id="operation-title">
              {active.status === "awaiting_customer_authorization"
                ? "Review before you approve."
                : active.status === "completed"
                  ? "Confirmed on Testnet."
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
              {active.status.replaceAll("_", " ")}
            </span>
            {active.prepared_action && (
              <div className="approval-summary">
                {Object.entries(active.prepared_action.summary)
                  .filter(([, v]) => v !== undefined)
                  .map(([k, v]) => (
                    <div key={k}>
                      <span>{k.replaceAll(/([A-Z])/g, " $1")}</span>
                      <code>{String(v)}</code>
                    </div>
                  ))}
              </div>
            )}
            <code className="operation-id">{active.operation_id}</code>
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
                View transaction on Stellar Expert ↗
              </a>
            )}
            {active.status === "awaiting_customer_authorization" && (
              <>
                <p className="small muted">
                  Approve only if the asset, amount, recipient, fee ceiling, and
                  expiry match your intent. Privy signs this exact Testnet
                  transaction.
                </p>
                <button
                  className="button wide"
                  disabled={busy || !auth}
                  onClick={() => action(approve)}
                >
                  {busy ? "Waiting for approval…" : "Approve with Privy"}
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
  return balances.length ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Asset identity</th>
            <th>Wallet amount</th>
            <th>Reserved</th>
            <th>Spendable</th>
          </tr>
        </thead>
        <tbody>
          {balances.map((b) => (
            <tr key={b.asset_id}>
              <td>
                <span className="asset-mark">
                  {b.asset_id.includes("native:XLM") ? "✦" : "◈"}
                </span>
                <div>
                  <strong>
                    {b.asset_id.includes("native:XLM")
                      ? "Stellar Lumens · XLM"
                      : "Testnet asset"}
                  </strong>
                  <code>{b.asset_id}</code>
                </div>
              </td>
              <td>{b.wallet_amount}</td>
              <td>{b.reserved}</td>
              <td>
                <strong>{b.spendable}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty
      icon="wallet"
      title={
        connected
          ? "Waiting for a live balance read."
          : "Connect to see your assets."
      }
      text="Wallet amounts, reserved funds, and spendable balances appear here from confirmed Stellar state."
    />
  );
}

function GrapnelMark() {
  return (
    <span className="grapnel-wordmark">
      <img src="/brand/logo-name-white.png" alt="Grapnel" />
    </span>
  );
}
