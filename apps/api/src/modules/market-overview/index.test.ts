import { describe, expect, it, vi } from "vitest";
import type { BlendMarket } from "../../adapters/blend/index.js";
import type { NoetherPublicMarket } from "../../adapters/perps/noether.js";
import {
  createYahooReferencePriceReader,
  MARKET_OVERVIEW_CLASSIC_USDC_ISSUER,
  MarketOverviewService,
  supplyApyPercentagePoints,
} from "./index.js";

const now = Date.parse("2026-11-11T18:00:00.000Z");
const asOf = new Date(now - 60_000).toISOString();
const quote = (value: string, time = asOf) => ({ value, as_of: time });

function perps(symbol: string, price: string | null, time = asOf, status: "current" | "stale" | "unavailable" = "current"): NoetherPublicMarket {
  return {
    market_id: `stellar-testnet:noether:${symbol}-PERP`, label: `${symbol}-PERP`, asset_class: "perps", module: "trade.perps", provider: "noether", network: "stellar-testnet",
    underlying: { symbol, name: symbol === "XLM" ? "Stellar Lumens" : symbol === "BTC" ? "Bitcoin" : "Ethereum", display_decimals: 7 },
    reference_price_atomic: null, reference_price: price, price_decimals: 7, oracle_timestamp: time, oracle_age_seconds: Math.floor((now - Date.parse(time)) / 1000), price_status: status,
    observed_at: time, source_url: "https://example.invalid", execution_status: "discovery_only", executable: false, reason: "REGION_RESTRICTED", reason_message: "read-only",
  };
}

function blendMarket(code: "XLM" | "USDC", apy: number | null, as_of = new Date(now - 30_000).toISOString(), identity: "native" | "classic" | "soroban" = code === "XLM" ? "native" : "classic", issuer = MARKET_OVERVIEW_CLASSIC_USDC_ISSUER): BlendMarket {
  const assetId = code === "XLM" ? "stellar-testnet:native:XLM" : `stellar-testnet:classic:USDC:${issuer}`;
  return {
    market_id: `blend:${assetId}`, provider: "blend", network: "stellar-testnet", pool_contract_id: "CPOOL", pool_name: "Testnet pool", reserve_contract_id: "CRESERVE", asset_id: assetId,
    asset: { id: assetId, network: "stellar-testnet", kind: identity, code, issuer: identity === "classic" ? issuer : undefined, decimals: 7, verified: true, sourceUrl: "https://blend.capital" },
    pool_status: 0, supply_apy_variable: apy, borrow_apy_variable: null, available_liquidity: null, total_supplied: "0", total_borrowed: "0", as_of, as_of_ledger: 1,
    execution_status: "discovery_only", executable: false, reason: "read-only",
  } as BlendMarket;
}

