# QA / deployment handoff — feat/qa-deploy

Gate 0 consumed. The local API/security portion is verified; Gates 1–3 are not passed by this work. No chain writes, signatures, grants, swaps, supply or withdrawal executed. No public URLs or video claimed.

## Owned changes

- `tests/integration/security.test.ts`: eight actual Postgres tests for foreign wallet/operation/portfolio access, tenant composite FK, customer/wallet identity mismatch, Origin+CSRF enforcement, same-key module changes, concurrent treasury preparation exclusion, durable grant caps and revoked key rejection.
- `tests/security/config.test.ts`: three environment boundary checks.
- `tests/vitest.integration.config.ts`: core and QA integration suites serialized to avoid schema-reset races.
- `tests/playwright.config.ts`, `tests/e2e/public-surfaces.pw.ts`: two independent frontend loading/Testnet/secret-exposure checks. `.pw.ts` intentionally avoids Vitest collecting Playwright tests. `PLAYWRIGHT_CHROME_CHANNEL=chrome` can use locally installed Chrome; CI users may install pinned Chromium with `pnpm exec playwright install --with-deps chromium`.
- `tests/tsconfig.json`: strict typecheck for all QA tests/scripts; scripts/tests package manifests select ESM without changing root ownership.
- Scripts: idempotent tenant/module-only seed; production/Testnet environment checks; tracked-file secret pattern scan; read-only independent chain/API smoke.
- CI: Postgres 16 service, Node 22, pinned pnpm/frozen install, secret scan, typecheck, isolated unit/integration runs and builds. No live signing/broadcast in CI.
- Deployment: explicit-copy API/worker Dockerfile, Render Blueprint, Railway configs, Vercel monorepo runbook, honest functional-video/pitch/trifold script.
- `evidence/README.md`: evidence distinctions and verification limits.

## Root script changes requested to lead

Lead was notified and confirmed changes:

```
"test:integration": "vitest run --config tests/vitest.integration.config.ts"
"test:e2e": "playwright test --config tests/playwright.config.ts"
```

Optional root aliases: `check:env` → `tsx scripts/check-env.ts`; `check:secrets` → `tsx scripts/scan-secrets.ts`; `typecheck:qa` → `tsc --noEmit -p tests/tsconfig.json`. Existing db:seed and smoke:testnet scripts already point to supplied files. No root manifest/lock/API/shared/migration/UI edits made by QA.

## Verification performed

- `pnpm install --frozen-lockfile`: passed.
- `API_TEST_DATABASE_URL=postgres://mathuthavarajah@localhost:5432/grapnel_mvp_qa_test pnpm exec vitest run --config tests/vitest.integration.config.ts`: **26 passed** (18 existing core + 8 QA), rerun passed.
- `pnpm exec vitest run tests/security/config.test.ts`: **3 passed**.
- `pnpm exec tsc --noEmit -p tests/tsconfig.json`: passed.
- `pnpm --filter @grapnel/api typecheck`: passed.
- `pnpm exec tsx scripts/scan-secrets.ts`: passed on staged/tracked implementation. Pattern scan supplements review; it does not prove absence of every possible credential format.
- `scripts/check-env.ts` rejected missing configuration; passed explicit controlled Testnet test configuration. Values withheld.
- `scripts/seed-demo.ts` ran twice against QA-only database successfully; existing entitlements retained, no keys/balances/operations generated.
- Playwright test discovery: two tests listed. Full browser tests await merged/running frontend apps and must be run by lead. No successful browser E2E claim.
- Render YAML validated against live `https://render.com/schema/render.yaml.json`. Both Railway JSON files validated against live `https://railway.com/railway.schema.json` using JSON Schema. Docker image build not run: daemon is unavailable. Schema validity does not prove cloud deployment.

## Actual live read-only evidence

`SMOKE_API_URL=http://localhost:3001 pnpm exec tsx scripts/smoke-testnet.ts` independently read official Horizon network, treasury transaction and account, plus running API health and OpenAPI 0.1.1. Treasury activation transaction `f89109f4379358f0e11771eef6e3aa7e9797dd9b99bf5c576ad3a61d37f76a36` was confirmed successful. This is **Friendbot treasury activation only**, not a customer-signed payment or grant. All `gate1`, `funding`, `return`, `soroswap`, `blend_supply`, `blend_withdraw` transaction fields were missing, and script reported `acceptance_gate_passed:false`.

The smoke command performs only reads and never edits evidence. `--require-full` deliberately exits nonzero because provider-specific delta/customer-consent verification is not implemented by generic transaction inclusion checks. Do not promote a successful read-only command to full MVP acceptance.

Funding concurrency tests use a clearly named offline `prepareFund` mock and cryptographic fixture accounts/hashes solely in the disposable QA database. The real SQL lock/quota/idempotency logic runs, but no fixture envelope is ever broadcast. These tests are not Testnet transfer evidence.

## Sources and remaining work

Reviewed 2026-11-10: https://render.com/docs/blueprint-spec, https://render.com/schema/render.yaml.json, https://vercel.com/docs/monorepos, https://docs.railway.com/builds/dockerfiles, https://railway.com/railway.schema.json. Provider schema validation passed; connected hosting access remains required.

Lead must run browser E2E after merging both apps; run builds in final monorepo; build container once Docker is available; configure provider/hosting credentials by server-only names; prove customer signing and each Gate 2 transfer/provider delta; deploy public services; verify external pages; publish repo after scan; record actual one-minute functional demo. The submission script is content preparation, not a recorded demo.

No additional dependency or secret variable required for default QA. Optional names: API_TEST_DATABASE_URL, SMOKE_API_URL, E2E_DASHBOARD_URL, E2E_FINTECH_URL, PLAYWRIGHT_CHROME_CHANNEL. Hosting secrets are documented by name only in deployment runbook.
