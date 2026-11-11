# Native XLM collateral withdrawal readiness

Current acceptance remains blocked. On 2026-11-11 UTC, the official current registry and live Testnet pool executable/native SAC/reserve configuration passed `getVerifiedRegistry()`. A read-only `WithdrawCollateral` simulation for 1 XLM from the diagnostic treasury account returned contract error `#1217` at ledger 5668835. The raw diagnostic is preserved in `withdraw-preflight.json`; this error has not been mapped to an official named error in this review.

No transaction was signed or broadcast. This treasury probe does not represent customer authorization, an established customer position, successful withdrawal, or Gate 2 proof. A failing simulation provides no successful standalone withdrawal auth/footprint to inspect.

The existing Blend adapter already rejects withdrawal with liabilities, insufficient actual collateral, or insufficient observed reserve liquidity. The existing operation builder verifies exact `WithdrawCollateral` root arguments. The Soroban preparer still rejects withdrawal with `WITHDRAW_AUTH_FOOTPRINT_PROOF_REQUIRED`; its supply-specific footprint and customer-to-pool transfer authorization must not be reused for pool-to-customer withdrawal by assumption.

After a real authorized customer supply succeeds, use that exact customer's confirmed collateral to perform an unsigned standalone withdrawal simulation. Review its actual root authorization, children, account/token balance keys, Positions/ResData/emissions keys and bounded resources. Add a separate withdrawal inspector and tests, re-simulate in enforce mode, connect exact-envelope customer approval and worker reconciliation, then prove the real transaction hash plus collateral decrease and wallet credit. Supply execution alone cannot promote withdrawal.

Reproduce the current diagnostic from the repository root:

```sh
pnpm exec tsx apps/api/src/adapters/blend/research/withdraw-preflight.ts
```

This command makes read-only network calls and emits a JSON diagnostic. It contains only the dedicated public treasury address and current official registry results. It has no credential, signing or broadcasting path.
