# 01 — Parallel agents, sequencing and integration gates

## Decision
Run **parallel workstreams after contract freeze**, then enforce **sequential integration gates**. A fully sequential strategy is too slow; undisciplined parallel edits to auth/wallet/OpenAPI will conflict. Orchestrator is the lead; it performs merges and resolves global decisions. Each subagent reads root AGENTS.md plus its role file.

## Branch / ownership table
| Role | Working branch | Primary ownership | Agent instructions |
|---|---|---|---|
| Lead/API | `feat/core-api` | `apps/api/src/modules/{auth,dashboard,customers,operations,portfolio}`, `packages/contracts`, `openapi`, migrations | `agents/01-lead-api.md` |
| Chain/Privy | `feat/stellar-wallet` | `apps/api/src/adapters/{stellar,privy}`, wallet APIs, signer client integration | `agents/02-chain-wallet.md` |
| Testnet Funding | `feat/testnet-funding` | `apps/api/src/adapters/testnet-funding`, funding asset discovery and return routes | `agents/03-funding.md` |
| Spot | `feat/spot` | `apps/api/src/adapters/soroswap`, spot routes/service | `agents/04-spot.md` |
| Blend | `feat/blend` | `apps/api/src/adapters/blend`, lending routes/service | `agents/05-blend.md` |
| Dashboard UI | `feat/dashboard-ui` | `apps/dashboard/**` | `agents/06-dashboard.md` |
| Fintech UI | `feat/fintech-ui` | `apps/fintech-demo/**` | `agents/07-fintech.md` |
| QA/Deploy | `feat/qa-deploy` | `tests/**`, `scripts/**`, deployment configs, evidence README | `agents/08-qa-deploy.md` |

**Avoid simultaneous edits** to `pnpm-lock.yaml`, schema migration order, shared response types, root package scripts, `.env.example` and deployed secrets. Lead owns these and integrates dependency updates at specified gates. For parallel branches, apply worktrees or merge through lead; do not run autonomous agents in the same directory editing the same paths.

## Gate 0: foundation contract freeze (lead)
1. Create pnpm workspace (`apps/api`, `apps/dashboard`, `apps/fintech-demo`, `packages/contracts`) and TypeScript strict config.
2. Publish Zod schemas / OpenAPI for `GET /v1/capabilities`, customers, keys, wallets, operations, spot and Blend. Base URL prefix `/v1`.
3. Create shared `Operation`, `Capability`, `AssetIdentity`, `PreparedAction`, `WalletSigner` interfaces; freeze serialized format. Publish `.env.example` without secrets.
4. Set tenant auth and customer-binding rules. Define error envelope, idempotency, BigInt conversion, asset registry identifiers.
5. Create DB migrations and seed one demo tenant only with no API secret committed.
6. Broadcast a versioned shared interface commit to each agent. **No adapter chooses its own HTTP error shape or customer identifier format.**

**Parallel Wave A / first checks**
- API: prove business key, tenant membership, module toggling and revoked key; implement request logs.
- Wallet: provision Privy Stellar wallet and sign/send a Testnet XLM transfer (proof with real tx and no private keys in UI/server DB); prove Soroban simulation/signing separately.
- Funding: verify configured Testnet treasury/account, transfer an allowlisted asset onchain, prepare customer-signed return; assert Friendbot only funds XLM and bootstrap actual token inventory.
- Spot: API-key availability, Testnet quotes/liquidity, build XDR and validate signer requirements; no fabricated fill.
- Blend: load real Testnet pool and asset contract, decide token funding method; simulate `SupplyCollateral`/`WithdrawCollateral`.
- Dashboard: functional screens against mocked API contract, then real API.
- Fintech: functional auth + server proxy, capabilities filtering, signature UX.
- QA: deployed backend health, DB, smoke runner and evidence format.

## Gate 1: real chain + auth
Passes only when (1) a live real `G...` account has a confirmed Testnet payment hash, (2) one valid key works, disabled module gives 403, (3) revoked key gives 401, (4) cross-tenant object gives 404/403, (5) customer signature cannot be forged by business key alone. If Privy Stellar signing fails, lead logs exact failure and authorizes a Freighter Testnet fallback while retaining Privy as preferred provider and listing actual demo signer honestly.

**Parallel Wave B**: hook Soroswap and Blend into `PreparedAction`/Operation service; connect frontend with actual backend and sign UX; Testnet Funding transfers verified allowed tokens; QA tests.

## Gate 2: end-to-end flows
- P0: real Testnet transfer, replay protection, verified event/activity, dashboard entitlement effect, working deployed sample fintech.
- Full-MVP Gate 2: actual Soroswap swap and Blend supply+withdraw **using the correct real token for each provider**. Funding must support the exact asset identity used by each route, or clearly show separate supported Testnet balances. Do not imply a conversion.
- If provider unavailable, mark `execution_status: blocked` and save reason; do not ship fake green success.

## Gate 3: deployment and submission
Externally browse URLs; create one-minute video from real flows, 3-minute pitch plan, trifold content, public repo, live URL and verifiable hash(es). No claim of owned contract unless deployed by this project. All identifiers saved to `evidence/testnet.json` (runtime-created by agent, initial nulls).

## Halt and escalation policy
1. A frozen interface must change: open short change request with before/after JSON, lead approves, then coordinate callers. Never silently drift.
2. Provider credential unavailable: record `PROVIDER_ACCESS_REQUIRED` for the specific affected Trade/Lending adapter; do not change Testnet Funding into fiat simulation or fake provider success. Use Friendbot XLM plus the controlled treasury for independently verifiable funding.
3. Blend/Soroswap contract missing or token incompatible: log source URL, RPC verification, asset ID, reason, and maintain reliable Testnet treasury transfer proof; don't burn time replacing protocols with novel contracts.
4. Jurisdiction gate Noether `451`/closed beta: stop execution, never use proxy/VPN bypass.
5. Testnet network reset: re-read current official contract registry and re-fund; previous tx hash may be unfindable after reset. Timestamp evidence.

## Agent handoff requirements
Use `templates/HANDOFF.md`. Each agent supplies reproducible commands and test results, actual URLs/hashes (if any), environment secrets needed **by name only**, file list, failures and next actions. Lead alone updates README claims from verified facts.
