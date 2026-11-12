import { z } from "zod";
import type { BlendMarket } from "../../adapters/blend/index.js";
export interface OverviewTradingMarket {underlying:{symbol:string;name:string};price_status:'current'|'stale'|'unavailable';reference_price:string|null;oracle_timestamp:string|null;instrument_type?:string;}

export const MARKET_OVERVIEW_CLASSIC_USDC_ISSUER = "GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56";
const CLASSIC_USDC_ID = `stellar-testnet:classic:USDC:${MARKET_OVERVIEW_CLASSIC_USDC_ISSUER}`;
const XLM_ID = "stellar-testnet:native:XLM";
const YAHOO_CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/";
const YAHOO_TICKERS = {
  BTC: "BTC-USD",
  ETH: "ETH-USD",
  XLM: "XLM-USD",
  AAPL: "AAPL",
  NVDA: "NVDA",
  TSLA: "TSLA",
} as const;
type YahooSymbol = keyof typeof YAHOO_TICKERS;

export interface MarketReferencePrice {
  value: string;
  as_of: string;
}
export type MarketReferencePriceReader = (symbol: string) => Promise<MarketReferencePrice | null>;
export interface MarketOverviewItem {
  symbol: string;
  name: string;
  value: string;
  unit: "USD" | "percent";
  unit_detail?: string;
  as_of: string;
}
export interface MarketOverviewSection {
  id: "spot" | "perps" | "stocks" | "lending";
  label: string;
  items: MarketOverviewItem[];
  available: boolean;
}
export interface MarketOverviewSnapshot {
  as_of: string;
  sections: MarketOverviewSection[];
}
export interface MarketOverviewDependencies {
  referencePrice: MarketReferencePriceReader;
  stockReferenceItems?:Array<{symbol:string;name:string;maxAgeMs:number}>;
  perps: () => Promise<OverviewTradingMarket[]>;
  lending: () => Promise<BlendMarket[]>;
  now?: () => number;
}

const referenceItems: Record<"spot" | "stocks", Array<{ symbol: YahooSymbol; name: string; maxAgeMs: number; unit_detail?: string }>> = {
  spot: [
    { symbol: "BTC", name: "Bitcoin", maxAgeMs: 15 * 60_000 },
    { symbol: "ETH", name: "Ethereum", maxAgeMs: 15 * 60_000 },
    { symbol: "XLM", name: "Stellar Lumens", maxAgeMs: 15 * 60_000 },
  ],
  stocks: [
    { symbol: "AAPL", name: "Apple", maxAgeMs: 7 * 86_400_000 },
    { symbol: "NVDA", name: "NVIDIA", maxAgeMs: 7 * 86_400_000 },
    { symbol: "TSLA", name: "Tesla", maxAgeMs: 7 * 86_400_000 },
  ],
};

function validDecimal(value: unknown): value is string {
  return typeof value === "string" && value.length <= 100 && /^(?:0|[1-9]\d{0,29})(?:\.\d{1,12})?$/.test(value) && /[1-9]/.test(value.replaceAll(".", ""));
}

function sourceDate(value: unknown, now: number, maxAgeMs: number): string | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time > now + 5000 || now - time > maxAgeMs) return null;
  return new Date(time).toISOString();
}

async function referenceSection(
  id: "spot" | "stocks",
  label: string,
  items: Array<{ symbol: string; name: string; maxAgeMs: number; unit_detail?: string }>,
  deps: MarketOverviewDependencies,
  now: number,
): Promise<MarketOverviewSection> {
  const rows = await Promise.all(items.map(async ({ symbol, name, maxAgeMs, unit_detail }): Promise<MarketOverviewItem | null> => {
    try {
      const quote = await deps.referencePrice(symbol);
      if (!quote || !validDecimal(quote.value) || BigInt(quote.value.replace(".", "")) <= 0n) return null;
      const asOf = sourceDate(quote.as_of, now, maxAgeMs);
      return asOf ? { symbol, name, value: quote.value, unit: "USD" as const, ...(unit_detail ? { unit_detail } : {}), as_of: asOf } : null;
    } catch {
      return null;
    }
  }));
  const values = rows.filter((value): value is MarketOverviewItem => value !== null).slice(0, 3);
  return { id, label, items: values, available: values.length > 0 };
}

