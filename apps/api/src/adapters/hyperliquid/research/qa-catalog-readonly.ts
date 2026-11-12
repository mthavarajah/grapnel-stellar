/** Independent public-data QA. Never queries customers or signs/sends exchange actions. */
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { HyperliquidTestnetReader, HYPERLIQUID_TESTNET_INFO } from '../reader.js';
import { perpetualMarketRows, stockPerpetualRows } from '../../../modules/perpetuals/market-data.js';

const reader = new HyperliquidTestnetReader();
const startedAt = new Date().toISOString();
const catalog = await reader.readCatalog();
const raw = await Promise.all(['perpDexs', 'allPerpMetas', 'spotMeta'].map(async (type) => {
  const response = await fetch(HYPERLIQUID_TESTNET_INFO, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type }), redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`QA_SOURCE_HTTP_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 2 * 1024 * 1024) throw new Error('QA_SOURCE_TOO_LARGE');
  return { type, sha256: createHash('sha256').update(bytes).digest('hex'), observedAt: new Date().toISOString(),
    body: JSON.parse(bytes.toString('utf8')) as unknown };
}));
const registry = raw[0]!.body as ({ name: string } | null)[];
const metas = raw[1]!.body as { collateralToken: number; universe: { name: string; isDelisted?: boolean; szDecimals: number; maxLeverage: number }[] }[];
const mismatches: string[] = [];
const directTokens = new Map(((raw[2]!.body as { tokens: { index: number; tokenId: string; name: string; weiDecimals: number; szDecimals: number; isCanonical: boolean }[] }).tokens).map((token) => [token.index, token]));
for (const market of catalog.markets) {
  const token = directTokens.get(market.collateralToken);
  if (token && (!market.collateral || market.collateral.tokenIndex !== token.index || market.collateral.tokenId !== token.tokenId
      || market.collateral.name !== token.name || market.collateral.weiDecimals !== token.weiDecimals
      || market.collateral.szDecimals !== token.szDecimals || market.collateral.isCanonical !== token.isCanonical)) mismatches.push(`COLLATERAL:${market.assetIndex}`);
}
if (registry.length !== catalog.dexes.length || metas.length !== catalog.dexes.length) mismatches.push('REGISTRY_COUNT_CHANGED');
const byId = new Map(catalog.markets.map((market) => [market.assetIndex, market]));
metas.forEach((meta, dexIndex) => meta.universe.forEach((source, local) => {
  const id = dexIndex === 0 ? local : 100000 + dexIndex * 10000 + local;
  const actual = byId.get(id);
  if (!actual || actual.name !== source.name || actual.dex !== (registry[dexIndex]?.name ?? '')
      || actual.collateralToken !== meta.collateralToken || actual.szDecimals !== source.szDecimals
      || actual.maxLeverage !== source.maxLeverage || actual.isDelisted !== (source.isDelisted ?? false)) mismatches.push(`IDENTITY_OR_METADATA:${id}`);
}));
const rows = perpetualMarketRows(catalog.markets, catalog.source.receivedAt);
const aliases = stockPerpetualRows(rows);
const active = catalog.markets.filter((market) => !market.isDelisted);
const categories = Object.fromEntries([...new Set(active.map((market) => market.sourceCategory ?? '(unannotated)'))]
  .map((category) => [category, active.filter((market) => (market.sourceCategory ?? '(unannotated)') === category).length]));
const rowCategories = Object.fromEntries([...new Set(rows.map((row) => row.asset_category))].map((category) => [category, rows.filter((row) => row.asset_category === category).length]));
const stockSourceCategories = new Set(['stocks', 'stock', 'equity', 'equities', 'indices', 'index']);
const expectedStockNames = active.filter((market) => stockSourceCategories.has(market.sourceCategory?.toLowerCase() ?? '')).map((market) => market.name);
const actualAliasNames = new Set(aliases.map((row) => row.provider_symbol));
const sourceStockAliasesMissing = expectedStockNames.filter((name) => !actualAliasNames.has(name));
const unsafeAliases = aliases.filter((row) => row.instrument_type !== 'perpetual_futures' || row.asset_class !== 'stocks'
  || row.module !== 'trade.stocks' || row.executable || !['equity', 'index'].includes(row.asset_category));
const duplicateIds = new Set(catalog.markets.map((market) => market.assetIndex)).size !== catalog.markets.length;
const inventedCatalogMetrics = catalog.markets.filter((market) => market.metricsStatus !== 'metadata_only' || market.markPrice !== null || market.fundingRate !== null).map((market) => market.name);
const activeCollateral = [...new Map(active.map((market) => [market.collateralToken, market.collateral])).entries()].map(([index, identity]) => ({ tokenIndex: index, identity,
  activeCount: active.filter((market) => market.collateralToken === index).length,
  compatibility: [...new Set(active.filter((market) => market.collateralToken === index).map((market) => market.collateralCompatibility))] }));
const selections = await Promise.allSettled(['', 'xyz', 'eqde', 'flx', 'pas'].filter((dex) => catalog.dexes.some((venue) => venue.dex === dex && venue.marketCount > 0))
  .map(async (dex) => {
    const result = await reader.readDexMarkets(dex);
    const rows = result.markets.filter((market) => !market.isDelisted);
    return { dex, source: result.source, total: result.markets.length, active: rows.length,
      missingMidpoint: rows.filter((market) => market.midPrice === null).length,
      zeroVolume: rows.filter((market) => /^0(?:\.0+)?$/.test(market.dayNotionalVolume ?? '')).length,
      collateralCompatibility: [...new Set(rows.map((market) => market.collateralCompatibility))],
      examples: rows.filter((market) => ['BTC', 'xyz:AAPL', 'xyz:CL', 'xyz:JPY', 'eqde:SAP', 'flx:TSLA'].includes(market.name)).slice(0, 6),
      executable: result.executable };
  }));
const report = { startedAt, completedAt: new Date().toISOString(), mode: 'independent_read_only_catalog_qa', source: catalog.source,
  directSourceFingerprints: raw.map(({ body: _body, ...provenance }) => provenance),
  counts: { dexes: catalog.dexes.length, total: catalog.markets.length, active: active.length, directTotal: metas.reduce((sum, meta) => sum + meta.universe.length, 0),
    directActive: metas.reduce((sum, meta) => sum + meta.universe.filter((market) => !market.isDelisted).length, 0), stockAliases: aliases.length },
  categories, mappedCategories: rowCategories, activeCollateral, mismatches, duplicateIds, inventedCatalogMetrics,
  sourceStockAliasesMissing,
  unaliasedPreipoMarkets: active.filter((market) => market.sourceCategory?.toLowerCase() === 'preipo' && !actualAliasNames.has(market.name)).map((market) => ({ name: market.name, assetIndex: market.assetIndex })),
  aliasesUsingReviewedFallback: aliases.filter((row) => !stockSourceCategories.has(row.source_category?.toLowerCase() ?? '')).map((row) => ({ name: row.provider_symbol, sourceCategory: row.source_category, mappedCategory: row.asset_category })),
  unsafeAliasNames: unsafeAliases.map((row) => row.provider_symbol),
  stockAliases: aliases.map((row) => ({ marketId: row.market_id, providerSymbol: row.provider_symbol, dex: row.provider_dex,
    sourceCategory: row.source_category, mappedCategory: row.asset_category, instrumentType: row.instrument_type,
    collateral: row.settlement_asset, price: row.reference_price, executable: row.executable, reason: row.reason })),
  selections: selections.map((result) => result.status === 'fulfilled' ? { status: result.status, ...result.value }
    : { status: result.status, error: result.reason instanceof Error ? result.reason.message : 'SOURCE_READ_FAILED' }),
  financialWritesPerformed: false, customerAccountReadsPerformed: false, mainnetRequestsPerformed: false,
  txHash: null, executionVerified: false };
await writeFile(new URL('./catalog-independent-qa.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ counts: report.counts, categories, mappedCategories: rowCategories, mismatches, duplicateIds,
  sourceStockAliasesMissing, unsafeAliases: report.unsafeAliasNames,
  selections: report.selections.map((result) => 'dex' in result ? { dex: result.dex, status: result.status, active: result.active, missingMidpoint: result.missingMidpoint, zeroVolume: result.zeroVolume } : result) }, null, 2));
