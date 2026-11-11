# Customer Borrow readiness — read-only audit

Observed November 11, 2026 at 23:09 UTC, Testnet ledgers 5682983–5682985. Reproduce with:

```sh
pnpm exec tsx apps/api/src/adapters/blend/research/borrow-customer-readiness-audit.ts
```

This diagnostic directly reads the public customer wallet and prepares hypothetical unsigned transactions. It does not log in as the customer, create an identity proof or Grapnel operation, sign, submit, or reuse a QA private key. Diagnostic identity labels deliberately are not real tenant/customer IDs. The earlier actual Gate 1 payment was independently found on Testnet Horizon. Exact fresh data is recorded in `borrow-customer-readiness-audit.json`.

The requested pool is `CB3447A446DY3USGWPIDXTNQHF5EX24XDQA2EN6TAZP62JTPBTNOA52Q`, independent of the old Earn pool. Customer collateral and debt were both zero in this pool. Exact liquidity read was 83800.8231061 XLM and 22838.2372580 classic USDC, with the already pinned issuer/SAC. Both one-XLM and one-USDC collateral-supply preparations passed current adapter, auth/footprint inspection and enforce simulation with zero signatures. Fee ceilings were 525592 and 525833 stroops, respectively; they are observations, not future fee promises.

Direct one-unit borrow preparation correctly rejected `COLLATERAL_REQUIRED`. Direct repayment correctly rejected `REPAY_AMOUNT_EXCEEDS_DEBT_OR_BALANCE`. Before/after raw position tokens were unchanged. No new transaction hashes exist from this audit.

## Customer acceptance steps

1. Sign in to Local Finance and open Borrow.
2. Choose USDC, add **1 USDC collateral**, review the exact new-pool transaction and approve through the normal Privy customer flow. Wait for its durable operation to complete; this first real debit belongs to the customer, not this diagnostic.
3. Refresh the Borrow card. Its collateral and available-to-borrow must now be positive from fresh source reads. Existing Earn collateral must remain separate.
4. Review and approve a small **0.1 USDC borrow** only if fresh available capacity permits it. Wait for completion and verify both wallet receipt and debt increase.
5. Repay the exact freshly returned debt amount (the app's Max/repayable amount), accounting for accrued interest. Wait for verified wallet/debt changes.
6. Only after debt is zero, withdraw collateral up to the freshly read available amount. Preserve sufficient wallet XLM for the actual reviewed network fee.

Capture real customer operation IDs/hashes and the source-backed wallet/debt/collateral changes. The earlier own-account QA cycles remain separate proof and do not establish customer Privy execution.

## Fix and boundary checks

A zero-liquidity withdrawal previously passed a confirmed zero through the positive-only `toAtomic` converter and could produce a generic server error. It now uses the existing zero-aware exact converter and returns structured `EXECUTION_UNAVAILABLE` / `COLLATERAL_WITHDRAW_LIQUIDITY_UNAVAILABLE`, with no preparation call. Tests additionally verify the exact conservative borrow limit versus one atomic unit above it, utilization-cap exhaustion, future/stale oracle timestamps and nonpositive oracle values. Existing transaction-metadata, reservations and authorization tests remain unchanged.
