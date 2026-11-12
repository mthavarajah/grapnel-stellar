# AGENTS.md — Grapnel for Stellar Innovation Challenge

> READ THIS FIRST. This repository is a **Stellar Testnet hackathon prototype** of a reusable B2B infrastructure API. It is **not** a production financial service and **not** a consumer trading startup. Last research review: 2026-11-10.

## Mission / hard deadline
Build and deploy a functioning **Grapnel REST API**, a **Grapnel business dashboard**, and an **independent sample fintech frontend/backend** that integrates the REST API with a business API key. Prove real Stellar Testnet funding **and a real Soroswap swap and Blend supply/withdraw as the full MVP target**. No swap or lending execution may be claimed complete before chain proof. Submit public GitHub repo + README, functioning app URL and/or deployed contract IDs, and a one-minute functioning demo video by the **Devpost deadline Nov 13, 2026, 08:30 EST** (verify any changes). No invented contract IDs, transaction hashes, fictitious test-token balances, or customer balances.

## Chosen agent coordination: PARALLEL WITH SEQUENTIAL GATES
Do not implement everything serially; do not let all agents edit shared contracts independently. One integration lead owns shared design, migration and merge. Follow `docs/01_WORK_PLAN.md` and scoped instructions under `agents/`. Workflow:
- **Gate 0** (lead, immediately): freeze module IDs, API schemas, auth model, file ownership and Testnet configuration. Publish `packages/contracts` / OpenAPI and database baseline. All agents read these before coding.
- **Parallel Wave A**: Agent-API builds tenant/key/entitlement/customer/operation APIs; Agent-Chain proves Privy+Stellar signing; Agent-Dashboard builds dashboard against published API contract; Agent-Fintech builds sample fintech server/frontend against published contract; Agent-Funding builds treasury-backed Testnet funding and return; Agent-Spot researches/verifies Soroswap; Agent-Blend verifies pool and token compatibility. Tests/Deployment agent configures CI, deploy surfaces and acceptance harness concurrently.
- **Gate 1**: actual Privy-signed Stellar Testnet payment; real tenant/module/key enforcement; customer session bindings. No financial provider execution until signing gate passes.
- **Parallel Wave B**: Spot and Blend integrate the frozen signing/operations interface; funding agent transfers allowlisted Testnet tokens; UI agents connect live Grapnel. Provider agents own adapters only, do not change root contracts independently.
- **Gate 2**: confirmed treasury funding/return, Soroswap spot swap, and Blend supply/withdraw with hashes and position/balance deltas. If any provider route cannot execute, record an unresolved Gate 2 item and disclose a reduced, incomplete demo rather than marking the MVP fully passed.
- **Gate 3**: deploy URLs, smoke tests from outside localhost, public repo, screenshots, testnet hashes and submission assets.

An AI coding assistant with no multi-agent runner must execute these waves in dependency order; `AGENTS.md` does **not** automatically spawn agents.

## Required reading order
1. `README.md`
2. `docs/00_PRODUCT.md` (scope & honest product claims)
3. `docs/01_WORK_PLAN.md` (owners, gates, blockers)
4. `docs/02_ARCHITECTURE.md` and `docs/03_API.md` (authoritative interfaces)
5. `docs/04_DATABASE.md` and `docs/05_SIGNING.md`
6. Your assigned provider/frontend document and `agents/<role>.md`
7. `docs/11_TESTS_SECURITY.md`, `docs/12_DEPLOY_SUBMISSION.md`, `docs/13_SOURCES.md`

## Fixed product boundaries
**Capital selectable modules:** `capital.wallets`, `capital.testnet_funding` (real treasury-backed Testnet fund/return), `capital.lending` (Blend supply/withdraw/borrow/repay). **Trade selectable modules:** `trade.spot`, `trade.stocks`, `trade.perps`. Internal operation coordinator, reservations, portfolio reconciler and Stellar execution service are NOT separate products. No cross-chain module, extended bridge, or standalone venue-funding module for this demo. No SDK, CLI, MCP, billing, fiat on/off-ramps, MoneyGram/Privy Funding, production KYC, mainnet transfers or custom Grapnel smart contracts unless submission is otherwise impossible.

## Mandatory behavioral invariants
1. **Testnet only** for any onchain write. Explicit network passphrase `Test SDF Network ; September 2015`; fail closed on mismatched network or issuer. No mainnet secret or transaction path.
2. **API key authenticates business, NOT the end user.** Browser never sees business key. Wallet spend requires real customer authorization tied to the exact transaction and a verified customer session.
3. Toggle modules by changing tenant entitlement records. **Existing key changes effective scopes immediately**; do NOT reissue secret. Dashboard owner sessions (not API keys) can enable modules.
4. Only advertise an action as executable after it has been validated on current Testnet. Unavailable actions return structured `EXECUTION_UNAVAILABLE`; do not mint pretend stock shares or invent Noether positions.
5. Testnet Funding is **real onchain transfers only**, not fiat. Friendbot activates new accounts with XLM; a separate capped Testnet treasury transfers its *existing* allowlisted assets. `fund` is treasury-signed; `return` is customer-signed to the fixed treasury. No bank/card simulation or fiat session.
6. **Asset identity is explicit**: Friendbot XLM, classic issuer-based tokens and Blend's Soroban Testnet token are distinct; no funding-to-lending or funding-to-spot compatibility claim without verifying the exact asset and route. See `docs/06_FUNDING.md` and `docs/08_BLEND.md`.
7. No floating point for token amounts. Store decimal strings and bigint base units; read decimals from asset registry. Verify live asset IDs and contracts before transacting.
8. No signing of arbitrary provider XDR. Inspect transaction network, source, sequence, footprint/auth, invocations, contracts, recipients, values, fees and expiry against user-approved intent. Privy Stellar is **Tier 2 signing**, not managed broadcasting.
9. A `202 Accepted` is NOT onchain success. Persist durable operations; reconcile onchain before `completed`. Never blindly resend after timeout; check hash/status first.
10. Tenant isolation in every customer/wallet/order/operation lookup; negative tests for cross-tenant and disabled module access are mandatory.
11. No fake proof: evidence JSON starts `null`; only a verified transaction or deployed service fills it. No claims that a protocol's preexisting contract belongs to Grapnel.
12. Do not quietly weaken tests, bypass auth, skip simulation, or put private keys in client code. Privy + customer signer is default; Freighter fallback ONLY via lead decision after documented Privy blocker, and label the fallback.

## Agent work/merge protocol
- Keep changes within assigned owned paths in `docs/01_WORK_PLAN.md`. Shared contract edits require lead approval and a new version note.
- Make small commits with tests. Each PR/merge note: files changed, implemented calls, actual provider requests tested, acceptance evidence, unresolved blockers.
- Use explicit interface mocks for isolated UI tests but never represent mock success as testnet success. `execution_status` must be `testnet_verified`, `discovery_only`, `blocked`, or `simulation` in capabilities.
- If documentation disagrees with live response, capture sanitized request/response, update `docs/13_SOURCES.md` and raise blocker. Never guess or silently substitute an endpoint.
- Prioritize shipping working P0 over breadth of visible assets.

## Final mandatory proof
`GET /health`, tested business entitlements, issued/revoked key, one activated `G...` Testnet account, a real `tx_hash` with explorer link, a sample fintech flow through Grapnel, an accessible URL, a public code repo, and a one-minute functional screen recording. Soroswap spot execution and Blend supply/withdraw are intended Gate 2 acceptance tests; record a failure or capability reduction explicitly if they cannot be completed. Do not invent them.
