"use client";
import Link from "next/link";
import Customers from "./customers";
import { ModuleAvailability, type ModuleCapability } from "./module-availability";
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
type Module = ModuleCapability;
type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  last_four: string;
  status: string;
  created_at: string;
  last_used_at: string | null;
};
type Log = {
  request_id: string;
  method: string;
  path_template: string;
  status: number;
  duration_ms: number;
  created_at: string;
};
type Business = {
  id: string;
  name: string;
  environment: string;
  revision: number;
};
const nav = [
  ["overview", "Overview", "grid"],
  ["customers", "Customers", "wallet"],
  ["modules", "API modules", "layers"],
  ["api-keys", "API keys", "key"],
  ["logs", "Request logs", "activity"],
  ["docs", "Documentation", "book"],
] as const;
const titles: Record<string, string> = {
  overview: "Overview",
  customers: "Customers",
  modules: "API modules",
  "api-keys": "API keys",
  logs: "Request logs",
  docs: "Documentation",
  onboarding: "Create a workspace",
};
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    layers: (
      <>
        <path d="m12 3 10 5-10 5L2 8l10-5Z" />
        <path d="m2 12 10 5 10-5M2 16l10 5 10-5" />
      </>
    ),
    key: (
      <>
        <circle cx="8" cy="8" r="5" />
        <path d="m12 12 9 9m-4-4 3-3m-6 0 3-3" />
      </>
    ),
    activity: <path d="M2 12h5l3-8 4 16 3-8h5" />,
    book: (
      <>
        <path d="M12 5v16M3 3c5 0 7 1 9 3 2-2 4-3 9-3v16c-5 0-7 0-9 2-2-2-4-2-9-2V3Z" />
      </>
    ),
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    wallet: (
      <>
        <rect x="3" y="5" width="18" height="15" rx="3" />
        <path d="M3 8h18M17 12h4v5h-4a2.5 2.5 0 0 1 0-5Z" />
      </>
    ),
    bank: (
      <>
        <path d="m3 7 9-4 9 4H3Zm1 13h16M6 10v7m6-7v7m6-7v7" />
      </>
    ),
    swap: (
      <>
        <path d="M3 7h17l-4-4M21 17H4l4 4M20 7l-4 4M4 17l4-4" />
      </>
    ),
    logout: (
      <>
        <path d="M9 5H4v14h5m6-3 4-4-4-4m-6 4h10" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    copy: (
      <>
        <rect x="8" y="8" width="13" height="13" rx="2" />
        <path d="M16 8V3H3v13h5" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5" />
        <path d="M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3" />
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
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.layers}
    </svg>
  );
}
function Brand() {
  return (
    <div className="brand" aria-label="Grapnel">
      <img
        src="/brand/logo-name-black.png"
        alt="Grapnel"
        width={884}
        height={444}
      />
    </div>
  );
}

