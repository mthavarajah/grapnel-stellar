-- Public onchain/provider observations only; never customer-specific quotes or invented candles.
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
