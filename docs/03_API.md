# 03 — Grapnel REST API contract v0.1 (authoritative for agents)

**Base** `https://<deployed-api-host>/v1`, HTTPS only, JSON, Testnet only. These are **proposed Grapnel endpoints**, not provider endpoints or already deployed APIs. Maintain `/openapi.json` and an interactive `/docs` route. Never let UI agents invent alternate signatures. Standard `X-Request-ID` in every response.

## Authentication
- Dashboard admin: secure HttpOnly session cookie, CSRF protection for state-changing admin endpoints. Admin-only routes `/v1/dashboard/*`; not callable with business API key.
- Business API: `Authorization: Bearer gr_test_<secret>` on `/v1/*` business routes; hash secret in DB, resolve active key and tenant. Check live `business_modules` each request. API key does not store permissions as immutable claim.
- End-user: sample fintech BFF authenticates its own session; wallet operations also require **verified Privy identity + signature**, not simply `customer_id` / key. Binding via short-lived `customer_auth_context` issued only from verified Privy token and matched to tenant/registered customer. Fintech key is never a substitute for customer's approval.
- `Idempotency-Key` on all financial POSTs, unique `(tenant_id,key,route)`; a duplicate with identical payload returns same operation, different payload -> `409 IDEMPOTENCY_CONFLICT`.

## Response envelopes
```json
{ "data": {}, "meta": { "request_id": "req_...", "network": "stellar-testnet", "as_of": "2026-11-10T00:00:00Z" } }
```
Error:
```json
{ "error": { "code": "MODULE_NOT_ENABLED", "message": "Module trade.spot is disabled", "retryable": false, "details": {} }, "meta": { "request_id": "req_..." } }
```
Do not return stack traces, credential data or provider raw secrets to business callers. `as_of` must be actual runtime value.

## Modules and admin
| Method | Path | Session/key | Request or behavior |
|---|---|---|---|
| `POST` | `/v1/dashboard/businesses` | admin session | Create tenant: `{name}` |
| `GET` | `/v1/dashboard/business` | admin session | Current tenant details |
| `GET` | `/v1/dashboard/customers` | admin session | Tenant-scoped customer IDs and linked wallet metadata; never returns signer proofs |
| `GET` | `/v1/dashboard/customers/:id/lending-positions` | admin session | Fresh onchain Blend position for that tenant customer wallet; position is protocol-held and not spendable |
| `GET` | `/v1/dashboard/modules` | admin session | catalog and enabled settings |
| `PATCH` | `/v1/dashboard/modules` | admin session | `{modules:["capital.wallets","trade.spot",...]}` atomically replace set; revision increments |
| `POST` | `/v1/dashboard/api-keys` | admin session | `{name}`; reveal full secret ONLY once |
| `GET` | `/v1/dashboard/api-keys` | admin session | last four, created, status, no secret |
| `DELETE` | `/v1/dashboard/api-keys/:id` | admin session | revoke immediately |
| `GET` | `/v1/dashboard/requests` | admin session | tenant-scoped sanitized logs |
| `GET` | `/v1/capabilities` | business key | module enabled + live provider `execution_status` + reason; no trades if disabled |

Module dependencies: wallets required for other financial writes. A business may enable `trade.stocks`, but can only see `discovery_only` until actual eligible execution exists. `GET /v1/capabilities` must combine tenant entitlements and provider readiness; do not hide unavailability.

### Module PATCH example
```json
{ "modules": ["capital.wallets", "capital.testnet_funding", "capital.lending", "trade.spot"] }
```
On successful update any existing valid key immediately gets the revised module set. The key secret is unchanged. Disabling a module prevents new operations; submitted chain transactions remain tracked. `MODULE_DEPENDENCY_MISSING` when trying to enable action without wallet infra.

## Customer and wallet
| Method | Path | Entitlement | Details |
|---|---|---|---|
| `POST` | `/v1/customers` | any active key | `{external_customer_id}` unique per tenant, idempotent mapping |
| `GET` | `/v1/customers/:id` | any active key | tenant-scoped |
| `POST` | `/v1/capital/wallets` | `capital.wallets` | `{customer_id, privy_identity_proof}`; verified customer context; returns `wallet_id, stellar_address, activation_status` |
| `GET` | `/v1/capital/wallets/:id` | `capital.wallets` | customer and G-address |
| `GET` | `/v1/capital/wallets/:id/balances` | `capital.wallets` | per-asset `asset_id`, `wallet_amount`, `reserved`, `spendable`, `as_of`, `source` |
| `GET` | `/v1/portfolio?customer_id=...` | wallet and relevant data entitlements | wallet assets + Blend positions, no fabricated USD NAV |
| `GET` | `/v1/operations/:id` | owning tenant | status, created_at, tx_hash, provider, error; optional signing request when approved identity |
| `POST` | `/v1/operations/:id/authorize` | module of operation | verified customer context + client-signed XDR/signature, strict match to prepared action; never accepts arbitrary XDR from key holder |

For actual account provision, use Privy client user wallet. Wallet authorization is a separate privileged action initiated by a verified customer session. Design `POST /v1/operations/:id/authorize` to consume a short-lived, single-use `customer_action_token` bound to Privy identity and operation; this token requires an identity verification proof and cannot be minted using the business API key alone. Include strict network, source, tx hash, expiry and approval summary checks.

