# AGENT 05 — Blend v2 Lending / Borrowing / Yield

**Read:** `AGENTS.md`, `docs/03_API.md`, `04_DATABASE.md`, `05_SIGNING.md`, `06_FUNDING.md`, `08_BLEND.md`, `11_TESTS_SECURITY.md`, `13_SOURCES.md`. Own `apps/api/src/adapters/blend/**` and lending service routes; coordinate exact `PreparedAction` with Chain agent.

## P0 execution
1. Re-read official `testnet.contracts.json`; query live RPC, verify actual `TestnetV2` pool exists and reserves, identify decimals and liquidity. Do not assume stable IDs after reset.
2. Begin with XLM reserve funded from Friendbot for easier Testnet proof; retain minimum fee/reserve. The Blend `USDC` Soroban token is not Friendbot XLM; seed the exact token in the Testnet treasury using a verified source if showing USDC supply. Do not assume the treasury holds it.
3. Use official `@blend-capital/blend-sdk` / `Pool.load`, `pool.loadUser`, `PoolContract.submit`, `RequestType.SupplyCollateral`, `WithdrawCollateral`. Build Soroban op, call common SDK simulation/auth/signing, submit and poll SUCCESS, load actual updated position. Record hashes.
4. Return normalized markets/positions and variable APY from reserve SDK data; no fixed yield promises. Show supplied funds locked, not wallet-spendable.
5. Only after supply+withdraw actually works, implement P1 `Borrow` / `Repay` with collateral factor, health estimate, available liquidity and risk warnings. If unable, return `EXECUTION_UNAVAILABLE` rather than mocking loan.

## Hard edges
Soroban auth entries may require more than a classic envelope signature. Onchain token contract IDs and decimals must come from validated registry. Pool may be stale/reset/inactive; position loading may be delayed or require RPC state freshness. With debt, collateral withdrawal can trigger liquidation; reject if risk checks fail. Interest rate variable and not guaranteed.

## Acceptance
Live pool info, real customer-signed supply tx hash, live position delta, real withdraw hash, wallet balance changes, no wrong token accepted; borrow/repay if verified separately. API unauthorized customer and disabled-module tests pass. Handoff includes exact pool/reserve IDs and verified timestamp.
