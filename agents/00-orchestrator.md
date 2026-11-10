# AGENT 00 — Orchestrator / How to launch the team

This file exists for the human or coordinating coding agent that runs the other agents. **These markdown files don't automatically start agents.** Choose **parallel agents with sequential quality gates**. Multi-agent environments: use isolated git worktrees/branches. Single-agent environment: follow same dependencies in order.

## Brief to send every agent
> You are working on Grapnel for Stellar, a Testnet-only modular B2B REST infrastructure demo. Read root `AGENTS.md`, `README.md`, `docs/00_PRODUCT.md`, `docs/01_WORK_PLAN.md`, `docs/02_ARCHITECTURE.md`, `docs/03_API.md`, `docs/11_TESTS_SECURITY.md`, `docs/13_SOURCES.md`, and your specific `agents/NN-role.md`. Work ONLY within your listed owned paths. Build real integrations and tests; no fabricated onchain success. Use handoff template and communicate blockers and interface changes to orchestrator.

## Start order
**Lead first (short Gate 0):** spawn Agent 01 to create package interfaces, migration baseline, API auth contract and test harness. Ask Agent 02 to immediately spike Privy/Stellar Testnet signing independently using a scratch branch and report real tx hash; allow Agent 08 to prepare deploy/test skeleton. Dashboard/Fintech agents may draft UI against contract spec in parallel, but cannot declare integration until lead freeze.

After lead publishes frozen interfaces commit, spawn **all remaining agent roles simultaneously** in their worktrees:
- Agent 03: real Testnet treasury funding + customer-signed return (no fiat provider).
- Agent 04: Soroswap Testnet quote/execute probe.
- Agent 05: Blend pool contract/USDC vs XLM probe.
- Agent 06: dashboard.
- Agent 07: sample fintech BFF/frontend.
- Agent 08: E2E tests and deployment.

## Merge/dependency graph
```
AG01 frozen API/DB/contracts -----------+--> AG06 Dashboard --> E2E
                                       +--> AG07 Fintech --> E2E
AG02 Privy Stellar wallet -> Gate 1 ---+--> AG03 Testnet Funding/Return --> E2E
                                       +--> AG04 Spot -> confirmed swap
                                       +--> AG05 Blend -> confirmed supply/withdraw
AG08 tests/deploy ----------------------+--> Gate 3 live public URLs/submission
```

## Orchestrator acceptance decisions
1. G0 accepts shared types and basic business auth; no competing schemas.
2. G1 requires actual Privy signed Testnet tx, entitlement tests and tenant checks. If signing blocked, make a **recorded explicit fallback decision**, not a secret switch.
3. G2 full-MVP target requires a **confirmed treasury grant, customer-authorized return, Soroswap swap, and Blend supply/withdraw**, with real hashes and position/balance changes. Missing steps must be recorded as failed/incomplete, not passed. SODAX, commodity and Noether may remain discovery-only. Never let optional work delay deployment.
4. G3 independently opens deployed pages in incognito, runs smoke, verifies transaction hash on explorer and submits URL/repo/video.

## Reports
Ask for `templates/HANDOFF.md` on every agent merge. Maintain daily (or per commit) list of blockers: provider API key, signing, treasury inventory, token liquidity, pool ID, chain transaction proof, URLs. No unreviewed branch changes to `.env.example`, OpenAPI, root dependency lockfile or DB migration numbering.

## First 5 practical commands for human operator
1. Copy this folder into the coding repository and open `AGENTS.md`.
2. Run orchestrator/lead using this file and `agents/01-lead-api.md`.
3. Once lead freezes interfaces, run assigned agents in separate worktrees with role files.
4. Merge through lead and run `pnpm typecheck && pnpm test && pnpm test:integration` plus actual Testnet smoke script.
5. Deploy, gather actual explorer proof, publish code and submit. None of these commands are claimed to have been executed by this pack.
