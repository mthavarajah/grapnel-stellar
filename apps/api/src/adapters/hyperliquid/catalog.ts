import { z } from 'zod';

const decimal = z.string().max(128).regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/);
const signedDecimal = z.string().max(128).regex(/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/);
const assetSchema = z.object({ name: z.string().min(1).max(128).regex(/^[^\x00-\x1f\x7f]+$/), szDecimals: z.number().int().min(0).max(18),
  maxLeverage: z.number().int().min(1).max(1000), isDelisted: z.boolean().optional(), onlyIsolated: z.boolean().optional(), marginMode: z.string().max(64).optional() });
const metaSchema = z.object({ universe: z.array(assetSchema).max(10_000), collateralToken: z.number().int().nonnegative() });
const tokenSchema = z.object({ index: z.number().int().nonnegative(), tokenId: z.string().regex(/^0x[0-9a-fA-F]{32}$/),
  name: z.string().min(1).max(128), fullName: z.string().max(512).nullable().optional(),
  szDecimals: z.number().int().min(0).max(38), weiDecimals: z.number().int().min(0).max(38), isCanonical: z.boolean(),
  evmContract: z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/), evm_extra_wei_decimals: z.number().int().min(-38).max(38) }).nullable().optional() });
const annotationSchema = z.array(z.tuple([z.string().min(1).max(128), z.object({ category: z.string().max(128), displayName: z.string().max(512).optional() })])).max(20_000);
const ctxSchema = z.array(z.object({ markPx: decimal, oraclePx: decimal, midPx: decimal.nullable().optional(), prevDayPx: decimal,
  funding: signedDecimal, openInterest: decimal, dayNtlVlm: decimal, dayBaseVlm: decimal.optional(), premium: signedDecimal.nullable().optional() })).max(10_000);

export interface HyperliquidCollateralIdentity {
  tokenIndex: number; tokenId: string; name: string; fullName: string | null;
  szDecimals: number; weiDecimals: number; isCanonical: boolean;
  /** Provider-linked contract only; do not infer this is a transferable USDC ERC20. */
  linkedEvmContract: { address: string; evmExtraWeiDecimals: number } | null;
}
export interface HyperliquidCatalogMarket {
  assetIndex: number; globalAssetIndex: number; localAssetIndex: number; dex: string; dexIndex: number;
  name: string; szDecimals: number; maxLeverage: number; isDelisted: boolean; onlyIsolated: boolean; marginMode: string | null;
  collateralToken: number; collateral: HyperliquidCollateralIdentity | null;
  collateralCompatibility: 'usdc' | 'other' | 'unresolved';
  sourceCategory: string | null; displayName: string | null;
  markPrice: string | null; oraclePrice: string | null; midPrice: string | null; previousDayPrice: string | null;
  fundingRate: string | null; openInterest: string | null; dayNotionalVolume: string | null; dayBaseVolume: string | null; premium: string | null;
  metricsStatus: 'metadata_only' | 'source_context'; executable: false;
}
export interface HyperliquidCatalogData {
  markets: HyperliquidCatalogMarket[];
  dexes: { dex: string; dexIndex: number; collateralToken: number; marketCount: number; activeCount: number }[];
  registryNames: (string | null)[];
  annotationStatus: 'available' | 'unavailable';
}

/** Bulk metadata has no market contexts on the current Testnet response.
 * Preserve every source slot; never fill missing prices from another market. */
