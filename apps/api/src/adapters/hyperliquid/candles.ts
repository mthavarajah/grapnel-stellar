import { z } from 'zod';

export const CANDLE_INTERVAL_MS = { '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000,
  '30m': 1_800_000, '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '8h': 28_800_000,
  '12h': 43_200_000, '1d': 86_400_000, '3d': 259_200_000, '1w': 604_800_000, '1M': 2_678_400_000 } as const;
export type HyperliquidCandleInterval = keyof typeof CANDLE_INTERVAL_MS;
export interface HyperliquidCandle {
  openTime: number; closeTime: number; open: string; high: string; low: string; close: string;
  volume: string; tradeCount: number;
}
const price = z.string().max(128).regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/);
const timestamp = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const rowsSchema = z.array(z.object({ t: timestamp, T: timestamp, s: z.string(), i: z.string(),
  o: price, h: price, l: price, c: price, v: price, n: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) })).max(5000);

export function validateCandleRequest(symbol: string, interval: string, startTime: number, endTime: number, now: number) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(symbol) || !Object.hasOwn(CANDLE_INTERVAL_MS, interval))
    throw new Error('HYPERLIQUID_INVALID_CANDLE_REQUEST');
  const duration = CANDLE_INTERVAL_MS[interval as HyperliquidCandleInterval];
  if (!Number.isSafeInteger(startTime) || !Number.isSafeInteger(endTime) || startTime <= 0 || endTime <= startTime
      || endTime > now + 30_000 || endTime - startTime > Math.min(duration * 5000, 10 * 366 * 86_400_000))
    throw new Error('HYPERLIQUID_INVALID_CANDLE_WINDOW');
  return { symbol, interval: interval as HyperliquidCandleInterval, startTime, endTime, duration };
}

function compare(a: string, b: string) {
  const [aWhole, aFraction = ''] = a.split('.');
  const [bWhole, bFraction = ''] = b.split('.');
  const precision = Math.max(aFraction.length, bFraction.length);
  const left = BigInt(aWhole! + aFraction.padEnd(precision, '0'));
  const right = BigInt(bWhole! + bFraction.padEnd(precision, '0'));
  return left < right ? -1 : left > right ? 1 : 0;
}

export function parseHyperliquidCandles(value: unknown, request: ReturnType<typeof validateCandleRequest>): HyperliquidCandle[] {
  let previous = -1;
  return rowsSchema.parse(value).map((row) => {
    // Include an overlapping first/last bar; an in-progress final bar's close
    // timestamp can be later than requested endTime. Never invent missing bars.
    if (row.s !== request.symbol || row.i !== request.interval || row.t <= previous || row.T < row.t
        || row.T - row.t >= request.duration || row.t > request.endTime || row.T < request.startTime
        || row.t < request.startTime - request.duration)
      throw new Error('HYPERLIQUID_CANDLE_IDENTITY_OR_TIME_MISMATCH');
    if (compare(row.l, row.h) > 0 || compare(row.o, row.l) < 0 || compare(row.o, row.h) > 0
        || compare(row.c, row.l) < 0 || compare(row.c, row.h) > 0)
      throw new Error('HYPERLIQUID_INVALID_CANDLE_PRICES');
    previous = row.t;
    return { openTime: row.t, closeTime: row.T, open: row.o, high: row.h, low: row.l, close: row.c,
      volume: row.v, tradeCount: row.n };
  });
}
