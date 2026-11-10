# 11 — Security, testing, and provider acceptance checklist

## Objective
This is a demo, not a license to fake execution or compromise users. Testnet funds aren't real, but **auth, consent and balances must be sound enough to demonstrate credible infrastructure**. No security bypass for judges.

## Highest priority threat model
1. Fintech API key leaked to browser: attacker impersonates business. Prevent with server-only secret and token hashing/revocation; secret detection in builds.
2. API key used to spend arbitrary customer's funds: prevent by verified customer session and exact customer-signed XDR or scoped authorization; never use business key as signing authority.
3. Cross-tenant object confusion: all queries use `business_id`; composite FK and negative integration tests.
4. Malicious provider XDR or altered quote: inspect exact network, source, contract calls/auth, destination, amount, min receive and fee ceilings; bind to immutable approved intent. Recompute/compare signing digest before submission.
5. Token confusion: Friendbot native XLM vs Blend mock USDC Soroban contract; `USDC` symbol alone is not an identity. Registry canonical identities, no symbol-only trades.
6. Duplicate submission: idempotency+database reservation+hash reconciliation; an ambiguous timeout must NOT trigger automatic second broadcast of new transaction.
7. Balance oversubscription: row lock per `(wallet,asset)` plus authoritative observations and active reservations. Never spend Blend collateral as wallet free balance.
8. Chain mismatch or wrong issuer: every contract/token/net must match `stellar-testnet`; fail closed.
9. Fake completion: only actual `SUCCESS` on Stellar RPC plus relevant balance/position check marks `completed`.
10. Malicious browser input: validate with Zod, rate limits, CORS and CSRF for admin. Display no PII/secret in logs, traces, or screenshots.

## Automated test matrix
| Test | Owner | Pass criteria |
|---|---|---|
| API key generation | API | Only one reveal; DB stores hash only; invalid key 401 |
| Entitlements | API/dashboard | Same key Spot denied, enabled after PATCH, denied after disable |
| Cross-tenant | API | A cannot read B customer, wallet, operation, lending position |
| Admin elevation | API | Business key cannot call dashboard/admin endpoints |
| Customer spend proof | Chain/API | Key alone or forged wallet signature cannot submit action |
| Module dependency | API | Cannot enable Spot without wallets internally |
| Idempotency | API | Same body+key returns same operation; changed body 409 |
| Double-spend | DB | Concurrent requests cannot reserve > confirmed spendable amount |
| Asset decimals | Adapters | Reject precision overflow, negative, extra decimals, wrong issuer |
| Wrong network | Chain | Mainnet signed tx/XDR rejected; Testnet fixed passphrase |
| Soroban auth | Chain/Blend | Valid customer auth entries; wrong signer rejected |
| Provider outages | Provider agents | Timeouts do not complete; deterministic error statuses
| Testnet return | Funding/Chain | Customer signature required; fixed treasury recipient, XLM reserve, no locked collateral return |
| Testnet fund (`capital.testnet_funding`) | Funding | Treasury-only outgoing signer, real tx hash, asset inventory, quotas, correct recipient, idempotent single transfer |
| Soroswap | Spot | Real Testnet quote/build/sign/submit/settle + balance delta |
| Blend | Blend | Read current pool, supply/withdraw Testnet position, risk constraints |
| Public endpoints | QA | Browser access, API /health, docs, no leaked server key |

## Live provider integration checklist
- Stellar: account funded by Friendbot, Horizon account read, Testnet hash query and explorer link work.
- Privy: actual Tier 2 Stellar sign of classic transfer and Soroban, no private key export; if unsupported, document fallback and source.
- Testnet funding: exact treasury->recipient asset delta, verified current inventory, quota, no double grant; return: customer->fixed treasury transfer only with customer signature and preserved XLM reserve.
- Soroswap: use actual TESTNET protocols and asset registry, API key, nonzero Testnet liquidity, quote, built XDR, signed execution and hash. No "success" solely from quote.
- Blend: latest testnet.contracts.json, active pool/reserve, correct XLM/USDC reserve contract and funding, actual SDK position reads, XDR, success hash, position delta.
- Confirm the API spec, DB, code and frontend contain no fiat on/off-ramp routes, MoneyGram secrets, bank payout simulation or fiat statuses.
- Noether optional: public market reads only unless closed beta key and jurisdiction rights; no forbidden trading access.

## Minimal reproducible test commands (to implement)
```
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm run smoke:testnet
```
Commands must be present in root scripts or documents updated to reflect actual available commands. Integration tests must be tagged and not accidentally broadcast transactions in default `pnpm test` mocks. Run live `smoke:testnet` with a dedicated demo wallet and secrets injected by hosting/CI, never public repo.

## Test results evidence format
Keep `evidence/testnet.json` with: version, `observed_at`, network passphrase, actual wallet address, provider, token identity, operation ID, tx hash, Testnet explorer URL, contract IDs **read from actual provider/testnet source**, source read timestamp, chain result and balance/position delta. Initial fields null. Screenshots/one-minute demo show successful hashes (not secret keys). Note Testnet resets can invalidate later explorer visibility.

## Compliance and fairness
The hackathon does not process fiat, bank payouts or real-money deposits. Stock tokens are securities-related, perps are derivatives, and DeFi lending/yield involve variable rates, liquidation and smart-contract risks. An international B2B distribution strategy does not bypass local business/regulator obligations. I'm not a lawyer. This submission is Testnet-only educational prototype, no investments or real payouts, no guaranteed returns.
