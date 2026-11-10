# AGENT 07 — Independent Sample Fintech Frontend + Backend-for-Frontend

**Read:** `AGENTS.md`, `docs/00_PRODUCT.md`, `03_API.md`, `05_SIGNING.md`, `06_FUNDING.md`, `08_BLEND.md`, `10_FRONTENDS.md`, `11_TESTS_SECURITY.md`. Own `apps/fintech-demo/**` except shared signer helper coordinated with Chain agent. This frontend is an actual example BUSINESS consuming Grapnel's B2B API, not Grapnel's own consumer product.

## Required implementation
- Next.js customer login (Privy) and server customer session. Verify Privy ID token; server maps session to tenant-scoped customer and wallet.
- Backend-for-frontend `/api/*` routes call Grapnel server-to-server with env `GRAPNEL_API_KEY`, never expose key publicly. Do NOT directly import Blend/Soroswap SDKs or query Stellar financial state from browser/BFF.
- `/home`: real balances per exact asset identity, spendable vs reserved and Blend positions separate; Testnet addresses/hashes.
- `/fund` (or Deposit relabeled Get Testnet Funds): load available real Testnet assets from Grapnel; call actual treasury-funded operation through BFF, show tx hash and asset identity. No fiat amount, provider, MoneyGram widget or simulated bank payment.
- `/markets` & `/trade`: read enabled capabilities and executable markets, quote, show slippage/min receive, customer approves prepared action via Privy, poll actual order operation, display confirmed balances/hash.
- `/earn`: live Blend lending pool with variable APY and risk; supply/withdraw verified actions, optional borrow/repay only when backend marks available.
- `/return` (or Withdraw relabeled Return Testnet Funds): customer signs an exact testnet transfer to fixed treasury; show chain confirmation and preserve XLM reserve; not a fiat withdrawal.
- `/activity`: poll real operations; show 202/confirming/failed, no fake fills.

## Wallet identity and signing
Browser can call Privy for login / signing because customer needs wallet interaction. It may not derive any Grapnel business key. Ask Chain agent for `signPreparedAction` helper using exact v0.1. No unsigned arbitrary XDR from caller. Fintech BFF verifies customer session before requesting operation approval and passes only verified appropriate user proof.

## Test gates
- In two tenants, customer session A cannot use customer/wallet ID B.
- On owner disabling Spot, existing fintech trade page handles 403 and stops submission.
- Get Testnet Funds real treasury transfer hash and exact asset on home; customer Return uses a separate signed tx hash.
- Trade/Blend only marked completed when Grapnel operation verified.
- Incognito public URL runs, customer can sign real chain action, no secret in JS bundle.

## Product copy
'Built with Grapnel APIs on Stellar Testnet'; 'Testnet tokens only, no fiat or real value'; 'Blend supply APY varies and is not guaranteed'; 'Perpetuals may be unavailable due to provider restrictions'. No broad financial-access claims of regulated live securities or licensed lending.
