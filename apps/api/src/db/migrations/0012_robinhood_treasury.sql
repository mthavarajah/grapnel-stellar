CREATE TABLE robinhood_funding_grants (
 id uuid PRIMARY KEY,business_id uuid NOT NULL,customer_id uuid NOT NULL,wallet_id uuid NOT NULL,account_address text NOT NULL UNIQUE CHECK(account_address ~ '^0x[0-9a-f]{40}$'),idempotency_key text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(business_id,customer_id,wallet_id) REFERENCES wallets(business_id,customer_id,id),
 UNIQUE(business_id,customer_id,wallet_id,idempotency_key)
);
CREATE TABLE robinhood_funding_stages (
 grant_id uuid NOT NULL REFERENCES robinhood_funding_grants(id),kind text NOT NULL CHECK(kind IN('gas','usdg')),treasury_address text NOT NULL,nonce bigint NOT NULL,
 transaction jsonb NOT NULL,signed_transaction text NOT NULL,tx_hash text NOT NULL UNIQUE,state text NOT NULL CHECK(state IN('prepared','sending','unknown','completed','reverted')),send_claimed_at timestamptz,proof jsonb,
 PRIMARY KEY(grant_id,kind),UNIQUE(treasury_address,nonce)
);
