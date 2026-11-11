import { z } from "zod";
import {
  GrapnelError,
  NETWORK,
  NETWORK_PASSPHRASE,
  fromAtomic,
  type AdapterCapabilities,
} from "@grapnel/contracts";

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
export interface NoetherPublicDependencies {
  fetcher?: typeof fetch;
  now?: () => number;
}

/** Public reads only. There is deliberately no key issuance, account, order or submit HTTP method. */
export class NoetherPublicAdapter {
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private healthExpires = 0;
  private snapshot?: { expires: number; markets: NoetherPublicMarket[] };
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
    path: "/v1/health" | "/v1/markets" | "/v1/keys/beta-status",
  ): Promise<unknown> {
    this.assertReadAllowed();
    let response: Response;
    try {
      response = await this.fetcher(NOETHER_TESTNET_API + path, {
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
      .object({ status: z.literal("ok"), network: z.literal("testnet") })
      .safeParse(await this.read("/v1/health"));
    if (!parsed.success)
      throw new GrapnelError(
        400,
        "NETWORK_MISMATCH",
        "Noether gateway did not confirm a healthy Testnet deployment",
      );
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
}
