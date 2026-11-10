# Sample fintech handoff — feat/fintech-ui

Gate 0 contract consumed, including lead-approved 0.1.1 signing spike/activity additions. Gate 1 and Gate 2 are not passed by this frontend work.

## Owned files and functionality

`apps/fintech-demo/**`: independent Next 16.4.6 / React 19.3.1 Local Finance Demo app and BFF. Screens cover wallet/home/login, Testnet funding/return, market discovery/quote/order, Blend market/position/supply/withdraw UI, activity and exact prepared-action approval. Official supplied Grapnel PNGs are copied unchanged into `public/brand` and used for sidebar/footer attribution; local fintech branding remains distinct.

BFF routes: `/api/session`, `/api/status`, `/api/grapnel/[...path]` with explicit allowlist. Privy identity token is verified server-side before customer creation/wallet provisioning. Session IDs derive from that verified mapping; financial payloads cannot override customer/wallet IDs. Business key is only in server fetch Authorization. Customer identity proof stays in the encrypted HttpOnly session; it is not returned by GET session/status or serialized into the page.

Customer sessions are AES-256-GCM encrypted and chunked into <=3000-character cookies, at most 4 chunks and 12000 sealed characters. Bounds deliberately account for both browser per-cookie limits and common request-header limits. Oversized sessions return 413 explicitly. Missing/reordered/tampered chunks fail authentication; logout and expiry clear metadata, legacy cookie and every possible chunk. Mutations require exact same Origin. Grapnel fetches reject redirects, sanitize errors and have a 20s timeout.

Browser signer uses Privy extended-chain `useSignRawHash`, StellarSDK Testnet digest/source/bounds checks, exact classic recipient/asset/bigint amount/fee ceiling summary binding before prompt, and Ed25519 signature verification. It signs only after explicit customer approval. Generic Soroban XDR is not interpreted by this client; the canonical Grapnel server inspector must validate any provider invocation before returning an immutable prepared action.

Operation polling increases from 2s to a 15s cap and stops at awaiting_customer_authorization and terminal/recovery states. The BFF authorization ownership read intentionally omits the customer identity header: API GET with identity issues/supersedes a pending action token, so forwarding identity during authorization precheck would invalidate the customer's approved token. No automatic replacement transaction is sent after uncertain state.

## Commands and outcomes

- `pnpm --filter @grapnel/fintech-demo typecheck`: passed.
- `pnpm --filter @grapnel/fintech-demo build`: passed production build.
- `pnpm exec vitest run apps/fintech-demo/src/lib/session.test.ts apps/fintech-demo/src/lib/privy-signer.test.ts 'apps/fintech-demo/src/app/api/grapnel/[...path]/route.test.ts'`: 20 passed after final session-expiry regression addition (7 session/fetch, 7 signer, 6 BFF tests).
- Actual installed Chrome headless smoke on isolated production port 3012: all seven routes returned 200, desktop and 390px mobile rendered with no horizontal overflow/page errors, no browser business-key leaks observed, hostile-Origin POST rejected 403. API status reported Grapnel configured, session configured, Privy not configured. No customer session, balance or transaction success was fabricated.
- Screenshots visually inspected: `/tmp/grapnel-fintech-home-branded.png`, `/tmp/grapnel-fintech-mobile-branded.png`; sanitized browser result `/tmp/grapnel-fintech-browser-result.json`. They are local setup-state screenshots, not public deployment or chain evidence.

Tests cover session integrity/expiry/large-token chunk boundaries/clear/tamper, redirect rejection, exact signature and semantic intent mismatch denial, session-derived financial IDs, browser ID overrides, foreign operation isolation, token-preserving authorize precheck, hostile Origin and arbitrary upstream route denial. All fixtures remain offline.

## Dependencies and integration

App manifest owns next 16.4.6, react/react-dom 19.3.1, @privy-io/react-auth 3.51.3, @privy-io/node 0.38.0, @stellar/stellar-sdk 14.3.0 and buffer 6.0.3. Privy auto-peer selection initially produced an incompatible Solana build; explicit compatibility pins @solana/kit 8.6.0, @solana-program/{memo 0.16.0, system 0.16.0, token 0.16.1} resolve the production build. No Solana product/financial calls are introduced. Lead must update root pnpm lockfile after cherry-pick; root/shared contracts/migrations were not modified by this role.

Env names only: GRAPNEL_API_URL, GRAPNEL_API_KEY, PRIVY_APP_ID, PRIVY_APP_SECRET, NEXT_PUBLIC_PRIVY_APP_ID, FINTECH_SESSION_SECRET, NEXT_PUBLIC_GRAPNEL_NETWORK. App example and README supplied; real values remain ignored/server-only.

## Blockers and actual evidence

No Privy customer credentials/session available, so no actual login, user wallet creation, signing or onchain hash is claimed. No Soroswap credential/liquid route or executable Blend proof is claimed. Fund/return/quote/order/lending buttons require API execution readiness; the restricted ≤1 XLM wallet test-payment path may prepare the Gate 1 proof once real customer login is configured. No Freighter fallback or local customer signing key is used.

Lead next: merge scoped commit, update/install root lockfile, set ignored app server env, run full monorepo build/tests and public-surfaces E2E, deploy with Privy allowed origins, then prove actual customer-signed payment and Gate 2 flows using real provider/chain evidence before promoting readiness.
