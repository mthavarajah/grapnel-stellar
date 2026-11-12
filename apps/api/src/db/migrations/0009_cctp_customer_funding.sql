CREATE TABLE cctp_customer_funding (
 id uuid PRIMARY KEY REFERENCES operations(id), business_id uuid NOT NULL,customer_id uuid NOT NULL,wallet_id uuid NOT NULL,
 stellar_address text NOT NULL,account_id uuid NOT NULL,account_address text NOT NULL CHECK(account_address ~ '^0x[0-9a-f]{40}$'),
 amount_atomic7 numeric(38,0) NOT NULL CHECK(amount_atomic7>0 AND amount_atomic7<=10000000000 AND mod(amount_atomic7,10)=0),
 state text NOT NULL CHECK(state IN ('awaiting_source','source_pending','attesting','destination_pending','core_pending','completed','recovery_required')),
 record jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(business_id,customer_id,wallet_id,account_id) REFERENCES perpetual_accounts(business_id,customer_id,wallet_id,id),
 UNIQUE(business_id,customer_id,wallet_id,id)
);
CREATE UNIQUE INDEX cctp_customer_funding_pending ON cctp_customer_funding(business_id,customer_id,wallet_id) WHERE state<>'completed';
CREATE TABLE cctp_customer_stages (
 id uuid PRIMARY KEY,funding_id uuid NOT NULL,business_id uuid NOT NULL,customer_id uuid NOT NULL,wallet_id uuid NOT NULL,
 account_address text NOT NULL,nonce bigint NOT NULL,step text NOT NULL CHECK(step IN ('cctp.receive','core.approve','core.deposit')),
 action jsonb NOT NULL,signed_transaction text,tx_hash text UNIQUE,
 state text NOT NULL CHECK(state IN ('prepared','signed','sending','unknown','confirmed','reverted')),
 proof jsonb,send_claimed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(business_id,customer_id,wallet_id,funding_id) REFERENCES cctp_customer_funding(business_id,customer_id,wallet_id,id),
 UNIQUE(account_address,nonce),UNIQUE(funding_id,step)
);
