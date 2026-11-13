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
| `GET` | `/v1/dashboard/customers/:id/balances` | admin session | Tenant-scoped live wallet balances, active reservations and spendable amounts; independent of protocol positions |
| `POST` | `/v1/capital/wallets/:id/usdc-trustline` | business key + verified customer | Prepare the exact issuer-pinned Testnet USDC trustline with limit1000; requires customer signature, additional0.5XLM reserve and100stroops fee. Summary amount denotes trust limit, not a transfer. |
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
| `GET` | `/v1/trade/markets?asset_class=crypto_spot|stocks|perps` | matching module | per market provider, asset IDs, executable boolean, reason |
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

### Borrow full repayment

`GET /v1/capital/lending/borrowing` includes optional `repay_all_amount` and `can_prepare_repay_all` per asset. The UI uses the exact fresh maximum string, never the rounded debt display. `POST /v1/capital/lending/repay` keeps its existing body; `amount` is the approved maximum transfer, bounded by current debt plus0.1% and2atomic units and by confirmed spendable funds. XLM Max additionally allows for the1XLM fee ceiling. Actual excess must be refunded and proved in transaction metadata. Debt and collateral stay in the separately pinned borrowing pool; existing Earn collateral is not moved.


## Hyperliquid Testnet market discovery extension — November12

`GET /v1/trade/markets?asset_class=perps` returns all active source catalog identities; `asset_class=stocks` returns source-classified equity/index aliases. These are perpetual futures, not ownership of shares. Global market IDs are `hyperliquid-testnet:perps:<index>` and `hyperliquid-testnet:stocks:<index>`; the corresponding live entitlement is checked on every catalog/detail/history call.

`GET /v1/trade/markets/:id` loads only the selected venue's fresh source context and preserves its exact collateral and price units. Catalog-only rows can have null prices. `GET /v1/trade/markets/:id/history?range=live|1d|1w|1m|1y|all` uses exact qualified source symbols and range-specific source candles. No history is invented for an empty source response. Stock aliases cannot resolve a crypto instrument. Provider metadata does not establish customer balances, account eligibility or live execution.

Crypto history may expose `price_basis: underlying_reference`, `reference_symbol`, `related_asset_id`, `source_url`, and the actual quote unit for a first-party reference price series. This series describes the underlying reference; it is not the Soroswap execution quote or the token balance valuation. Unsupported reference identities retain observed Testnet pool history without fabricated backfill.

## Customer CCTP funding freeze v1 (November12)

All paths below require the business `trade.perps` and `capital.wallets` entitlements plus the verified customer session. Browser BFF injects `customer_id` and `wallet_id`; they are never browser-selected ownership. Every POST requires `Idempotency-Key`. No standalone bridge module exists.

- `GET /v1/trade/perpetuals/funding?customer_id=...&wallet_id=...&funding_id=...`: reconcile an existing scoped request, or the pending request when ID is omitted; never signs or sends.
- `POST .../funding/prepare`: `{customer_id,wallet_id,amount}`; returns exact prepared Stellar burn and a one-use `source_customer_action_token` only after prerequisites pass.
- `POST .../funding/source-review`: `{customer_id,wallet_id,funding_id}`; explicitly refreshes the token for the same still-unsigned, unexpired source approval.
- `POST .../funding/source-authorize`: `{customer_id,wallet_id,funding_id,customer_action_token,signed_xdr}`; records the exact customer signature/hash before the existing operations worker can send once.
- `POST .../funding/stage-prepare`: `{customer_id,wallet_id,funding_id,step}`; step is `cctp.receive`, `core.approve` or `core.deposit`, gated by actual predecessor proof.
- `POST .../funding/stage-authorize`: `{customer_id,wallet_id,funding_id,stage_id,step,signed_transaction}`; persists exact customer-signed chain998 EIP1559 bytes/hash before a one-use send claim.

Responses follow `modules/perpetuals/cctp-contract.ts` and include exact scope, amounts, source hash, stage and immutable evidence. `completed` requires actual matched HyperCore cash credit. A Stellar burn, Iris attestation or HyperEVM mint alone never completes funding. Current source burns are unavailable because no authoritative Testnet receiving-capacity reader has been verified. No source transfer proof has been claimed.

`GET /v1/trade/stocks/funding?customer_id=...&wallet_id=...&account_address=...` returns official Paxos USDG/Robinhood gas faucet metadata and exact USDG/ETH balances for a currently verified customer-owned Privy EVM wallet. Unknown balances are null. A browser cannot select another user’s address. This is separate Testnet faucet funding, not CCTP bridging to Robinhood.

## v0.4.2 — capability loading

`GET /v1/capabilities` keeps its full default response. Optional `module=<frozen module ID>` selects one provider and `readiness=omit` reads only live tenant entitlements without provider probes. Omitted-readiness rows explicitly use `discovery_only`, `READINESS_NOT_REQUESTED` and empty actions; they cannot establish financial execution permission. Existing/revoked keys and current enabled-module records are checked on every request. Full readiness failures are isolated to the affected module instead of failing the complete catalog.

### Perpetual activity — additive GMX customer contract v3

`GET /v1/trade/gmx/activity?customer_id=<uuid>&wallet_id=<uuid>` requires current business `trade.perps` and `capital.wallets`, verified customer identity and current EVM wallet ownership. Response is `{scope:{business_id,customer_id,wallet_id},items:[{id,kind,state,symbol,side,size_usd,amount,collateral,tx_hash,created_at}]}`. Kinds are `mint|approve|open|close|gas`; side is `long|short|null`; token amounts and USD notional are decimal strings or null. Actual completed open/close events link to the keeper transaction; accepted order creation does not establish a fill. All records are tenant/customer/wallet/account scoped. The fintech BFF injects identity at `gmx-activity` and never exposes the business key.

Version0.4.3 publishes the existing GMX status/request/prepare/authorize/gas surfaces and the new activity read in OpenAPI, with the six exact market IDs, customer identity header, idempotency headers and conditional preparation bodies. This is an additive lead-approved extension; existing module identifiers and Stellar/Stocks contracts remain unchanged.

## Version 0.4.4 — Zenex XLM provider replacement

Active Perpetuals catalog is `zenex-testnet:perps:XLM`. Additive status/prepare/fund routes reuse the existing customer-bound operations/signing lifecycle; exact order fields are bound in optional `summary.perpetual`, with `display_side` for activity. No new module IDs or DB tables. See [Zenex integration](20_ZENEX_TESTNET.md).

### Additive owner Activity endpoint — November 13, 2026 (0.4.5)

`GET /v1/dashboard/activity` uses the existing owner cookie and derives the tenant from that session. It returns `activities` (up to50 submitted Stellar transactions) and nullable `next_cursor: {before, before_id}`. Pass both cursor fields to read older rows. Each item contains operation/customer identifiers, external customer reference, wallet address, action, durable status, provider, transaction hash, timestamps and nullable requested amount/asset. Only existing operations with an exact Stellar hash are listed; no unsigned requests, EVM transactions, signing payloads or secrets. This is the business's Grapnel activity, not a global network explorer or an index of external wallet transfers. Pending submission is not chain success. Existing interfaces are unchanged.
