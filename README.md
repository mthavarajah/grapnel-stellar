# Grapnel for Stellar — Agent Execution Pack

**Purpose:** hand these Markdown instructions to a coding-agent team starting from an empty monorepo. They are build instructions and a researched provider integration plan, **not** a claim the apps or contracts are already deployed.

**Coordination:** **parallel agents with gated integration**. See root [`AGENTS.md`](AGENTS.md), [`docs/01_WORK_PLAN.md`](docs/01_WORK_PLAN.md), then one role file in [`agents/`](agents/). If you have only one agent, run gates serially while treating workstreams as separate components.

**The business model:** companies use Grapnel's documented REST API rather than writing Soroban, Stellar, token, DEX or Blend code. A mock B2B customer uses Grapnel via a separate fintech app. Grapnel dashboard admin selects enabled modules; a server-side business key immediately inherits current entitlements. End users own/sign their wallet actions separately.

**Scope change (2026-11-10):** No fiat deposits/withdrawals, MoneyGram or Privy Funding APIs in the competition MVP. One `capital.testnet_funding` module replaces the two fiat modules. Friendbot supplies XLM only for account activation; a controlled Testnet treasury handles real supported token grants/returns.

**Deliverables to implement:**
1. Public Grapnel B2B dashboard: tenant signup/demo login, module toggles, one-time API-key display, documentation, recent request log.
2. Public Grapnel API: business keys, entitlements, customers, wallet/transaction operations, real Testnet funding and return, spot/Blend adapters, capabilities/readiness, OpenAPI.
3. Public sample fintech frontend plus server-side proxy: login, wallet, Testnet funding/return, available/locked balances, spot trade, Blend Earn and activities; only calls Grapnel for financial operations (the client may call Privy to sign).
4. Verified Stellar Testnet transfers. Full MVP target includes verified Soroswap swap and Blend supply/withdraw, with actual transaction hashes and position changes. If not executable, record the incomplete acceptance gate and explain honestly.
5. README that allows judge to reproduce, `.env.example`, public source, evidence transaction hashes/contract IDs where used, working live URL(s), one-minute demo recording, 3-minute pitch and board.

**Documentation index**

| File | Meaning |
|---|---|
| `AGENTS.md` | Global instructions, safety, multi-agent gates |
| `docs/00_PRODUCT.md` | Scope, flows, modules and priorities |
| `docs/01_WORK_PLAN.md` | Parallel agents, dependencies, tasks, branches |
| `docs/02_ARCHITECTURE.md` | Monorepo architecture, identity and service boundaries |
| `docs/03_API.md` | Versioned REST contract, payloads, errors, auth |
| `docs/04_DATABASE.md` | Postgres schema, constraints, queries, races |
| `docs/05_SIGNING.md` | Stellar + Privy Tier 2 wallet, XDR and transaction lifecycle |
| `docs/06_FUNDING.md` | Real Testnet treasury funding, customer-authorized return, asset identities |
| `docs/07_SPOT.md` | Soroswap/Aquarius/native DEX integration |
| `docs/08_BLEND.md` | Blend v2 supply, borrow, withdraw and positions |
| `docs/09_OTHER_ASSETS.md` | Stocks, commodities, Noether with reality gates |
| `docs/10_FRONTENDS.md` | B2B dashboard and fintech UI flows |
| `docs/11_TESTS_SECURITY.md` | Unit, integration, threat model, acceptance |
| `docs/12_DEPLOY_SUBMISSION.md` | Hosting, runbook, demo and evidence |
| `docs/13_SOURCES.md` | Official docs, verified claims, blockers |
| `agents/00-orchestrator.md` | Copyable multi-agent coordination and launch instructions |
| `agents/*.md` | Workstream-specific tasks and owned paths |
| `templates/HANDOFF.md` | Required agent handoff format |

**Suggested code stack**: pnpm workspace, TypeScript, Fastify, Zod, PostgreSQL + Drizzle, one polling worker, Next.js + Tailwind for both independent frontends, Stellar SDK, Privy, Soroswap SDK, Blend SDK. Deploy web apps to Vercel and API/worker/DB to Railway or Render; choose one service for each to minimize setup.

**Warning:** Public hackathon requirements are verified on [Devpost](https://blockchain-stellar-ic.devpost.com/). The separately linked Velocity Notion page returned 404 in browser research, so this pack cannot assert Notion-only requirements. If a copy is supplied, the lead must check it for conflicts. The solution should explicitly target savings, credit and financial asset access rather than claim leveraged perps are safe savings.
