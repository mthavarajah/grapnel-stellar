# Public market price history

`new MarketDataService(pool, readPrice, {now?})` exposes `observe(marketId)` and `history(marketId, range)`. History refreshes through the supplied real provider callback before querying stored observations. The caller must authenticate the business, enforce market entitlement, and validate the registered market/provider source; this module never signs, trades, reads user balances, or claims a price is executable.

`readPrice` returns `{market_id,price,quote_symbol,observed_at,source}`. Prices are positive decimal strings with at most 60 integer and 18 fractional digits, matching NUMERIC(78,18). Observation times are real UTC timestamps; timestamps more than five seconds ahead are rejected. Units and canonical source are immutable for each market. Changing either requires a distinct market identifier. Missing/failed provider data throws; it is never zero-filled.

Root-owned migration requirements:

```sql
CREATE TABLE market_price_observations (
  market_id text NOT NULL CHECK (length(market_id) BETWEEN 1 AND 200),
  observed_bucket timestamptz NOT NULL,
  observed_at timestamptz NOT NULL,
  price numeric(78,18) NOT NULL CHECK (price > 0),
  quote_symbol text NOT NULL CHECK (length(quote_symbol) BETWEEN 1 AND 32),
  source text NOT NULL CHECK (length(source) BETWEEN 1 AND 512),
  PRIMARY KEY (market_id, observed_bucket)
);
CREATE INDEX market_price_observations_history
  ON market_price_observations (market_id, observed_at, observed_bucket);
```

There is no tenant or customer data in this table. All writers must use the service's per-market transaction advisory lock. Within the same 15-second bucket, the newest actual observation wins; identical timestamp/price replay is idempotent, conflicting same-timestamp values fail, and older reads cannot replace newer ones. Concurrent reads in one service instance share an in-flight provider call.

Ranges: live = previous hour; 1d = 24 hours; 1w = 7 days; 1m = 30 days; 1y = 365 days; all = all stored observations. A fixed SQL window query samples actual stored rows deterministically to at most 1000 points, retaining the first and latest points. It does not interpolate, average, extend flat lines, or fabricate missing historical intervals.

The frozen history DTO is `{market_id,quote_symbol,latest_price,as_of,points:[{timestamp,price}],change_absolute,change_percent}`. Price changes use bigint arithmetic from the actual first and latest observations. Changes stay null for fewer than two points. Percent changes are truncated to 18 fractional digits; a nonzero change below that precision yields null instead of a false zero. Empty selected ranges return no points and null latest/change fields; the quote unit still comes from a real observation.

## Separate underlying crypto reference history

`CryptoReferenceHistoryReader({resolveMarket,fetcher?,now?}).history(marketId,range)` reads actual public Binance spot candles through the fixed, credential-free `https://data-api.binance.vision` market-data endpoint. The trusted resolver must map an exact registered asset identity to `{asset_id,reference_symbol}`, where the explicit finite symbol set is XLM/BTC/ETH/XRP/USDC. A symbol printed on an arbitrary Testnet token is **not** sufficient identity or a verified wrapper relationship. The reader never accepts a caller-selected URL, performs a trade or writes provider prices into the Testnet pool observation table.

This is an additional UI reference series, not historical Stellar Testnet pool prices. Its metadata explicitly reports `price_basis:underlying_reference`, `reference_symbol`, `related_asset_id`, `source_url`, `interval`, `requested_range` and actual `coverage_start`/`coverage_end`. Its denomination is **USDT**, not an assumed USD peg. USDC/USDT prices come from actual source candles; no synthetic constant-one history is generated. The UI must label the reference basis and unit. Runtime wallet valuation and actual swap quotes must continue using their current Testnet pool/approved provider prices, never this reference reader. Unknown or failed reference mappings may retain the existing local Testnet observation chart, with that separate basis stated honestly; they must not be guessed from token symbols.

Ranges request real closed candles: live=1-minute bars over one hour, 1d=5-minute/24hours, 1w=hourly/7days, 1m=4-hour/30days, 1y=daily/365days, all=up to1000weekly bars (actual available source coverage). The current forming bar is omitted; points use actual candle **close timestamps** and exact decimal close strings. Wrong exchange symbol/base/quote/status, invalid ordering, future open times, malformed prices and stale/empty histories fail closed. Successful windows are cached15seconds live/60seconds otherwise; concurrent identical requests share a source call. Rate limits back off60seconds, other failures5seconds, without serving expired data. The cache namespace is bounded by five symbols and six ranges.

First-party endpoint and format documentation: [market-data-only URLs](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md), [kline response and intervals](https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md#klinecandlestick-data). HTTP reads were checked November11,2026 Toronto time. XLM returned59/287/167/179/364/441closed points for live/1d/1w/1m/1y/all, respectively. All-history actual coverage was June3,2018–November8,2026; one-year closes moved from0.2684 to0.1472USDT. BTC live returned73647.26USDT, and USDC live1.00106USDT, both at the actual close `2026-11-12T04:35:59.999Z`. These source reads required no credentials, signing, customer session or blockchain write. Values are timestamped observations, not permanent current prices.

Validation:18focused history tests plus13decimal tests passed; API typecheck passed. Tests cover every timeframe, exact decimals/timestamps, unknown identity, symbol mismatch, future/stale/duplicate/unordered/empty data, forming-only data, provider failure/rate limits, cache concurrency and no fixed USDC peg.


## November 13 chart correction

Active crypto reference history now requests exact XLM/USDC, BTC/USDC, ETH/USDC or XRP/USDC exchange pairs, validates `quoteAsset=USDC`, and returns `quote_symbol=USDC`. A USDC/USDC reference is refused instead of inventing an exchange pair or converting USDT at an assumed peg. Earlier USDT sample values above are historical evidence of the superseded implementation.

Each response includes closed source candles plus a separate exact-symbol `/api/v3/ticker/24hr` `lastPrice` observation at the source `closeTime`. This keeps the end of long ranges current without assigning a forming candle's value to a future close time. The ticker must be fresh and not future-dated. `current_source_url` records its provenance. A historical candle can legitimately close early at a delisting boundary; its actual close timestamp is retained and must stay within its nominal interval. Missing source intervals are left as visual gaps.

The chart uses the selected range's actual horizontal time window. Recorded-only Testnet pool/Robinhood data is not stretched into a longer implied history. Coverage labels disclose when recording began. Zenex returns its available one-year history for All; longer windows returned `upstream_unavailable` during verification, so no older points are fabricated. A fresh verified oracle observation is appended to the historical series.

Live request evidence for every range is in `evidence/market-chart-review/`: 24 direct crypto/perpetual provider reads, 30 official Robinhood recorded-history reads, and all 72 authorized business-API history reads across the 12 active Crypto pairs. Quotes in that folder are genuine Soroswap responses checked against independently simulated Testnet output; no signing or broadcast was performed for this chart/quote review.
