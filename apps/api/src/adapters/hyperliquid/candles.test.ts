import { describe, expect, it, vi } from 'vitest';
import { HyperliquidTestnetReader, HYPEREVM_TESTNET_RPC } from './reader.js';
import { parseHyperliquidCandles, validateCandleRequest } from './candles.js';
const now = Date.parse('2026-11-12T04:00:00Z');
const start = now - 3_600_000;
const request = () => validateCandleRequest('BTC', '1h', start, now, now);
const candle = { t: start, T: now - 1, s: 'BTC', i: '1h', o: '9007199254740993.000001', h: '9007199254740993.000002', l: '9007199254740993.000000', c: '9007199254740993.000002', v: '0.0000001', n: 2 };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

describe('source Hyperliquid candleSnapshot history', () => {
  it('pins readonly request and preserves OHLCV values without floating-point conversion', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) => url === HYPEREVM_TESTNET_RPC ? json({ jsonrpc: '2.0', id: 1, result: '0x3e6' }) : json([candle]));
    const result = await new HyperliquidTestnetReader(fetcher, () => now).readCandles('BTC', '1h', start, now);
    expect(result.candles[0]).toMatchObject({ open: candle.o, close: candle.c, volume: candle.v, openTime: start });
    expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string)).toEqual({ type: 'candleSnapshot', req: { coin: 'BTC', interval: '1h', startTime: start, endTime: now } });
    expect(result.executable).toBe(false);
  });
  it('rejects unsupported intervals, symbols and windows before network access', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new HyperliquidTestnetReader(fetcher, () => now).readCandles('BTC', '5s' as '1h', start, now)).rejects.toThrow('INVALID_CANDLE_REQUEST');
    expect(() => validateCandleRequest('https://other.host', '1h', start, now, now)).toThrow();
    for (const [a, b] of [[now, start], [0, now], [start, now + 31_000], [start - 5000 * 60_000, now]])
      expect(() => validateCandleRequest('BTC', '1m', a!, b!, now)).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects symbol, interval, duplicate ordering and out-of-window substitutions', () => {
    for (const patch of [{ s: 'ETH' }, { i: '1d' }, { t: now + 1 }, { T: start - 1 }])
      expect(() => parseHyperliquidCandles([{ ...candle, ...patch }], request())).toThrow();
    expect(() => parseHyperliquidCandles([candle, candle], request())).toThrow();
  });
  it('rejects high/low inversion and out-of-range prices with exact integer math', () => {
    expect(() => parseHyperliquidCandles([{ ...candle, o: '9007199254740993.000003' }], request())).toThrow('INVALID_CANDLE_PRICES');
    expect(() => parseHyperliquidCandles([{ ...candle, h: candle.l, l: candle.h }], request())).toThrow('INVALID_CANDLE_PRICES');
  });
  it('bounds response rows and rejects invalid numeric quantities', () => {
    expect(() => parseHyperliquidCandles(Array(5001).fill(candle), request())).toThrow();
    expect(() => parseHyperliquidCandles([{ ...candle, o: 10 }], request())).toThrow();
    expect(() => parseHyperliquidCandles([{ ...candle, n: 0.5 }], request())).toThrow();
  });
  it('permits an empty source history without synthesizing candles', () => {
    expect(parseHyperliquidCandles([], request())).toEqual([]);
  });
});
