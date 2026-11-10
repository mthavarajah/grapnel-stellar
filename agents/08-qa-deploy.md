# AGENT 08 — Tests, Testnet evidence, deployment, submission

**Read everything in `docs/11_TESTS_SECURITY.md` and `docs/12_DEPLOY_SUBMISSION.md`, plus root `AGENTS.md` and `docs/13_SOURCES.md`.** Own automated `tests/`, smoke and evidence scripts, CI, deploy configs and submission README improvements. Do NOT take over API/adapter source without lead approval.

## Wave A
Set up unit/integration harness, Postgres test container or hosted test DB, API health deployment, base build CI, `.env.example` validation and secrets scanning. Seed two tenants; write authorization and concurrency tests against frozen API contract. Prepare `evidence/testnet.json` with null fields, no pretend hashes.

## Wave B
Run tests against real Privy signer and Stellar testnet with dedicated demo wallets, verify chain tx hashes and balances by independent RPC/explorer. Test Soroswap and Blend confirmed status separately. Exercise dashboard key scopes and customer fintech backend with incognito browser.

## Gate 3 deployment
Deploy dashboard and fintech to Vercel or equivalent, API/worker/Postgres to Railway/Render. Configure HTTPS, CORS and Privy allowed origins, secrets in hosting config, no mainnet setting. Verify `/health`, `/docs`, API key issuance, module toggles, real onchain flow on **public** URL and independent account. Verify asset treasury funding and separate customer-signed return; no fiat integration. Publish public repo with complete setup and run instructions and relevant verified contract IDs/hashes.

## Submission assets
Working live URL and/or owned custom Testnet contract IDs (not necessary to deploy owned contracts if live app works); clear existing Blend/Soroswap IDs; public GitHub repo; 1-minute screen capture of functioning app (not slideshow); 3-minute presentation script; trifold board. Deadline check Devpost Nov 13, 2026 8:30 AM EST. If Notion export later arrives, compare exact requirements before submission.

## Acceptance matrix
Key enable/disable same-secret; revoked key; tenant isolation; wallet customer signing; Testnet treasury grant AND customer-authorized return success; no database fake balance; real Testnet treasury funding/return fully confirmed; live frontend; real explorer hash; docs and API examples; no secret leakage. If some providers can't execute, list exact blockers and display honest discovery-only behavior.

## Evidence schema
Use `templates/TESTNET_EVIDENCE.md`. Record only live observed hashes, wallet, provider token identity and actual deployed URLs, after independent checks. Record source timestamp and test result. Never fill missing with example addresses that look real.
