# Local Finance Demo

Independent customer fintech frontend/backend consuming Grapnel's REST API. Stellar Testnet only; no fiat or real money.

## Setup

Copy `.env.example` to ignored `.env.local` and set the server-only Grapnel API URL/key, Privy app ID/secret, and random `FINTECH_SESSION_SECRET` of at least 32 characters. Set only the public Privy app ID as `NEXT_PUBLIC_PRIVY_APP_ID`. The API business tenant must enable Wallets before funding/trade/lending. Configure Privy's allowed origins for the actual frontend hostname.

From the monorepo root:

```sh
pnpm --filter @grapnel/fintech-demo dev
pnpm --filter @grapnel/fintech-demo typecheck
pnpm --filter @grapnel/fintech-demo build
pnpm exec vitest run apps/fintech-demo/src/lib apps/fintech-demo/src/app/api/grapnel
```

The app runs on port 3002. Routes: `/home`, `/login`, `/fund`, `/return`, `/markets`, `/trade`, `/earn`, `/activity`. When provider configuration is absent, setup and unavailable states are shown; no customer login bypass or sample balances exist.

## Boundaries

- Privy verifies the customer; the server maps that identity to a tenant-scoped Grapnel customer and wallet. Customer/wallet IDs are derived from the encrypted session, never accepted from browser financial payloads.
- The business key and identity token remain server-only. AES-256-GCM sessions use bounded 3000-character HttpOnly cookie chunks, at most four chunks / 12000 sealed characters. Larger identity sessions fail explicitly rather than silently exceeding browser/header limits. Logout and expired/invalid-session handling clear all chunks.
- The BFF has an explicit endpoint allowlist and same-Origin mutation checks; it rejects credential-bearing HTTP redirects. Providers and financial state are accessed only through Grapnel.
- The browser uses Privy raw Stellar hash signing only after displaying the server's approval summary. It validates Testnet digest/source/expiry, exact classic payment asset/amount/recipient and fee ceiling before opening Privy, then validates the Ed25519 signature. No private-key export.
- Operation polling stops while customer authorization is awaiting/signing, preserving the one-use token. Authorization ownership checks omit identity from their preliminary operation read so they do not supersede that token.
- A 202 response is not completion. UI displays durable operation states and only shows confirmed transactions from the API. Module disablement is rechecked server-side for every action.

The extra pinned Solana packages satisfy Privy 3.51.3 SDK build peer compatibility; this app exposes no Solana integration or transaction path.

## Verification limits

Offline signature/BFF/session tests use explicit fixture identities and envelopes and never broadcast. Without actual Privy credentials, customer login, customer-signed Testnet payment, fund/return, Soroswap and Blend writes remain unproven. See root gate/evidence files for actual live verification.
