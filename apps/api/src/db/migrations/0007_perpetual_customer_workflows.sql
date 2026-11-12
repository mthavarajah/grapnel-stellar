CREATE TABLE perpetual_accounts (
 id uuid PRIMARY KEY, business_id uuid NOT NULL, customer_id uuid NOT NULL, wallet_id uuid NOT NULL,
 stellar_address text NOT NULL, account_address text NOT NULL CHECK(account_address ~ '^0x[0-9a-f]{40}$'),
 signing_key_ref text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(business_id,customer_id,wallet_id) REFERENCES wallets(business_id,customer_id,id),
 UNIQUE(account_address), UNIQUE(business_id,customer_id,wallet_id), UNIQUE(business_id,customer_id,wallet_id,id)
);
CREATE TABLE perpetual_challenges (
 id uuid PRIMARY KEY, business_id uuid NOT NULL, customer_id uuid NOT NULL, wallet_id uuid NOT NULL,
 stellar_address text NOT NULL, account_address text NOT NULL CHECK(account_address ~ '^0x[0-9a-f]{40}$'),
 message text NOT NULL, digest text NOT NULL, expires_at timestamptz NOT NULL, consumed_at timestamptz,
 FOREIGN KEY(business_id,customer_id,wallet_id) REFERENCES wallets(business_id,customer_id,id)
);
CREATE TABLE perpetual_orders (
 id uuid PRIMARY KEY, business_id uuid NOT NULL, customer_id uuid NOT NULL, wallet_id uuid NOT NULL,
 stellar_address text NOT NULL, account_id uuid NOT NULL, idempotency_key text NOT NULL, request_hash text NOT NULL,
 intent jsonb NOT NULL, approval_message text NOT NULL, approval_digest text NOT NULL,
 unsigned_action jsonb, signed_action jsonb, payload_hash text, intent_hash text,
 account_address text NOT NULL CHECK(account_address ~ '^0x[0-9a-f]{40}$'), nonce bigint NOT NULL, client_order_id text NOT NULL,
 reserved_at timestamptz, send_claimed_at timestamptz,
 state text NOT NULL CHECK(state IN ('preparing','awaiting_approval','approved','sending','unknown','filled','cancelled','rejected','no_fill','expired')),
 result jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(business_id,customer_id,wallet_id,account_id) REFERENCES perpetual_accounts(business_id,customer_id,wallet_id,id),
 UNIQUE(business_id,customer_id,wallet_id,idempotency_key), UNIQUE(account_address,nonce), UNIQUE(account_address,client_order_id)
);
