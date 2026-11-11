# Integration gates — 2026-11-11

Provider credentials and customer signing are integrated. **Onchain Gate 2 is passed; public deployment remains incomplete and is deferred at the user's request.** Actual payment, funding/return, both classic-USDC Soroswap directions, XLM Blend supply/withdraw, and USDC supply are verified. USDC withdrawal and execution of the additional standalone token routes remain unverified.

## Gate 0 — passed
Foundation committed before delegation as `6ed12fd`. Monorepo, seven module IDs, auth boundaries, Zod/TypeScript interfaces, OpenAPI and Postgres baseline frozen. Current additive API contract is 0.1.1; see docs/14_GATE0_FREEZE.md. Agents worked in isolated scoped worktrees; lead integrated commits.

## Implementation and verification

- API: actual owner/key/entitlement behavior, tenant isolation, customer binding, idempotent durable operations, reservations, safe unsigned expiry and uncertain-send recovery.
- Chain/Privy: customer wallet provisioning, verified identity, exact customer signing and approved-summary checks. Actual customer-signed Testnet payment and Blend transactions are verified below.
- Funding: actual treasury inventory reads, capped preparation, fixed-recipient return, durable worker and evidence-backed readiness promotion. Grant and return are verified below.
- Soroswap: both classic-USDC swap directions have real customer execution proof. The local catalog includes seven verified token identities and twelve reviewed direct XLM directions, including five standalone Soroswap tokens. Each new direction remains preparation-only until its own confirmed transaction and balance changes are recorded. Mainnet assets and unverified multihop routes remain excluded.
- Blend: real pool/reserve/asset/liquidity reads; narrow native-XLM supply operation/auth/footprint inspector, record+enforce simulation, gated submission revalidation and observed position/wallet reconciliation. Withdrawal now has a dedicated exact-intent inspector, fresh record/enforce simulation, signed submission and position/wallet reconciliation path. Customer-signed XLM supply and withdrawal are verified with position and wallet deltas below; borrow/repay remain unavailable.
- Dashboard: merged, branded with supplied logos, production build and real browser owner/key/module flows verified.
- Fintech: merged independent frontend/BFF, real API reads, encrypted bounded customer sessions, exact signing UX, secret isolation, same-origin checks and idempotent timeout recovery. No customer login bypass.
- QA: local tests/typechecks/builds, secret/history scans, browser checks, CI, container and cloud deployment inputs. See evidence/local-verification.json for counts and scope; fixture-based tests are never chain proof.

## Gate 1 — passed
Actual Privy customer signature and approved intent verified for completed 0.1 XLM Testnet payment `c1fd6b62b43b062ec88b4bdeddf86e45ea329ac1b9e5969a199289b536208ab2`, ledger 5669076. Independent Horizon reads confirm exact source, fixed treasury recipient, native asset and 0.1000000 debit/credit, plus 100-stroop fee. Auth/tenant/customer-negative suite rerun:55 passed. No fallback signer was used. Gate 1 alone does not prove treasury funding, spot or lending execution; the Blend supply proof is separately recorded under Gate 2.

## Gate 2 — passed for the core onchain MVP
Treasury grant and customer return are verified for the same customer wallet and amount, in order. The 0.1 XLM grant is `70d688bc1a5e1a852a2d19ff0d2c9d9c3215b5458e2e2a2700bf24064be06b1c` (ledger 5669361); the customer-signed 0.1 XLM return is `4f1dcf32382fa783e9efafbcdf6eacee64fa926ece108bd3277165e6e86acece` (ledger 5669372). Horizon independently confirms exact native XLM debit/credit effects and 100-stroop fees. The live API now promotes funding to `testnet_verified`.

