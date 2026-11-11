# Blend withdrawal integration — 2026-11-11

The native-XLM `WithdrawCollateral` path is integrated through exact-intent inspection, record/enforce simulation, browser approval, exact customer signature verification, durable RPC submission and confirmed collateral/wallet delta reconciliation. It accepts a single source-account pool `submit` authorization with no child grant. Debt-bearing withdrawals and insufficient position/liquidity remain blocked. The operation stores a separate `blend_withdraw_baseline` and reserves the approved resource fee.

Fresh unsigned customer-wallet preflight at 2026-11-11T14:11Z succeeded for 0.05 XLM; collateral was 0.1002164 XLM, total prepared fee 23079 stroops. The final unsigned envelope passed the withdrawal-specific inspector. No signing or broadcasting occurred. The live owner-only dashboard customer endpoint subsequently observed 0.1002173 XLM collateral and zero debt at 14:13:57Z; unauthenticated access returned 401.

Actual customer signature, transaction hash and post-chain withdrawal deltas remain pending. Do not mark withdrawal or full Gate 2 complete until these exist. The user can initiate 0.05 XLM in the sample fintech Earn screen and review its freshly prepared fee and intent before Privy signing. Positions are displayed only under Grapnel dashboard Customers.
