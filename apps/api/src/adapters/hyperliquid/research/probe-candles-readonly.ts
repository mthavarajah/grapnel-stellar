/** Public Testnet candle history only; no account or exchange requests. */
import { writeFile } from 'node:fs/promises';
import { HyperliquidTestnetReader } from '../reader.js';

const endTime = Date.now();
const report = await new HyperliquidTestnetReader().readCandles('SOL', '1h', endTime - 86_400_000, endTime);
await writeFile(new URL('./testnet-candles.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ symbol: report.symbol, interval: report.interval, count: report.candles.length, source: report.source }, null, 2));
