# Final integration review — feat/integration-review

Reviewed API/provider/dashboard/QA at `7a3a74d`, the independent fintech source in its owned worktree, and the lead's follow-up `9eec2f8`. Changes in this role are restricted to `tests/review/**` and this handoff. No source, contract, migration, manifest, lockfile or evidence changes. No provider writes, signing, public deployment or financial success claimed.

## Findings and disposition

1. **High: displayed classic payment approval was not independently checked against the envelope.** A valid 1 XLM payment to A passed server verification even when PreparedAction.summary displayed recipient B, amount 0.1 or a different asset ID. The exact XDR digest alone only bound the envelope to itself. Offline cryptographic regressions reproduced three acceptances that should reject. Lead fixed canonical recipient/asset/atomic amount binding in `9eec2f8`; all four regression tests now pass against integrated main. Fintech agent reports analogous browser checks before invoking Privy, with callback-never-called tests.
2. **Functional: funding readiness was permanently blocked.** Runtime hardcoded funding capability blocked, while BFF only accepts verified execution; flags and a valid Gate 1 could never unlock the UI after future proofs. Lead added evidence-backed readiness validation, preserving controlled direct-API initial acceptance and no flag-only promotion.
3. **Functional: encrypted customer cookies could exceed browser limits.** POST accepted identity tokens up to 32768 characters but sealed the entire token into one base64 cookie. Chrome actual local HTTP fixture returned status 200 but stored no cookies for a 5000-byte cookie value. Lead/fintech agent implemented bounded encrypted chunking (reported max four 3000-character chunks) and explicit size handling. Full real Privy-token login still requires credentials.
4. **Medium: production origin validation only existed in an optional script.** Runtime previously defaulted missing production origins to localhost and accepted HTTP origins. Lead now requires explicit HTTPS origins in production in `9eec2f8`.
5. **Defense in depth:** fintech server fetch did not reject redirects. Fintech agent reports `redirect:'error'` added, matching dashboard proxy behavior.
6. **Remaining lifecycle issue raised to lead:** unsubmitted awaiting-customer-authorization operations can expire without an expiry worker/job, leaving reservations and position locks indefinitely held. Cleanup must only expire/release definitely unsubmitted operations with no signed envelope or hash; submitted/ambiguous transactions must retain holds. Lead owns fix and integration verification. This handoff does not claim it is fixed.

No additional tenant-isolation, customer-authentication or CSRF bypass was found in the reviewed code. This is a scoped review, not a claim of production security.

## Added adversarial tests

`tests/review/intent-review.test.ts`: four offline SDK signing fixtures; exact native payment succeeds, incorrect displayed recipient/amount/asset reject. No source account or signature is sent anywhere. Before the fix: one passed, three failed. After lead fix: four pass.

`tests/review/authorization-review.test.ts`: four actual Postgres tests, with clearly non-executable offline envelopes and injected verifier/broadcast mocks:
- verifier rejection rolls back token consumption and stores no signed envelope/hash/job;
- token for another operation is rejected before verifier invocation, even for the same customer/wallet;
- concurrent replay consumes one authorization and inserts one broadcast job;
- an initial ambiguous send is polled by its stored hash without a second send or false completion.

The DB suite requires `REVIEW_TEST_DATABASE_URL` or falls back to `API_TEST_DATABASE_URL`, and refuses a database whose actual name does not end in `_test`. Tests reset the public schema of that explicit disposable DB. Add the file to the serialized integration config, not a parallel test run sharing another suite's DB.

Exact local command used:

```sh
REVIEW_TEST_DATABASE_URL=postgres://mathuthavarajah@localhost:5432/grapnel_mvp_review_test \
  pnpm exec vitest run tests/review/authorization-review.test.ts
pnpm exec tsc --noEmit -p tests/tsconfig.json
pnpm exec vitest run tests/review/intent-review.test.ts
```

First two commands passed in review worktree (4 DB tests, strict typecheck). Last command passed against integrated main after `9eec2f8` (4 tests). CI can supply its existing disposable `API_TEST_DATABASE_URL` if integration files are serialized.

## Deployment and review checks

A hermetic temporary directory reproduced the Dockerfile's explicit package-manifest subset and ran `pnpm install --frozen-lockfile --filter @grapnel/api... --ignore-scripts --offline`. It succeeded, installed root `node_modules/.bin/tsx`, and `tsx --version` returned pinned 4.20.6. This verifies that the filtered installation includes the source runtime dependency. It does not replace a Docker image build or cloud deployment; Docker daemon and hosting remain unavailable.

Reviewed owner proxy route/method allowlist, cookie filtering, CSRF Origin/token forwarding, API tenant-scoped lookups and composite relationships, operation/action-token binding, worker persisted hash/attempt ordering, financial idempotency, treasury locks/quotas, server-only BFF key handling, current-customer ID derivation, encrypted sessions, source digest/signature validation and fail-closed uninspected Soroban behavior. Public capability metadata contains no financial secret. Actual Privy login, provider routes, hash/position proof and external URLs remain future acceptance work.
