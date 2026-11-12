CREATE TABLE gmx_customer_requests (
 id uuid PRIMARY KEY,business_id uuid NOT NULL,customer_id uuid NOT NULL,wallet_id uuid NOT NULL,stellar_address text NOT NULL,
 account_address text NOT NULL CHECK(account_address ~ '^0x[0-9a-f]{40}$'),kind text NOT NULL CHECK(kind IN('mint','approve','open','close')),
 market_id text NOT NULL CHECK(market_id IN('gmx-testnet:perps:ETH','gmx-testnet:perps:BTC')),
 idempotency_key text NOT NULL,request_hash text NOT NULL,prepared jsonb NOT NULL,nonce bigint NOT NULL,
 state text NOT NULL CHECK(state IN('prepared','sending','confirming','completed','cancelled','reverted','unknown')),
 signed_transaction text,tx_hash text UNIQUE,creation_proof jsonb,settlement jsonb,send_claimed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(business_id,customer_id,wallet_id) REFERENCES wallets(business_id,customer_id,id),
 UNIQUE(business_id,customer_id,wallet_id,idempotency_key)
);
CREATE UNIQUE INDEX gmx_customer_nonce ON gmx_customer_requests(account_address,nonce) WHERE signed_transaction IS NOT NULL;
CREATE UNIQUE INDEX gmx_customer_pending ON gmx_customer_requests(account_address) WHERE state IN('prepared','sending','confirming','unknown');
CREATE TABLE gmx_gas_grants (
 id uuid PRIMARY KEY,business_id uuid NOT NULL,customer_id uuid NOT NULL,wallet_id uuid NOT NULL,
 account_address text NOT NULL CHECK(account_address ~ '^0x[0-9a-f]{40}$'),treasury_address text NOT NULL,nonce bigint NOT NULL,
 amount_wei numeric(38,0) NOT NULL CHECK(amount_wei>0 AND amount_wei<=2000000000000000),signed_transaction text NOT NULL,tx_hash text NOT NULL UNIQUE,
 state text NOT NULL CHECK(state IN('prepared','sending','confirmed','unknown','reverted')),send_claimed_at timestamptz,proof jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(business_id,customer_id,wallet_id) REFERENCES wallets(business_id,customer_id,id),
 UNIQUE(treasury_address,nonce),UNIQUE(account_address)
);
