# 06 — Stellar Testnet Funding and Return (NO fiat integration)

## Decision and product boundary
The competition prototype is **Testnet-only**. We are **not implementing fiat deposits, fiat conversion, MoneyGram, Privy Funding, bank/card rails, fiat sessions, fiat payouts, or simulated fiat**. Keep the long-term product concept separate from this project. This demo exposes one selectable Capital module: `capital.testnet_funding` with **Get Testnet Funds** and **Return Testnet Funds** operations. Every successful transfer has a real onchain transaction hash. Do not use "on-ramp", "off-ramp", "cash-in", "cash-out", "bank deposit", or "USD purchase" in the customer UI.

## Providers and credentials
- **Friendbot** at `https://friendbot.stellar.org?addr=<G...>` activates eligible new Stellar Testnet accounts and supplies **XLM only**. Use its hosted API with conservative request limits and confirm account activation through Horizon. Do not assume repeated Friendbot calls replenish accounts or provide other tokens. Official: https://github.com/stellar/friendbot.
- **Grapnel Testnet treasury** is an independently provisioned and funded Stellar account. Store `DEMO_TREASURY_SECRET` in the API/worker hosting secrets **only**. It may transfer only treasury-owned, allowlisted Testnet assets, never sign on behalf of customer accounts. Cap per customer, per business and globally; rate-limit public funding requests and enforce concurrency/idempotency. Create a distinct distribution account if issuing a demonstration token.
- **Asset-specific token faucet or issuance** is optional: for an asset labeled `USDC` or Blend-specific token, obtain the **exact** onchain asset contract/issuer and legitimately funded treasury balance from a verified test faucet/issuer. Friendbot **does not mint USDC**. Do not substitute an unrelated token just because both assets say `USDC`.
- Stellar SDK, Horizon and RPC build, submit and reconcile transactions. Differentiate classic `Asset(code, issuer)` trustlines from Soroban token contracts and their `transfer` auth rules.

## Important design decision: asset allowlist and route readiness
At bootstrap, seed only real verified Testnet asset identities: native `XLM` plus any exact issued assets / Soroban tokens confirmed through RPC and a reliable distribution mechanism. Never seed a fake balance. `GET /v1/capital/testnet/funding-assets` exposes each asset's canonical `asset_id`, network, kind, issuer/contract, decimals, whether treasury currently has confirmed spendable stock, per-request max, and **provider compatibility** only after successful market/pool checks.

A funding asset for Soroswap is **not automatically** the same asset used by Blend. The Blend Testnet registry includes a Soroban mock USDC token; its current contract ID must be verified before use. If only native XLM is available, fund XLM and demonstrate Blend with the XLM reserve if supported. **Do not describe XLM as USDC**, or claim a continuous USDC-to-Blend flow without proof of token identity and path.

## Fund: treasury -> customer (no customer signing required for treasury spend)
`POST /v1/capital/testnet/fund` (business key + `capital.testnet_funding` + tenant/customer ownership verified):
```json
{"customer_id":"cus_...","wallet_id":"wal_...","asset_id":"stellar-testnet:native:XLM","amount":"25.0000000"}
```
1. Validate key, enabled modules, tenant-bound customer/wallet, verified Privy customer context, Testnet network, asset allowlist, amount precision, rate limits and cumulative customer/tenant quota. Do not allow caller-selected recipient `G...` or arbitrary issuer/contract; use stored wallet and asset registry only.
2. Require customer Stellar account already activated, including XLM reserve (Friendbot only during provisioning). Validate treasury balance, estimated fees, source sequence, asset trustline and transfer authorization if classic asset. Acquire treasury asset/account funding lock and create idempotent durable `testnet_funding_transfers` + `operations` record **before** chain submission.
3. Build Stellar payment for XLM or classic issued asset; for Soroban token transfer, create exact approved contract invocation and simulate with RPC. Only the **server's treasury-owned signer** signs outgoing treasury transfers. Never use customer's Privy key for this direction.
4. Persist transaction hash/serialized envelope and broadcast with retry-safe semantics. Poll Horizon/RPC until final **success**; on timeout recover by hash rather than send another payment. Read recipient confirmed balance/contract token balance, then complete operation. A transfer may be confirmed without instantly appearing in every indexer; poll boundedly and expose `confirming` where appropriate.
5. Return original operation on duplicate `Idempotency-Key`. Reject same key/different payload. Never let repeated page clicks create extra treasury grants.