/** Convert a decimal ratio to bounded percentage points without binary multiplication. */
export function supplyApyPercentagePoints(ratio: number | null): string | null {
  if (ratio === null || !Number.isFinite(ratio) || ratio < 0 || ratio > 1_000_000) return null;
  const raw = ratio.toString().toLowerCase();
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(raw);
  if (!match) return null;
  const digits = match[1]! + (match[2] ?? "");
  const point = match[1]!.length + Number(match[3] ?? 0) + 2;
  let value: string;
  if (point <= 0) value = `0.${"0".repeat(Math.min(-point, 32))}${digits}`;
  else if (point >= digits.length) value = digits + "0".repeat(Math.min(point - digits.length, 32));
  else value = `${digits.slice(0, point)}.${digits.slice(point)}`;
  if (!value.includes(".")) {
    value = value.replace(/^0+(?=\d)/, "");
    return value.length <= 12 ? value : null;
  }
  let [whole, fraction = ""] = value.split(".");
  fraction = fraction.slice(0, 8).replace(/0+$/, "");
  whole = (whole || "0").replace(/^0+(?=\d)/, "");
  if (whole.length > 12) return null;
  return fraction ? `${whole}.${fraction}` : whole;
}

function isXlmMarket(market: BlendMarket): boolean {
  return market.asset_id === XLM_ID && market.asset.id === XLM_ID && market.asset.network === "stellar-testnet"
    && market.asset.kind === "native" && market.asset.code === "XLM" && market.asset.verified === true;
}
function isClassicUsdcMarket(market: BlendMarket): boolean {
  return market.asset_id === CLASSIC_USDC_ID && market.asset.id === CLASSIC_USDC_ID && market.asset.network === "stellar-testnet"
    && market.asset.kind === "classic" && market.asset.code === "USDC" && market.asset.issuer === MARKET_OVERVIEW_CLASSIC_USDC_ISSUER
    && market.asset.decimals === 7 && market.asset.verified === true;
}

export class MarketOverviewService {
  private readonly now: () => number;
  constructor(private readonly deps: MarketOverviewDependencies) {
    this.now = deps.now ?? Date.now;
  }

  async read(enabledModules: string[]): Promise<MarketOverviewSnapshot> {
    const enabled = new Set(enabledModules);
    const sections: Partial<Record<MarketOverviewSection["id"], Promise<MarketOverviewSection>>> = {};
    if (enabled.has("trade.spot")) sections.spot = referenceSection("spot", "Spot prices", referenceItems.spot, this.deps, this.now());
    if (enabled.has("trade.perps")) sections.perps = (async () => {
      let markets: OverviewTradingMarket[] = [];
      try { markets = await this.deps.perps(); } catch { /* preserve other enabled sections */ }
      const now = this.now();
      const eligible = markets.filter(market => ["BTC", "ETH", "XLM"].includes(market.underlying.symbol)
        && market.price_status === "current" && market.reference_price !== null && validDecimal(market.reference_price)
        && market.oracle_timestamp !== null && sourceDate(market.oracle_timestamp, now, market.instrument_type==='leveraged_margin'?600_000:60_000) !== null);
      const items: MarketOverviewItem[] = eligible.slice(0, 3).map(market => ({
        symbol: market.underlying.symbol,
        name: `${market.underlying.name} ${market.instrument_type==='leveraged_margin'?'margin':'perpetual'}`,
        value: market.reference_price!,
        unit: "USD",
        as_of: new Date(market.oracle_timestamp!).toISOString(),
      }));
      return { id: "perps", label: "Margin prices", items, available: items.length > 0 };
    })();
    if (enabled.has("trade.stocks")) sections.stocks = referenceSection("stocks", "Stock prices", this.deps.stockReferenceItems??referenceItems.stocks, this.deps, this.now());
    if (enabled.has("capital.lending")) sections.lending = (async () => {
      let markets: BlendMarket[] = [];
      try { markets = await this.deps.lending(); } catch { /* preserve other enabled sections */ }
      const now = this.now();
      const seen = new Set<string>();
      const items: MarketOverviewItem[] = [];
      for (const market of markets) {
        const allowedAsset = isXlmMarket(market) || isClassicUsdcMarket(market);
        if (!allowedAsset || seen.has(market.asset_id) || items.length >= 3) continue;
        const asOf = sourceDate(market.as_of, now, 5 * 60_000);
        const value = supplyApyPercentagePoints(market.supply_apy_variable);
        if (!asOf || value === null) continue;
        seen.add(market.asset_id);
        items.push({ symbol: market.asset.code, name: `${market.asset.code} variable supply APY`, value, unit: "percent", unit_detail: "Variable APY", as_of: asOf });
      }
      return { id: "lending", label: "Lending rates", items, available: items.length > 0 };
    })();
    const ordered = (["spot", "perps", "stocks", "lending"] as const).flatMap(id => sections[id] ? [sections[id]!] : []);
    return { as_of: new Date(this.now()).toISOString(), sections: await Promise.all(ordered) };
  }
}