## Stellar Testnet Funding (not fiat)
| Method | Path | Entitlement | Body/result |
|---|---|---|---|
| `GET` | `/v1/capital/testnet/funding-assets` | `capital.testnet_funding` | Allowlisted verified Testnet asset IDs, exact issuer/contract, treasury available amount/quotas, and compatibility with real routes |
| `POST` | `/v1/capital/testnet/fund` | `capital.testnet_funding` | `{customer_id,wallet_id,asset_id,amount}`; treasury-signed real Testnet transfer; operation 202 |
| `POST` | `/v1/capital/testnet/return` | `capital.testnet_funding` | `{customer_id,wallet_id,asset_id,amount}`; **customer-authorized** real return to fixed treasury; operation 202 |

Example request, `Idempotency-Key: fund-001`:
```json
{"customer_id":"cus_...","wallet_id":"wal_...","asset_id":"stellar-testnet:native:XLM","amount":"25.0000000"}
```
**Fund**: server validates tenant/customer/wallet, customer session binding, quota, asset allowlist, treasury inventory and trustline, then treasury signs and broadcasts. Never request a customer signature for treasury-owned outgoing funds. The operation may initially return `accepted` and completes only after confirmation and actual recipient receipt. Rate-limit repeated requests across tenants and customers.

**Return**: sender is the customer's Privy Stellar wallet; build exact `PreparedAction` bound to action, amount, asset and configured treasury destination. Return uses `/v1/operations/:id/authorize` and never accepts a caller-controlled destination. Preserve XLM minimum balance/fees and reject Blend-locked funds.

**Account activation** is part of wallet setup; Friendbot can provide XLM for new accounts but **cannot** provide USDC or replace a treasury balance. Different `USDC` issuers and Soroban token contracts are different assets. `GET /v1/capital/testnet/funding-assets` must not promise compatibility unless the actual Testnet route/pool accepts that exact asset. No fiat fields, bank/card funding, ramp sessions or payouts in the MVP.

Read `docs/06_FUNDING.md` for operation state, test and threat controls.

## Spot and market discovery
| Method | Path | Entitlement | Body/result |
|---|---|---|---|
| `GET` | `/v1/trade/markets?asset_class=crypto_spot|stocks|perps|commodities` | matching module | per market provider, asset IDs, executable boolean, reason |
| `GET` | `/v1/trade/markets/:id` | matching module | verified metadata, liquidity status |
| `POST` | `/v1/trade/quotes` | matching module | `{customer_id, market_id, exact_in:{asset_id,amount}, slippage_bps:50}`; returns quote id, immutable amount/route, expiry |
| `POST` | `/v1/trade/orders` | matching module | `{customer_id, quote_id, wallet_id}` with Idempotency-Key; creates operation awaiting signature |
| `GET` | `/v1/trade/orders/:id` | matching module | order status, actual executed amounts if completed |
| `GET` | `/v1/trade/positions?customer_id=...` | matching module | wallet token holdings + optional venue positions, separate categories |

Example `POST /v1/trade/quotes`:
```json
{ "customer_id":"cus_...", "market_id":"stellar-testnet:spot:XLM:USDC_BLEND", "exact_in":{"asset_id":"stellar-testnet:native:XLM","amount":"10.0000000"}, "slippage_bps":50 }
```
`market_id` and asset ID are **example shapes**, not guaranteed liquid markets. Real token registry must resolve identifiers. Return `409 EXECUTION_UNAVAILABLE` if no Testnet quote or route; never fabricate amountOut.

## Blend lending
| Method | Path | Entitlement | Request/result |
|---|---|---|---|
| `GET` | `/v1/capital/lending/markets` | `capital.lending` | pool IDs, reserve IDs, supply/borrow APY from live data, timestamp, availability |
| `GET` | `/v1/capital/lending/positions?customer_id=...` | `capital.lending` | customer wallet-backed pool positions, health/collateral/debt |
| `POST` | `/v1/capital/lending/supply` | `capital.lending` | `{customer_id,wallet_id,market_id,asset_id,amount}` |
| `POST` | `/v1/capital/lending/withdraw` | `capital.lending` | same shape, validate health/liquidity |
| `POST` | `/v1/capital/lending/borrow` | `capital.lending` | same shape, verify collateral/health, P1 |
| `POST` | `/v1/capital/lending/repay` | `capital.lending` | same shape, P1 |

All financial writes return **202** on acceptance, never immediate success:
```json
{ "data": { "operation_id":"op_...", "status":"awaiting_customer_authorization", "network":"stellar-testnet", "tx_hash":null }, "meta": {"request_id":"req_..."} }
```

## Code/type conventions
- Monetary input string decimal, strictly positive, known decimals per registry. Convert with exact bigint (`10^decimals`), reject more fractional digits than asset supports. Never `parseFloat` for protocol amounts.
- `STELLAR_NETWORK` is explicit Testnet only; network mismatch => `400 NETWORK_MISMATCH`.
- All provider fields normalized behind Grapnel, but provider references retained privately for reconciliation.
- HTTP 401 invalid/revoked key; 403 disabled module or unauthorized spend; 404 foreign tenant object; 409 idempotency or unavailable execution; 422 invalid asset/amount; 429 limits; 502 provider invalid; 503 provider unavailable.
- `quote_id` expires and does not guarantee execution price; re-evaluate or fail if stale.
- HTTP 202 operation requires `GET /v1/operations/:id` polling at an increasing interval.

## Required negative API tests
Invalid key (401); revoked key (401); Spot disabled (403); enable Spot with same key (success on permitted call); wallet disabled when Spot enabled (dependency error); foreign customer ID (404); customer signing denial (403); duplicate idempotent call returns original op; same key/different body 409; invalid issuer/asset 422; unsupported module execution 409; submitted tx not marked completed before chain confirmation.
