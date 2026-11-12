/** Five public Testnet reads for bulk metadata; one lazy xyz context read. */
import { writeFile } from 'node:fs/promises';
import { HyperliquidTestnetReader } from '../reader.js';
const reader = new HyperliquidTestnetReader();
const catalog = await reader.readCatalog();
const selected = await reader.readDexMarkets('xyz');
const collateral = [...new Map(catalog.markets.filter((market) => market.collateral).map((market) => [market.collateralToken, market.collateral])).values()];
const report = { source: catalog.source, executionStatus: catalog.executionStatus, executable: catalog.executable,
  marketCount: catalog.markets.length, activeCount: catalog.activeCount, annotationStatus: catalog.annotationStatus,
  dexes: catalog.dexes, registryNames: catalog.registryNames, collateral,
  markets: catalog.markets.map(({ collateral: _collateral, markPrice: _mark, oraclePrice: _oracle, midPrice: _mid,
    previousDayPrice: _previous, fundingRate: _funding, openInterest: _oi, dayNotionalVolume: _notional,
    dayBaseVolume: _volume, premium: _premium, ...identity }) => ({ ...identity, price: null })),
  selectedXyzContext: selected };
await writeFile(new URL('./testnet-all-catalog.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ markets: catalog.markets.length, active: catalog.activeCount, dexes: catalog.dexes.length,
  collateralCount: collateral.length, annotationStatus: catalog.annotationStatus, selectedXyz: selected.markets.length,
  source: catalog.source, collateral }, null, 2));