describe("MarketOverviewService", () => {
  it("returns enabled sections only with real bounded symbols, unit-aware futures, current perps and exact-asset Blend rates", async () => {
    const referencePrice = vi.fn(async (symbol: string) => ({ BTC: quote("74200.5"), ETH: quote("2100"), XLM: quote("0.15"), AAPL: quote("355.15"), NVDA: quote("190"), TSLA: quote("330"), "GC=F": quote("4000"), "SI=F": quote("45"), "CL=F": quote("60") }[symbol] ?? null));
    const service = new MarketOverviewService({
      referencePrice,
      perps: async () => [perps("BTC", "74201.0000000"), perps("ETH", "2101.0000000"), perps("XLM", "0.1500000"), perps("SOL", "150.0000000")],
      lending: async () => [blendMarket("XLM", 0.0525), blendMarket("USDC", 0.0375), blendMarket("USDC", 99, asOf, "classic", "GWRONGISSUER"), blendMarket("USDC", 99, asOf, "soroban")],
      now: () => now,
    });
    const result = await service.read(["trade.spot", "trade.perps", "trade.stocks", "trade.commodities", "capital.lending"]);
    expect(result.as_of).toBe(new Date(now).toISOString());
    expect(result.sections.map(section => section.id)).toEqual(["spot", "perps", "stocks", "commodities", "lending"]);
    expect(result.sections.every(section => section.available && section.items.length <= 3)).toBe(true);
    expect(result.sections.find(section => section.id === "spot")?.items).toMatchObject([
      { symbol: "BTC", value: "74200.5", unit: "USD", as_of: asOf },
      { symbol: "ETH", value: "2100", unit: "USD" },
      { symbol: "XLM", value: "0.15", unit: "USD" },
    ]);
    expect(result.sections.find(section => section.id === "stocks")?.items.map(item => item.symbol)).toEqual(["AAPL", "NVDA", "TSLA"]);
    expect(result.sections.find(section => section.id === "commodities")?.items).toMatchObject([
      { symbol: "GC=F", name: "Gold futures", unit_detail: "USD per troy ounce" },
      { symbol: "SI=F", name: "Silver futures", unit_detail: "USD per troy ounce" },
      { symbol: "CL=F", name: "Crude oil futures", unit_detail: "USD per barrel" },
    ]);
    expect(result.sections.find(section => section.id === "perps")?.items.map(item => item.symbol)).toEqual(["BTC", "ETH", "XLM"]);
    expect(result.sections.find(section => section.id === "lending")?.items).toMatchObject([
      { symbol: "XLM", value: "5.25", unit: "percent", unit_detail: "APY percentage points" },
      { symbol: "USDC", value: "3.75", unit: "percent", unit_detail: "APY percentage points" },
    ]);
    expect(referencePrice).toHaveBeenCalledTimes(9);
  });

  it("omits disabled sections and does not touch their providers", async () => {
    const referencePrice = vi.fn(async () => quote("1"));
    const perpsRead = vi.fn(async () => [perps("BTC", "100.0000000")]);
    const lendingRead = vi.fn(async () => [blendMarket("XLM", 0.01)]);
    const service = new MarketOverviewService({ referencePrice, perps: perpsRead, lending: lendingRead, now: () => now });
    await expect(service.read(["capital.wallets"])).resolves.toEqual({ as_of: new Date(now).toISOString(), sections: [] });
    expect(referencePrice).not.toHaveBeenCalled();
    expect(perpsRead).not.toHaveBeenCalled();
    expect(lendingRead).not.toHaveBeenCalled();
  });

  it("keeps partial source failures local and omits stale, malformed and unavailable observations", async () => {
    const referencePrice = vi.fn(async (symbol: string) => {
      if (symbol === "BTC") throw new Error("provider down");
      if (symbol === "ETH") return quote("2100", new Date(now - 16 * 60_000).toISOString());
      if (symbol === "XLM") return quote("0");
      if (symbol === "AAPL") return quote("355.15");
      return null;
    });
    const service = new MarketOverviewService({
      referencePrice,
      perps: async () => [perps("BTC", "74200.0000000", new Date(now - 61_000).toISOString())],
      lending: async () => [blendMarket("XLM", 0.05, new Date(now - 6 * 60_000).toISOString())],
      now: () => now,
    });
    const result = await service.read(["trade.spot", "trade.stocks", "trade.perps", "capital.lending"]);
    expect(result.sections.find(section => section.id === "spot")).toMatchObject({ available: false, items: [] });
    expect(result.sections.find(section => section.id === "stocks")?.items).toMatchObject([{ symbol: "AAPL", value: "355.15" }]);
    expect(result.sections.find(section => section.id === "perps")).toMatchObject({ available: false, items: [] });
    expect(result.sections.find(section => section.id === "lending")).toMatchObject({ available: false, items: [] });
  });

  it("returns enabled but unavailable sections when a whole reader fails", async () => {
    const service = new MarketOverviewService({
      referencePrice: async () => { throw new Error("unavailable"); },
      perps: async () => { throw new Error("unavailable"); },
      lending: async () => { throw new Error("unavailable"); },
      now: () => now,
    });
    const result = await service.read(["trade.spot", "trade.perps", "capital.lending"]);
    expect(result.sections.map(section => [section.id, section.available, section.items.length])).toEqual([
      ["spot", false, 0], ["perps", false, 0], ["lending", false, 0],
    ]);
  });
});

describe("percentage-point APY formatting", () => {
  it.each([
    [0.0525, "5.25"], [0.02, "2"], [5.826186057257479, "582.61860572"], [0, "0"],
  ])("converts the fraction %s to percentage points", (value, expected) => {
    expect(supplyApyPercentagePoints(value)).toBe(expected);
  });
  it.each([null, -0.1, Number.NaN, Number.POSITIVE_INFINITY, 1_000_001])("omits invalid APY ratio %s", value => {
    expect(supplyApyPercentagePoints(value)).toBeNull();
  });
});

function yahooBody(symbol: string, price = 123.45, time = Math.floor(now / 1000) - 30, currency = "USD") {
  return { chart: { result: [{ meta: { symbol, currency, regularMarketPrice: price, regularMarketTime: time } }], error: null } };
}

describe("Yahoo fixed-allowlist reference reader", () => {
  it("uses a fixed HTTPS ticker map, USD metadata, timeouts, safe cache and request coalescing", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(yahooBody("GC=F", 3998.4)), { status: 200 }));
    let clock = now;
    const read = createYahooReferencePriceReader({ fetcher, now: () => clock });
    const [first, second] = await Promise.all([read("GC=F"), read("GC=F")]);
    expect(first).toEqual({ value: "3998.4", as_of: new Date(now - 30_000).toISOString() });
    expect(second).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe("https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?range=1d&interval=1m");
    expect(init).toMatchObject({ method: "GET", headers: { Accept: "application/json" }, redirect: "error" });
    clock += 61_000;
    await read("GC=F");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("returns null for unknown symbols, stale crypto, wrong ticker/currency, bad JSON and HTTP errors", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => {
      const ticker = decodeURIComponent(new URL(String(url)).pathname.split("/").at(-1)!);
      if (ticker === "BTC-USD") return new Response(JSON.stringify(yahooBody(ticker, 100, Math.floor(now / 1000) - 16 * 60)), { status: 200 });
      if (ticker === "ETH-USD") return new Response(JSON.stringify(yahooBody("BTC-USD")), { status: 200 });
      if (ticker === "XLM-USD") return new Response(JSON.stringify(yahooBody(ticker, 0.1, Math.floor(now / 1000), "CAD")), { status: 200 });
      if (ticker === "AAPL") return new Response("not json", { status: 200 });
      return new Response("unavailable", { status: 503 });
    });
    const read = createYahooReferencePriceReader({ fetcher, now: () => now });
    await expect(read("../private" )).resolves.toBeNull();
    for (const symbol of ["BTC", "ETH", "XLM", "AAPL", "NVDA"]) await expect(read(symbol)).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
});
