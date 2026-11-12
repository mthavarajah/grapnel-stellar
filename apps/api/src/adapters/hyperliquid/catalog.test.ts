import { describe, expect, it, vi } from 'vitest';
import { parseHyperliquidCatalog, priceHyperliquidCatalogDex } from './catalog.js';
import { HYPEREVM_TESTNET_RPC, HyperliquidTestnetReader } from './reader.js';
const asset = (name: string) => ({ name, szDecimals: 3, maxLeverage: 10 });
const registry = [null, { name: 'xyz' }, { name: 'pas3307' }];
const metas = [{ universe: [asset('BTC')], collateralToken: 0 }, { universe: [asset('xyz:AAPL')], collateralToken: 0 }, { universe: [asset('pas3307:GOLD')], collateralToken: 3307 }];
const token = (index: number, name: string) => ({ index, tokenId: `0x${String(index ? 1 : 0).repeat(32)}`, name, szDecimals: 8, weiDecimals: 8, isCanonical: index === 0 });
const spots = { tokens: [token(0, 'USDC'), token(3307, 'DIFFERENT')] };
const annotations = [['xyz:AAPL', { category: 'stocks', displayName: 'Apple exposure' }], ['pas3307:GOLD', { category: 'commodities' }]];
const ctx = { markPx: '10.00001', oraclePx: '10.1', prevDayPx: '9', funding: '-0.00001', openInterest: '10.00000001', dayNtlVlm: '19.00000001' };
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const fetcher = () => vi.fn<typeof fetch>(async (url, options) => {
  if (url === HYPEREVM_TESTNET_RPC) return json({ jsonrpc: '2.0', id: 1, result: '0x3e6' });
  const body = JSON.parse(options!.body as string);
  if (body.type === 'perpDexs') return json(registry);
  if (body.type === 'allPerpMetas') return json(metas);
  if (body.type === 'spotMeta') return json(spots);
  if (body.type === 'perpConciseAnnotations') return json(annotations);
  const index = body.dex === 'pas3307' ? 2 : body.dex === 'xyz' ? 1 : 0;
  return json([metas[index], [ctx]]);
});

