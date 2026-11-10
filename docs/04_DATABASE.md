# 04 — Minimum PostgreSQL model and financial correctness

Use PostgreSQL 16+, Drizzle migrations, UUID primary keys, timestamptz, unique tenant-scoped identifiers. Avoid a separate Ledger commercial feature; retain necessary operation/reconciliation records. Implement migrations before provider agents add tables. These are **suggested schemas**, not a claim migrations already exist.

## Tables
| Table | Columns (abbreviated, but required) | Constraints |
|---|---|---|
| `businesses` | `id uuid`, `name text`, `environment text`, `created_at` | `environment='stellar-testnet'` |
| `business_users` | `id`, `business_id`, `auth_provider_id`, `role`, timestamps | unique `(business_id,auth_provider_id)`; only `owner` edits keys/modules |
| `business_modules` | `business_id`, `module_code`, `enabled`, `revision`, `updated_at` | primary key `(business_id,module_code)`; module code enum/lookup |
| `api_keys` | `id`, `business_id`, `prefix`, `key_hash`, `name`, `revoked_at`, `created_at`, `last_used_at` | UNIQUE key hash; raw key NEVER stored |
| `customers` | `id`, `business_id`, `external_customer_id`, `privy_user_id`, `created_at` | UNIQUE `(business_id,external_customer_id)`; scoped customer lookup |
| `wallets` | `id`, `business_id`, `customer_id`, `privy_wallet_id`, `stellar_address`, `public_key`, `status`, `created_at` | Unique active wallet per `(business_id,customer_id,network)`; enforce customer tenant via composite FK |
| `wallet_authorizations` | `id`, `business_id`, `customer_id`, `wallet_id`, `operation_id`, `intent_hash`, `token_hash`, `expires_at`, `consumed_at`, `status` | one-use auth and wallet ownership |
| `assets` | `id`, `network`, `kind`, `code`, `issuer`, `contract_id`, `decimals`, `verified`, `source_url`, `demo_only` | unique `(network,kind,code,issuer,contract_id)` with NULL handling |
| `provider_markets` | `id`, `module_code`, `provider`, `contract_id`, `asset_in_id`, `asset_out_id`, `network`, `readiness`, `reason`, `as_of` | composite verified key / no fake routes |
| `operations` | `id`, `business_id`, `customer_id`, `wallet_id`, `module_code`, `type`, `state`, `network`, `request_json`, `approved_intent_hash`, `xdr_hash`, `tx_hash`, `provider_ref`, `error_code`, `created_at`, `updated_at` | tenant/customer FKs and unique confirmed hash per network as applicable |
| `operation_attempts` | `id`, `operation_id`, `business_id`, `attempt_no`, `provider`, `tx_hash`, `response_json_redacted`, `created_at` | immutable attempts, no secrets |
| `idempotency_records` | `id`, `business_id`, `route`, `idempotency_key`, `request_hash`, `operation_id` | UNIQUE `(business_id,route,idempotency_key)` |
| `balance_reservations` | `id`, `business_id`, `customer_id`, `wallet_id`, `asset_id`, `operation_id`, `amount_atomic numeric(78,0)`, `state`, `expires_at` | avoid oversubscribed spend; only active amounts deducted |
| `testnet_funding_transfers` | `id`, `business_id`, `customer_id`, `wallet_id`, `operation_id`, `direction` (`fund`/`return`), `asset_id`, `amount_atomic`, `treasury_address`, `tx_hash`, `status`, `created_at` | composite tenant/customer/wallet FKs; operation unique; canonical asset ID; real Testnet-only chain result |
| `trade_quotes` | `id`, `business_id`, `customer_id`, `market_id`, `provider`, `exact_in_asset_id`, `amount_in_atomic numeric(78,0)`, `expected_out_atomic`, `min_out_atomic`, `expires_at`, `provider_quote_json_redacted` | customer/tenant bound |
| `orders` | `id`, `business_id`, `customer_id`, `operation_id`, `quote_id`, `market_id`, `status`, `actual_in_atomic`, `actual_out_atomic`, `tx_hash` | order is not filled until reconciled |
| `lending_positions_cache` | `id`, `business_id`, `customer_id`, `wallet_id`, `pool_contract_id`, `reserve_contract_id`, `supplied_atomic`, `debt_atomic`, `as_of`, `ledger` | cache only; chain is authoritative |
| `api_request_logs` | `id`, `business_id`, `api_key_id`, `request_id`, `method`, `path_template`, `status`, `duration_ms`, `created_at` | do not log secrets/bodies/tokens |
| `worker_jobs` | `id`, `operation_id`, `job_type`, `state`, `lease_until`, `attempts`, `next_attempt_at` | reclaim expired lease safely |

