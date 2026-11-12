# Dashboard handoff

**Role/branch:** Agent 06 / feat/dashboard-ui.
**Gate completed:** Gate 0 consumed. Local owner UI integration verified; no Gate 1 blockchain or public deployment claim.
**Owned paths changed:** apps/dashboard/**, docs/handoffs/dashboard.md.

## Implemented

Uses the user-supplied original PNG wordmark in sidebar/login and supplied icon for favicon; assets copied unchanged into apps/dashboard/public/brand. The black-background white-art wordmark is visually blended with the dark surface using screen and its source margins are cropped in CSS without distortion.

Independent Next.js 16.4.6/React 19.3.1 dashboard with responsive navy sidebar, cream workspace, teal controls, Testnet labeling, meaningful error/loading/empty states and actual API metrics. Pages: owner login, overview, six module cards grouped Capital/Trade, API key issue-once/hide/copy/revoke, real request log with errors filter, REST quickstart/reference pointers, and workspace creation.

All owner data comes from the Grapnel API. Module descriptions/provider/readiness/reasons are backend catalog fields. Enabling another financial module adds wallets in the form; backend remains authoritative and validates dependency. Save sends the exact frozen PATCH shape and shows returned revision. No onchain completion, positions, balances or successful protocol routes are fabricated. Readiness badges explicitly show blocked/discovery/simulation/verified statuses.

`/api/grapnel/[...path]` proxies an allowlist of dashboard-owner routes. No business key or owner secret is stored automatically or used as a customer signer. User manually enters ADMIN_LOGIN_SECRET, API issues an HttpOnly cookie, subsequent mutations forward X-CSRF-Token. Proxy rejects mismatched mutation Origin before upstream requests; API independently enforces owner session/CSRF. Only `grapnel_owner` cookie and CSRF are forwarded; browser Authorization headers and arbitrary provider/customer paths are excluded. Empty-body DELETE omits Content-Type, fixing a real Fastify integration issue. Upstream errors/timeouts return explicit unavailable state, not sample data.

One-time created API key stays in ephemeral React state, clears on hide/navigation/sign-out, and is never persisted to localStorage/URL. Full secret is only displayed after creation, as required. Existing keys remain masked.

## Verification

- `pnpm install --lockfile=false`: passed, root lock deliberately unchanged.
- `pnpm --filter @grapnel/dashboard typecheck`: passed.
- `pnpm --filter @grapnel/dashboard build`: passed production build.
- `pnpm exec vitest run apps/dashboard/src/app/api/grapnel/'[...path]'/route.test.ts`: four security tests passed. They use mocked upstream fetch; not blockchain evidence.
- Real headless Chrome browser against local running API `http://localhost:3001`: successful owner login, overview with actual tenant/request/key counts, modules/readiness view, key creation then hide and immediate revoke, docs and 390px mobile rendering. Zero page errors.
- Screenshots inspected: `/tmp/grapnel-dashboard-overview.png`, `/tmp/grapnel-dashboard-mobile.png`; no key secret visible. Optional login/modules screenshots also in /tmp.
- Real browser toggled Crypto Spot, saved, reloaded and verified the persisted checkbox, then restored the original entitlement set. Initial attempt exposed slow dynamic provider capability probes; lead fixed readiness caching, and the retry passed. No API schema change was needed.

A local key named `Dashboard browser verification` was actually created and revoked via the browser; it is not a provider execution claim. No outgoing onchain requests, transaction hashes or deployment URLs produced by this role.

## Environment and deployment

Dashboard server env: `GRAPNEL_API_URL`, optionally exact `DASHBOARD_ORIGIN`. API's DASHBOARD_ORIGIN must match the dashboard's origin. Defaults are localhost:3001 API and request origin locally. apps/dashboard/.env.example contains names and local defaults only. No credentials in source. `next start` serves port 3000; deploy app root apps/dashboard, install from monorepo root and build workspace package.

Added own manifest dependencies: next 16.4.6, react/react-dom 19.3.1, @types/react/@types/react-dom 19.2.2, TypeScript 5.9.3, @types/node 22.19.0. Lead must update root pnpm-lock.yaml after cherry-pick. No shared contract/root/migration changes.

**Blockers:** Public hosting not connected; Testnet signing gate and protocol proofs are owned by integration/provider roles. This dashboard cannot independently pass Gate 3. Verify deployed cookie/Origin configuration in browser and rerun same-key effect through fintech BFF before claiming acceptance.

## Customer holdings UI update — 2026-11-11

Added a dedicated owner-session Customers view with independent live wallet balance and Blend position reads. Wallet columns show balance/reserved/spendable; protocol columns show total supplied, the collateral portion, and borrowed assets. The UI never combines protocol-held positions with wallet spending availability. All amounts use shared `formatTokenAmount(value, 6)` without floating-point conversion. Unknown amounts display Unavailable; failed reads never become zero balances.

Customer selection ignores late responses from previous selections; both reads have independent loading/error states and explicit refresh. No raw UUID, Privy ID, market/asset contract ID or wallet address appears in labels. Customers use readable local labels, while asset/wallet inspection links retain exact public explorer references. Workspace/request UUID text was also removed. Mobile tables become labeled amount cards so spendable and collateral values fit a 390px screen.

Validation: production build and strict typecheck passed; three table-format/identity-display tests and six proxy security tests passed. Actual Chrome browser verified unauthenticated login screen, authenticated owner cookie access, live wallet balance plus four current Blend reserve rows, zero read errors, zero page errors, no opaque IDs in rendered text, and no horizontal document overflow at 390px. Screenshots inspected at `/tmp/grapnel-dashboard-holdings-desktop.png` and `/tmp/grapnel-dashboard-holdings-mobile.png`. This was read-only verification, not a new chain execution or acceptance hash.

Lead-owned integration dependency: GET `/v1/dashboard/customers/:id/balances` and the dashboard proxy allowlist are supplied by the root agent. Their identical local allowlist patch was used for verification but deliberately excluded from this UI commit. No API/BFF/shared-contract changes or new dependencies included. Temporary local dashboard port 3013 was stopped after verification.
