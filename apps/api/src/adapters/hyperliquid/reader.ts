import { z } from 'zod';
import { parseHyperliquidCatalog, priceHyperliquidCatalogDex } from './catalog.js';
import { parseHyperliquidCandles, validateCandleRequest, type HyperliquidCandleInterval } from './candles.js';

export const HYPERLIQUID_TESTNET_INFO = 'https://api.hyperliquid-testnet.xyz/info';
export const HYPEREVM_TESTNET_RPC = 'https://rpc.hyperliquid-testnet.xyz/evm';
const SOURCE_DOC = 'https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals';
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 8_000;
const MAX_AGE_MS = 60_000;
const CATALOG_BUDGET_MS = 12_000;
const decimal = z.string().max(128).regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/);
const signedDecimal = z.string().max(128).regex(/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/);
const metadata = z.object({
  collateralToken: z.number().int().nonnegative().optional(),
  universe: z.array(z.object({
    name: z.string().min(1).max(128).regex(/^[^\x00-\x1f\x7f]+$/),
    szDecimals: z.number().int().min(0).max(18),
    maxLeverage: z.number().int().min(1).max(1000),
    isDelisted: z.boolean().optional(),
    onlyIsolated: z.boolean().optional(),
    marginMode: z.string().max(64).optional(),
  })).min(1).max(2048),
});
const context = z.object({
  markPx: decimal, oraclePx: decimal, midPx: decimal.nullable().optional(), prevDayPx: decimal,
  funding: signedDecimal, openInterest: decimal, dayNtlVlm: decimal,
  dayBaseVlm: decimal.optional(), premium: signedDecimal.nullable().optional(),
});
const payload = z.tuple([metadata, z.array(context).max(2048)]);

export interface HyperliquidTestnetMarket {
  assetIndex: number;
  globalAssetIndex?: number;
  localAssetIndex?: number;
  dex?: '' | 'xyz';
  dexIndex?: number;
  name: string;
  szDecimals: number;
  maxLeverage: number;
  isDelisted: boolean;
  onlyIsolated: boolean;
  marginMode: string | null;
  markPrice: string;
  oraclePrice: string;
  midPrice: string | null;
  previousDayPrice: string;
  fundingRate: string;
  openInterest: string;
  dayNotionalVolume: string;
  dayBaseVolume: string | null;
  premium: string | null;
}

/** Exact decimals remain strings. Contexts are joined only by the provider's
 * corresponding array index, never a symbol match or a fabricated fallback. */
export function parseHyperliquidMarkets(value: unknown, builder?: { dex: 'xyz'; dexIndex: number }): HyperliquidTestnetMarket[] {
  const [meta, contexts] = payload.parse(value);
  if (builder && (builder.dex !== 'xyz' || !Number.isSafeInteger(builder.dexIndex) || builder.dexIndex <= 0 || builder.dexIndex >= 2048))
    throw new Error('HYPERLIQUID_UNAPPROVED_DEX');
  if (builder && meta.collateralToken !== 0) throw new Error('HYPERLIQUID_NON_USDC_COLLATERAL');
  if (meta.universe.length !== contexts.length) throw new Error('HYPERLIQUID_CONTEXT_COUNT_MISMATCH');
  const names = new Set<string>();
  return meta.universe.map((asset, localAssetIndex) => {
    if (builder && (!asset.name.startsWith('xyz:') || asset.name.length <= 4 || asset.name.slice(4).includes(':')))
      throw new Error('HYPERLIQUID_DEX_PREFIX_MISMATCH');
    if (!builder && asset.name.includes(':')) throw new Error('HYPERLIQUID_DEX_PREFIX_MISMATCH');
    const assetIndex = builder ? 100000 + builder.dexIndex * 10000 + localAssetIndex : localAssetIndex;
    if (names.has(asset.name)) throw new Error('HYPERLIQUID_DUPLICATE_MARKET');
    names.add(asset.name);
    const ctx = contexts[localAssetIndex]!;
    return { assetIndex, globalAssetIndex: assetIndex, localAssetIndex, dex: builder?.dex ?? '', dexIndex: builder?.dexIndex ?? 0, name: asset.name, szDecimals: asset.szDecimals, maxLeverage: asset.maxLeverage,
      isDelisted: asset.isDelisted ?? false, onlyIsolated: asset.onlyIsolated ?? false,
      marginMode: asset.marginMode ?? null, markPrice: ctx.markPx, oraclePrice: ctx.oraclePx,
      midPrice: ctx.midPx ?? null, previousDayPrice: ctx.prevDayPx, fundingRate: ctx.funding,
      openInterest: ctx.openInterest, dayNotionalVolume: ctx.dayNtlVlm,
      dayBaseVolume: ctx.dayBaseVlm ?? null, premium: ctx.premium ?? null };
  });
}