Example **202** response:
```json
{"data":{"operation_id":"op_...","type":"testnet.fund","status":"accepted","network":"stellar-testnet","asset_id":"stellar-testnet:native:XLM","tx_hash":null},"meta":{"request_id":"req_..."}}
```
Final result is read via `GET /v1/operations/:id`, with verified `tx_hash` and asset amount; no fiat status.

## Return: customer -> fixed treasury (requires customer authorization)
`POST /v1/capital/testnet/return` (same business entitlement + verified customer session):
```json
{"customer_id":"cus_...","wallet_id":"wal_...","asset_id":"stellar-testnet:native:XLM","amount":"5.0000000"}
```
1. Resolve the **fixed configured treasury recipient**, not one supplied by browser/business. Check wallet actual spendable balance after native XLM reserve/fees, active reservations and collateral/venue encumbrances; reject overdraw.
2. Persist an idempotent operation and `PreparedAction` restricted to return action, exact asset and amount, destination, fee ceiling, Testnet network passphrase, expiry and authorized wallet.
3. Fintech customer approves via Privy; Grapnel verifies signed XDR and customer binding, then submits transaction, polls actual finality and verifies recipient balance/transaction result. A business API key **alone cannot return/drain customer funds**.
4. Refund/return is a **Testnet token movement**, not an off-ramp or fiat withdrawal. Any supplied Blend position must first be withdrawn to wallet (subject to liquidity and health) before returning assets.

## Operations, failure modes, and safeguards
- One canonical operation per idempotency key. Define `accepted`, `validating`, `preparing`, `awaiting_customer_authorization` (return only), `submitted`, `confirming`, `completed`, `failed`, `recovery_required`. Fund and return use same status API; return may also be `expired` or `rejected`.
- `GET /v1/capital/testnet/funding-assets` must be accurate even if treasury depleted; return `409 INSUFFICIENT_TESTNET_TREASURY` or `409 FUNDING_ASSET_UNAVAILABLE`, not a fake successful deposit.
- `429 TESTNET_FUNDING_LIMIT` for customer/tenant quota exceeded, and `503 TESTNET_FAUCET_UNAVAILABLE` only for genuine Friendbot activation failures.
- Stellar Testnet may reset; previous accounts/tokens/pools can disappear. Reconcile current chain and reinitialize treasury/asset registry after reset, never silently relabel old hashes as current.
- Protect funding endpoint against repeat grants across business API keys, IPs and customer accounts. Use a low global cap and operational kill switch, e.g. `TESTNET_FUNDING_ENABLED=false`.
- Native XLM return must preserve minimum balance and the actual wallet fee. Classic issued assets require authorized trustline; Soroban transfers require correct auth entries. No unchecked arbitrary contract XDR signing.

## Technical acceptance
- New customer wallet activated on Testnet (verified XLM only).
- With one successful `POST /v1/capital/testnet/fund`, a separate treasury account sends exact real allowlisted test asset to intended customer, `tx_hash` and actual recipient balance verified independently.
- Same idempotency key never sends twice, including timeout + worker restart; depleted treasury or unsupported asset fails visibly.
- With `POST /v1/capital/testnet/return`, customer-signed transfer returns only unencumbered funds to fixed treasury; incorrect signature, wrong tenant or missing customer consent fails.
- Disabling `capital.testnet_funding` immediately blocks **new** fund/return writes for the existing key; submitted operations remain tracked.
- No fiat fields (`fiat_currency`, `provider:moneygram`, `widget_url`, `fiat_payout_status`) in this demo's API, database schema, docs examples or user-facing claims.

## Source documentation
- [Stellar Friendbot official repository and API](https://github.com/stellar/friendbot)
- [Stellar JS SDK](https://stellar.github.io/js-stellar-sdk/)
- [Stellar developer portal: assets, trustlines, transactions](https://developers.stellar.org/)
- [Stellar Testnet RPC and transaction SDK](https://developers.stellar.org/docs/build/guides/transactions/invoke-contract-tx-sdk)
- [Blend Testnet contract registry](https://github.com/blend-capital/blend-utils/blob/main/testnet.contracts.json)
- [Stellar Testnet explorer](https://stellar.expert/explorer/testnet)
