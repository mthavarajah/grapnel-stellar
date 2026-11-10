# AGENT 06 — Grapnel B2B Dashboard Frontend

**Read:** `AGENTS.md`, `docs/00_PRODUCT.md`, `01_WORK_PLAN.md`, `03_API.md`, `10_FRONTENDS.md`. Own `apps/dashboard/**` only. Work against mocked OpenAPI/Zod during Wave A; replace with live Grapnel API at Gate 1. NEVER implement independent module permission logic that changes backend behavior.

## Screens
Dashboard owner login; overview; `/modules` seven catalog cards grouped Capital/Trade; `/api-keys` create once/revoke; `/logs` request list; `/docs` OpenAPI quickstart. Prominent `Stellar Testnet` banner, not a generic live bank.

## Central interaction
1. Admin selects `capital.wallets`, `capital.testnet_funding`, `capital.lending`, `trade.spot`.
2. Click Save -> `PATCH /v1/dashboard/modules` with exact module IDs; response revision confirms persistence; refetch after reload.
3. API key page create -> secret shown ONCE and copy; later visits only prefix/last 4. Revoke updates backend.
4. Change a module while same business key exists -> read `/v1/capabilities` showing allowed/disallowed after save. Show message 'Existing API keys use your new module settings automatically'.
5. Modules with `discovery_only`, `blocked`, `simulation` must be visibly differentiated; none should imply a working trade.

Show `capital.testnet_funding` as a **Testnet token distribution/return** module, never fiat on/off-ramp, MoneyGram, bank deposit or cash-out. Module metadata comes from backend catalog.

## Security/UI rules
Admin cookie separate from API key; keys shown in secure ephemeral state never URL/search params/logs. No raw secrets in screenshots/demo video. Dashboard can require a safe demonstration login, but backend ownership enforcement is mandatory. Use loading/error states, responsive layout, meaningful copy and no invented financial metrics.

## Acceptance
Toggle persisted after refresh; same-key scopes change immediately as verified by API; API secret once; revoked key fails 401; docs show real endpoints; activity log shows actual requests not placeholder numbers; independent public deployment.