/** Registry array positions are provider identifiers. Only xyz is allowlisted;
 * unknown builders remain metadata rather than accidentally executable assets. */
export function resolveHyperliquidXyzDex(value: unknown) {
  const registry = z.array(z.object({ name: z.string().min(1).max(128) }).nullable()).min(2).max(2048).parse(value);
  if (registry[0] !== null || registry.slice(1).some((entry) => entry === null)) throw new Error('HYPERLIQUID_INVALID_DEX_REGISTRY');
  const names = registry.map((entry) => entry?.name ?? null);
  const unique = new Set(names.slice(1));
  if (unique.size !== names.length - 1) throw new Error('HYPERLIQUID_DUPLICATE_DEX');
  const dexIndex = names.indexOf('xyz');
  if (dexIndex <= 0) throw new Error('HYPERLIQUID_XYZ_DEX_UNAVAILABLE');
  return { dex: 'xyz' as const, dexIndex, names };
}

/** Fixed Testnet public data reader. No signing, exchange, deposit or mainnet
 * method exists. Market discovery never enables customer execution. */
export class HyperliquidTestnetReader {
  private catalogCache: { value: Awaited<ReturnType<HyperliquidTestnetReader['fetchCatalog']>>; expiresAt: number } | undefined;
  private catalogInFlight: Promise<Awaited<ReturnType<HyperliquidTestnetReader['fetchCatalog']>>> | undefined;

  constructor(private readonly request: typeof fetch = fetch, private readonly now: () => number = Date.now) {}

