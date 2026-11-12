import { z } from 'zod';
import { parseHyperliquidCandles, validateCandleRequest, type HyperliquidCandleInterval } from './candles.js';

export const HYPERLIQUID_TESTNET_INFO = 'https://api.hyperliquid-testnet.xyz/info';
export const HYPEREVM_TESTNET_RPC = 'https://rpc.hyperliquid-testnet.xyz/evm';
const SOURCE_DOC = 'https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals';
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 8_000;
const MAX_AGE_MS = 60_000;
const decimal = z.string().max(128).regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/);
const signedDecimal = z.string().max(128).regex(/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/);
const metadata = z.object({
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
export function parseHyperliquidMarkets(value: unknown): HyperliquidTestnetMarket[] {
  const [meta, contexts] = payload.parse(value);
  if (meta.universe.length !== contexts.length) throw new Error('HYPERLIQUID_CONTEXT_COUNT_MISMATCH');
  const names = new Set<string>();
  return meta.universe.map((asset, assetIndex) => {
    if (names.has(asset.name)) throw new Error('HYPERLIQUID_DUPLICATE_MARKET');
    names.add(asset.name);
    const ctx = contexts[assetIndex]!;
    return { assetIndex, name: asset.name, szDecimals: asset.szDecimals, maxLeverage: asset.maxLeverage,
      isDelisted: asset.isDelisted ?? false, onlyIsolated: asset.onlyIsolated ?? false,
      marginMode: asset.marginMode ?? null, markPrice: ctx.markPx, oraclePrice: ctx.oraclePx,
      midPrice: ctx.midPx ?? null, previousDayPrice: ctx.prevDayPx, fundingRate: ctx.funding,
      openInterest: ctx.openInterest, dayNotionalVolume: ctx.dayNtlVlm,
      dayBaseVolume: ctx.dayBaseVlm ?? null, premium: ctx.premium ?? null };
  });
}

/** Fixed Testnet public data reader. No signing, exchange, deposit or mainnet
 * method exists. Market discovery never enables customer execution. */
export class HyperliquidTestnetReader {
  constructor(private readonly request: typeof fetch = fetch, private readonly now: () => number = Date.now) {}

  private async read(url: typeof HYPERLIQUID_TESTNET_INFO | typeof HYPEREVM_TESTNET_RPC, body: unknown) {
    const startedAt = this.now();
    const response = await this.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), redirect: 'error', credentials: 'omit', cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS) });
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

  private async verifyHyperEvmNetwork() {
    // Separate chain check verifies this fixed EVM endpoint, not a claim that
    // HyperCore perpetuals execute as EVM transactions on chain998.
    const network = await this.read(HYPEREVM_TESTNET_RPC, { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] });
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
