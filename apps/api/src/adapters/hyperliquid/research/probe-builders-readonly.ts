/** Public Testnet registry/native/xyz metadata only. No financial writes. */
import { writeFile } from 'node:fs/promises';
import { HyperliquidTestnetReader } from '../reader.js';
const report = await new HyperliquidTestnetReader().readAllMarkets();
await writeFile(new URL('./testnet-builder-markets.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ receivedAt: report.source.receivedAt, registryCount: report.source.registry.names.length,
  dexes: report.source.dexes, markets: report.markets.length,
  counts: { native: report.markets.filter((market) => !market.dex).length, xyz: report.markets.filter((market) => market.dex === 'xyz').length },
  examples: report.markets.filter((market) => ['xyz:AAPL', 'xyz:TSLA', 'xyz:NVDA', 'xyz:MSFT', 'xyz:AMZN', 'xyz:GOOGL', 'xyz:META'].includes(market.name)) }, null, 2));
