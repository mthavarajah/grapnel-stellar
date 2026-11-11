import { z } from "zod";
import {
  GrapnelError,
  NETWORK,
  NETWORK_PASSPHRASE,
  fromAtomic,
  type AdapterCapabilities,
} from "@grapnel/contracts";
import type { HistoryRange, MarketHistory } from "../../modules/market-data/service.js";

export const NOETHER_TESTNET_API =
  "https://noether-api.proudmeadow-533cf0d8.germanywestcentral.azurecontainerapps.io";
export const NOETHER_RESTRICTIONS_SOURCE =
  "https://docs.noether.exchange/developers#regional-restrictions";
export const NOETHER_MARKETS_SOURCE =
  "https://docs.noether.exchange/developers/rest-api/markets";
const executionReason =
  "Noether trading is unavailable for the Ontario demo. Only public market data is exposed.";
const oracleSchema = z.object({
  asset: z.string(),
  price: z.string().regex(/^[1-9]\d{0,77}$/),
  timestamp: z.number().int().nonnegative(),
});
const marketSchema = z.object({
  markets: z
    .array(
      z.object({
        asset: z.object({
          symbol: z.string().regex(/^[A-Z0-9]{1,12}$/),
          name: z.string().min(1).max(100),
          decimals: z.number().int().min(0).max(38),
        }),
        oracle: oracleSchema.nullish(),
      }),
    )
    .max(100),
});
const nonnegativeAtomicSchema = z.string().regex(/^(0|[1-9]\d{0,77})$/);
const signedAtomicSchema = z.string().regex(/^-?(0|[1-9]\d{0,77})$/);
const marketStatsSchema = z.object({
  stats: z.array(z.object({
    asset: z.string().regex(/^[A-Z0-9]{1,12}$/),
    openInterestLong: nonnegativeAtomicSchema,
    openInterestShort: nonnegativeAtomicSchema,
    openInterestNet: signedAtomicSchema,
    openPositions: z.number().int().nonnegative(),
    volume24h: nonnegativeAtomicSchema,
    capacity: z.object({
      headroomLong: nonnegativeAtomicSchema.nullable().optional(),
      headroomShort: nonnegativeAtomicSchema.nullable().optional(),
      bindingLong: z.string().nullable().optional(),
      bindingShort: z.string().nullable().optional(),
      maxPositionSize: nonnegativeAtomicSchema.nullable().optional(),
    }).optional(),
  })).max(100),
  pool: z.object({ stale: z.boolean().optional(), asOfLedger: z.number().int().positive().optional() }).nullable().optional(),
  custody: z.object({ stale: z.boolean().optional(), ageMs: z.number().nonnegative().optional(), deficit: nonnegativeAtomicSchema.optional() }).nullable().optional(),
});
const candleSchema = z.object({
  candles: z.array(z.object({
    time: z.number().int().safe().nonnegative().max(253402300799),
    open: z.number().finite().positive(),
    high: z.number().finite().positive(),
    low: z.number().finite().positive(),
    close: z.number().finite().positive(),
  })).max(1000),
  source: z.enum(["noeracle", "binance"]),
});
const historyQuery: Record<HistoryRange, { interval: "1m" | "5m" | "1h" | "4h" | "1d" | "1w"; limit: number }> = {
  live: { interval: "1m", limit: 60 },
  "1d": { interval: "5m", limit: 288 },
  "1w": { interval: "1h", limit: 168 },
  "1m": { interval: "4h", limit: 180 },
  "1y": { interval: "1d", limit: 365 },
  // Noether has no cursor or explicit all-time range; bounded weekly candles
  // return the provider's latest 1000 observations, not a lifetime guarantee.
  all: { interval: "1w", limit: 1000 },
};
export interface NoetherPublicMarket {
  market_id: string;
  label: string;
  asset_class: "perps";
  module: "trade.perps";
  provider: "noether";
  network: typeof NETWORK;
  underlying: { symbol: string; name: string; display_decimals: number };
  reference_price_atomic: string | null;
  reference_price: string | null;
  price_decimals: 7;
  oracle_timestamp: string | null;
  oracle_age_seconds: number | null;
  price_status: "current" | "stale" | "unavailable";
  observed_at: string;
  source_url: string;
  execution_status: "discovery_only";
  executable: false;
  reason: "REGION_RESTRICTED";
  reason_message: string;
}
export interface NoetherBetaStatus {
  gated: boolean;
  allowed_without_address: boolean;
  observed_at: string;
  source_url: string;
}
export interface NoetherPublicMarketStats {
  asset: string;
  /** All amount fields below are 7-decimal USDC notional, per Noether's public API docs. */
  open_interest_long_atomic: string;
  open_interest_short_atomic: string;
  open_interest_net_atomic: string;
  open_positions: number;
  volume_24h_atomic: string;
  capacity: { headroom_long_atomic: string | null; headroom_short_atomic: string | null; binding_long: string | null; binding_short: string | null; max_position_size_atomic: string | null } | null;
}
export interface NoetherPublicStatsSnapshot {
  markets: NoetherPublicMarketStats[];
  observed_at: string;
  source_url: string;
  indexer_ledger_age_seconds: number | null;
  pool: { stale: boolean | null; as_of_ledger: number | null } | null;
  custody: { stale: boolean | null; age_ms: number | null; deficit_atomic: string | null } | null;
  execution_status: 'discovery_only';
  executable: false;
  reason: 'REGION_RESTRICTED';
}
export interface NoetherPublicMarketDetails extends NoetherPublicMarket {
  /** Null when data is unavailable or any freshness source is stale/unknown. */
  stats: (NoetherPublicMarketStats & Pick<NoetherPublicStatsSnapshot,
    'observed_at' | 'source_url' | 'indexer_ledger_age_seconds' | 'pool' | 'custody'>) | null;
}
export interface NoetherPerpsHistory extends Omit<MarketHistory, "points"> {
  base_asset_id: string;
  base_symbol: string;
  interval: (typeof historyQuery)[HistoryRange]["interval"];
  source: "noeracle" | "binance";
  source_url: string;
  observed_at: string;
  latest_candle_age_seconds: number | null;
  points: Array<{ timestamp: string; price: string; open: string; high: string; low: string; close: string }>;
  metrics: (NoetherPublicMarketStats & Pick<NoetherPublicStatsSnapshot,
    "observed_at" | "source_url" | "indexer_ledger_age_seconds" | "pool" | "custody">) | null;
  execution_status: "discovery_only";
  executable: false;
}

