# Deployment runbook

These are deployment inputs, not evidence of a deployed service. Use Node 22.12+ and managed PostgreSQL 16. Set server secrets in hosting dashboards; never commit them.

## API and worker

Render: create a Blueprint using `deploy/render.yaml`. Both services share one environment group and Postgres database. The API runs migration before deployment. The worker uses the same container with a distinct command. Supply the exact final frontend HTTPS origins, Privy credentials and server-only Testnet treasury secret. Funding stays disabled until the lead records Gate 1 and verifies limits.

Railway alternative: create Postgres and two services from the repository, root directory `/`. Select config paths `deploy/railway-api.json` and `deploy/railway-worker.json` respectively, or set `RAILWAY_DOCKERFILE_PATH=deploy/Dockerfile.api`. Inject `DATABASE_URL` from the Postgres service into both. Supply the same server variables as the Render environment group. No API port is hardcoded in hosting; API honors `PORT`.

### Active hosting split

The owner selected Vercel for the two Next.js frontends and Railway for the API, continuous worker and PostgreSQL. Railway uses the repository root as its build context and `deploy/Dockerfile.api` for both processes. Configure the API start command as `pnpm --filter @grapnel/api start`, migration command as `pnpm --filter @grapnel/api db:migrate`, and `/health` as its health check. Configure the worker start command as `pnpm --filter @grapnel/api worker`, with no HTTP health check or public domain. Set `RAILWAY_DOCKERFILE_PATH=deploy/Dockerfile.api` on both. The API image includes the public Stocks and Zenex readiness evidence.

Railway's live API now rejects the legacy `railwayConfigFile` setting as deprecated. The checked-in Railway JSON files are historical reference inputs; this deployment uses explicit service settings through the official API. The optional frontend Dockerfiles were verified locally but are not the active Vercel deployment path.

Generate public domains first, then configure exact API `DASHBOARD_ORIGIN` and `FINTECH_ORIGIN`. Both frontends need server-only `GRAPNEL_API_URL` pointing to the public HTTPS API. The dashboard needs its own exact `DASHBOARD_ORIGIN` and build-time `NEXT_PUBLIC_VELOCITY_DEMO_URL` pointing to Velocity's `/home`. Velocity needs its server credentials from its environment template and build-time `NEXT_PUBLIC_PRIVY_APP_ID` plus `NEXT_PUBLIC_GRAPNEL_NETWORK=stellar-testnet`. These public values must be present before building; changing them requires rebuilding. Add the Velocity HTTPS origin to the existing Privy application's allowed origins. Never pass secrets as Docker build arguments.

API and worker must share the same database, session/authorization configuration, exact Testnet credentials and funding limits. Preserve the existing database through a private backup/restore when retaining customer history and grants; do not commit backups. On a fresh database, run migrations and the seed once, then issue a new business key through the owner dashboard and configure it only on Velocity's server. A key from a different database will not authenticate. Start the worker only after the database and matching configuration are ready. Public URLs remain unverified until external health, login and operation reconciliation checks pass.

The Dockerfile copies explicit source paths and cannot copy a developer's `.env`, `.git`, frontend private config or generated private keys. It runs source TypeScript via the pinned `tsx` runtime because shared package exports point to source. Do not switch to a nonexistent dist entry point. Build locally with `docker build -f deploy/Dockerfile.api -t grapnel-testnet-api .`; Docker verification requires an active daemon.

## Two Vercel frontend projects

Import the same repository twice. Select `apps/dashboard` as Root Directory for the business dashboard and `apps/fintech-demo` for the independent sample fintech. Framework preset Next.js, install `pnpm install --frozen-lockfile`, default Next build/output. Enable access to source outside each root for workspace contracts. Never set the API key as a NEXT_PUBLIC variable.

Dashboard: set server-only `GRAPNEL_API_URL` to the actual HTTPS API URL. Customer fintech: set server-only `GRAPNEL_API_URL`, business `GRAPNEL_API_KEY` issued through the dashboard, `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, and independent `FINTECH_SESSION_SECRET` (32+ random characters); browser receives only `NEXT_PUBLIC_PRIVY_APP_ID` and `NEXT_PUBLIC_GRAPNEL_NETWORK=stellar-testnet`. See each app's own `.env.example` for final supported names.

Add final frontend origins to the API and Privy allowlist, redeploy, then verify secure HttpOnly cookies with a fresh browser. API owner sessions and fintech customer sessions are independent.

## Verification and promotion

1. Run `pnpm install --frozen-lockfile`, typecheck, tests, integration tests, both Next production builds and secret scan.
2. Visit public `/health`, `/docs`, and `/openapi.json`. Run `SMOKE_API_URL=https://actual-api-host pnpm smoke:testnet`. This command performs reads only and does not certify customer consent or provider deltas.
3. In a fresh browser prove owner login, key issue/revoke, same-key entitlement changes, and customer session isolation. Record real provider hashes and explicit before/after asset/position observations only after successful chain execution.
4. Gate 1: actual Privy-signed customer Testnet payment, not Friendbot treasury activation. Gate 2: treasury grant AND customer return, Soroswap swap, Blend supply AND withdraw. No copy-only contract ID or quote passes a gate.
5. Fill public URLs/repo/video in evidence only after independent access checks. Record one-minute functional video from the deployed app only after its flow works. Never show secrets or local-only success as public deployment.

Sources reviewed 2026-11-10: [Render Blueprint spec](https://render.com/docs/blueprint-spec), [Vercel monorepos](https://vercel.com/docs/monorepos), [Railway Dockerfiles](https://docs.railway.com/builds/dockerfiles). Render and Railway config files validated against their live published JSON schemas on 2026-11-10. The container image build and provider-free health smoke passed in GitHub CI for source commit `06366e5` ([run](https://github.com/mthavarajah/grapnel-stellar/actions/runs/42901032088)). Public cloud deployment remains pending connected hosting access; CI does not provide a public application URL.
