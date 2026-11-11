# Grapnel business dashboard

Next.js developer console for the separate Grapnel API. It reads live owner-scoped API responses; no balances, request history or execution proof are fabricated.

Run from the workspace root:

```sh
pnpm install
pnpm dev:api
pnpm dev:dashboard
```

Configure the API's `DASHBOARD_ORIGIN` as `http://localhost:3000` locally. The dashboard defaults to `GRAPNEL_API_URL=http://localhost:3001`; for deployment set its server-only `GRAPNEL_API_URL` to the actual API origin and `DASHBOARD_ORIGIN` to its own exact HTTPS origin. The API must use that same dashboard origin. The dashboard has no business key or automatically supplied owner secret. Log in manually with the API's configured `ADMIN_LOGIN_SECRET`.

The dashboard proxies an explicit allowlist of owner routes through `/api/grapnel/dashboard/*`. Mutations require the exact origin and CSRF token; the API independently validates session ownership and CSRF. Cookies stay HttpOnly. The proxy does not forward browser Authorization headers or arbitrary financial/provider paths.

Pages: `/overview`, `/modules`, `/api-keys`, `/logs`, `/docs`, `/onboarding`. Module selection may enable unverified modules, but their execution status and reason remain visible. Selecting a financial module also selects `capital.wallets`; the API enforces the dependency. Changes persist in Postgres and affect existing API keys without rotation. Issued secrets appear only in ephemeral component state and are cleared on navigation, explicit hide, or sign-out.

Validation: `pnpm --filter @grapnel/dashboard build`, `pnpm --filter @grapnel/dashboard typecheck`; proxy security tests live beside the Next route and use mocked upstream HTTP only. Actual browser testing against the local API is detailed in `docs/handoffs/dashboard.md`.

The `/customers` owner view loads exact wallet balances and live Blend positions separately. Amounts use six significant digits; raw customer IDs are used only internally for tenant-scoped requests. Public wallet and asset explorer links permit precise inspection. A failed wallet read does not hide a successful position read, or imply a zero balance. On mobile, labeled cards show all amounts without horizontal scrolling.

Module readiness review (2026-11-11): module cards now separate saved Business access from Testnet execution, label pending access changes before Save, and translate provider reason codes for stocks, perps and commodities. The technical API reason remains available in an optional disclosure. Saving access updates existing keys immediately without rotation; it does not verify a provider route. Unknown capability statuses fail closed in the display. Market data availability is shown only when an explicit read action is advertised in the API capability response; the owner UI does not borrow a business key or infer public read availability from discovery status.

Validation: 15 focused dashboard component/proxy tests passed, as did the production build/typecheck. Actual local API owner session rendered seven current capability cards, including enabled Stocks with blocked execution. An unsaved stock toggle correctly preserved the saved access/readiness labels; it was reverted without saving. Headless installed Chrome had no page errors and no horizontal overflow at 390px. Desktop/mobile screenshots were inspected; the black/white theme and original logos remain. No API routes, provider adapters, consumer UI or shared contracts changed, and no blockchain execution is claimed.
