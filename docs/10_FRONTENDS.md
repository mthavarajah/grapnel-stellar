# 10 — Both frontends: dashboard vs sample fintech

## Non-negotiable separation
**App A: Grapnel B2B dashboard**. Owner registers a business, chooses API modules and manages API keys. Business administrator session. **App B: independent sample fintech**. Ordinary end customers use the business's product, not Grapnel; fintech's Next.js server holds business API key. The sample fintech must not import Soroswap/Blend SDKs, query Stellar RPC directly for financial operations, or access Grapnel DB. **Only exception:** it invokes Privy client-side for authentication and customer wallet signing; blockchain activity and balance reads remain Grapnel API responsibilities.

## App A: Grapnel Dashboard (`apps/dashboard/`)
Screens:
1. `/login` and `/onboarding`: secure owner email/demo login; create Testnet `business`, show no mainnet option.
2. `/overview`: tenant ID, environment `stellar-testnet`, enabled modules count, API recent activity, quickstart cURL.
3. `/modules`: two sections Capital/Trade, six cards with description, provider and operational readiness badge (e.g. Testnet verified or discovery only). Checkbox selection and **Save changes**. API `GET/PATCH /v1/dashboard/modules`. If Spot disabled, existing key loses access immediately. Wallet dependency auto-added or explicit validation; preserve state after refresh.
4. `/api-keys`: list key metadata, issue `gr_test_...` secret once, copy to clipboard, redacted thereafter, revoke confirmation. Never display previous full secret.
5. `/logs`: list request_id, path, module, status, timestamp, duration; filter errors; no raw PII or credentials.
6. `/docs`: OpenAPI explorer or quickstart showing key usage, endpoints and one curl for an enabled module. Docs may live under API `/docs` with link.

Admin auth can use an established hosted session provider, or for short demo a signed secure cookie with single demo owner account; must still prevent anyone who knows business key from toggling modules. Implement CSRF protection for admin POST/PATCH and strict allowed origins.

### Module selection UX acceptance
- Owner starts with wallets/spot/lending disabled except chosen defaults. Can toggle only operationally supported modules for writes, but catalog displays all with readiness. If owner enables Spot and tries to disable Wallets, either auto-enable wallets or show dependent-module error. Implementation contract chooses auto-enabling; backend validates.
- Save transaction updates `business_modules`, module revision increments; key value does not rotate. Dashboard should display `Enabled modules: 4` and key prefix. Test actual allowed/denied API calls with same secret.
- A module can be **entitled** yet `discovery_only`; this never unlocks order execution. Status from `GET /v1/capabilities` is returned after provider checks.

## App B: Sample Fintech (`apps/fintech-demo/`)
Company name can be `Local Finance Demo`; avoid presenting it as an actual bank, broker or investment adviser. Copy clearly says "Stellar Testnet, demo assets, no real money". Design is plain fintech UI; all funding is clearly labeled Testnet-only, with no fiat implications.

Screens:
1. `/login`: customer signs in via Privy, obtains verified identity session; fintech server maps session to its own user and Grapnel `external_customer_id`.
2. `/home`: wallet G-address; XLM and each verified asset with issuer/contract; `wallet_amount`, `reserved`, `spendable`; lending positions separately. Show Testnet explorer link and account-activation state. Never label Blend position as available wallet USDC.
3. `/fund` (or `/deposit` labelled **Get Testnet Funds**): enabled by `capital.testnet_funding`; select allowlisted asset from `GET /v1/capital/testnet/funding-assets`, show configured grant quota, call `POST /v1/capital/testnet/fund`, poll real chain confirmation and show explorer link. Never show a fiat amount or MoneyGram widget.
4. `/markets`: visible cards Crypto, Stocks, Margin filtered by entitlement and readiness. Search and actual market quote; disabled execution with explanatory reason.
5. `/trade/:market`: exact-in amount, quote, min receive, fees/slippage, consent/Privy signing modal, operation progress, final actual amounts and hash.
6. `/earn`: Blend pool list current variable supply APY, reserve and liquidity/position details; supply/withdraw, optional borrow/repay if verified. Customer sees collateral implications and liquidation risks.
7. `/return` (or `/withdraw` labelled **Return Testnet Funds**): `POST /v1/capital/testnet/return` prepares a real wallet-authorized transaction to fixed treasury; display freely spendable only, preserve XLM reserve, no fiat payout claim.
8. `/activity`: list pending/confirmed/failed operation statuses, tx hash, provider, updated timestamp. Poll with backoff and stop on terminal state.

### Page access / entitlements
Sample fintech BFF calls Grapnel `GET /v1/capabilities` server-side. Every UI route checks module enabled and readiness. Server **also** checks capability before calling financial API; UI hiding buttons is not authorization. Disable actions with reason and provider status. If B2B dashboard disables Spot while customer is on trade page, next request returns `403 MODULE_NOT_ENABLED` and UI handles gracefully.

