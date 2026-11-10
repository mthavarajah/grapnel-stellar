# Access handoff after credential-free integration

No credentials should be pasted into public source, README, screenshots, video or NEXT_PUBLIC variables. Configure local ignored environment files or the hosting secret manager; then tell the lead the account/project and that configuration is ready.

## Local API `.env` (server only)
- PRIVY_APP_ID and PRIVY_APP_SECRET: same Privy demo app used by the fintech. Stellar user-owned wallets and raw-hash signing must be enabled/supported. Allow the actual frontend origins in Privy.
- SOROSWAP_API_KEY: authenticated Testnet discovery/quote/build access. API URL defaults to the official endpoint; no guessed replacement.
- DATABASE_URL, ADMIN_LOGIN_SECRET, SESSION_SECRET: local configuration already generated for this workspace, kept ignored. Hosting needs its own managed Postgres URL and fresh secrets.
- DEMO_TREASURY_SECRET: a dedicated Testnet treasury is already provisioned locally. Its secret remains ignored. Store it only in the API/worker host; never use it as a customer signer. Keep TESTNET_FUNDING_ENABLED=false until the signing gate passes.

## Sample fintech `.env.local` (server only unless NEXT_PUBLIC)
- GRAPNEL_API_URL and GRAPNEL_API_KEY: URL plus a key issued through the real dashboard; never a browser key. A local key has already been issued and is stored in ignored server configuration.
- PRIVY_APP_ID, PRIVY_APP_SECRET: server identity verification, same app as API.
- NEXT_PUBLIC_PRIVY_APP_ID: only the public app ID.
- FINTECH_SESSION_SECRET: fresh high-entropy value of at least 32 characters.

## Hosting access
Choose Railway or Render for API + worker + PostgreSQL, and Vercel for the two independent frontends, or identify an equivalent existing project. The lead needs the connected account/project and deployment permissions. No service URLs are claimed until deployment and external smoke checks succeed. Deployment configs and exact commands are in deploy/README.md.

Public frontend origins must be explicitly configured as HTTPS in the API and Privy. The dashboard proxy and fintech BFF use the deployed API URL server-side. Keep API/worker secrets separate from frontend-public configuration.

## Work after access is ready, in gate order
1. Sign in as a real Privy customer, provision/activate the user-owned Stellar wallet, approve the restricted <=1 XLM test payment to the fixed Testnet treasury, broadcast through durable worker and independently verify hash/effects. Re-run auth negatives, then lead records actual Gate 1 evidence. A copied hash or treasury signature is insufficient.
2. Enable capped Testnet funding, execute an actual grant and customer-signed return through the API. Verify exact account/asset/amount and both hashes. Initial acceptance uses the restricted authenticated API; evidence-backed capability promotion follows actual completed round-trip proof.
3. Authenticate Soroswap discovery and identify real exact assets/liquidity. Validate actual quote/build output and route-specific XDR/auth inspection before customer signing and real swap. Missing credentials previously prevented this work; no market or fill is invented.
4. Complete the reviewed Blend Soroban path and prove actual customer supply/withdraw, including position/balance deltas. Read-only simulation is not execution. Withdraw inspection/proof may require the position established by real supply; keep unproven paths unavailable.
5. Deploy, run external/incognito smoke and secret checks, then record a one-minute functioning demo and publish its URL. Keep uncompleted provider acceptance items disclosed.

The credential-free build is not a full-MVP acceptance claim. See docs/15_GATE_STATUS.md and evidence/testnet.json for actual proof.