function candlePrice(value: number): { atomic: bigint; decimal: string } {
  const text = String(value);
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,7}))?$/.exec(text);
  if (!match) throw new GrapnelError(502, "PROVIDER_INVALID_RESPONSE", "Noether returned a candle price outside its documented 7-decimal precision");
  const atomic = BigInt(match[1]!) * 10_000_000n + BigInt((match[2] ?? "").padEnd(7, "0"));
  if (atomic <= 0n) throw new GrapnelError(502, "PROVIDER_INVALID_RESPONSE", "Noether returned a non-positive candle price");
  const fixed = fromAtomic(atomic, 7);
  const decimal = fixed.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
  return { atomic, decimal };
}

function decimalAtomic(value: bigint): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const whole = magnitude / 10_000_000n;
  const fraction = (magnitude % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function perpsPriceChange(first: bigint, last: bigint): { change_absolute: string; change_percent: string | null } {
  const difference = last - first;
  const scale = 10n ** 18n;
  const percent = (difference * 100n * scale) / first;
  const whole = (percent < 0n ? -percent : percent) / scale;
  const tail = ((percent < 0n ? -percent : percent) % scale).toString().padStart(18, "0").replace(/0+$/, "");
  const changePercent = percent === 0n && difference !== 0n ? null : `${percent < 0n ? "-" : ""}${whole}${tail ? `.${tail}` : ""}`;
  return { change_absolute: decimalAtomic(difference), change_percent: changePercent };
}
export interface NoetherPublicDependencies {
  fetcher?: typeof fetch;
  now?: () => number;
}

/** Public reads only. There is deliberately no key issuance, account, order or submit HTTP method. */
export class NoetherPublicAdapter {
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private healthExpires = 0;
  private indexerLedgerAgeSeconds: number | null = null;
  private snapshot?: { expires: number; markets: NoetherPublicMarket[] };
  private statsSnapshot?: { expires: number; value: NoetherPublicStatsSnapshot };
  private loadingStats?: Promise<NoetherPublicStatsSnapshot>;
  private loading?: Promise<NoetherPublicMarket[]>;
  private denied?:
    | "REGION_RESTRICTED"
    | "NOETHER_BETA_ACCESS_REQUIRED"
    | "NOETHER_PUBLIC_READ_FORBIDDEN";
  private rateLimitUntil = 0;
  constructor(
    config: { network: string; networkPassphrase: string },
    deps: NoetherPublicDependencies = {},
  ) {
    if (
      config.network !== "testnet" ||
      config.networkPassphrase !== NETWORK_PASSPHRASE
    )
      throw new GrapnelError(
        400,
        "NETWORK_MISMATCH",
        "Noether discovery is restricted to Stellar Testnet",
      );
    this.fetcher = deps.fetcher ?? fetch;
    this.now = deps.now ?? Date.now;
  }
  async capabilities(): Promise<AdapterCapabilities> {
    return {
      provider: "noether",
      networks: [NETWORK],
      modes: ["read"],
      status: this.denied ? "blocked" : "discovery_only",
      reason: this.denied ?? executionReason,
    };
  }
  prepare(): never {
    throw new GrapnelError(
      409,
      "EXECUTION_UNAVAILABLE",
      executionReason,
      false,
      {
        module: "trade.perps",
        provider: "noether",
        reason: "REGION_RESTRICTED",
        source_url: NOETHER_RESTRICTIONS_SOURCE,
      },
    );
  }
  private assertReadAllowed(): void {
    if (this.denied)
      throw new GrapnelError(
        409,
        "EXECUTION_UNAVAILABLE",
        "Noether denied access; no further provider requests will be made",
        false,
        {
          provider: "noether",
          reason: this.denied,
          source_url:
            this.denied === "NOETHER_BETA_ACCESS_REQUIRED"
              ? "https://docs.noether.exchange/developers/authentication"
              : NOETHER_RESTRICTIONS_SOURCE,
        },
      );
    if (this.now() < this.rateLimitUntil)
      throw new GrapnelError(
        429,
        "PROVIDER_RATE_LIMITED",
        "Noether public rate limit is active",
        true,
        {
          retry_after_seconds: Math.ceil(
            (this.rateLimitUntil - this.now()) / 1000,
          ),
        },
      );
  }
  private async read(
    path: "/v1/health" | "/v1/markets" | "/v1/markets/stats" | "/v1/keys/beta-status" | "/v1/candles",
    query?: Record<string, string>,
  ): Promise<unknown> {
    this.assertReadAllowed();
    let response: Response;
    try {
      const queryString = query ? `?${new URLSearchParams(query).toString()}` : "";
      response = await this.fetcher(NOETHER_TESTNET_API + path + queryString, {
        method: "GET",
        headers: { Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new GrapnelError(
        503,
        "NOETHER_UNAVAILABLE",
        "Noether public market data could not be reached",
        true,
      );
    }
    let body: unknown;
    try {
      const text = await response.text();
      if (text.length > 1_000_000) throw new Error("oversize");
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    const code =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : "";
    if (response.status === 451 || code === "region_restricted")
      this.denied = "REGION_RESTRICTED";
    else if (response.status === 403)
      this.denied =
        code === "not_in_beta"
          ? "NOETHER_BETA_ACCESS_REQUIRED"
          : "NOETHER_PUBLIC_READ_FORBIDDEN";
    if (this.denied) this.assertReadAllowed();
    if (response.status === 429) {
      const value = response.headers.get("retry-after");
      const seconds =
        value && /^\d+$/.test(value)
          ? Math.min(Math.max(Number(value), 1), 3600)
          : 60;
      this.rateLimitUntil = this.now() + seconds * 1000;
      this.assertReadAllowed();
    }
    if (!response.ok)
      throw new GrapnelError(
        503,
        "NOETHER_UNAVAILABLE",
        "Noether public market data request failed",
        true,
        { provider_status: response.status },
      );
    if (body === null)
      throw new GrapnelError(
        502,
        "PROVIDER_INVALID_RESPONSE",
        "Noether returned invalid public data",
      );
    return body;
  }
  private async verifyNetwork(): Promise<void> {
    if (this.healthExpires > this.now()) return;
    const parsed = z
      .object({ status: z.literal("ok"), network: z.literal("testnet"), indexer: z.object({ ledgerAgeSeconds: z.number().nonnegative() }).optional() })
      .safeParse(await this.read("/v1/health"));
    if (!parsed.success)
      throw new GrapnelError(
        400,
        "NETWORK_MISMATCH",
        "Noether gateway did not confirm a healthy Testnet deployment",
      );
    this.indexerLedgerAgeSeconds = parsed.data.indexer?.ledgerAgeSeconds ?? null;
    this.healthExpires = this.now() + 60000;
  }
  private freshness(markets: NoetherPublicMarket[]): NoetherPublicMarket[] {
    return markets.map((market) => {
      const age =
        market.oracle_timestamp === null
          ? null
          : Math.floor(
              (this.now() - Date.parse(market.oracle_timestamp)) / 1000,
            );
      return {
        ...market,
        underlying: { ...market.underlying },
        oracle_age_seconds: age,
        price_status:
          age === null || age < -5
            ? "unavailable"
            : age > 60
              ? "stale"
              : "current",
      };
    });
  }
  async markets(): Promise<NoetherPublicMarket[]> {
    this.assertReadAllowed();
    if (this.snapshot && this.snapshot.expires > this.now())
      return this.freshness(this.snapshot.markets);
    if (this.loading) return this.freshness(await this.loading);
    this.loading = (async () => {
      await this.verifyNetwork();
      const parsed = marketSchema.safeParse(await this.read("/v1/markets"));
      if (!parsed.success)
        throw new GrapnelError(
          502,
          "PROVIDER_INVALID_RESPONSE",
          "Noether market metadata or fixed-point prices are invalid",
        );
      const observedAt = new Date(this.now()).toISOString();
      const seen = new Set<string>();
      const markets = parsed.data.markets.map(
        ({ asset, oracle }): NoetherPublicMarket => {
          if (
            seen.has(asset.symbol) ||
            (oracle && oracle.asset !== asset.symbol)
          )
            throw new GrapnelError(
              502,
              "PROVIDER_INVALID_RESPONSE",
              "Noether returned duplicate or mismatched market identities",
            );
          seen.add(asset.symbol);
          if (
            oracle &&
            !Number.isFinite(new Date(oracle.timestamp * 1000).getTime())
          )
            throw new GrapnelError(
              502,
              "PROVIDER_INVALID_RESPONSE",
              "Noether oracle timestamp is invalid",
            );
          return {
            market_id: `stellar-testnet:noether:${asset.symbol}-PERP`,
            label: `${asset.symbol}-PERP`,
            asset_class: "perps",
            module: "trade.perps",
            provider: "noether",
            network: NETWORK,
            underlying: {
              symbol: asset.symbol,
              name: asset.name,
              display_decimals: asset.decimals,
            },
            reference_price_atomic: oracle?.price ?? null,
            reference_price: oracle
              ? fromAtomic(BigInt(oracle.price), 7)
              : null,
            price_decimals: 7,
            oracle_timestamp: oracle
              ? new Date(oracle.timestamp * 1000).toISOString()
              : null,
            oracle_age_seconds: null,
            price_status: "unavailable",
            observed_at: observedAt,
            source_url: NOETHER_TESTNET_API + "/v1/markets",
            execution_status: "discovery_only",
            executable: false,
            reason: "REGION_RESTRICTED",
            reason_message: executionReason,
          };
        },
      );
      this.snapshot = { expires: this.now() + 15000, markets };
      return markets;
    })();
    try {
      return this.freshness(await this.loading);
    } finally {
      this.loading = undefined;
    }
  }
  async betaStatus(): Promise<NoetherBetaStatus> {
    this.assertReadAllowed();
    await this.verifyNetwork();
    const parsed = z
      .object({ gated: z.boolean(), allowed: z.boolean() })
      .safeParse(await this.read("/v1/keys/beta-status"));
    if (!parsed.success)
      throw new GrapnelError(
        502,
        "PROVIDER_INVALID_RESPONSE",
        "Noether beta status is invalid",
      );
    return {
      gated: parsed.data.gated,
      allowed_without_address: parsed.data.allowed,
      observed_at: new Date(this.now()).toISOString(),
      source_url: NOETHER_TESTNET_API + "/v1/keys/beta-status",
    };
  }

  /** Public read-only utilization data. Missing chain capacity stays null; no execution readiness is inferred. */
  async marketStats(): Promise<NoetherPublicStatsSnapshot> {
    this.assertReadAllowed();
    if (this.statsSnapshot && this.statsSnapshot.expires > this.now()) return this.statsSnapshot.value;
    if (this.loadingStats) return this.loadingStats;
    this.loadingStats = (async () => {
      await this.verifyNetwork();
      const parsed = marketStatsSchema.safeParse(await this.read('/v1/markets/stats'));
      if (!parsed.success) throw new GrapnelError(502, 'PROVIDER_INVALID_RESPONSE', 'Noether market utilization statistics are invalid');
      const seen = new Set<string>();
      const markets = parsed.data.stats.map(stat => {
        if (seen.has(stat.asset)) throw new GrapnelError(502, 'PROVIDER_INVALID_RESPONSE', 'Noether returned duplicate market utilization identities');
        seen.add(stat.asset);
        return {
          asset: stat.asset, open_interest_long_atomic: stat.openInterestLong,
          open_interest_short_atomic: stat.openInterestShort, open_interest_net_atomic: stat.openInterestNet,
          open_positions: stat.openPositions, volume_24h_atomic: stat.volume24h,
          capacity: stat.capacity ? {
            headroom_long_atomic: stat.capacity.headroomLong ?? null,
            headroom_short_atomic: stat.capacity.headroomShort ?? null,
            binding_long: stat.capacity.bindingLong ?? null,
            binding_short: stat.capacity.bindingShort ?? null,
            max_position_size_atomic: stat.capacity.maxPositionSize ?? null,
          } : null,
        };
      });
      const value: NoetherPublicStatsSnapshot = {
        markets, observed_at: new Date(this.now()).toISOString(),
        source_url: NOETHER_TESTNET_API + '/v1/markets/stats',
        indexer_ledger_age_seconds: this.indexerLedgerAgeSeconds,
        pool: parsed.data.pool ? { stale: parsed.data.pool.stale ?? null, as_of_ledger: parsed.data.pool.asOfLedger ?? null } : null,
        custody: parsed.data.custody ? { stale: parsed.data.custody.stale ?? null, age_ms: parsed.data.custody.ageMs ?? null, deficit_atomic: parsed.data.custody.deficit ?? null } : null,
        execution_status: 'discovery_only', executable: false, reason: 'REGION_RESTRICTED',
      };
      this.statsSnapshot = { expires: this.now() + 5000, value };
      return value;
    })();
    try { return await this.loadingStats; }
    finally { this.loadingStats = undefined; }
  }

  /**
   * Enrich public oracle markets with utilization only when its current health
   * evidence is complete and fresh. Oracle price reads remain independently
   * usable if the stats endpoint is unavailable or stale.
   */
  async marketDetails(): Promise<NoetherPublicMarketDetails[]> {
    const markets = await this.markets();
    let snapshot: NoetherPublicStatsSnapshot;
    try {
      snapshot = await this.marketStats();
    } catch {
      return markets.map(market => ({ ...market, stats: null }));
    }
    const observedAge = this.now() - Date.parse(snapshot.observed_at);
    const fresh = Number.isFinite(observedAge) && observedAge >= -5000 && observedAge <= 60000
      && snapshot.indexer_ledger_age_seconds !== null
      && snapshot.indexer_ledger_age_seconds <= 60
      && snapshot.pool?.stale === false
      && snapshot.custody?.stale === false;
    if (!fresh) return markets.map(market => ({ ...market, stats: null }));

    const byAsset = new Map(snapshot.markets.map(stat => [stat.asset, stat]));
    return markets.map(market => {
      const stat = byAsset.get(market.underlying.symbol) ?? null;
      return {
        ...market,
        stats: stat ? {
          ...stat,
          observed_at: snapshot.observed_at,
          source_url: snapshot.source_url,
          indexer_ledger_age_seconds: snapshot.indexer_ledger_age_seconds,
          pool: snapshot.pool,
          custody: snapshot.custody,
        } : null,
      };
    });
  }

  /** Read bounded real Testnet candles; Noether may identify Binance fallback history in `source`. */
  async history(marketId: string, range: HistoryRange): Promise<NoetherPerpsHistory> {
    const match = /^stellar-testnet:noether:([A-Z0-9]{1,12})-PERP$/.exec(marketId);
    if (!match) throw new GrapnelError(422, "INVALID_MARKET_ID", "A registered Noether Testnet perpetual market id is required");
    if (!Object.hasOwn(historyQuery, range)) throw new GrapnelError(422, "INVALID_HISTORY_RANGE", "Unsupported market history range");
    await this.verifyNetwork();
    const symbol = match[1]!;
    const { interval, limit } = historyQuery[range];
    const parsed = candleSchema.safeParse(await this.read("/v1/candles", { asset: symbol, interval, limit: String(limit) }));
    if (!parsed.success) throw new GrapnelError(502, "PROVIDER_INVALID_RESPONSE", "Noether candle history response is invalid");
    let priorTime = -1;
    const points = parsed.data.candles.map(candle => {
      if (candle.time <= priorTime) throw new GrapnelError(502, "PROVIDER_INVALID_RESPONSE", "Noether candles are not strictly oldest-first");
      priorTime = candle.time;
      const open = candlePrice(candle.open);
      const high = candlePrice(candle.high);
      const low = candlePrice(candle.low);
      const close = candlePrice(candle.close);
      if (low.atomic > open.atomic || low.atomic > close.atomic || high.atomic < open.atomic || high.atomic < close.atomic || low.atomic > high.atomic)
        throw new GrapnelError(502, "PROVIDER_INVALID_RESPONSE", "Noether candle OHLC values are inconsistent");
      return {
        timestamp: new Date(candle.time * 1000).toISOString(),
        price: close.decimal,
        open: open.decimal,
        high: high.decimal,
        low: low.decimal,
        close: close.decimal,
        closeAtomic: close.atomic,
      };
    });
    const latest = points.at(-1);
    const first = points[0];
    const changes = first && latest ? perpsPriceChange(first.closeAtomic, latest.closeAtomic) : { change_absolute: null, change_percent: null };
    const metrics = await this.freshStatsFor(symbol);
    const observedAt = new Date(this.now()).toISOString();
    const cleanPoints = points.map(({ closeAtomic: _atomic, ...point }) => point);
    return {
      market_id: marketId,
      base_asset_id: marketId,
      base_symbol: symbol,
      quote_symbol: "USD",
      latest_price: latest?.close ?? null,
      as_of: latest?.timestamp ?? null,
      points: cleanPoints,
      ...changes,
      interval,
      source: parsed.data.source,
      source_url: NOETHER_TESTNET_API + "/v1/candles",
      observed_at: observedAt,
      latest_candle_age_seconds: latest ? Math.max(0, Math.floor(this.now() / 1000 - Date.parse(latest.timestamp) / 1000)) : null,
      metrics,
      execution_status: "discovery_only",
      executable: false,
    };
  }

  private async freshStatsFor(symbol: string): Promise<NoetherPerpsHistory["metrics"]> {
    let snapshot: NoetherPublicStatsSnapshot;
    try { snapshot = await this.marketStats(); } catch { return null; }
    const age = this.now() - Date.parse(snapshot.observed_at);
    if (!Number.isFinite(age) || age < -5000 || age > 60000 || snapshot.indexer_ledger_age_seconds === null || snapshot.indexer_ledger_age_seconds > 60 || snapshot.pool?.stale !== false || snapshot.custody?.stale !== false) return null;
    const stat = snapshot.markets.find(item => item.asset === symbol);
    return stat ? { ...stat, observed_at: snapshot.observed_at, source_url: snapshot.source_url, indexer_ledger_age_seconds: snapshot.indexer_ledger_age_seconds, pool: snapshot.pool, custody: snapshot.custody } : null;
  }
}
