<img src="logos/logo-name-white.png" alt="Grapnel" width="330" />

Grapnel is a **Stellar Testnet B2B infrastructure API** with a business dashboard and a separate sample fintech frontend/backend. Businesses enable modules and keep their API key on their server; customers separately authorize wallet spending through Privy.

**The core onchain Gate 2 MVP is verified locally; public deployment is pending.** Gate 0 foundation and Gate 1 customer signing are committed and verified. Real customer transactions prove treasury funding/return, Soroswap swaps and Blend XLM supply/withdraw. USDC supply and withdrawal are also verified. The customer Privy USDC borrow, full repayment and borrowing-collateral withdrawal are verified; Hyperliquid Testnet Perpetuals integration is in progress. See [gate status](docs/15_GATE_STATUS.md) and [evidence](evidence/testnet.json). No fiat rails, mainnet writes or custom Grapnel contracts.

Public source: [mthavarajah/grapnel-stellar](https://github.com/mthavarajah/grapnel-stellar). Local verification: [test/build results](evidence/local-verification.json).

## Run locally

Prerequisites: Node **22.12+**, pnpm **10.11**, PostgreSQL **16+**. The API refuses implicit or non-Testnet network settings.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
# Set DATABASE_URL, ADMIN_LOGIN_SECRET (16+ random characters), SESSION_SECRET (32+).
# Keep .env ignored; use dedicated Testnet provider credentials only.
pnpm db:migrate
pnpm db:seed
cp apps/dashboard/.env.example apps/dashboard/.env.local
cp apps/fintech-demo/.env.example apps/fintech-demo/.env.local
```

Run each service in its own terminal:

```sh
pnpm dev:api        # http://localhost:3001 — /health, /docs, /openapi.json
pnpm dev:dashboard  # http://localhost:3000
pnpm dev:fintech    # http://localhost:3002
pnpm --filter @grapnel/api worker
```

Sign into the dashboard with the configured owner secret. Enable Wallets before other modules, issue a business key once, and put it **only** in the sample fintech's server `GRAPNEL_API_KEY` environment. Set `GRAPNEL_API_URL`, `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `NEXT_PUBLIC_PRIVY_APP_ID` and a random 32+ character `FINTECH_SESSION_SECRET` in its ignored server environment. Configure the same Privy app and allowed origins. No customer login bypass is provided when Privy is unavailable.

API server variables and names are in [.env.example](.env.example). Dashboard and fintech have independent templates. Never place the business key, Privy secret or treasury secret in a `NEXT_PUBLIC_` variable. App-specific environment files are server configuration; the sample browser only uses the public Privy app ID.

## Modules and authorization

Capital: `capital.wallets`, `capital.testnet_funding`, `capital.lending`. Trade: `trade.spot`, `trade.stocks`, `trade.perps`.

Owner cookies and CSRF protect dashboard administration. A hashed/revocable API key identifies the business; its scopes follow current entitlement records on every request. Customer wallet actions additionally require verified Privy identity, current wallet ownership, exact signed transaction and a one-use authorization token. Tenant-scoped Postgres constraints, idempotency, reservations and durable worker records protect state.

```sh
curl http://localhost:3001/health
# Set GRAPNEL_API_KEY in your shell without placing it in source/history.
curl -H "Authorization: Bearer $GRAPNEL_API_KEY" \
  http://localhost:3001/v1/capabilities
```

Module administration uses an owner session: `POST /v1/dashboard/login`, then the cookie and returned CSRF token for `PATCH /v1/dashboard/modules`. See the dashboard, [REST contract](docs/03_API.md), [OpenAPI](openapi/grapnel.yaml), and [frozen integration rules](docs/14_GATE0_FREEZE.md). Existing keys gain/lose entitlements without rotation.

Financial operations return `202` and require polling. The worker stores hash/envelope before sending and reconciles chain result plus relevant effects before completion. It polls the same hash through indexing delays and never blindly creates a replacement transfer.

## Real evidence and limits

A dedicated Testnet treasury was activated with Friendbot, with **10,000 native XLM** independently read at activation. [Confirmed activation transaction](https://stellar.expert/explorer/testnet/tx/f89109f4379358f0e11771eef6e3aa7e9797dd9b99bf5c576ad3a61d37f76a36). This is **treasury activation only**, not a Privy-signed customer payment or grant/return proof.

Live Blend pool/reserve reads and a **customer-signed 0.1 XLM collateral supply** are verified on Testnet. Transaction `eed88945a8c1327f260a1808136d3c3e8c2dd2f62607628fe8ce95d04d54af35` succeeded at ledger 5669556; Grapnel reconciled the 0.0999997 XLM collateral delta and customer wallet fee/debit. A real 0.05 XLM withdrawal is also verified at ledger 5677438; see chain evidence. The existing Blend pool and token contracts belong to Blend. Current exact asset identities and timestamped reads are preserved in [Blend research](apps/api/src/adapters/blend/research/testnet-read.json) and [chain evidence](evidence/testnet.json). Its current USDC reserve is a classic issuer asset exposed through a SAC; it is distinct from native XLM and is not held by this treasury merely because the symbol is USDC.

Authenticated Soroswap Testnet discovery, exact quotes, inspected transactions and customer-signed swaps work. Both classic USDC directions and XLM→standalone BTC have actual transaction proof. Additional catalog routes remain preparation-only until individually executed and reconciled. Mainnet asset lists and unverified multihop routes are excluded. See [sanitized discovery](apps/api/src/adapters/soroswap/research/README.md).

The restricted `/v1/capital/wallets/:id/test-payment` endpoint prepares a customer-authorized payment of at most 1 XLM to the fixed treasury for Gate 1. Actual Privy-signed payment, treasury funding/return, both classic-USDC Soroswap directions, XLM and USDC Blend supply/withdraw are verified; see [recorded evidence](evidence/testnet.json). The remaining standalone-token swap directions await customer execution proof. No Freighter fallback has been used.

The separate borrowing pool has a verified customer Privy roundtrip: [0.1 USDC borrow](evidence/borrow-usdc-customer.json), [full repayment](evidence/repay-usdc-customer.json) and [2 USDC collateral withdrawal](evidence/withdraw-usdc-collateral-customer.json). Repayment cleared debt tokens to zero; the withdrawal left **30 collateral receipt units of rounding dust**, so collateral is not claimed to be zero. This borrowing-pool withdrawal does not establish withdrawal acceptance for the separate Earn pool.

Velocity includes real observed price history, asset-driven Sell/Buy panels, compact Earn controls and verified accrued interest. The catalog has seven verified token identities and twelve reviewed direct XLM directions. Perpetuals now targets Hyperliquid Testnet with actual market data and candle history. Privy-signed canonical Circle-USDC CCTP funding now has durable source/mint/deposit stages and independent chain-proof readers. Source burns remain blocked until HyperCore Testnet recipient eligibility and receiving capacity can be verified. No live CCTP transfer, HyperCore fill/close or reverse transfer is claimed. Peridot is retired from the customer tab; its protocol QA evidence is retained. The Stocks tab now uses the five verified Robinhood Chain Testnet stock tokens, official Robinhood USD reference prices and separate USDG execution quotes. Paxos USDG and Robinhood ETH faucets fund the customer’s Privy EVM wallet. Stock order preparation/reconciliation is implemented, but actual stock execution proof is still missing. SODAX mainnet assets and the blocked Ztellar candidate are excluded from the current customer catalog. Unverified execution remains blocked. Public hosting and the submission video remain pending; deployment is deferred until the user finalizes localhost.

## Validation and deployment

```sh
pnpm lint
pnpm typecheck
pnpm test                         # offline tests; no chain broadcasts
API_TEST_DATABASE_URL=postgres://localhost/grapnel_api_test pnpm test:integration
pnpm build
pnpm test:e2e                     # local apps running; installed Chrome or Playwright Chromium
pnpm smoke:testnet               # read-only verification, never signs or sends
pnpm exec tsx scripts/scan-secrets.ts
```

Integration tests require a disposable database whose name ends in `_test`; they must never target development/production data. See [deployment guide](deploy/README.md), [submission script](deploy/SUBMISSION_SCRIPT.md), [source review](docs/13_SOURCES.md) and [agent handoffs](docs/handoffs/). Public URLs and demo/video links remain null until actually deployed and checked. Local screenshots are labeled local.

The [official deadline](https://blockchain-stellar-ic.devpost.com/details/dates) was rechecked November 10: **November 13, 2026 at 08:30 EST**. Submission requires public source, a functional Testnet prototype URL and/or owned contract IDs, a public one-minute functioning demo video, pitch and trifold. Missing Gate 2 transactions must be disclosed as an incomplete full MVP.