A customer-signed Blend TestnetV2 native-XLM collateral supply is verified: `eed88945a8c1327f260a1808136d3c3e8c2dd2f62607628fe8ce95d04d54af35` (ledger 5669556). Horizon confirms a successful pool invocation and 0.1000000 XLM transfer from the customer wallet to the Blend pool. Grapnel reconciliation confirms wallet debit 0.1454406 XLM including 454406 stroops fee and collateral increase from 0 to 0.0999997 XLM. See [transaction](https://stellar.expert/explorer/testnet/tx/eed88945a8c1327f260a1808136d3c3e8c2dd2f62607628fe8ce95d04d54af35) and [evidence](../evidence/testnet.json).

Blend withdrawal is verified: `c5483ff9c241eb8f9449c32f1cb5556f6d4071df82474e754bc9bd298ba0c268`, ledger 5677438. Horizon confirms the exact0.05 XLM pool-to-customer transfer. Grapnel confirms collateral decreased from0.1002446 to0.0502446 XLM and wallet net credit was0.0487196 XLM after12804stroops fee.

The customer-signed Soroswap swap is verified: `eb4e7f22eac0b36195047ac231074ede70d7f1930e43d9f897557d43438b7e9a`, ledger5678121. Independent Horizon transaction/effects reads confirm successful execution, exact100XLM debit and15.0312556 classic USDC credit with the pinned Testnet issuer. The durable operation completed only after matching balance changes; the fee was16407stroops. This completes the core funding/return + spot + Blend supply/withdraw proof set. Additional USDC Blend supply/withdraw remains unverified. See `evidence/testnet.json`.

## Gate 3 — partially complete
Public source published and unauthenticated access verified: https://github.com/mthavarajah/grapnel-stellar . Public dashboard/API/fintech URLs and qualifying video remain absent. Owned Grapnel contract IDs: none. Referenced Blend contracts belong to Blend.

GitHub CI passed for source commit `06366e5`, including Linux builds, disposable Postgres checks, the API/worker Docker image build and live container health smoke without provider credentials: https://github.com/mthavarajah/grapnel-stellar/actions/runs/42901032088 . This is CI container verification, not public cloud deployment; hosting access remains pending.

## Real infrastructure evidence
Dedicated treasury `GCY4DPMIBYCQ352UDKVWDJFKRXOIB2YCOLF2PQFUZHZPYU4WD4PW3LBE` activated via Friendbot. Horizon independently confirmed successful hash `f89109f4379358f0e11771eef6e3aa7e9797dd9b99bf5c576ad3a61d37f76a36`, ledger 5659589, with 10000.0000000 native XLM at activation. This is **treasury activation only**.

The earlier inspected Blend supply simulation was independently rechecked by the lead: record and enforce modes passed at ledger 5664220, with source-account authorization, total fee 525597 stroops and bounded footprint. Actual customer supply execution and position reconciliation are now recorded above.

## Current local follow-up
USDC supply is independently verified at ledger 5678454: customer transaction `1ad63c4281c7fd6a730a914c6f182beb60b6a9872103882b4a9506caa572a09a` debited exactly 4 USDC and increased collateral from zero to 3.9999999 USDC; its fee was 59910 stroops of XLM. USDC withdrawal remains pending customer execution. Earn now reports actual token interest from verified principal/history and fresh positions, with null for incomplete history. Charts persist real public price observations without invented backfill. Latest verification: 358 tests passed, 68 opt-in checks skipped, typechecks and production builds passed, and 12 isolated browser fixtures passed. See `evidence/local-verification.json` for the current scope; earlier paragraphs describe historical verification stages.

## Next access step
Current local services expose customer-approved USDC trustline setup, exact XLM-to-USDC swap preparation, and XLM/USDC Blend supply/withdraw preparation. The exact swap registry route is live-verified and reports `preparation_available:true`, while execution remains unverified. Independent direct swap enforce simulations passed at ledger5677859; USDC Blend record/enforce preparation passed for supply at ledger5677920 and withdrawal at ledger5677923. These public-account read-only diagnostics were not signed or broadcast and are not customer execution evidence. Customer consent is required for the trustline, swap, and subsequent USDC lending transactions. Local Finance combines Get/Return under `/funds`; the owner dashboard exposes actual wallet balances separately from Blend positions.

Follow docs/16_CREDENTIAL_HANDOFF.md: configure Privy/Soroswap secrets server-side and identify/connect hosting. Then perform customer consent and real Testnet acceptance sequentially, followed by public deployment and functional demo recording. Recheck current provider state at that time.

## Follow-up hardening
Provider POST requests and durable-worker broadcasts now revalidate the current Gate 1 transaction proof instead of relying only on startup state. Missing proof blocks new execution; already-submitted hashes can still reconcile. Wallet/funding capability reads also recheck proof. The worker regression covers stale proof blocking broadcasts while allowing confirmed position reconciliation. Customer approval errors appear inside the modal; an authorization error triggers status recovery without automatic signing or resubmission. Offline suite: 145 passed, 32 database-dependent skips; workspace typecheck, fintech production build and secret scan passed. No new chain write or acceptance proof.