function Empty({
  title,
  children,
  icon = "activity",
}: {
  title: string;
  children: ReactNode;
  icon?: string;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} size={26} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
const time = (value: string | null) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Never";
export default function Dashboard({ section }: { section: string }) {
  const [session, setSession] = useState<{
    business_id: string;
    csrf_token: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [business, setBusiness] = useState<Business | null>(null);
  const [modules, setModules] = useState<Module[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [secret, setSecret] = useState("");
  const [loginSecret, setLoginSecret] = useState("");
  const [keyName, setKeyName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [copied, setCopied] = useState(false);
  const api = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const r = await fetch("/api/grapnel/dashboard/" + path, {
        ...init,
        headers: {
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(session ? { "X-CSRF-Token": session.csrf_token } : {}),
          ...init.headers,
        },
        cache: "no-store",
      });
      const body = await r.json();
      if (!r.ok) {
        if (r.status === 401) setSession(null);
        throw Error(body.error?.message ?? "Request failed");
      }
      return body.data;
    },
    [session],
  );
  const reload = useCallback(async () => {
    const [b, m, k, l] = await Promise.all([
      api("business"),
      api("modules"),
      api("api-keys"),
      api("requests"),
    ]);
    setBusiness(b);
    setModules(m.modules);
    setSelected(
      m.modules.filter((x: Module) => x.enabled).map((x: Module) => x.module),
    );
    setRevision(m.revision);
    setKeys(k.keys);
    setLogs(l.requests);
  }, [api]);
  useEffect(() => {
    let active = true;
    fetch("/api/grapnel/dashboard/session", { cache: "no-store" })
      .then(async (r) => {
        const b = await r.json();
        if (active && r.ok) setSession(b.data);
        else if (active && r.status !== 401)
          setError(b.error?.message ?? "API unavailable");
      })
      .catch(() => {
        if (active)
          setError("Grapnel API is unreachable. Check the server connection.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (session) {
      setLoading(true);
      reload()
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, [session, reload]);
  useEffect(() => {
    setSecret("");
    setNotice("");
    setError("");
  }, [section]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  async function login(e: FormEvent) {
    e.preventDefault();
    await action(async () => {
      const data = await api("login", {
        method: "POST",
        body: JSON.stringify({ secret: loginSecret }),
      });
      setLoginSecret("");
      setSession(data);
    });
  }
  async function saveModules() {
    await action(async () => {
      const data = await api("modules", {
        method: "PATCH",
        body: JSON.stringify({ modules: selected }),
      });
      setModules(data.modules);
      setRevision(data.revision);
      setSelected(
        data.modules
          .filter((m: Module) => m.enabled)
          .map((m: Module) => m.module),
      );
      setNotice(
        "Business access saved. Existing API keys use these settings immediately; provider readiness is unchanged.",
      );
    });
  }
  function toggle(id: string) {
    setSelected((current) => {
      const next = current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id];
      if (
        id !== "capital.wallets" &&
        next.includes(id) &&
        !next.includes("capital.wallets")
      )
        next.push("capital.wallets");
      return next;
    });
  }
  async function createKey(e: FormEvent) {
    e.preventDefault();
    await action(async () => {
      const data = await api("api-keys", {
        method: "POST",
        body: JSON.stringify({ name: keyName }),
      });
      setSecret(data.secret);
      setKeyName("");
      await reload();
      setNotice("Key created. Copy it now; Grapnel will not show it again.");
    });
  }
  async function revokeKey(id: string) {
    if (
      !confirm(
        "Revoke this API key? Requests using it will immediately be denied.",
      )
    )
      return;
    await action(async () => {
      await api("api-keys/" + id, { method: "DELETE" });
      await reload();
      setNotice("API key revoked.");
    });
  }
  async function logout() {
    await action(async () => {
      await api("logout", { method: "POST", body: "{}" });
      setSession(null);
      setSecret("");
      setBusiness(null);
    });
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Clipboard unavailable. Select and copy the displayed value.");
    }
  }
  const enabled = modules.filter((m) => m.enabled);
  const activeKeys = keys.filter((k) => k.status === "active");
  const verified = modules.filter(
    (m) => m.execution_status === "testnet_verified",
  );
  const dirty =
    [...selected].sort().join() !==
    modules
      .filter((m) => m.enabled)
      .map((m) => m.module)
      .sort()
      .join();
  if (!session)
    return (
      <main className="login-shell">
        <section className="login-story">
          <Brand />
          <div className="story-main">
            <span className="eyebrow light">BUILD ON STELLAR</span>
            <h1>
              Financial infrastructure.
              <br />
              <em>Your building blocks.</em>
            </h1>
            <p>
              One REST API for customer wallets, Testnet funding, spot markets,
              and lending. Activate only what your business needs.
            </p>
            <div className="stack-art">
              <div className="stack-top">
                <span className="mini-square">↗</span>Your application
                <span className="code-tag">REST API</span>
              </div>
              <div className="stack-line" />
              <div className="stack-mid">
                <b>grapnel.</b>
                <span>
                  Capital <i /> Trade
                </span>
              </div>
              <div className="stack-line" />
              <div className="stack-bottom">
                <span>Stellar</span>
                <span>Soroswap</span>
                <span>Blend</span>
              </div>
            </div>
          </div>
          <span className="story-footer">
            Modular by design. Testnet by default.
          </span>
        </section>
        <section className="login-form">
          <div className="testnet">
            <i />
            Stellar Testnet
          </div>
          <div className="login-box">
            <span className="eyebrow">DEVELOPER CONSOLE</span>
            <h2>Your workspace starts here.</h2>
            <p>
              Sign in with the owner access secret configured for this demo
              deployment.
            </p>
            {error && (
              <div role="alert" className="message error">
                {error}
              </div>
            )}
            <form onSubmit={login}>
              <label htmlFor="owner-secret">Owner access secret</label>
              <input
                id="owner-secret"
                type="password"
                autoComplete="current-password"
                value={loginSecret}
                onChange={(e) => setLoginSecret(e.target.value)}
                placeholder="Enter your owner secret"
                required
              />
              <button className="primary wide" disabled={busy || loading}>
                {busy
                  ? "Signing in…"
                  : loading
                    ? "Connecting…"
                    : "Open workspace"}
                <Icon name="arrow" size={18} />
              </button>
            </form>
            <p className="form-foot">
              Owner sessions manage modules and API keys. Customer wallets
              require separate authorization.
            </p>
          </div>
          <div className="login-bottom">
            Hackathon prototype · Testnet tokens have no real value
          </div>
        </section>
      </main>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <span className="nav-label">WORKSPACE</span>
        <nav>
          {nav.map(([id, label, icon]) => (
            <Link
              key={id}
              href={"/" + id}
              className={section === id ? "active" : ""}
            >
              <Icon name={icon} />
              <span>{label}</span>
              {id === "modules" && modules.length > 0 && (
                <small>{modules.length}</small>
              )}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button onClick={logout} className="logout" disabled={busy}>
            <Icon name="logout" size={18} />
            Sign out
          </button>
          <span className="version">GRAPNEL API · v0.1</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>Developer Console</span>
          <div>
            <span className="testnet">
              <i />
              Testnet
            </span>
            <span className="avatar">{business?.name.charAt(0) ?? "G"}</span>
            <button
              className="mobile-logout"
              onClick={logout}
              disabled={busy}
              aria-label="Sign out"
            >
              <Icon name="logout" size={16} />
            </button>
          </div>
        </header>
        <main className="content">
          <div className="page-heading">
            <div>
              <h1>{titles[section] ?? "Overview"}</h1>
              <p>
                {section === "modules"
                  ? "Manage business access and review provider readiness."
                  : section === "customers"
                    ? "Review live customer wallet balances and lending positions."
                    : section === "api-keys"
                      ? "Connect your backend with secure business credentials."
                      : section === "logs"
                        ? "Inspect real requests across your integration."
                        : section === "docs"
                          ? "Go from an API key to your first request."
                          : "Build financial products. We handle the infrastructure."}
              </p>
            </div>
            <button
              className="secondary refresh"
              aria-label="Refresh workspace"
              disabled={busy || loading}
              onClick={() => action(reload)}
            >
              <Icon name="refresh" size={17} />
              Refresh
            </button>
          </div>
          {error && (
            <div role="alert" className="message error">
              {error}
            </div>
          )}
          {notice && (
            <div role="status" className="message success">
              <Icon name="check" size={17} />
              {notice}
            </div>
          )}
          {loading ? (
            <div className="loading">
              Loading your workspace
              <span />
            </div>
          ) : (
            <>
              {section === "modules" ? (
                <>
                  <div className="info-strip">
                    <span className="info-symbol">i</span>
                    <p>
                      Enable API access for your business. Execution remains subject to the provider’s Testnet readiness.
                    </p>
                  </div>
                  {["capital", "trade"].map((group) => (
                    <section key={group} className="module-section">
                      <div className="section-heading">
                        <div>
                          <h2>
                            {group === "capital" ? "Capital" : "Trade"}
                            <span className="count">
                              {
                                modules.filter((m) =>
                                  m.module.startsWith(group + "."),
                                ).length
                              }
                            </span>
                          </h2>
                          <p>
                            {group === "capital"
                              ? "Wallets, Testnet funding, and protocol lending."
                              : "Asset access through one consistent interface."}
                          </p>
                        </div>
                      </div>
                      <div className="module-grid">
                        {modules
                          .filter((m) => m.module.startsWith(group + "."))
                          .map((m) => (
                            <article
                              key={m.module}
                              className={`module-card ${selected.includes(m.module) ? "selected" : ""}`}
                            >
                              <div className="module-top">
                                <span className="module-icon">
                                  <Icon
                                    name={
                                      m.module.endsWith("wallets")
                                        ? "wallet"
                                        : m.module.endsWith("lending")
                                          ? "bank"
                                          : m.module.startsWith("trade")
                                            ? "swap"
                                            : "layers"
                                    }
                                    size={23}
                                  />
                                </span>
                                <label className="switch">
                                  <input
                                    aria-label={`Allow business access to ${m.name}`}
                                    type="checkbox"
                                    checked={selected.includes(m.module)}
                                    onChange={() => toggle(m.module)}
                                  />
                                  <span />
                                </label>
                              </div>
                              <h3>{m.name}</h3>
                              <code className="module-code">{m.module}</code>
                              <p>{m.description}</p>
                              <div className="module-provider">Provider · {m.provider}</div>
                              <ModuleAvailability capability={m} selected={selected.includes(m.module)} />
                            </article>
                          ))}
                      </div>
                    </section>
                  ))}
                  <div className="save-bar">
                    <div>
                      <strong>{selected.length} modules selected{dirty ? " · unsaved" : ""}</strong>
                      <p>Saved access changes apply immediately to existing API keys. No rotation needed.</p>
                    </div>
                    <span className="revision">Revision {revision}</span>
                    <button
                      className="primary"
                      disabled={busy || !dirty}
                      onClick={saveModules}
                    >
                      {busy ? "Saving…" : "Save changes"}
                      <Icon name="arrow" size={17} />
                    </button>
                  </div>
                </>
              ) : section === "customers" ? (
                <Customers api={api} />
              ) : section === "api-keys" ? (
                <>
                  <div className="panel key-create">
                    <div>
                      <h2>Create a business API key</h2>
                      <p>
                        Keep it on your server. A business key never authorizes
                        customer spending.
                      </p>
                    </div>
                    <form onSubmit={createKey}>
                      <input
                        aria-label="Key name"
                        value={keyName}
                        onChange={(e) => setKeyName(e.target.value)}
                        required
                        maxLength={100}
                        placeholder="e.g. Fintech demo backend"
                      />
                      <button className="primary" disabled={busy}>
                        <Icon name="plus" size={16} />
                        Create key
                      </button>
                    </form>
                  </div>
                  {secret && (
                    <div className="secret-panel">
                      <span className="eyebrow">ONE-TIME SECRET</span>
                      <h3>Copy your API key now.</h3>
                      <p>
                        This is the only time the complete key will be
                        displayed.
                      </p>
                      <div className="secret-value">
                        <code>{secret}</code>
                        <button
                          className="secondary"
                          onClick={() => copy(secret)}
                        >
                          <Icon name={copied ? "check" : "copy"} size={16} />
                          {copied ? "Copied" : "Copy"}
                        </button>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => setSecret("")}
                      >
                        I saved it. Hide secret
                      </button>
                    </div>
                  )}
                  <section className="panel table-panel">
                    <div className="panel-heading">
                      <h2>
                        Business keys{" "}
                        <span className="count">{keys.length}</span>
                      </h2>
                      <span className="muted">
                        Secrets are stored as hashes
                      </span>
                    </div>
                    {keys.length ? (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Name</th>
                              <th>Key</th>
                              <th>Status</th>
                              <th>Created</th>
                              <th>Last used</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {keys.map((k) => (
                              <tr key={k.id}>
                                <td>
                                  <strong>{k.name}</strong>
                                </td>
                                <td>
                                  <code>
                                    {k.prefix}••••{k.last_four}
                                  </code>
                                </td>
                                <td>
                                  <span className={`key-status ${k.status}`}>
                                    {k.status}
                                  </span>
                                </td>
                                <td>{time(k.created_at)}</td>
                                <td>{time(k.last_used_at)}</td>
                                <td>
                                  {k.status === "active" && (
                                    <button
                                      className="revoke"
                                      onClick={() => revokeKey(k.id)}
                                      disabled={busy}
                                    >
                                      Revoke
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty title="No API keys yet" icon="key">
                        Create a key to connect your independent fintech
                        backend.
                      </Empty>
                    )}
                  </section>
                </>
              ) : section === "logs" ? (
                <section className="panel table-panel">
                  <div className="panel-heading">
                    <h2>
                      Recent requests{" "}
                      <span className="count">{logs.length}</span>
                    </h2>
                    <label className="filter">
                      <input
                        type="checkbox"
                        checked={onlyErrors}
                        onChange={(e) => setOnlyErrors(e.target.checked)}
                      />
                      Errors only
                    </label>
                  </div>
                  {logs.filter((l) => !onlyErrors || l.status >= 400).length ? (
                    <LogTable
                      logs={logs.filter((l) => !onlyErrors || l.status >= 400)}
                    />
                  ) : (
                    <Empty
                      title={
                        onlyErrors
                          ? "No errors in recent requests"
                          : "Your first request belongs here"
                      }
                    >
                      Requests made with your business API keys appear here with
                      their actual status and latency.
                    </Empty>
                  )}
                </section>
              ) : section === "docs" ? (
                <>
                  <div className="docs-grid">
                    <section className="panel doc-main">
                      <span className="eyebrow">QUICKSTART</span>
                      <h2>Make your first request.</h2>
                      <p>
                        Issue an API key, store it in your backend environment,
                        and read your current capabilities.
                      </p>
                      <div className="code-window">
                        <div>
                          <i />
                          <i />
                          <i />
                          <span>Server-side request</span>
                        </div>
                        <pre>
                          {
                            'curl "$GRAPNEL_API_URL/v1/capabilities" \\\n  -H "Authorization: Bearer $GRAPNEL_API_KEY"'
                          }
                        </pre>
                      </div>
                      <div className="doc-note">
                        <Icon name="key" />
                        <p>
                          Never expose a business API key in browser code.
                          Customer wallet actions also require a verified
                          identity and an exact transaction signature.
                        </p>
                      </div>
                      <h3>One operation, explicit finality.</h3>
                      <p>
                        Financial writes require an <code>Idempotency-Key</code>
                        . A <code>202 Accepted</code> response creates a durable
                        operation. Poll its status; completion is reported only
                        after verified onchain settlement.
                      </p>
                      <div className="lifecycle">
                        <span>Accepted</span>
                        <b>→</b>
                        <span>Authorized</span>
                        <b>→</b>
                        <span>Confirming</span>
                        <b>→</b>
                        <span>Completed</span>
                      </div>
                    </section>
                    <aside className="panel docs-side">
                      <h3>API reference</h3>
                      <p>
                        The public API serves its current OpenAPI document and
                        interactive reference.
                      </p>
                      <code>GET /openapi.json</code>
                      <code>GET /docs</code>
                      <h3>Core endpoints</h3>
                      {[
                        "GET /v1/capabilities",
                        "POST /v1/customers",
                        "POST /v1/capital/wallets",
                        "GET /v1/operations/:id",
                      ].map((x) => (
                        <code key={x}>{x}</code>
                      ))}
                      <p className="small">
                        Use the configured Grapnel API origin. All execution is
                        Stellar Testnet only.
                      </p>
                    </aside>
                  </div>
                </>
              ) : section === "onboarding" ? (
                <section className="panel key-create">
                  <h2>Create a workspace</h2>
                  <p>
                    Your owner session will switch to the newly created
                    business. Modules start disabled.
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      action(async () => {
                        await api("businesses", {
                          method: "POST",
                          body: JSON.stringify({ name: workspaceName }),
                        });
                        await reload();
                        setWorkspaceName("");
                        setNotice("Workspace created.");
                      });
                    }}
                  >
                    <input
                      aria-label="Business name"
                      placeholder="Business name"
                      required
                      maxLength={120}
                      value={workspaceName}
                      onChange={(e) => setWorkspaceName(e.target.value)}
                    />
                    <button className="primary" disabled={busy}>
                      Create workspace
                    </button>
                  </form>
                </section>
              ) : (
                <>
                  <section className="overview-hero">
                    <div>
                      <span className="eyebrow light">
                        YOUR NEXT PRODUCT STARTS HERE
                      </span>
                      <h2>
                        Build more.
                        <br />
                        <span>Integrate less.</span>
                      </h2>
                      <p>
                        Activate the modules your business needs.
                        <br />
                        One API key. Consistent operations.
                      </p>
                      <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                        <Link href="/modules" className="hero-link">
                          Configure your modules
                          <Icon name="arrow" size={18} />
                        </Link>
                        <a href={process.env.NEXT_PUBLIC_VELOCITY_DEMO_URL || "http://localhost:3002/home"} className="hero-link" target="_blank" rel="noopener noreferrer">
                          View Velocity Trading demo
                          <Icon name="arrow" size={18} />
                        </a>
                      </div>
                    </div>
                    <div className="hero-stack">
                      <div>
                        <Icon name="wallet" />
                        <span>Wallets</span>
                        <code>Capital</code>
                      </div>
                      <div>
                        <Icon name="swap" />
                        <span>Spot markets</span>
                        <code>Trade</code>
                      </div>
                      <div>
                        <Icon name="bank" />
                        <span>Lending</span>
                        <code>Capital</code>
                      </div>
                      <span className="stack-caption">
                        <i />
                        CONNECTED THROUGH GRAPNEL
                      </span>
                    </div>
                  </section>
                  <div className="stats-grid">
                    <Stat
                      label="Enabled modules"
                      value={String(enabled.length)}
                      detail={`of ${modules.length} available modules`}
                      icon="layers"
                    />
                    <Stat
                      label="Active API keys"
                      value={String(activeKeys.length)}
                      detail="Server-side business credentials"
                      icon="key"
                    />
                    <Stat
                      label="Recent API requests"
                      value={String(logs.length)}
                      detail="Latest 100 authenticated requests"
                      icon="activity"
                    />
                    <Stat
                      label="Verified execution"
                      value={String(verified.length)}
                      detail="Modules with actual Testnet proof"
                      icon="check"
                    />
                  </div>
                  <div className="overview-grid">
                    <section className="panel table-panel">
                      <div className="panel-heading">
                        <h2>Recent activity</h2>
                        <Link href="/logs" className="text-link">
                          View all
                          <Icon name="arrow" size={15} />
                        </Link>
                      </div>
                      {logs.length ? (
                        <LogTable logs={logs.slice(0, 5)} compact />
                      ) : (
                        <Empty title="Ready for your first request">
                          Connect your backend with an API key. Your real
                          integration activity will appear here.
                        </Empty>
                      )}
                    </section>
                    <section className="panel workspace-detail">
                      <span className="eyebrow">WORKSPACE DETAILS</span>
                      <h2>{business?.name}</h2>
                      <dl>
                        <dt>Environment</dt>
                        <dd>
                          <span className="testnet">
                            <i />
                            Stellar Testnet
                          </span>
                        </dd>
                        <dt>Access</dt>
                        <dd>Owner session</dd>
                        <dt>Module revision</dt>
                        <dd>{revision}</dd>
                        <dt>API version</dt>
                        <dd>v0.1</dd>
                      </dl>
                      <Link href="/onboarding" className="text-link">
                        Create another workspace
                        <Icon name="plus" size={15} />
                      </Link>
                    </section>
                  </div>
                </>
              )}
            </>
          )}
        </main>
        <footer className="main-footer">
          <span>Grapnel · Financial infrastructure, assembled.</span>
        </footer>
      </div>
    </div>
  );
}
function Stat({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: string;
}) {
  return (
    <article className="stat">
      <div>
        <span>{label}</span>
        <Icon name={icon} size={18} />
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}
function LogTable({
  logs,
  compact = false,
}: {
  logs: Log[];
  compact?: boolean;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Request</th>
            <th>Status</th>
            <th>Latency</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l) => (
            <tr key={l.request_id}>
              <td>
                <span className="method">{l.method}</span>
                <code>{l.path_template}</code>
              </td>
              <td>
                <span
                  className={`http-status ${l.status < 400 ? "ok" : "failed"}`}
                >
                  {l.status}
                </span>
              </td>
              <td>{l.duration_ms} ms</td>
              <td className="nowrap">{time(l.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