describe('bounded all-DEX source metadata and lazy contexts', () => {
  it('preserves all source identities and collateral while metadata prices stay explicitly null', () => {
    const result = parseHyperliquidCatalog(registry, metas, spots, annotations);
    expect(result.markets).toHaveLength(3);
    expect(result.markets[1]).toMatchObject({ name: 'xyz:AAPL', assetIndex: 110000, markPrice: null, sourceCategory: 'stocks', displayName: 'Apple exposure', metricsStatus: 'metadata_only', executable: false });
    expect(result.markets[2]).toMatchObject({ name: 'pas3307:GOLD', collateralToken: 3307, collateralCompatibility: 'other', sourceCategory: 'commodities' });
    expect(result.markets[0]?.collateral).toMatchObject({ name: 'USDC', weiDecimals: 8, tokenIndex: 0 });
  });
  it('preserves opaque names with spaces, nested colons and Unicode without treating them as paths', () => {
    const unusual = 'xyz:A B:C/../../中';
    const custom = [metas[0], { ...metas[1], universe: [asset(unusual)] }, metas[2]];
    expect(parseHyperliquidCatalog(registry, custom, spots).markets[1]?.name).toBe(unusual);
  });
  it('never labels same-symbol other collateral as USDC and retains unresolved identity', () => {
    const result = parseHyperliquidCatalog(registry, metas, { tokens: [token(3307, 'USDC')] });
    expect(result.markets[0]).toMatchObject({ collateral: null, collateralCompatibility: 'unresolved' });
    expect(result.markets[2]?.collateralCompatibility).toBe('other');
  });
  it('rejects source array drift, wrong namespaces and duplicate collateral records', () => {
    expect(() => parseHyperliquidCatalog(registry, metas.slice(0, 2), spots)).toThrow('COUNT_MISMATCH');
    expect(() => parseHyperliquidCatalog(registry, [metas[0], metas[2], metas[1]], spots)).toThrow('PREFIX_MISMATCH');
    expect(() => parseHyperliquidCatalog(registry, metas, { tokens: [token(0, 'USDC'), token(0, 'USDC')] })).toThrow('DUPLICATE_COLLATERAL');
  });
  it('retains empty DEXs/delisted indices without creating or reindexing prices', () => {
    const custom = [{ ...metas[0], universe: [{ ...asset('BTC'), isDelisted: true }, asset('ETH')] }, { universe: [], collateralToken: 0 }, metas[2]];
    const result = parseHyperliquidCatalog(registry, custom, spots);
    expect(result.markets[1]).toMatchObject({ name: 'ETH', localAssetIndex: 1, assetIndex: 1 });
    expect(result.dexes[1]?.marketCount).toBe(0);
  });
  it('treats unavailable/malformed optional annotations as unavailable, never invented classification', () => {
    for (const value of [undefined, { malformed: true }, [...annotations, annotations[0]]]) {
      const result = parseHyperliquidCatalog(registry, metas, spots, value);
      expect(result.annotationStatus).toBe('unavailable');
      expect(result.markets.every((market) => market.sourceCategory === null)).toBe(true);
    }
  });
  it('uses five bounded initial source calls and caches/single-flights metadata without caller mutation', async () => {
    const transport = fetcher(), reader = new HyperliquidTestnetReader(transport);
    const [first, second] = await Promise.all([reader.readCatalog(), reader.readCatalog()]);
    expect(transport).toHaveBeenCalledTimes(5);
    first.markets[0]!.name = 'MUTATED';
    expect(second.markets[0]?.name).toBe('BTC');
    expect((await reader.readCatalog()).markets[0]?.name).toBe('BTC');
    expect(transport).toHaveBeenCalledTimes(5);
  });
  it('fetches exactly one selected DEX context with actual non-USDC identity retained', async () => {
    const transport = fetcher(), reader = new HyperliquidTestnetReader(transport);
    await reader.readCatalog();
    const result = await reader.readDexMarkets('pas3307');
    expect(transport).toHaveBeenCalledTimes(6);
    expect(result.markets[0]).toMatchObject({ markPrice: ctx.markPx, collateralCompatibility: 'other', metricsStatus: 'source_context', executable: false });
    expect((await reader.readCatalog()).markets[2]?.markPrice).toBeNull();
    await expect(reader.readDexMarkets('unpublished')).rejects.toThrow('UNKNOWN_CATALOG_DEX');
    expect(transport).toHaveBeenCalledTimes(6);
  });
  it('rejects reordered/changed selected metadata and context count instead of matching by symbol', () => {
    const catalog = parseHyperliquidCatalog(registry, metas, spots);
    expect(() => priceHyperliquidCatalogDex([{ ...metas[1], collateralToken: 3307 }, [ctx]], 'xyz', catalog)).toThrow('CATALOG_CHANGED');
    expect(() => priceHyperliquidCatalogDex([metas[1], []], 'xyz', catalog)).toThrow('CATALOG_CHANGED');
    expect(() => priceHyperliquidCatalogDex([{ ...metas[1], universe: [asset('xyz:TSLA')] }, [ctx]], 'xyz', catalog)).toThrow('CATALOG_CHANGED');
  });
  it('refreshes expired metadata and does not fall back to stale cache on source failure', async () => {
    const transport = fetcher(); let now = Date.now();
    const reader = new HyperliquidTestnetReader(transport, () => now);
    await reader.readCatalog(); now += 60_001;
    transport.mockImplementation(async () => { throw new Error('source offline'); });
    await expect(reader.readCatalog()).rejects.toThrow('source offline');
  });
  it('keeps identity catalog usable when only optional annotation source fails', async () => {
    const transport = fetcher();
    const request: typeof fetch = (url, options) => JSON.parse(options!.body as string).type === 'perpConciseAnnotations'
      ? Promise.reject(new Error('no annotations')) : transport(url, options);
    const result = await new HyperliquidTestnetReader(request).readCatalog();
    expect(result.annotationStatus).toBe('unavailable');
    expect(result.markets).toHaveLength(3);
  });
});
