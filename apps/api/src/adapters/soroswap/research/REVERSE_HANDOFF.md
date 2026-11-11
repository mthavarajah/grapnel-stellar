# Bidirectional direct XLM / exact USDC preparation

Reverse `USDC-XLM` is a distinct market ID using the same verified pair; it remains preparation-only until its own actual completed chain proof. Forward execution proof cannot promote reverse. Both directions retain `summary.action:spot.swap` and the frozen quote/order endpoints.

Actual independent reverse diagnostic used an existing public Testnet account with a confirmed exact USDC trustline and existing token balance. `reverse-unsigned-build.json` records the real provider build. It invokes router `swap_exact_tokens_for_tokens` with ordered `[USDC_SAC,native_SAC]`, exact USDC input and native minimum, exact source recipient and deadline. The sole source-account authorization grants one exact USDC transfer from source to the same verified pair. Its actual footprint contains source USDC trustline/native account and exactly the pair/token instances/balances plus approved executable hashes (5RO/5RW); no blind forward-path substitution is allowed.

Live record in `latest-reverse-readonly-inspection.json`: ledger5678237, quote1USDC ->6.6229406XLM, min6.5904881; two enforce simulations succeeded. Instructions2479622->2742031 (observed2492755), resourceFee21511->24667, total318164stroops unchanged; expiry narrowed to quote30seconds. No signature, broadcast, created account, customer operation or reverse transaction proof.

Reservation semantics: forward reserves native input+native fee; reverse reserves exact USDC principal and a separate XLM fee, preserving native minimum balance. Reverse reconciliation requires exact USDC debit and gross native output equal to observed wallet credit plus the actual chain fee. Quote `min_receive` and actual output represent gross token transfer; the reviewed XLM fee remains separately displayed and deducted from the wallet. Immutable quote/order/baseline bindings now use the stored ordered asset IDs.

Runtime includes two live-verified markets, direction-aware stored intent/delta checks, and `SpotProofReadiness` wiring (capability callback and route refresh hook). Existing forward historical proof remains verified; reverse proof promotion checks its own exact reverse token events and balance records. Also fixes SDK trustline evidence ledger field to `ledger_attr`.

## Reproduce safely from repository root

```sh
pnpm exec tsx apps/api/src/adapters/soroswap/research/inspect-readonly.ts
DIAGNOSTIC_REVERSE=true pnpm exec tsx apps/api/src/adapters/soroswap/research/inspect-readonly.ts
```

Both commands only perform authenticated quote/build, public Horizon/RPC reads and simulations. Server-only provider credentials must already be configured. Each default public diagnostic account must already exist and have the exact authorized USDC trustline; scripts never create or fund accounts, change trustlines, sign or broadcast. They emit non-signable inspection reports with null transaction/operation/customer proof IDs. Timeouts or changed state must fail; no stale unsigned build is substituted.
