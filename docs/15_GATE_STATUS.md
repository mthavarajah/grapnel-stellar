# Integration gates — 2026-11-10

Credential-free implementation is integrated and locally verified. **Full MVP acceptance is incomplete.** Credentials and hosting are intentionally deferred by the user; no customer/provider execution is claimed.

## Gate 0 — passed
Foundation committed before delegation as `6ed12fd`. Monorepo, seven module IDs, auth boundaries, Zod/TypeScript interfaces, OpenAPI and Postgres baseline frozen. Current additive API contract is 0.1.1; see docs/14_GATE0_FREEZE.md. Agents worked in isolated scoped worktrees; lead integrated commits.

## Implementation and verification

- API: actual owner/key/entitlement behavior, tenant isolation, customer binding, idempotent durable operations, reservations, safe unsigned expiry and uncertain-send recovery.
- Chain/Privy: user-owned wallet provisioning, verified identity, exact customer signing and approved-summary checks. No Privy credentials/customer transaction yet.
- Funding: actual treasury inventory reads, capped/locked preparation, fixed-recipient return, durable worker and evidence-backed readiness promotion. No grant or return executed.
- Soroswap: source-verified API adapter, strict quote normalization and durable quote/order services. Live unauthenticated request returned 401 MISSING_CREDENTIAL. Real asset registry/liquidity/build inspection and swap remain unproven.
- Blend: real pool/reserve/asset/liquidity reads; narrow native-XLM supply operation/auth/footprint inspector, record+enforce simulation, gated submission revalidation and observed position/wallet reconciliation. Withdrawal/borrow/repay remain explicitly unavailable. No lending execution.
- Dashboard: merged, branded with supplied logos, production build and real browser owner/key/module flows verified.
- Fintech: merged independent frontend/BFF, real API reads, encrypted bounded customer sessions, exact signing UX, secret isolation, same-origin checks and idempotent timeout recovery. No customer login bypass.
- QA: local tests/typechecks/builds, secret/history scans, browser checks, CI, container and cloud deployment inputs. See evidence/local-verification.json for counts and scope; fixture-based tests are never chain proof.

## Gate 1 — pending
Auth/tenant/customer-negative checks pass locally. The missing mandatory item is a real **Privy-signed customer Testnet payment** with confirmed hash/effects. Gate decision remains false; no fallback signer is authorized.

## Gate 2 — pending
No confirmed treasury grant, customer return, Soroswap swap, Blend supply or Blend withdrawal. Read-only simulations do not pass this gate. Financial writes remain behind Gate 1; unsupported/unproven paths fail closed.

## Gate 3 — partially complete
Public source published and unauthenticated access verified: https://github.com/mthavarajah/grapnel-stellar . Public dashboard/API/fintech URLs and qualifying video remain absent. Owned Grapnel contract IDs: none. Referenced Blend contracts belong to Blend.

GitHub CI passed for source commit `06366e5`, including Linux builds, disposable Postgres checks, the API/worker Docker image build and live container health smoke without provider credentials: https://github.com/mthavarajah/grapnel-stellar/actions/runs/42901032088 . This is CI container verification, not public cloud deployment; hosting access remains pending.

## Real infrastructure evidence
Dedicated treasury `GCY4DPMIBYCQ352UDKVWDJFKRXOIB2YCOLF2PQFUZHZPYU4WD4PW3LBE` activated via Friendbot. Horizon independently confirmed successful hash `f89109f4379358f0e11771eef6e3aa7e9797dd9b99bf5c576ad3a61d37f76a36`, ledger 5659589, with 10000.0000000 native XLM at activation. This is **treasury activation only**.

Actual inspected Blend supply simulation was independently rechecked by the lead: record and enforce modes passed at ledger 5664220, with source-account authorization, total fee 525597 stroops and bounded footprint. No signature/broadcast/hash or position change exists. See docs/handoffs/soroban.md and evidence/testnet.json; all financial proof fields remain null.

## Next access step
Follow docs/16_CREDENTIAL_HANDOFF.md: configure Privy/Soroswap secrets server-side and identify/connect hosting. Then perform customer consent and real Testnet acceptance sequentially, followed by public deployment and functional demo recording. Recheck current provider state at that time.
