import { describe, expect, it, vi } from 'vitest';
import { HYPEREVM_TESTNET_RPC, HYPERLIQUID_TESTNET_INFO, HyperliquidTestnetReader, parseHyperliquidMarkets } from './reader.js';
const meta = { universe: [{ name: 'BTC', szDecimals: 5, maxLeverage: 40 }, { name: 'OLD', szDecimals: 0, maxLeverage: 3, isDelisted: true }] };
const ctx = { markPx: '12345.0001', oraclePx: '12344.1', midPx: null, prevDayPx: '12000.00', funding: '-0.000012345', openInterest: '9007199254740993.000001', dayNtlVlm: '19.999999' };
const fixture = () => [structuredClone(meta), [structuredClone(ctx), { ...ctx, markPx: '0' }]];
const json = (value: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json', ...headers } });
const clock = () => Date.parse('2026-11-12T04:00:00Z');
const transport = () => vi.fn<typeof fetch>(async (url) => url === HYPEREVM_TESTNET_RPC ? json({ jsonrpc: '2.0', id: 1, result: '0x3e6' }) : json(fixture()));

describe('strict readonly Hyperliquid Testnet markets', () => {
  it('pins sources, checks chain998, reads matching universe contexts and preserves exact strings', async () => {
    const request = transport();
    const result = await new HyperliquidTestnetReader(request, clock).readMarkets();
    expect(result.executable).toBe(false);
    expect(result.executionStatus).toBe('discovery_only');
    expect(result.markets[0]).toMatchObject({ assetIndex: 0, name: 'BTC', markPrice: ctx.markPx, fundingRate: ctx.funding, openInterest: ctx.openInterest, midPrice: null, dayBaseVolume: null });
    expect(result.markets[1]).toMatchObject({ name: 'OLD', isDelisted: true, markPrice: '0' });
    expect(result.source.providerMarketTimestamp).toBeNull();
    expect(request.mock.calls.map(([url]) => url)).toEqual([HYPEREVM_TESTNET_RPC, HYPERLIQUID_TESTNET_INFO]);
    expect(JSON.parse(request.mock.calls[1]![1]!.body as string)).toEqual({ type: 'metaAndAssetCtxs' });
    for (const [, options] of request.mock.calls) {
      expect(options).toMatchObject({ method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error' });
      expect(options?.signal).toBeInstanceOf(AbortSignal);
    }
  });
  it('rejects a mismatched chain before requesting any markets', async () => {
    const request = vi.fn<typeof fetch>(async () => json({ jsonrpc: '2.0', id: 1, result: '0x3e7' }));
    await expect(new HyperliquidTestnetReader(request, clock).readMarkets()).rejects.toThrow('NETWORK_MISMATCH');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('rejects missing or extra contexts instead of guessing market matches', () => {
    expect(() => parseHyperliquidMarkets([meta, [ctx]])).toThrow('CONTEXT_COUNT_MISMATCH');
    expect(() => parseHyperliquidMarkets([meta, [ctx, ctx, ctx]])).toThrow('CONTEXT_COUNT_MISMATCH');
  });
  it('rejects duplicate names while retaining delisted universe indices', () => {
    expect(() => parseHyperliquidMarkets([{ universe: [meta.universe[0], meta.universe[0]] }, [ctx, ctx]])).toThrow('DUPLICATE_MARKET');
  });
  it.each(['NaN', 'Infinity', '1e5', '-1', '', '00.1'])('rejects malformed positive decimal %s', (value) => {
    expect(() => parseHyperliquidMarkets([meta, [{ ...ctx, markPx: value }, ctx]])).toThrow();
  });
  it('rejects numeric JSON amounts and missing required source data', () => {
    expect(() => parseHyperliquidMarkets([meta, [{ ...ctx, dayNtlVlm: 1 }, ctx]])).toThrow();
    expect(() => parseHyperliquidMarkets([meta, [{ ...ctx, funding: undefined }, ctx]])).toThrow();
  });
  it.each([0.5, -1, 19])('rejects invalid size precision %s', (value) => {
    expect(() => parseHyperliquidMarkets([{ universe: [{ ...meta.universe[0], szDecimals: value }] }, [ctx]])).toThrow();
  });
  it('rejects stale or invalid provider HTTP dates', async () => {
    for (const date of ['2026-11-12T03:58:00Z', '2026-11-12T04:02:00Z', 'invalid']) {
      const request: typeof fetch = async () => json({}, { date });
      await expect(new HyperliquidTestnetReader(request, clock).readMarkets()).rejects.toThrow('STALE_RESPONSE');
    }
  });
  it('rejects responses taking longer than the deadline even if transport ignores abort', async () => {
    let calls = 0;
    await expect(new HyperliquidTestnetReader(transport(), () => clock() + calls++ * 9000).readMarkets()).rejects.toThrow('STALE_RESPONSE');
  });
  it('rejects an oversized streamed body even with no declared content length', async () => {
    const request: typeof fetch = async () => new Response(' '.repeat(2 * 1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } });
    await expect(new HyperliquidTestnetReader(request, clock).readMarkets()).rejects.toThrow('RESPONSE_TOO_LARGE');
  });
  it('rejects bad status, content type and malformed JSON', async () => {
    const responses = [new Response('no', { status: 403 }), new Response('<html/>'), new Response('{', { headers: { 'content-type': 'application/json' } })];
    for (const response of responses) await expect(new HyperliquidTestnetReader(async () => response, clock).readMarkets()).rejects.toThrow();
  });
});
