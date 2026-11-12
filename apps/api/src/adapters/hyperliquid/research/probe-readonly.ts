/** Auth-free Testnet data only. No account lookup, signing or financial writes. */
import { writeFile } from 'node:fs/promises';
import { HyperliquidTestnetReader } from '../reader.js';

const report = await new HyperliquidTestnetReader().readMarkets();
await writeFile(new URL('./testnet-markets.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ source: report.source, marketCount: report.markets.length,
  delistedCount: report.markets.filter((market) => market.isDelisted).length,
  executionStatus: report.executionStatus, executable: report.executable, firstMarket: report.markets[0] }, null, 2));
