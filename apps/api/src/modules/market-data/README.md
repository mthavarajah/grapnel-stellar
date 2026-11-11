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
