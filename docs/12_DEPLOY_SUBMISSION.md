# 12 — Deployable Testnet prototype and submission runbook

## Exact published requirement (Devpost)
> "Teams must deploy a functional prototype on Stellar Testnet and provide the deployed contract ID(s) and/or a live application URL so judges can verify and interact with it."

Also published: **public GitHub repository** with complete source/README setup instructions; **one-minute video of functioning prototype** hosted publicly and included in submission; **three-minute verbal pitch** containing that demo; **trifold board**. Deadline listed **Friday, Nov 13 2026 8:30 AM EST**. [Official Devpost](https://blockchain-stellar-ic.devpost.com/). The separately linked Notion brief was not accessible in browser research; lead should read it if an export arrives.

## Deliverables and links (fill only after real deployment)
- `GRAPNEL_DASHBOARD_URL`: `null` until deployed, business owner sign-in + module toggles + key lifecycle.
- `GRAPNEL_API_URL`: `null` until deployed, HTTPS `/health` and `/docs` and actual financial APIs.
- `SAMPLE_FINTECH_URL`: `null` until deployed, login and real Testnet chain activity.
- `GITHUB_REPO_URL`: `null` until public source published.
- `VIDEO_URL`: `null` until real one-minute demo recorded.
- `OWN_CONTRACT_IDS`: [] unless we actually deploy our own contracts. **Blend/Soroswap IDs belong to those protocols**; list those separately with confirmed network and source.

## Hosting steps
1. Create a private development repo with pnpm workspace, then make public after running secret scan. `apps/dashboard` and `apps/fintech-demo` on Vercel (or same provider); `apps/api` HTTP and worker on Railway/Render with managed Postgres. Must be **externally reachable**; no localhost submission.
2. Configure domain/HTTPS, server-only env (`DATABASE_URL`, `PRIVY_APP_SECRET`, `SOROSWAP_API_KEY`, Testnet treasury signing secret and funding limits), frontend safe env (`NEXT_PUBLIC_GRAPNEL_NETWORK=stellar-testnet`, `NEXT_PUBLIC_PRIVY_APP_ID` where supported) and allowed origins. Use distinct Testnet provider keys; no mainnet credentials.
3. Apply migrations, seed verified Testnet asset IDs and demo admin. Generate business API key through dashboard; paste once into demo fintech backend env. Do not commit or display it in video.
4. Test backend `GET /health` returns `{status:"ok",network:"stellar-testnet",db:"ok"}` (no keys). API docs `GET /openapi.json` and `/docs` publicly accessible, either with safe demo request examples or nonexposed auth.
5. Verify wallet identity, **both treasury-signed fund and customer-signed return** and actual Testnet transfers from public fintech URL. If Privy allowed origin fails on deployed hostname, update Privy dashboard and repeat.
6. Connect Testnet funding, real spot and Blend adapters. Mark verified only after Testnet transaction hash confirmed; fallback to meaningful read-only, not fake execution.
7. Run negative tests (revoked API key, disabled module, wrong user wallet), and confirm no customer key or treasury secret appears in browser network requests, JS bundle, logs or repo.
8. Link `evidence/testnet.json` file, transaction explorer links, contract IDs from official registries, and new observer test steps in README. Public judge can navigate app without needing developer secrets; seed a demo business and provide safe ephemeral demo login or read-only path.
9. Record demo video **after deployment** using live app. Verify public URL with fresh logged-out browser and a second network/device if possible.

## Config template
```
NODE_ENV=production
STELLAR_NETWORK=testnet
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
DATABASE_URL=<server-only>
PRIVY_APP_ID=<app-id>
PRIVY_APP_SECRET=<server-only>
SOROSWAP_API_KEY=<server-only-optional-until-ready>
DEMO_TREASURY_SECRET=<server-only-testnet-only>
TESTNET_FUNDING_ENABLED=true
TESTNET_FUNDING_MAX_PER_CUSTOMER_ATOMIC=<integer-exact-amount>
TESTNET_FUNDING_MAX_PER_TENANT_ATOMIC=<integer-exact-amount>
GRAPNEL_API_URL=https://<real-api-host>
GRAPNEL_API_KEY=<sample-fintech-server-only>
```
Only `NEXT_PUBLIC_...` values intended for browsers are safe. Split `.env.example` into per-app files during code implementation; no private secret values.

## Funding setup before the smoke test
1. Create a dedicated Testnet treasury account, fund native XLM through the official Friendbot and verify actual spendable balance. Friendbot activates accounts; it does not deliver USDC. Configure the secret **only** in API/worker hosting secrets; never in client apps.
2. If an optional issued/Soroban asset is used, verify issuer/contract ID and mint/faucet/distribution permission, establish required trustlines, and hold confirmed spendable units in treasury. Register only real asset IDs.
3. Test `GET /v1/capital/testnet/funding-assets`, then `POST /fund` and customer-authorized `POST /return`, including customer quota/rate-limit checks, idempotency, treasury depletion and correct XLM reserve behavior. Preserve explorer hashes in evidence.
4. Enable `capital.testnet_funding` in the business dashboard and demonstrate same-key 403 after disabling it; no new API key needed.

## Judge-ready 60-second functional demo outline
0–10s: Owner dashboard enables Spot and Blend; show module catalog; reveal only **masked** existing key.
10–18s: Same key calls a now-enabled API endpoint; demonstrate disabled module 403 if time permits.
18–30s: Fintech login shows real Stellar Testnet G-address, click Get Testnet Funds => **real onchain treasury-to-customer Testnet token transfer** with link.
30–43s: Execute verified spot swap through Grapnel; show actual hash and updated token balances. If impossible, explicitly disclose a failed full-MVP acceptance item.
43–54s: Execute Blend supply and read verified onchain lending position, plus actual withdraw evidence where time allows. Do not claim full-Gate-2 completion without both transactions.
54–60s: Show public API docs and "Powered by Grapnel" developer integration, summary Testnet proof. **Do not force unsupported steps into video; actual hash-based P0 is preferred over simulations.**

## 3-minute verbal pitch structure
~30s problem: local fintech devs lack Stellar/Soroban protocol skills, high integration burden; underserved customers need affordable access to saving/credit options.
~30s solution: modular B2B APIs activated per tenant, uniform auth/financial operations, business retains distribution relationship.
~60s live video (real Testnet).
~30s explain adapter model, Blend variable yield and wallet authorization, limits.
~30s distribution/scalability and grounded next steps. Avoid "guaranteed yield" or "available globally without licensing."

## Trifold board sections
Left: Problem/access/distribution. Center: B2B dashboard → Grapnel API Capital/Trade → Stellar/Blend/Soroswap diagram. Right: live Testnet explorer hashes + user flow + API sample + commercial constraints. Use actual screenshots from deployed app.

## Submission README minimum sections
What it does; who buys API; scope and Testnet-only warnings; architecture; prerequisites; environment variables as names (no values); `pnpm install` / migrate / seed / run; API curl for module toggling and key auth; demo credentials instructions; real testnet transaction IDs; existing vs newly deployed contracts; source links; limitations and security/regulatory caveats.

## Final go/no-go list
- [ ] Devpost requirements reread; Notion-specific added requirements reconciled if available.
- [ ] Public live dashboard/API/fintech URLs work in incognito.
- [ ] Dashboard module toggles change actual same-key authorization.
- [ ] Customer-signed real Stellar Testnet payment hash verifiable; Soroswap and Blend if completed.
- [ ] No fiat on/off-ramp routes, bank/card integrations, simulated fiat balances or tokenized stock claims; no mainnet operations.
- [ ] Public repo/README with install/run and secrets sanitized.
- [ ] Demo video, 3-minute pitch, trifold, contract IDs and/or live URL submitted by deadline.