  private async read(url: typeof HYPERLIQUID_TESTNET_INFO | typeof HYPEREVM_TESTNET_RPC, body: unknown, budgetSignal?: AbortSignal) {
    const startedAt = this.now();
    const response = await this.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), redirect: 'error', credentials: 'omit', cache: 'no-store',
      signal: budgetSignal ? AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), budgetSignal]) : AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`HYPERLIQUID_SOURCE_HTTP_${response.status}`); }
    if (Number(response.headers.get('content-length') ?? '0') > MAX_BYTES) {
      await response.body?.cancel(); throw new Error('HYPERLIQUID_RESPONSE_TOO_LARGE');
    }
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      await response.body?.cancel(); throw new Error('HYPERLIQUID_UNEXPECTED_CONTENT_TYPE');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('HYPERLIQUID_EMPTY_RESPONSE');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_BYTES) throw new Error('HYPERLIQUID_RESPONSE_TOO_LARGE');
        chunks.push(chunk.value);
      }
    } finally { await reader.cancel(); }
    const receivedAt = this.now();
    if (receivedAt < startedAt || receivedAt - startedAt > TIMEOUT_MS) throw new Error('HYPERLIQUID_STALE_RESPONSE');
    const serverDate = response.headers.get('date');
    if (serverDate !== null) {
      const timestamp = Date.parse(serverDate);
      if (!Number.isFinite(timestamp) || receivedAt - timestamp > MAX_AGE_MS || timestamp - receivedAt > 30_000)
        throw new Error('HYPERLIQUID_STALE_RESPONSE');
    }
    const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
    let data: unknown;
    try { data = JSON.parse(text) as unknown; } catch { throw new Error('HYPERLIQUID_INVALID_JSON'); }
    return { data, receivedAt: new Date(receivedAt).toISOString(), serverDate };
  }

  private async verifyHyperEvmNetwork(budgetSignal?: AbortSignal) {
    // Separate chain check verifies this fixed EVM endpoint, not a claim that
    // HyperCore perpetuals execute as EVM transactions on chain998.
    const network = await this.read(HYPEREVM_TESTNET_RPC, { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }, budgetSignal);
    const rpcResult = z.object({ jsonrpc: z.literal('2.0'), id: z.literal(1), result: z.literal('0x3e6'), error: z.never().optional() });
    if (!rpcResult.safeParse(network.data).success) throw new Error('HYPERLIQUID_NETWORK_MISMATCH');
  }

  async readMarkets() {
    await this.verifyHyperEvmNetwork();
    const result = await this.read(HYPERLIQUID_TESTNET_INFO, { type: 'metaAndAssetCtxs' });
    return { provider: 'hyperliquid' as const, network: 'hyperliquid-testnet' as const,
      executionStatus: 'discovery_only' as const, executable: false as const,
      // This reader requests the first/native perpetual DEX only. HIP-3 DEXs
      // require independently enumerated sources; no claim of global coverage.
      dex: '', markets: parseHyperliquidMarkets(result.data),
      source: { infoUrl: HYPERLIQUID_TESTNET_INFO, requestType: 'metaAndAssetCtxs' as const,
        hyperEvmRpcUrl: HYPEREVM_TESTNET_RPC, hyperEvmChainId: 998 as const, documentationUrl: SOURCE_DOC,
        receivedAt: result.receivedAt, httpDate: result.serverDate, maxResponseAgeMs: MAX_AGE_MS,
        providerMarketTimestamp: null, freshnessBasis: 'http_response_receipt' as const },
    };
  }

  /** New complete snapshot for the two explicitly reviewed DEXs. Fail closed
   * when either source fails; never mix a fresh DEX with cached old metrics. */
  async readAllMarkets() {
    await this.verifyHyperEvmNetwork();
    const registry = await this.read(HYPERLIQUID_TESTNET_INFO, { type: 'perpDexs' });
    const xyz = resolveHyperliquidXyzDex(registry.data);
    const [native, builder] = await Promise.all([
      this.read(HYPERLIQUID_TESTNET_INFO, { type: 'metaAndAssetCtxs' }),
      this.read(HYPERLIQUID_TESTNET_INFO, { type: 'metaAndAssetCtxs', dex: 'xyz' }),
    ]);
    const markets = [...parseHyperliquidMarkets(native.data), ...parseHyperliquidMarkets(builder.data, xyz)];
    if (new Set(markets.map((market) => market.assetIndex)).size !== markets.length
        || new Set(markets.map((market) => market.name)).size !== markets.length) throw new Error('HYPERLIQUID_MARKET_ID_COLLISION');
    const observed = [registry, native, builder].map((row) => Date.parse(row.receivedAt));
    if (this.now() - Math.min(...observed) > MAX_AGE_MS) throw new Error('HYPERLIQUID_STALE_RESPONSE');
    return { provider: 'hyperliquid' as const, network: 'hyperliquid-testnet' as const,
      executionStatus: 'discovery_only' as const, executable: false as const, partial: false as const, markets,
      source: { infoUrl: HYPERLIQUID_TESTNET_INFO, requestTypes: ['perpDexs', 'metaAndAssetCtxs'] as const,
        hyperEvmRpcUrl: HYPEREVM_TESTNET_RPC, hyperEvmChainId: 998 as const,
        receivedAt: new Date(Math.max(...observed)).toISOString(), maxResponseAgeMs: MAX_AGE_MS,
        providerMarketTimestamp: null, freshnessBasis: 'http_response_receipt' as const,
        registry: { receivedAt: registry.receivedAt, httpDate: registry.serverDate, names: xyz.names },
        dexes: [{ dex: '', dexIndex: 0, receivedAt: native.receivedAt, httpDate: native.serverDate },
          { dex: 'xyz', dexIndex: xyz.dexIndex, collateralToken: 0, receivedAt: builder.receivedAt, httpDate: builder.serverDate }],
        documentationUrl: SOURCE_DOC,
        assetIdDocumentationUrl: 'https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/asset-ids' },
    };
  }

  private async fetchCatalog() {
    const budgetSignal = AbortSignal.timeout(CATALOG_BUDGET_MS);
    await this.verifyHyperEvmNetwork(budgetSignal);
    const [registry, metas, tokens, annotations] = await Promise.all([
      this.read(HYPERLIQUID_TESTNET_INFO, { type: 'perpDexs' }, budgetSignal),
      this.read(HYPERLIQUID_TESTNET_INFO, { type: 'allPerpMetas' }, budgetSignal),
      this.read(HYPERLIQUID_TESTNET_INFO, { type: 'spotMeta' }, budgetSignal),
      this.read(HYPERLIQUID_TESTNET_INFO, { type: 'perpConciseAnnotations' }, budgetSignal).catch(() => null),
    ]);
    const data = parseHyperliquidCatalog(registry.data, metas.data, tokens.data, annotations?.data);
    const times = [registry, metas, tokens].map((row) => Date.parse(row.receivedAt));
    if (this.now() - Math.min(...times) > MAX_AGE_MS) throw new Error('HYPERLIQUID_STALE_RESPONSE');
    return { ...data, provider: 'hyperliquid' as const, network: 'hyperliquid-testnet' as const,
      executionStatus: 'discovery_only' as const, executable: false as const, partial: false as const,
      activeCount: data.markets.filter((market) => !market.isDelisted).length,
      source: { infoUrl: HYPERLIQUID_TESTNET_INFO, receivedAt: new Date(Math.max(...times)).toISOString(),
        cacheExpiresAt: new Date(Math.min(...times) + MAX_AGE_MS).toISOString(), metadataCacheTtlMs: MAX_AGE_MS,
        metricAvailability: 'not_requested' as const, providerMarketTimestamp: null,
        observations: [registry, metas, tokens, annotations].map((row, index) => ({
          type: ['perpDexs', 'allPerpMetas', 'spotMeta', 'perpConciseAnnotations'][index],
          receivedAt: row?.receivedAt ?? null, httpDate: row?.serverDate ?? null })),
        annotationMeaning: 'provider_declared_not_verified_ownership_or_eligibility' as const },
    };
  }

  /** Bulk metadata only: at most five source calls including the chain check,
   * with a 60-second single-flight cache. Never fan out over all DEX contexts. */
  async readCatalog() {
    if (this.catalogCache && this.catalogCache.expiresAt > this.now()) return structuredClone(this.catalogCache.value);
    if (!this.catalogInFlight) {
      this.catalogInFlight = this.fetchCatalog().then((value) => {
        this.catalogCache = { value, expiresAt: Date.parse(value.source.cacheExpiresAt) };
        return value;
      });
    }
    const pending = this.catalogInFlight;
    try { return structuredClone(await pending); }
    finally { if (this.catalogInFlight === pending) this.catalogInFlight = undefined; }
  }

  /** Lazy source-context fetch for one DEX already verified in the current
   * catalog. Other collateral is displayed exactly and never relabeled USDC. */
  async readDexMarkets(dex: string) {
    const startedAt = this.now();
    const catalog = await this.readCatalog();
    if (!catalog.dexes.some((venue) => venue.dex === dex)) throw new Error('HYPERLIQUID_UNKNOWN_CATALOG_DEX');
    const remaining = CATALOG_BUDGET_MS - (this.now() - startedAt);
    if (remaining <= 0) throw new Error('HYPERLIQUID_STALE_RESPONSE');
    const result = await this.read(HYPERLIQUID_TESTNET_INFO, dex ? { type: 'metaAndAssetCtxs', dex } : { type: 'metaAndAssetCtxs' }, AbortSignal.timeout(remaining));
    try {
      const markets = priceHyperliquidCatalogDex(result.data, dex, catalog);
      return { provider: 'hyperliquid' as const, network: 'hyperliquid-testnet' as const,
        executionStatus: 'discovery_only' as const, executable: false as const, dex, markets,
        source: { infoUrl: HYPERLIQUID_TESTNET_INFO, requestType: 'metaAndAssetCtxs' as const,
          receivedAt: result.receivedAt, httpDate: result.serverDate, catalogReceivedAt: catalog.source.receivedAt,
          providerMarketTimestamp: null, freshnessBasis: 'http_response_receipt' as const } };
    } catch (error) { this.catalogCache = undefined; throw error; }
  }

  async readCandles(symbol: string, interval: HyperliquidCandleInterval, startTime: number, endTime: number) {
    const request = validateCandleRequest(symbol, interval, startTime, endTime, this.now());
    await this.verifyHyperEvmNetwork();
    const result = await this.read(HYPERLIQUID_TESTNET_INFO, { type: 'candleSnapshot',
      req: { coin: symbol, interval, startTime, endTime } });
    return { provider: 'hyperliquid' as const, network: 'hyperliquid-testnet' as const,
      executionStatus: 'discovery_only' as const, executable: false as const, symbol, interval,
      candles: parseHyperliquidCandles(result.data, request),
      source: { infoUrl: HYPERLIQUID_TESTNET_INFO, requestType: 'candleSnapshot' as const,
        receivedAt: result.receivedAt, httpDate: result.serverDate, maxResponseAgeMs: MAX_AGE_MS,
        requestedStartTime: startTime, requestedEndTime: endTime, maxRows: 5000,
        historicalLimit: 'most_recent_5000_source_candles' as const,
        documentationUrl: 'https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint' },
    };
  }

}