export function parseHyperliquidCatalog(registryValue: unknown, metasValue: unknown, spotValue: unknown, annotationsValue?: unknown): HyperliquidCatalogData {
  const registry = z.array(z.object({ name: z.string().min(1).max(128) }).nullable()).min(1).max(2048).parse(registryValue);
  if (registry[0] !== null || registry.slice(1).some((entry) => entry === null)) throw new Error('HYPERLIQUID_INVALID_DEX_REGISTRY');
  const registryNames = registry.map((entry) => entry?.name ?? null);
  if (new Set(registryNames).size !== registryNames.length) throw new Error('HYPERLIQUID_DUPLICATE_DEX');
  const metas = z.array(metaSchema).max(2048).parse(metasValue);
  if (metas.length !== registry.length) throw new Error('HYPERLIQUID_CATALOG_DEX_COUNT_MISMATCH');
  const tokens = z.object({ tokens: z.array(tokenSchema).max(20_000) }).parse(spotValue).tokens;
  if (new Set(tokens.map((token) => token.index)).size !== tokens.length) throw new Error('HYPERLIQUID_DUPLICATE_COLLATERAL_TOKEN');
  const tokenMap = new Map(tokens.map((token) => [token.index, token]));
  const annotations = annotationSchema.safeParse(annotationsValue);
  const annotationMap = new Map(annotations.success ? annotations.data : []);
  // A malformed/duplicate optional annotation source cannot alter identities.
  const annotationStatus = annotations.success && annotationMap.size === annotations.data.length ? 'available' : 'unavailable';
  const names = new Set<string>(), ids = new Set<number>();
  const markets: HyperliquidCatalogMarket[] = [];
  const dexes = metas.map((meta, dexIndex) => {
    const dex = registry[dexIndex]?.name ?? '';
    const token = tokenMap.get(meta.collateralToken);
    const collateral: HyperliquidCollateralIdentity | null = token ? { tokenIndex: token.index, tokenId: token.tokenId, name: token.name,
      fullName: token.fullName ?? null, szDecimals: token.szDecimals, weiDecimals: token.weiDecimals, isCanonical: token.isCanonical,
      linkedEvmContract: token.evmContract ? { address: token.evmContract.address, evmExtraWeiDecimals: token.evmContract.evm_extra_wei_decimals } : null } : null;
    const compatibility = !token ? 'unresolved' : meta.collateralToken === 0 && token.name === 'USDC' && token.isCanonical ? 'usdc' : 'other';
    meta.universe.forEach((asset, localAssetIndex) => {
      if ((dex && (!asset.name.startsWith(`${dex}:`) || asset.name.length <= dex.length + 1))
          || (!dex && asset.name.includes(':'))) throw new Error('HYPERLIQUID_DEX_PREFIX_MISMATCH');
      const assetIndex = dexIndex === 0 ? localAssetIndex : 100000 + dexIndex * 10000 + localAssetIndex;
      if (names.has(asset.name) || ids.has(assetIndex)) throw new Error('HYPERLIQUID_MARKET_ID_COLLISION');
      names.add(asset.name); ids.add(assetIndex);
      const annotation = annotationStatus === 'available' ? annotationMap.get(asset.name) : undefined;
      markets.push({ assetIndex, globalAssetIndex: assetIndex, localAssetIndex, dex, dexIndex, name: asset.name,
        szDecimals: asset.szDecimals, maxLeverage: asset.maxLeverage, isDelisted: asset.isDelisted ?? false,
        onlyIsolated: asset.onlyIsolated ?? false, marginMode: asset.marginMode ?? null,
        collateralToken: meta.collateralToken, collateral, collateralCompatibility: compatibility,
        sourceCategory: annotation?.category || null, displayName: annotation?.displayName ?? null,
        markPrice: null, oraclePrice: null, midPrice: null, previousDayPrice: null, fundingRate: null,
        openInterest: null, dayNotionalVolume: null, dayBaseVolume: null, premium: null,
        metricsStatus: 'metadata_only', executable: false });
    });
    return { dex, dexIndex, collateralToken: meta.collateralToken, marketCount: meta.universe.length, activeCount: meta.universe.filter((asset) => !asset.isDelisted).length };
  });
  return { markets, dexes, registryNames, annotationStatus };
}

/** Only selected DEX context reads populate prices. Exact catalog identities and
 * collateral must still match; callers must refresh a changed catalog. */
export function priceHyperliquidCatalogDex(value: unknown, dex: string, catalog: HyperliquidCatalogData): HyperliquidCatalogMarket[] {
  const tuple = z.tuple([metaSchema, ctxSchema]).parse(value);
  const [meta, contexts] = tuple;
  const venue = catalog.dexes.find((entry) => entry.dex === dex);
  if (!venue) throw new Error('HYPERLIQUID_UNKNOWN_CATALOG_DEX');
  const expected = catalog.markets.filter((entry) => entry.dex === dex);
  if (meta.collateralToken !== venue.collateralToken || meta.universe.length !== expected.length || contexts.length !== expected.length)
    throw new Error('HYPERLIQUID_CATALOG_CHANGED_REFRESH_REQUIRED');
  return expected.map((market, index) => {
    const asset = meta.universe[index]!, ctx = contexts[index]!;
    if (asset.name !== market.name || asset.szDecimals !== market.szDecimals || asset.maxLeverage !== market.maxLeverage
        || (asset.isDelisted ?? false) !== market.isDelisted || (asset.onlyIsolated ?? false) !== market.onlyIsolated
        || (asset.marginMode ?? null) !== market.marginMode) throw new Error('HYPERLIQUID_CATALOG_CHANGED_REFRESH_REQUIRED');
    return { ...market, markPrice: ctx.markPx, oraclePrice: ctx.oraclePx, midPrice: ctx.midPx ?? null,
      previousDayPrice: ctx.prevDayPx, fundingRate: ctx.funding, openInterest: ctx.openInterest,
      dayNotionalVolume: ctx.dayNtlVlm, dayBaseVolume: ctx.dayBaseVlm ?? null, premium: ctx.premium ?? null,
      metricsStatus: 'source_context' as const };
  });
}
