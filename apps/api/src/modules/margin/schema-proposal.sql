-- PROPOSAL ONLY. Root must review, number and install as a migration.
-- Coordinator is not registered in runtime until schema and validated provider steps are integrated.
CREATE TABLE margin_workflows (
 id uuid PRIMARY KEY, business_id uuid NOT NULL, customer_id uuid NOT NULL, wallet_id uuid NOT NULL,
 wallet_address text NOT NULL, network text NOT NULL DEFAULT 'stellar-testnet' CHECK(network='stellar-testnet'),
 creation_key text NOT NULL CHECK(length(creation_key) BETWEEN 1 AND 200),
 terms_json jsonb NOT NULL, terms_hash text NOT NULL CHECK(terms_hash ~ '^[a-f0-9]{64}$'),
 phase text NOT NULL CHECK(phase IN ('awaiting_collateral','awaiting_margin_transfer','awaiting_open_begin','opening_pending','opening_swapped','open','closing_prepared','closing_swapped','closed','awaiting_vault_withdraw','recovered')),
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 position_id text CHECK(position_id ~ '^(0|[1-9][0-9]*)$'),
 receipt_atomic text CHECK(receipt_atomic ~ '^(0|[1-9][0-9]*)$'), active_operation_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(business_id,customer_id,wallet_id) REFERENCES wallets(business_id,customer_id,id),
 FOREIGN KEY(business_id,customer_id,wallet_id,active_operation_id) REFERENCES operations(business_id,customer_id,wallet_id,id),
 UNIQUE(business_id,creation_key), UNIQUE(business_id,customer_id,wallet_id,id)
);
CREATE UNIQUE INDEX margin_workflows_one_active_wallet ON margin_workflows(business_id,wallet_id) WHERE phase<>'recovered';
CREATE TABLE margin_workflow_steps (
 business_id uuid NOT NULL, customer_id uuid NOT NULL, wallet_id uuid NOT NULL,
 workflow_id uuid NOT NULL, operation_id uuid NOT NULL UNIQUE,
 step text NOT NULL CHECK(step IN ('vault_deposit','margin_transfer','open_begin','open_swap','open_activate','open_cancel','close_prepare','close_swap','close_short_swap','close_finish','close_cancel','margin_return','vault_withdraw')),
 attempt integer NOT NULL CHECK(attempt>0), step_terms jsonb NOT NULL,
 intent_hash text NOT NULL CHECK(intent_hash ~ '^[a-f0-9]{64}$'), baseline_json jsonb NOT NULL,
 evidence_json jsonb, confirmed_at timestamptz,
 FOREIGN KEY(business_id,customer_id,wallet_id,workflow_id) REFERENCES margin_workflows(business_id,customer_id,wallet_id,id),
 FOREIGN KEY(business_id,customer_id,wallet_id,operation_id) REFERENCES operations(business_id,customer_id,wallet_id,id),
 PRIMARY KEY(business_id,workflow_id,step,attempt),
 CHECK((evidence_json IS NULL)=(confirmed_at IS NULL))
);
-- Persist frozen economics immutably, while revision/phase/receipts advance separately.
CREATE FUNCTION preserve_margin_workflow_terms() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.business_id,NEW.customer_id,NEW.wallet_id,NEW.wallet_address,NEW.network,NEW.creation_key,NEW.terms_json,NEW.terms_hash)
    IS DISTINCT FROM (OLD.business_id,OLD.customer_id,OLD.wallet_id,OLD.wallet_address,OLD.network,OLD.creation_key,OLD.terms_json,OLD.terms_hash)
 THEN RAISE EXCEPTION 'Margin workflow terms and ownership are immutable'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER margin_workflow_terms_immutable BEFORE UPDATE ON margin_workflows FOR EACH ROW EXECUTE FUNCTION preserve_margin_workflow_terms();
