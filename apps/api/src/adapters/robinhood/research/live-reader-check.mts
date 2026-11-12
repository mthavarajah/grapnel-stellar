/** Reads only. Reproduces the production reader checks and five buy/sell quotes. */
import { writeFile } from 'node:fs/promises';
import { createRobinhoodReader, STOCKS } from '../index.js';
const reader = createRobinhoodReader();
const results = [];
for (const market of STOCKS) {
 for (const side of ['buy', 'sell'] as const) {
  results.push(await reader.quoteExactInput({ symbol: market.symbol, side, amountInBaseUnits: side === 'buy' ? '1000000' : '10000000000000000', slippageBps: 50 }));
 }
}
await writeFile(new URL('./reader-live-evidence.json', import.meta.url), JSON.stringify({ capturedAt: new Date().toISOString(), transactionsSubmitted: 0, quotes: results }, null, 2)+'\n');
console.log(`${results.length} read-only quotes passed all runtime/asset/route checks`);