const yahooResponseSchema = z.object({
  chart: z.object({
    result: z.array(z.object({
      meta: z.object({
        symbol: z.string(),
        currency: z.string(),
        regularMarketPrice: z.number().finite().positive(),
        regularMarketTime: z.number().int().safe().positive(),
      }).passthrough(),
    }).passthrough()).max(1).nullable(),
    error: z.unknown().nullable().optional(),
  }).passthrough(),
}).passthrough();

function numberDecimalString(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const raw = value.toString().toLowerCase();
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(raw);
  if (!match) return null;
  const digits = match[1]! + (match[2] ?? "");
  const point = match[1]!.length + Number(match[3] ?? 0);
  let expanded: string;
  if (point <= 0) expanded = `0.${"0".repeat(Math.min(-point, 32))}${digits}`;
  else if (point >= digits.length) expanded = digits + "0".repeat(Math.min(point - digits.length, 32));
  else expanded = `${digits.slice(0, point)}.${digits.slice(point)}`;
  let [whole, fraction = ""] = expanded.split(".");
  whole = whole!.replace(/^0+(?=\d)/, "");
  fraction = fraction.replace(/0+$/, "");
  if (whole!.length > 24 || fraction.length > 12) return null;
  return fraction ? `${whole}.${fraction}` : whole!;
}

export interface YahooReferencePriceDependencies {
  fetcher?: typeof fetch;
  now?: () => number;
}

/** Fixed-symbol, server-side, public Yahoo chart reader. No caller-controlled URL or ticker. */
export function createYahooReferencePriceReader(deps: YahooReferencePriceDependencies = {}): MarketReferencePriceReader {
  const fetcher = deps.fetcher ?? fetch;
  const now = deps.now ?? Date.now;
  const cache = new Map<YahooSymbol, { expires: number; value: MarketReferencePrice }>();
  const loading = new Map<YahooSymbol, Promise<MarketReferencePrice | null>>();
  const read = async (symbol: string): Promise<MarketReferencePrice | null> => {
    if (!Object.hasOwn(YAHOO_TICKERS, symbol)) return null;
    const ticker = symbol as YahooSymbol;
    const current = cache.get(ticker);
    if (current && current.expires > now()) {
      const threshold = ["BTC", "ETH", "XLM"].includes(ticker) ? 15 * 60_000 : 7 * 86_400_000;
      if (sourceDate(current.value.as_of, now(), threshold)) return current.value;
      cache.delete(ticker);
    }
    const ongoing = loading.get(ticker);
    if (ongoing) return ongoing;
    const promise = (async (): Promise<MarketReferencePrice | null> => {
      try {
        const url = new URL(encodeURIComponent(YAHOO_TICKERS[ticker]), YAHOO_CHART_BASE);
        url.searchParams.set("range", "1d");
        url.searchParams.set("interval", "1m");
        const response = await fetcher(url.toString(), {
          method: "GET",
          headers: { Accept: "application/json" },
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) return null;
        const text = await response.text();
        if (text.length > 1_000_000) return null;
        const parsed = yahooResponseSchema.safeParse(JSON.parse(text));
        if (!parsed.success) return null;
        const result = parsed.data.chart.result?.[0];
        if (!result || result.meta.symbol !== YAHOO_TICKERS[ticker] || result.meta.currency !== "USD") return null;
        const value = numberDecimalString(result.meta.regularMarketPrice);
        const asOfMs = result.meta.regularMarketTime * 1000;
        const threshold = ["BTC", "ETH", "XLM"].includes(ticker) ? 15 * 60_000 : 7 * 86_400_000;
        const as_of = sourceDate(new Date(asOfMs).toISOString(), now(), threshold);
        if (!value || !as_of) return null;
        const quote = { value, as_of };
        cache.set(ticker, { expires: now() + 60_000, value: quote });
        return quote;
      } catch {
        return null;
      }
    })();
    loading.set(ticker, promise);
    try { return await promise; }
    finally { loading.delete(ticker); }
  };
  return read;
}