### Funding/return interaction details
- Funding asset dropdown is sourced from Grapnel and should show only actual `available` funded assets; default native XLM. If treasury has no verified eligible USDC inventory, do not offer a USDC grant or show a `USD` label.
- Start `fund` server-side only after session verification; display `accepted → submitted → confirming → completed`, show operation ID and actual transfer hash. No customer signature is needed for treasury-owned outgoing transfer, but BFF must still bind the customer's session.
- Start `return` with amount and asset only; Grapnel constructs a fixed-treasury `PreparedAction`, customer signs through Privy, BFF submits authorization and polls for actual confirmation. Show `awaiting_customer_authorization` rather than optimistic balance changes.

## Customer identity and session
Fintech backend uses secure session to identify the customer. On first Privy login, verify identity via supported Privy server verification, then `POST /v1/customers` with tenant-bound external ID and link wallet through approved ownership proof; **never** accept wallet address alone as proof of account ownership. Subsequent calls derive `customer_id` from server session, not from browser. For action signing, the browser gets a short-lived `PreparedAction` and passes the Privy signature through fintech BFF; no business key, customer private key or treasury secret in client.

## Sample server request adapter
```ts
// Next.js server ONLY, not a React client file:
async function grapnel(path: string, init: RequestInit = {}) {
  const response = await fetch(`${process.env.GRAPNEL_API_URL}/v1${path}`, {
    ...init,
    headers: { 'Authorization': `Bearer ${process.env.GRAPNEL_API_KEY}`,
      'Content-Type': 'application/json', ...(init.headers || {}) },
    cache: 'no-store'
  });
  const body = await response.json();
  if (!response.ok) throw new GrapnelError(response.status, body.error);
  return body.data;
}
```
Caller derives session customer and passes an `Idempotency-Key` on financial actions. `GRAPNEL_API_KEY` must never be exposed via `NEXT_PUBLIC_` env vars, embedded in HTML or logged.

## UX acceptance plan
- Two separate public URLs. Business logs into dashboard, disables Spot; fintech Spot action immediately denied. Re-enable Spot, same key works.
- Customer signs in, receives Testnet wallet, sees actual onchain balance.
- Click Get Testnet Funds -> treasury-funded real Testnet asset transfer and explorer hash, with exact issuer/contract identity.
- Click Spot -> real quote and signed swap if verified, otherwise accurate explicit unavailable message.
- Click Earn -> real Blend pool read and supply/withdraw if verified; account/wallet position refreshes.
- Refresh browser, operations remain persisted; no vanishing fake balances.
- Test on mobile view for demo; don't optimize full accessibility/theme before P0 backend works.

The customer funding page shows confirmed wallet balances and the gated Testnet treasury request. The QR/address deposit portal was removed at the user’s request. Wallet addresses remain internal for account binding, execution checks, transaction approval and explorer links.

## Owner UI revision — November 12

Velocity removes the Personal workspace selector, top breadcrumb/header strip, and Perpetuals asset-class dropdown. Market search remains. The profile trigger is anchored at the sidebar bottom, with its existing balance/logout popup opening beside it.

Explicit customer action buttons now prepare and initiate exact wallet authorization in the same interaction rather than requiring a second in-app Review click. This applies to the core Stellar operation actions, Robinhood approvals/swaps and GMX actions. Wallet authorization, transaction inspection, scope/network/fee/expiry checks and one-use durable send claims remain required. Page render, GET recovery and background polling never initiate a signature. An uncertain submitted request is reconciled, not automatically signed or sent again. Existing pending unsigned requests require an explicit Continue action. Stock actions use a portal progress dialog with focus containment, Escape/close and focus restoration; dismissal retains the server request. Network transaction confirmations continue to determine completion.

## Loading and signing follow-up — November 12

Privy now lives in the persistent root layout, so route changes do not recreate its wallet provider. Navigation reads current module entitlements without provider probes, then loads full readiness separately. BFF module preflights request only their exact module and omit provider reads for entitlement-only checks; each actual Grapnel action retains its authoritative module, identity and signing checks. No entitlement TTL cache is introduced.

The pinned Privy React SDK's optional transaction screen invokes its own transaction scanning path before signing. Stock actions already reconstruct exact calls in the browser and repeat live backend simulation, so explicit Buy/Sell now uses `signTransaction` with `uiOptions.showWalletUIs=false` (sign-only, no browser broadcast). This removes the redundant review/scanning screen; Privy authentication, wallet recovery/MFA when required, current ownership and exact returned-signature validation remain active. This is not yet customer-browser acceptance proof. A same-origin, authenticated diagnostic endpoint records only redacted signing stage/code/message; it never accepts transaction payloads, signatures or tokens.
