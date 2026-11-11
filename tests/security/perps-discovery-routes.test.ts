import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { buildApp } from "../../apps/api/src/app.js";
import {
  registerSpotRoutes,
  type SpotRouteDependencies,
} from "../../apps/api/src/modules/spot/routes.js";
import {
  SpotService,
  type SpotOperationStore,
} from "../../apps/api/src/modules/spot/service.js";
import { SoroswapSpotAdapter } from "../../apps/api/src/adapters/soroswap/index.js";
import type { NoetherPublicMarket } from "../../apps/api/src/adapters/perps/index.js";
import {
  GrapnelError,
  NETWORK,
  NETWORK_PASSPHRASE,
  type ModuleId,
} from "../../packages/contracts/src/index.js";

const require = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const Fastify = require("fastify") as () => Awaited<
  ReturnType<typeof buildApp>
>;
const publicSnapshot = JSON.parse(
  readFileSync(
    new URL(
      "../../apps/api/src/adapters/perps/research/public-discovery.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const referenceMarket = publicSnapshot.markets[0] as NoetherPublicMarket;
const customerId = randomUUID(),
  walletId = randomUUID(),
  quoteId = randomUUID();
const cryptoMarket = {
  market_id: "test-only-crypto-market",
  provider: "soroswap",
  asset_class: "crypto_spot",
  network: NETWORK,
  executable: false,
  execution_status: "discovery_only",
};
const bearer = { authorization: "Bearer test-only-business-fixture" };
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

// These tests exercise HTTP routing/ordering with explicit fake business/customer guards.
// Provider data is a captured public reference fixture; no provider HTTP, database or chain
// execution takes place. Authentication cryptography/tenant persistence have separate tests.
async function harness(
  options: { reader?: boolean; service?: SpotService } = {},
) {
  const app = Fastify();
  apps.push(app);
  app.setErrorHandler((error, _request, reply) => {
    const status =
      error instanceof GrapnelError
        ? error.statusCode
        : (error as Error).name === "ZodError"
          ? 422
          : 500;
    reply
      .code(status)
      .send({
        error: {
          code: error instanceof GrapnelError ? error.code : "VALIDATION_ERROR",
        },
      });
  });
  const enabled = new Set<ModuleId>(["trade.spot", "trade.perps"]);
  const requireBusiness = vi.fn<SpotRouteDependencies["requireBusiness"]>(
    async (request, module) => {
      if (request.headers.authorization !== bearer.authorization)
        throw new GrapnelError(
          401,
          "INVALID_API_KEY",
          "Test-only business guard denied",
        );
      if (!enabled.has(module))
        throw new GrapnelError(
          403,
          "MODULE_NOT_ENABLED",
          "Test-only module guard denied",
        );
      return { businessId: "test-only-tenant" };
    },
  );
  const requireCustomer = vi.fn<SpotRouteDependencies["requireCustomer"]>(
    async () => ({
      businessId: "test-only-tenant",
      customerId,
      walletId,
      walletAddress: "test-only-wallet",
      privyUserId: "test-only-user",
    }),
  );
  const readDiscoveryMarkets = vi
    .fn<NonNullable<SpotRouteDependencies["readDiscoveryMarkets"]>>()
    .mockResolvedValue([referenceMarket]);
  const refreshReadiness = vi.fn().mockResolvedValue(undefined);
  const markets = vi.fn().mockReturnValue([cryptoMarket]);
  const quote = vi
    .fn()
    .mockResolvedValue({
      quote_id: quoteId,
      market_id: cryptoMarket.market_id,
      execution_status: "simulation",
    });
  const createOrder = vi
    .fn()
    .mockResolvedValue({
      operation: {
        operation_id: randomUUID(),
        status: "awaiting_customer_authorization",
        tx_hash: null,
      },
    });
  const service =
    options.service ??
    ({
      adapter: { markets },
      quote,
      createOrder,
      order: vi.fn(),
    } as unknown as SpotService);
  await registerSpotRoutes(app, {
    service,
    requireBusiness,
    requireCustomer,
    refreshReadiness,
    success: (_request, data) => ({ data, meta: { network: NETWORK } }),
    ...(options.reader === false ? {} : { readDiscoveryMarkets }),
  });
  await app.ready();
  return {
    app,
    enabled,
    requireBusiness,
    requireCustomer,
    readDiscoveryMarkets,
    refreshReadiness,
    markets,
    quote,
    createOrder,
  };
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("Public perps discovery stays behind business/module guards", () => {
  it.each([undefined, "Bearer invalid-fixture"])(
    "denies unauthenticated discovery before reading a provider",
    async (authorization) => {
      const h = await harness();
      const response = await h.app.inject({
        url: "/v1/trade/markets?asset_class=perps",
        headers: authorization ? { authorization } : {},
      });
      expect(response.statusCode).toBe(401);
      expect(h.readDiscoveryMarkets).not.toHaveBeenCalled();
      expect(h.refreshReadiness).not.toHaveBeenCalled();
      expect(h.markets).not.toHaveBeenCalled();
    },
  );
  it("denies disabled perps before reading the public provider", async () => {
    const h = await harness();
    h.enabled.delete("trade.perps");
    const response = await h.app.inject({
      url: "/v1/trade/markets?asset_class=perps",
      headers: bearer,
    });
    expect(response.statusCode).toBe(403);
    expect(h.requireBusiness).toHaveBeenCalledWith(
      expect.anything(),
      "trade.perps",
    );
    expect(h.readDiscoveryMarkets).not.toHaveBeenCalled();
  });
  it("returns the reference DTO unchanged with perps entitlement alone, never executable", async () => {
    const h = await harness();
    h.enabled.delete("trade.spot");
    const response = await h.app.inject({
      url: "/v1/trade/markets?asset_class=perps",
      headers: bearer,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual([referenceMarket]);
    expect(response.json().data[0]).toMatchObject({
      provider: "noether",
      asset_class: "perps",
      network: NETWORK,
      execution_status: "discovery_only",
      executable: false,
      reason: "REGION_RESTRICTED",
      price_decimals: 7,
    });
    expect(typeof response.json().data[0].reference_price).toBe("string");
    expect(response.json().data[0].quote_id).toBeUndefined();
    expect(h.readDiscoveryMarkets).toHaveBeenCalledExactlyOnceWith("perps");
    expect(h.refreshReadiness).not.toHaveBeenCalled();
    expect(h.markets).not.toHaveBeenCalled();
  });
  it("preserves the empty fallback when no optional discovery reader was installed", async () => {
    const h = await harness({ reader: false });
    const response = await h.app.inject({
      url: "/v1/trade/markets?asset_class=perps",
      headers: bearer,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual([]);
    expect(h.requireBusiness).toHaveBeenCalledWith(
      expect.anything(),
      "trade.perps",
    );
  });
  it("propagates provider read failures instead of inventing an empty successful discovery", async () => {
    const h = await harness();
    h.readDiscoveryMarkets.mockRejectedValueOnce(
      new GrapnelError(
        503,
        "NOETHER_UNAVAILABLE",
        "Offline fixture failure",
        true,
      ),
    );
    const response = await h.app.inject({
      url: "/v1/trade/markets?asset_class=perps",
      headers: bearer,
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("NOETHER_UNAVAILABLE");
    expect(h.markets).not.toHaveBeenCalled();
  });
  it.each(["", "?asset_class=crypto_spot"])(
    "keeps the crypto market path unchanged %s",
    async (query) => {
      const h = await harness();
      const response = await h.app.inject({
        url: "/v1/trade/markets" + query,
        headers: bearer,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual([cryptoMarket]);
      expect(h.requireBusiness).toHaveBeenCalledWith(
        expect.anything(),
        "trade.spot",
      );
      expect(h.refreshReadiness).toHaveBeenCalledOnce();
      expect(h.markets).toHaveBeenCalledOnce();
      expect(h.readDiscoveryMarkets).not.toHaveBeenCalled();
    },
  );
  it("does not route a perps market ID through the single-market crypto endpoint", async () => {
    const h = await harness();
    const response = await h.app.inject({
      url: "/v1/trade/markets/" + encodeURIComponent(referenceMarket.market_id),
      headers: bearer,
    });
    expect(response.statusCode).toBe(404);
    expect(h.readDiscoveryMarkets).not.toHaveBeenCalled();
    const crypto = await h.app.inject({
      url: "/v1/trade/markets/" + cryptoMarket.market_id,
      headers: bearer,
    });
    expect(crypto.statusCode).toBe(200);
    expect(crypto.json().data).toEqual(cryptoMarket);
  });
  it.each(["/v1/trade/quotes", "/v1/trade/orders"])(
    "perps entitlement does not authorize the existing spot write route %s",
    async (path) => {
      const h = await harness();
      h.enabled.delete("trade.spot");
      const payload = path.endsWith("quotes")
        ? {
            customer_id: customerId,
            market_id: referenceMarket.market_id,
            exact_in: { asset_id: "stellar-testnet:native:XLM", amount: "1" },
            slippage_bps: 50,
          }
        : { customer_id: customerId, wallet_id: walletId, quote_id: quoteId };
      const response = await h.app.inject({
        method: "POST",
        url: path + "?asset_class=perps",
        headers: { ...bearer, "idempotency-key": "test-only-write-block" },
        payload,
      });
      expect(response.statusCode).toBe(403);
      expect(h.requireBusiness).toHaveBeenCalledWith(
        expect.anything(),
        "trade.spot",
      );
      expect(h.requireCustomer).not.toHaveBeenCalled();
      expect(h.readDiscoveryMarkets).not.toHaveBeenCalled();
      expect(h.quote).not.toHaveBeenCalled();
      expect(h.createOrder).not.toHaveBeenCalled();
    },
  );
  it.each(["/v1/trade/perps/quotes", "/v1/trade/perps/orders"])(
    "does not install a perps financial endpoint %s",
    async (url) => {
      const h = await harness();
      const response = await h.app.inject({
        method: "POST",
        url,
        headers: bearer,
        payload: {},
      });
      expect(response.statusCode).toBe(404);
      expect(h.readDiscoveryMarkets).not.toHaveBeenCalled();
      expect(h.quote).not.toHaveBeenCalled();
      expect(h.createOrder).not.toHaveBeenCalled();
    },
  );
  it("the actual spot registry rejects a perps reference market even when both modules are enabled", async () => {
    const providerFetch = vi.fn<typeof fetch>();
    const adapter = new SoroswapSpotAdapter(
      {
        network: "testnet",
        networkPassphrase: NETWORK_PASSPHRASE,
        gate1Passed: false,
        markets: [],
      },
      providerFetch,
    );
    const client = {
      query: vi.fn(async (text: string) => ({
        rows: text.startsWith("SELECT id FROM customers")
          ? [{ id: customerId }]
          : [],
        rowCount: 0,
      })),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as ConstructorParameters<typeof SpotService>[1];
    const service = new SpotService(adapter, pool, {} as SpotOperationStore);
    const h = await harness({ service });
    const response = await h.app.inject({
      method: "POST",
      url: "/v1/trade/quotes",
      headers: { ...bearer, "idempotency-key": "test-only-perps-as-spot" },
      payload: {
        customer_id: customerId,
        market_id: referenceMarket.market_id,
        exact_in: { asset_id: "stellar-testnet:native:XLM", amount: "1" },
        slippage_bps: 50,
      },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("NOT_FOUND");
    expect(providerFetch).not.toHaveBeenCalled();
    expect(h.readDiscoveryMarkets).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalledOnce();
  });
  it("does not accept a public market reference as a quote ID for an order", async () => {
    const h = await harness();
    const response = await h.app.inject({
      method: "POST",
      url: "/v1/trade/orders",
      headers: bearer,
      payload: {
        customer_id: customerId,
        wallet_id: walletId,
        quote_id: referenceMarket.market_id,
      },
    });
    expect(response.statusCode).toBe(422);
    expect(h.createOrder).not.toHaveBeenCalled();
    expect(h.readDiscoveryMarkets).not.toHaveBeenCalled();
  });
});
