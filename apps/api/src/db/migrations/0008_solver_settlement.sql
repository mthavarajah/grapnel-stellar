CREATE TABLE solver_wallets (
 id uuid PRIMARY KEY, business_id uuid NOT NULL, customer_id uuid NOT NULL, identity_wallet_id uuid NOT NULL,
 freighter_address text NOT NULL, asset_id text NOT NULL, escrow_address text NOT NULL,
 master_address text NOT NULL CHECK(master_address ~ '^0x[0-9a-f]{40}$'),
 subaccount_address text CHECK(subaccount_address ~ '^0x[0-9a-f]{40}$'), provider_ownership_proof jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(business_id,customer_id,identity_wallet_id) REFERENCES wallets(business_id,customer_id,id),
 UNIQUE(business_id,customer_id,identity_wallet_id), UNIQUE(subaccount_address),
 UNIQUE(business_id,customer_id,identity_wallet_id,id)
);
CREATE TABLE solver_challenges (
 id uuid PRIMARY KEY, business_id uuid NOT NULL, customer_id uuid NOT NULL, identity_wallet_id uuid NOT NULL,
 freighter_address text NOT NULL, purpose text NOT NULL CHECK(purpose IN ('bind','order','withdraw')),
 intent_hash text NOT NULL, message text NOT NULL, nonce text NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
 origin text NOT NULL, asset_id text NOT NULL, consumed_at timestamptz, proof jsonb,
 FOREIGN KEY(business_id,customer_id,identity_wallet_id) REFERENCES wallets(business_id,customer_id,id)
);
CREATE TABLE solver_requests (
 id uuid PRIMARY KEY, business_id uuid NOT NULL, customer_id uuid NOT NULL, identity_wallet_id uuid NOT NULL,
 solver_wallet_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('deposit','order','withdraw')),
 module_code module_code NOT NULL CHECK(module_code IN ('trade.perps','trade.stocks')),
 idempotency_key text NOT NULL, request_hash text NOT NULL, intent_hash text NOT NULL,
 terms jsonb NOT NULL, state text NOT NULL CHECK(state IN ('preparing','awaiting_approval','authorized','submitted','confirming','completed','failed','recovery_required','expired')),
 challenge_id uuid REFERENCES solver_challenges(id), prepared jsonb, signed_xdr text, tx_hash text,
 stellar_send_claimed_at timestamptz, customer_proof jsonb, source_payment_proof jsonb,
 funding_proof jsonb, return_proof jsonb, payout_proof jsonb, result jsonb,
 withdrawal_reserved_atomic7 numeric(78,0), expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(business_id,customer_id,identity_wallet_id,solver_wallet_id) REFERENCES solver_wallets(business_id,customer_id,identity_wallet_id,id),
 UNIQUE(business_id,customer_id,identity_wallet_id,kind,idempotency_key),
 UNIQUE(business_id,customer_id,identity_wallet_id,id), UNIQUE(tx_hash)
);
CREATE TABLE solver_provider_actions (
 id uuid PRIMARY KEY, business_id uuid NOT NULL, customer_id uuid NOT NULL, identity_wallet_id uuid NOT NULL,
 request_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('create_subaccount','fund','order','return')),
 master_address text NOT NULL CHECK(master_address ~ '^0x[0-9a-f]{40}$'),
 subaccount_address text CHECK(subaccount_address ~ '^0x[0-9a-f]{40}$'),
 nonce bigint NOT NULL, client_order_id text, intent_hash text NOT NULL, payload jsonb,
 payload_hash text, send_claimed_at timestamptz,
 state text NOT NULL CHECK(state IN ('prepared','sending','unknown','verified','failed')), result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(business_id,customer_id,identity_wallet_id,request_id) REFERENCES solver_requests(business_id,customer_id,identity_wallet_id,id),
 UNIQUE(master_address,nonce), UNIQUE(master_address,client_order_id), UNIQUE(request_id,kind)
);
CREATE TABLE solver_credit_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, customer_id uuid NOT NULL,
 identity_wallet_id uuid NOT NULL, solver_wallet_id uuid NOT NULL, request_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('funded_deposit','verified_settlement','withdrawal','refund')),
 amount_atomic7 numeric(78,0) NOT NULL, evidence_reference text NOT NULL UNIQUE, proof jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(business_id,customer_id,identity_wallet_id,solver_wallet_id) REFERENCES solver_wallets(business_id,customer_id,identity_wallet_id,id),
 FOREIGN KEY(business_id,customer_id,identity_wallet_id,request_id) REFERENCES solver_requests(business_id,customer_id,identity_wallet_id,id)
);
