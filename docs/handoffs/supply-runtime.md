# Inspected native-XLM supply runtime integration

**Role/branch:** lead-delegated internal composition / feat/inspected-supply-runtime.
**Gates completed:** none beyond the inherited Gate 0. Gate 1 remains false; no Privy login, signature, provider request, chain broadcast, supply transaction or position proof was performed by this task.

## Changed paths

Only lead-approved paths changed:
- apps/api/src/runtime.ts
- apps/api/src/modules/lending/routes.ts
- apps/api/src/modules/lending/runtime.test.ts
- apps/api/src/modules/operations/service.ts
- apps/api/src/modules/operations/worker.ts
- this handoff

No shared HTTP/schema, OpenAPI, provider SDK, root dependency, migration or evidence file changed. The current lead lockfile was copied locally only to install dependencies; it is not part of the commit.

## What is implemented

Runtime now constructs `BlendSorobanPreparer` with the independently established Gate 1 decision and injects `prepare` into the existing Blend adapter. Customer authorization uses `verifyForSubmission` for `blend.supply`, preserving classic payments' existing verifier. The generic verifier still fails closed on Soroban without its strict callback; the preparer supplies the approved exact auth/footprint/registry inspector.

The future worker resolves an envelope only through its exact durably stored hash and signed bytes, with composite wallet/customer/tenant association. It rejects financial provider execution while Gate 1 is absent, rejects unknown operation types, verifies the stored Blend supply's module/provider/customer wallet/native asset/amount, and runs `verifyForSubmission` again before a future canonical RPC send. It does not change signed bytes. RPC hash mismatch, error, unexpected state or transport ambiguity cannot produce completion or a second send. The existing worker attempt record is persisted before this path and remains the retry guard.

Only native-XLM collateral **supply** is wired. Withdrawal remains explicitly unavailable in the inspected preparer; borrow and repay remain unavailable. Blend capability stays discovery-only: no flag or simulated fixture promotes it.

## Baselines, fees and reconciliation

Lending preparation reads a real position and wallet baseline. No position result means rejection, never assumed zero. Position asset/market/pool identity, collateral decimal shape, positive ledger and bounded freshness are required. The native wallet reservation includes the exact approved Soroban max fee in addition to supply amount; the fee-only logic remains present for any future reviewed withdrawal. The generic reader's conservative base-fee deduction is retained.

The private `operations.result_json.blend_supply_baseline` stores exact wallet balance, collateral, asset/market/pool/reserve identity, wallet address, source timestamps and ledger. `recordReconciliation` now merges new private observations into this object instead of overwriting it with `{}` on pending polls.

After RPC **SUCCESS**, the worker reloads customer Blend positions and native Horizon balances. `inspectSupplyDeltas` requires the matching baseline and exact request/wallet/asset, post-transaction source ledger, fresh observations, actual collateral growth and native wallet debit covering the requested amount. Blend b-token rounding is preserved as observed; the code does not invent an exact collateral delta. Actual before/after values and atomic requested amount are recorded privately in `blend_supply_verification`. Missing, stale, invalid, unavailable or unchanged observations remain unverified and the operation stays confirming with its reservation held.

Internal `WorkerChain.verifyDeltas` now accepts either the original boolean or `{verified,result}`. Existing callers/tests remain compatible. No serialized Operation schema changed; these observations remain private persisted reconciliation evidence.

## Tests and commands

All sender and provider observations in the new test file are explicitly offline doubles. Local random keypairs/envelopes are fixtures only and are never sent.

- `pnpm --filter @grapnel/api typecheck`: passed.
- `API_TEST_DATABASE_URL=postgres://mathuthavarajah@localhost:5432/grapnel_mvp_supply_runtime_test pnpm test:integration`: **33 passed**.
- `SUPPLY_RUNTIME_TEST_DATABASE_URL=postgres://mathuthavarajah@localhost:5432/grapnel_mvp_supply_runtime_test pnpm exec vitest run apps/api/src/modules/lending/runtime.test.ts`: **21 passed** (20 offline runtime checks plus one actual disposable-Postgres baseline-preservation check).
- `git diff --check`: passed.

New tests cover actual delta recording, missing baseline/no fabricated zero, wrong wallet/asset/market, stale data/ledger, absent position or insufficient wallet debit, Gate 1 denial before verification/send, missing durable operation, unknown operation type, request/approval amount mismatch, failed inspection before sender, ambiguous mocked RPC send without mutation/retry, pending/failed RPC refusal, and SQL baseline preservation through pending/unverified reconciliation.

`SUPPLY_RUNTIME_TEST_DATABASE_URL` is optional and must point to an explicitly disposable database whose actual name ends in `_test`. Without it, the one Postgres-specific test skips; all offline cases still run in default Vitest. Lead can add that scoped file and environment to serialized CI integration if desired.

## Remaining acceptance work

Configure Privy, prove actual customer signing and Gate 1, then perform controlled real supply acceptance. Recheck current official pool/code/reserve and auth/footprint again at that time. Real success must include actual transaction hash and the persisted observed position/wallet deltas. Validate a genuine withdrawal position/auth/footprint before implementing or enabling withdrawal. No Testnet hash, balance change, customer consent, deployed service or full Gate 2 success is claimed here.
