import { describe, expect, it, vi } from 'vitest';
import { HYPEREVM_TESTNET_RPC, HyperliquidTestnetReader, parseHyperliquidMarkets, resolveHyperliquidXyzDex } from './reader.js';
const ctx = { markPx: '10.01', oraclePx: '10.00', prevDayPx: '9.00', funding: '-0.000001', openInterest: '10', dayNtlVlm: '100' };
const meta = (name: string, collateralToken = 0, isDelisted = false) => [{ collateralToken, universe: [{ name, szDecimals: 2, maxLeverage: 10, isDelisted }] }, [ctx]];
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const registry = [null, { name: 'other' }, { name: 'xyz' }];
const transport = () => vi.fn<typeof fetch>(async (url, init) => {
  if (url === HYPEREVM_TESTNET_RPC) return json({ jsonrpc: '2.0', id: 1, result: '0x3e6' });
  const body = JSON.parse(init!.body as string);
  if (body.type === 'perpDexs') return json(registry);
  return json(meta(body.dex ? 'xyz:AAPL' : 'BTC'));
});

describe('allowlisted Hyperliquid Testnet builder identity', () => {
  it('resolves live registry position and keeps local/native and global builder indices distinct', async () => {
    const request = transport();
    const result = await new HyperliquidTestnetReader(request).readAllMarkets();
    expect(result.markets.map((market) => [market.name, market.assetIndex, market.globalAssetIndex, market.localAssetIndex, market.dexIndex]))
      .toEqual([['BTC', 0, 0, 0, 0], ['xyz:AAPL', 120000, 120000, 0, 2]]);
    expect(result.partial).toBe(false);
    expect(result.executable).toBe(false);
    expect(result.source.registry.names).toEqual([null, 'other', 'xyz']);
    expect(request.mock.calls.map(([, init]) => JSON.parse(init!.body as string)).filter((body) => body.dex)).toEqual([{ type: 'metaAndAssetCtxs', dex: 'xyz' }]);
  });
  it('uses the published builder ID formula for registry index65', () => {
    const rows = parseHyperliquidMarkets(meta('xyz:TSLA'), { dex: 'xyz', dexIndex: 65 });
    expect(rows[0]?.assetIndex).toBe(750000);
  });
  it('rejects bad registry null slots, missing allowlist and duplicate names', () => {
    for (const value of [[{ name: 'xyz' }], [null, null, { name: 'xyz' }], [null, { name: 'pas3307' }], [null, { name: 'xyz' }, { name: 'xyz' }]])
      expect(() => resolveHyperliquidXyzDex(value)).toThrow();
  });
  it('rejects wrong or unqualified builder prefixes and native qualified names', () => {
    for (const name of ['AAPL', 'pas3307:AAPL', 'xyz:', 'xyz:a:AAPL']) expect(() => parseHyperliquidMarkets(meta(name), { dex: 'xyz', dexIndex: 2 })).toThrow('PREFIX_MISMATCH');
    expect(() => parseHyperliquidMarkets(meta('xyz:AAPL'))).toThrow('PREFIX_MISMATCH');
  });
  it('requires actual explicit USDC collateralToken0 on xyz', () => {
    expect(() => parseHyperliquidMarkets(meta('xyz:AAPL', 1), { dex: 'xyz', dexIndex: 2 })).toThrow('NON_USDC');
    const rows = meta('xyz:AAPL'); delete (rows[0] as { collateralToken?: number }).collateralToken;
    expect(() => parseHyperliquidMarkets(rows, { dex: 'xyz', dexIndex: 2 })).toThrow('NON_USDC');
  });
  it('rejects invalid builder index and disallowed builder configuration', () => {
    for (const dexIndex of [0, -1, 2.5, 2048]) expect(() => parseHyperliquidMarkets(meta('xyz:AAPL'), { dex: 'xyz', dexIndex })).toThrow('UNAPPROVED_DEX');
    expect(() => parseHyperliquidMarkets(meta('pas3307:AAPL'), { dex: 'pas3307' as 'xyz', dexIndex: 2 })).toThrow('UNAPPROVED_DEX');
  });
  it('retains delisted entries and rejects context mismatch without reindexing', () => {
    expect(parseHyperliquidMarkets(meta('xyz:AAPL', 0, true), { dex: 'xyz', dexIndex: 2 })[0]).toMatchObject({ isDelisted: true, localAssetIndex: 0 });
    expect(() => parseHyperliquidMarkets([(meta('xyz:AAPL')[0]), []], { dex: 'xyz', dexIndex: 2 })).toThrow('COUNT_MISMATCH');
  });
  it('fails the entire snapshot on builder source failure instead of returning native as complete', async () => {
    const base = transport();
    const request: typeof fetch = async (url, init) => JSON.parse(init!.body as string).dex ? new Response('unavailable', { status: 503 }) : base(url, init);
    await expect(new HyperliquidTestnetReader(request).readAllMarkets()).rejects.toThrow('HTTP_503');
  });
  it('preserves qualified candle identity in the request and response', async () => {
    const now = Date.now(), start = now - 3_600_000;
    const request = vi.fn<typeof fetch>(async (url) => url === HYPEREVM_TESTNET_RPC ? json({ jsonrpc: '2.0', id: 1, result: '0x3e6' })
      : json([{ t: start, T: now - 1, s: 'xyz:AAPL', i: '1h', o: '10', h: '10', l: '10', c: '10', v: '1', n: 1 }]));
    const result = await new HyperliquidTestnetReader(request).readCandles('xyz:AAPL', '1h', start, now);
    expect(result.symbol).toBe('xyz:AAPL');
    expect(JSON.parse(request.mock.calls[1]![1]!.body as string).req.coin).toBe('xyz:AAPL');
  });
});
