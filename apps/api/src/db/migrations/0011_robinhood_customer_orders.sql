CREATE TABLE robinhood_customer_orders (
 id uuid PRIMARY KEY,business_id uuid NOT NULL,customer_id uuid NOT NULL,wallet_id uuid NOT NULL,stellar_address text NOT NULL,
 account_address text NOT NULL CHECK(account_address ~ '^0x[0-9a-f]{40}$'),kind text NOT NULL CHECK(kind IN('approval','swap')),
 market_id text NOT NULL CHECK(market_id IN('robinhood-testnet:stocks:TSLA','robinhood-testnet:stocks:AMZN','robinhood-testnet:stocks:PLTR','robinhood-testnet:stocks:NFLX','robinhood-testnet:stocks:AMD')),
 side text NOT NULL CHECK(side IN('buy','sell')),idempotency_key text NOT NULL,request_hash text NOT NULL,prepared jsonb NOT NULL,nonce bigint NOT NULL,
 state text NOT NULL CHECK(state IN('prepared','sending','confirming','completed','reverted','unknown','cancelled')),
 signed_transaction text,tx_hash text UNIQUE,proof jsonb,send_claimed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(business_id,customer_id,wallet_id) REFERENCES wallets(business_id,customer_id,id),
 UNIQUE(business_id,customer_id,wallet_id,idempotency_key)
);
CREATE UNIQUE INDEX robinhood_customer_nonce ON robinhood_customer_orders(account_address,nonce) WHERE signed_transaction IS NOT NULL;
CREATE UNIQUE INDEX robinhood_customer_pending ON robinhood_customer_orders(account_address) WHERE state IN('prepared','sending','confirming','unknown');