## Tenant safety
EVERY tenant-owned row has `business_id` and FK to businesses. Composite foreign keys guarantee that wallet/customer/operation share tenant, e.g. `UNIQUE (business_id,id)` on customers and FK `(business_id,customer_id) REFERENCES customers(business_id,id)`. Every business API query includes tenant where clause; consider RLS with server request transaction context. Dashboard cannot query arbitrary tenant. Integration tests must seed A and B and attempt accessing B customer with A key. Never silently accept `customer_id` from browser without verifying mapping.

## API key behavior
Generate >=32 random secret bytes with cryptographically secure RNG, format `gr_test_<random>`; store SHA-256 or HMAC-SHA-256 digest (a high-entropy generated key is suitable), prefix/last4, create/revoke dates. Display raw secret once. Lookup hash using constant-time compare where applicable. `PATCH modules` updates business_modules inside one transaction, increments revision. API middleware reads fresh effective module state on every call; no stale JWT permissions. One key can gain/lose permission without changing value.

## Atomic reservation algorithm
1. Begin DB transaction and acquire exclusive lock for `(business_id,wallet_id,asset_id)` via `SELECT ... FOR UPDATE` on a dedicated `wallet_asset_locks` row or transaction advisory lock.
2. Read a fresh authoritative chain balance snapshot (prefer fetched just before DB tx if RPC slow, then include age TTL and fail stale); obtain active reservation sum.
3. Available = confirmed spendable wallet amount - reserved amounts - network reserve/fees. Do **not** count Blend supplied capital/perp margin.
4. Reject if amount exceeds available; insert reservation and operation atomically with idempotency binding.
5. Mark `submitted` after broadcast; reconciliation releases reservation once finalized. On uncertain submission, keep reservation and check tx hash/network before retry; never generate a replacement blindly.

## Amount type and asset identity
Input JSON strings, DB atomic NUMERIC(78,0) for broad precision (or bigint when within 64-bit). Conversion with exact decimal library/BigInt; `numeric(38,18)` NOT safe for arbitrary Stellar token precision calculations if rounded. Stellar classic assets typically 7 decimals; Soroban tokens supply their own configured decimals. Friendbot XLM and any Blend Testnet token are different assets; even two Testnet tokens named `USDC` may be unrelated. No SQL `float` for holdings or rates in execution. Rate display can use floating-point for UI display if clearly non-authoritative, but base-unit math must be exact.

## Durable worker / retry
Claim jobs using `FOR UPDATE SKIP LOCKED`, lease with owner and expiry, set `in_progress`, poll Stellar RPC by stored tx hash. If hash absent after ambiguous submission, reconcile using operation signatures and ledgers before retrying. Provider timeouts -> `recovery_required` if uncertain. Use exponential backoff with jitter and cap. Preserve `operation_attempts` with sanitized errors. Long-lived pages poll operations; no webhook platform required for demo.

## Testnet funding constraints
`testnet_funding_transfers` holds **only real treasury grants and customer returns**, never fictitious fiat sessions. Record treasury inventory as a live chain-derived snapshot, not a credit balance in SQL. A `fund` needs durable per-tenant/customer grant quotas and a global funding switch. Acquire a separate lock over the treasury account+asset before reading available inventory/reservations; two tenants cannot simultaneously oversubscribe the same treasury. Treasury outgoing signer is server-only. `return` needs an actual customer wallet approval and the existing wallet-asset reservation algorithm. Never treat `fund` as authorization to debit customer assets.

## Seed data
Create `Demo Fintech` tenant through dashboard flow, optional fixture user and modules. Seed `capital.testnet_funding` in module catalog, not fiat on/off-ramps. Do NOT seed balances or fabricated completed operations. `assets` may contain official testnet identifiers from trusted docs but must be revalidated through RPC and issuer; source URL + verified_at. `provider_markets` entries not verified must be `discovery_only` or `blocked`.

## Schema verification tests
- Duplicate business external customer ID is idempotent, never creates a second wallet unexpectedly.
- Same key + same body financial POST returns existing operation; different body => 409.
- Two simultaneous spend requests cannot both reserve full wallet balance.
- Business A cannot resolve B's wallet, quote, operation or lending position.
- Balance cache stale => no spend.
- Repeat `fund` across two tenants cannot oversubscribe treasury; per-customer quota and rate limits apply; duplicate funding operation broadcasts at most once.
- Return requires real customer signature, always pays verified configured treasury recipient and preserves XLM reserve.
- No `fiat_sessions` table or bank/card provider state is created for this demo.
- No successful operation without real Testnet confirmation.
