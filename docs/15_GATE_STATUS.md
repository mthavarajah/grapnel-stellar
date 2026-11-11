# Integration gates — 2026-11-10

Credential-free implementation is integrated and locally verified. **Full MVP acceptance is incomplete.** Provider credentials are configured; customer login/signing and hosting access remain pending; no customer/provider execution is claimed.

## Gate 0 — passed
Foundation committed before delegation as `6ed12fd`. Monorepo, seven module IDs, auth boundaries, Zod/TypeScript interfaces, OpenAPI and Postgres baseline frozen. Current additive API contract is 0.1.1; see docs/14_GATE0_FREEZE.md. Agents worked in isolated scoped worktrees; lead integrated commits.

## Implementation and verification

- API: actual owner/key/entitlement behavior, tenant isolation, customer binding, idempotent durable operations, reservations, safe unsigned expiry and uncertain-send recovery.
- Chain/Privy: user-owned wallet provisioning, verified identity, exact customer signing and approved-summary checks. Privy credentials authenticate successfully; customer login/signature and transaction proof remain pending.
- Funding: actual treasury inventory reads, capped/locked preparation, fixed-recipient return, durable worker and evidence-backed readiness promotion. No grant or return executed.
- Soroswap: source-verified API adapter, strict quote normalization and durable quote/order services. Authenticated Testnet protocol/pool discovery and exact XLM/USDC quotes succeed. Default asset list is mainnet and rejected; unsigned build returns 428 CREATE_TRUSTLINE. Customer trustline, swap XDR inspection and execution remain pending.
- Blend: real pool/reserve/asset/liquidity reads; narrow native-XLM supply operation/auth/footprint inspector, record+enforce simulation, gated submission revalidation and observed position/wallet reconciliation. Withdrawal/borrow/repay remain explicitly unavailable. No lending execution.
- Dashboard: merged, branded with supplied logos, production build and real browser owner/key/module flows verified.
- Fintech: merged independent frontend/BFF, real API reads, encrypted bounded customer sessions, exact signing UX, secret isolation, same-origin checks and idempotent timeout recovery. No customer login bypass.
- QA: local tests/typechecks/builds, secret/history scans, browser checks, CI, container and cloud deployment inputs. See evidence/local-verification.json for counts and scope; fixture-based tests are never chain proof.

## Gate 1 — passed
Actual Privy customer signature and approved intent verified for completed 0.1 XLM Testnet payment `c1fd6b62b43b062ec88b4bdeddf86e45ea329ac1b9e5969a199289b536208ab2`, ledger 5669076. Independent Horizon reads confirm exact source, fixed treasury recipient, native asset and 0.1000000 debit/credit, plus 100-stroop fee. Auth/tenant/customer-negative suite rerun:55 passed. No fallback signer was used. This does not prove treasury funding, spot or lending execution.

## Gate 2 — partially passed
Treasury grant and customer return are verified for the same customer wallet and amount, in order. The 0.1 XLM grant is `70d688bc1a5e1a852a2d19ff0d2c9d9c3215b5458e2e2a2700bf24064be06b1c` (ledger 5669361); the customer-signed 0.1 XLM return is `4f1dcf32382fa783e9efafbcdf6eacee64fa926ece108bd3277165e6e86acece` (ledger 5669372). Horizon independently confirms exact native XLM debit/credit effects and 100-stroop fees. The live API now promotes funding to `testnet_verified`. Soroswap swap, Blend supply and Blend withdrawal remain unproven. Read-only simulations do not pass this gate. Financial writes remain behind Gate 1; unsupported/unproven paths fail closed.

## Gate 3 — partially complete
Public source published and unauthenticated access verified: https://github.com/mthavarajah/grapnel-stellar . Public dashboard/API/fintech URLs and qualifying video remain absent. Owned Grapnel contract IDs: none. Referenced Blend contracts belong to Blend.

GitHub CI passed for source commit `06366e5`, including Linux builds, disposable Postgres checks, the API/worker Docker image build and live container health smoke without provider credentials: https://github.com/mthavarajah/grapnel-stellar/actions/runs/42901032088 . This is CI container verification, not public cloud deployment; hosting access remains pending.

## Real infrastructure evidence
Dedicated treasury `GCY4DPMIBYCQ352UDKVWDJFKRXOIB2YCOLF2PQFUZHZPYU4WD4PW3LBE` activated via Friendbot. Horizon independently confirmed successful hash `f89109f4379358f0e11771eef6e3aa7e9797dd9b99bf5c576ad3a61d37f76a36`, ledger 5659589, with 10000.0000000 native XLM at activation. This is **treasury activation only**.

Actual inspected Blend supply simulation was independently rechecked by the lead: record and enforce modes passed at ledger 5664220, with source-account authorization, total fee 525597 stroops and bounded footprint. No signature/broadcast/hash or position change exists. See docs/handoffs/soroban.md and evidence/testnet.json; all financial proof fields remain null.

## Next access step
Follow docs/16_CREDENTIAL_HANDOFF.md: configure Privy/Soroswap secrets server-side and identify/connect hosting. Then perform customer consent and real Testnet acceptance sequentially, followed by public deployment and functional demo recording. Recheck current provider state at that time.

## Follow-up hardening
Provider POST requests and durable-worker broadcasts now revalidate the current Gate 1 transaction proof instead of relying only on startup state. Missing proof blocks new execution; already-submitted hashes can still reconcile. Wallet/funding capability reads also recheck proof. The worker regression covers stale proof blocking broadcasts while allowing confirmed position reconciliation. Customer approval errors appear inside the modal; an authorization error triggers status recovery without automatic signing or resubmission. Offline suite: 145 passed, 32 database-dependent skips; workspace typecheck, fintech production build and secret scan passed. No new chain write or acceptance proof.
