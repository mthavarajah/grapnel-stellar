# AGENT 03 — Stellar Testnet Funding and Return (NO fiat)

**Read:** root `AGENTS.md`, `docs/00_PRODUCT.md`, `docs/03_API.md`, `docs/04_DATABASE.md`, `docs/05_SIGNING.md`, `docs/06_FUNDING.md`, `docs/11_TESTS_SECURITY.md`, `docs/13_SOURCES.md`. Own `apps/api/src/adapters/testnet-funding/**` and Testnet funding service routes in coordination with Lead. Do NOT implement MoneyGram, Privy Funding, on/off-ramp routes, fiat sessions or simulated bank/card APIs. No shared-contract changes without Lead approval.

## Deliverable A: account activation and token source
1. Coordinate with Chain agent: Friendbot `https://friendbot.stellar.org?addr=<G...>` is for **new customer account activation and XLM**, not USDC. Check whether account already exists before requesting; verify Horizon account/asset state after.
2. Provision a separate Testnet treasury account with secret in server-only `DEMO_TREASURY_SECRET`; use Friendbot to acquire Testnet XLM and verify that treasury has spendable funds after network reserve/fees. Never commit secret, place in frontend, or sign customer actions using treasury signer.
3. If exact compatible Testnet USDC/mock asset is obtainable, configure verified classic `asset_code+issuer` / Soroban contract ID and seed actual treasury inventory. Do not issue or assert 'USDC' merely because a protocol uses that label. Show precise asset identity in API.

## Deliverable B: executable funding API
- `GET /v1/capital/testnet/funding-assets`: current allowlisted asset identities, confirmed treasury availability, network, fees/limits, route compatibility only if proven. No symbolic generic USDC.
- `POST /v1/capital/testnet/fund`: exact `{customer_id,wallet_id,asset_id,amount}`, business key + `capital.testnet_funding`, tenant/customer/Privy identity binding. Enforce current verified balance and per-user/tenant/global caps. DB lock treasury account+asset; idempotent operation. Treasury signs real Testnet payment/contract transfer, broadcast once, poll status, show confirmed tx and balance delta. Client can't select destination address.
- `POST /v1/capital/testnet/return`: exact same body, but **customer** must authorize prepared XDR through Privy, recipient = configured treasury only, preserve XLM reserve/fee and exclude reserved/Blend-locked funds. Reconcile customer->treasury transfer onchain.
- Operations are 202 accepted until real chain confirmation, never 'completed' just because provider request returned HTTP 200. Support timeout and worker crash recovery by previously submitted tx hash.

## Security and quotas
Rate-limit funding; persistent per-customer/per-business grants across API keys and browser sessions. Treasury grant caps and available inventory are not SQL-only balances. Reject unsupported trustline, wrong network, wrong issuer, wrong signer, insufficient asset/fee. Return must reject wallet-signature mismatch, attempts to alter treasury recipient or amount, and attempts to return locked Blend capital.

## Acceptance / handoff
- Confirmed separate treasury -> customer's real Stellar G-address transfer (hash + exact asset + independent balance read).
- Confirmed customer-signed -> treasury return hash, full Privy signing proof, fee/reserve preserved.
- Quota/insufficient funds/disabled entitlement/tenant isolation/duplicate request/timeout recovery tests.
- Handoff reports exact source of funded assets and how another agent can reproduce Testnet proof; never claims fiat settlement.
