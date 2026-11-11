import { describe, expect, it, vi } from "vitest";
import { NETWORK_PASSPHRASE } from "@grapnel/contracts";
import { NoetherPublicAdapter, NOETHER_TESTNET_API } from "./noether.js";
const now = Date.parse("2026-11-11T16:45:00Z");
const fixture = {
  markets: [
    {
      asset: { symbol: "BTC", name: "Bitcoin", decimals: 8 },
      oracle: {
        asset: "BTC",
        price: "742603233333",
        priceFloat: -999,
        timestamp: Math.floor(now / 1000) - 20,
      },
    },
  ],
};
const response = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), { status, headers });
function setup(providerResponse: Response = response(fixture)) {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      String(url).endsWith("/v1/health")
        ? response({ status: "ok", network: "testnet" })
        : providerResponse,
    );
  const adapter = new NoetherPublicAdapter(
    { network: "testnet", networkPassphrase: NETWORK_PASSPHRASE },
    { fetcher, now: () => now },
  );
  return { adapter, fetcher };
}
describe("Noether public-only Testnet discovery", () => {
  it("converts oracle prices using 7 decimals independently of underlying display metadata and ignores floats", async () => {
    const { adapter, fetcher } = setup();
    const [market] = await adapter.markets();
    expect(market).toMatchObject({
      label: "BTC-PERP",
      reference_price: "74260.3233333",
      price_decimals: 7,
      underlying: { display_decimals: 8 },
      oracle_age_seconds: 20,
      price_status: "current",
      executable: false,
      execution_status: "discovery_only",
      reason: "REGION_RESTRICTED",
    });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      NOETHER_TESTNET_API + "/v1/health",
      NOETHER_TESTNET_API + "/v1/markets",
    ]);
    for (const [, init] of fetcher.mock.calls)
      expect(init).toMatchObject({
        method: "GET",
        headers: { Accept: "application/json" },
        redirect: "error",
      });
  });
  it("rejects mainnet and a gateway reporting the wrong network", async () => {
    expect(
      () =>
        new NoetherPublicAdapter({
          network: "public",
          networkPassphrase: NETWORK_PASSPHRASE,
        }),
    ).toThrow();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ status: "ok", network: "mainnet" }));
    const adapter = new NoetherPublicAdapter(
      { network: "testnet", networkPassphrase: NETWORK_PASSPHRASE },
      { fetcher },
    );
    await expect(adapter.markets()).rejects.toMatchObject({
      code: "NETWORK_MISMATCH",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("has no executable path even when public reads and beta access succeed", async () => {
    const { adapter, fetcher } = setup(
      response({ gated: false, allowed: true }),
    );
    expect(await adapter.betaStatus()).toMatchObject({
      gated: false,
      allowed_without_address: true,
    });
    expect(() => adapter.prepare()).toThrow(
      expect.objectContaining({
        code: "EXECUTION_UNAVAILABLE",
        retryable: false,
        details: expect.objectContaining({ reason: "REGION_RESTRICTED" }),
      }),
    );
    expect((await adapter.capabilities()).modes).toEqual(["read"]);
    expect(fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(
      true,
    );
  });
  it.each([
    [451, "region_restricted", "REGION_RESTRICTED"],
    [403, "not_in_beta", "NOETHER_BETA_ACCESS_REQUIRED"],
    [403, "forbidden", "NOETHER_PUBLIC_READ_FORBIDDEN"],
  ])(
    "stops without retrying after HTTP %s %s",
    async (status, code, reason) => {
      const { adapter, fetcher } = setup(
        response({ error: code }, Number(status)),
      );
      await expect(adapter.markets()).rejects.toMatchObject({
        code: "EXECUTION_UNAVAILABLE",
        retryable: false,
        details: { reason },
      });
      await expect(adapter.markets()).rejects.toMatchObject({
        retryable: false,
      });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect((await adapter.capabilities()).status).toBe("blocked");
    },
  );
  it("honors public rate limit cooldown without automatic retry", async () => {
    const { adapter, fetcher } = setup(
      response({ error: "rate_limited" }, 429, { "Retry-After": "30" }),
    );
    await expect(adapter.markets()).rejects.toMatchObject({
      statusCode: 429,
      details: { retry_after_seconds: 30 },
    });
    await expect(adapter.markets()).rejects.toMatchObject({ statusCode: 429 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("preserves unavailable and stale observations rather than inventing prices", async () => {
    const { adapter } = setup(
      response({
        markets: [
          {
            asset: { symbol: "XLM", name: "Stellar", decimals: 7 },
            oracle: null,
          },
          {
            asset: { symbol: "BTC", name: "Bitcoin", decimals: 8 },
            oracle: {
              asset: "BTC",
              price: "10000000",
              timestamp: Math.floor(now / 1000) - 61,
            },
          },
        ],
      }),
    );
    const [missing, stale] = await adapter.markets();
    expect(missing).toMatchObject({
      reference_price: null,
      price_status: "unavailable",
    });
    expect(stale).toMatchObject({
      reference_price: "1.0000000",
      price_status: "stale",
    });
  });
  it("recomputes freshness on cached reads and deduplicates concurrent reads", async () => {
    let clock = now;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) =>
      String(url).endsWith("/v1/health")
        ? response({ status: "ok", network: "testnet" })
        : response({
            ...fixture,
            markets: [
              {
                ...fixture.markets[0],
                oracle: {
                  ...fixture.markets[0]!.oracle,
                  timestamp: Math.floor(now / 1000) - 59,
                },
              },
            ],
          }),
    );
    const adapter = new NoetherPublicAdapter(
      { network: "testnet", networkPassphrase: NETWORK_PASSPHRASE },
      { fetcher, now: () => clock },
    );
    await Promise.all([adapter.markets(), adapter.markets()]);
    clock += 2000;
    expect((await adapter.markets())[0]?.price_status).toBe("stale");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([123, "1.5", "-1", "0"])(
    "rejects invalid fixed-point prices %s",
    async (price) => {
      const { adapter } = setup(
        response({
          markets: [
            {
              ...fixture.markets[0],
              oracle: { ...fixture.markets[0]!.oracle, price },
            },
          ],
        }),
      );
      await expect(adapter.markets()).rejects.toMatchObject({
        code: "PROVIDER_INVALID_RESPONSE",
      });
    },
  );
  it("rejects duplicate market or oracle identity mismatches", async () => {
    for (const markets of [
      [fixture.markets[0], fixture.markets[0]],
      [
        {
          ...fixture.markets[0],
          oracle: { ...fixture.markets[0]!.oracle, asset: "ETH" },
        },
      ],
    ]) {
      const { adapter } = setup(response({ markets }));
      await expect(adapter.markets()).rejects.toMatchObject({
        code: "PROVIDER_INVALID_RESPONSE",
      });
    }
  });
  it("sanitizes network failures without exposing raw transport messages", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("internal transport detail"));
    const adapter = new NoetherPublicAdapter(
      { network: "testnet", networkPassphrase: NETWORK_PASSPHRASE },
      { fetcher },
    );
    await expect(adapter.markets()).rejects.toMatchObject({
      code: "NOETHER_UNAVAILABLE",
      message: "Noether public market data could not be reached",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
