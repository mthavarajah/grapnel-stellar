# 00 — Product, scope, and competition demo experience

## What judges must understand in 20 seconds
Grapnel is a modular **B2B2C REST financial infrastructure platform**, not a consumer bank. Local businesses enable API modules and integrate familiar HTTP endpoints; Grapnel handles Stellar wallets, transaction preparation/signing flows, protocol calls, and settlement monitoring. The **sample fintech** is an independent business using Grapnel's API. Unlike thin wrappers over individual protocols, the product demonstrates tenant entitlements, customer consent, unified operations and portfolio views.

## Complete intended walkthrough
1. Business owner signs into Grapnel dashboard and creates the `Demo Fintech` tenant on Stellar Testnet.
2. Enables `capital.wallets`, `capital.testnet_funding`, `trade.spot`, and `capital.lending`. Disabling Spot immediately makes the same business API key receive `403` on Spot writes; re-enabling restores access **without rotating the key**.
3. Creates business API key, copies once, stores it only in sample fintech backend environment.
4. Customer logs into sample fintech via Privy; backend verifies Privy identity and creates/links customer and Stellar `G...` address. Grapnel activates a new account with Friendbot to provide native XLM for network reserve/fees (not USDC).
5. Customer selects **Get Testnet Funds**. Sample fintech server calls `POST /v1/capital/testnet/fund`; Grapnel uses an allowlisted treasury asset and its server-side Testnet treasury signer to make a **real confirmed Stellar Testnet transfer**. It shows exact asset identity, amount, operation state and explorer hash. No fiat payment, fiat conversion, payout or MoneyGram/Privy Funding in this demo.
6. Actual chain balances refresh; wallet XLM and Soroban/classic assets remain distinguished. A funding asset is compatible with a particular market/pool **only after its exact issuer/contract is validated**.
7. Spot: customer requests real quote for a verified Testnet pair via Soroswap; approves exact prepared transaction through Privy, Grapnel submits and verifies final balances/hash. If no executable route exists, say so; a simple payment is not evidence of a spot swap.
8. Blend: load real Testnet pool and eligible reserve, show **variable** supply APY and risks, submit authorized supply, show actual onchain position, then withdraw subject to liquidity and health. Borrow/repay only after collateral and liquidity verification; use funded XLM reserve if it is the supported first path.
9. Customer chooses **Return Testnet Funds**. Grapnel prepares an actual customer-authorized Stellar transfer of available, unencumbered test assets to the verified demo treasury address, confirms chain result. This is **not a fiat off-ramp**.
10. Activity and dashboard request logs show true provider and chain states. Public frontend/API URLs, public repo, video and transaction evidence are gathered for Devpost.

## Six business-selectable demo modules, two API groups
| Module ID | Name | Provider / execution | Priority |
|---|---|---|---|
| `capital.wallets` | Wallet Infrastructure | Privy Stellar Tier 2 + Stellar SDK | P0 account, balance, real signing |
| `capital.testnet_funding` | Testnet Funding & Return | Stellar Friendbot for activation, Grapnel Testnet treasury for transfers | P0 fund and authorized return |
| `capital.lending` | Lending, Borrowing & Yield | Blend v2 on Stellar Testnet | P0 actual supply/withdraw; P1 borrow/repay |
| `trade.spot` | Crypto | Soroswap + Stellar DEX / Aquarius as routed | P0 real testnet swap |
| `trade.stocks` | Stock Tokens | Robinhood Chain Testnet, exact USDG pools for TSLA/AMZN/PLTR/NFLX/AMD | Quotes and transaction preparation verified; live execution pending |
| `trade.perps` | Perpetuals | Hyperliquid Testnet; canonical Circle-USDC funding/return integration | Discovery verified; live funding and orders pending |

**Dependency rule:** `capital.wallets` is required for Testnet funding/return, lending and trade writes. UI may auto-enable wallets; backend must enforce the dependency. Internal coordinator, reserve management and portfolio reconciliation remain noncommercial internals. No on/off-ramp, cross-chain, extended bridging, venue-funding, capital-router product or separate Ledger product for this hackathon.

## Availability and truthful demo representation
Each module has tenant entitlement and actual provider execution state: `testnet_verified` | `discovery_only` | `blocked` | `simulation`. Real testnet funding is `testnet_verified` **only after a confirmed treasury transfer**; Friendbot XLM ≠ issued USDC. Business may enable an unready feature, but order buttons stay unavailable with a reason. P2 reference stock tokens must never be presented as real ownership/claims. No fake transaction hashes or positions.

## Out of scope
**No fiat on-ramp/off-ramp implementation**, MoneyGram, Privy Fiat Funding, banks/cards, simulated fiat balance/payout, live deposits, KYB/KYC integrations, real securities, production custodial services, mainnet transfers, cross-chain bridges, SDK/CLI/MCP, billing, broad blockchain wallet abstraction or custom smart contracts unless demonstrably needed. Testnet assets have no redemption or investment value. Variable yield is not guaranteed. Perps and investments involve real-world legal constraints outside this educational Testnet demo; I'm not a lawyer.

## Definition of working
At minimum: public dashboard + live REST API + independent sample fintech, real business entitlements and key behavior, customer-linked Stellar Testnet account and real confirmed transfer with hash. **Full MVP target before submission:** confirmed Soroswap swap and Blend supply/withdraw in addition to funding and return. Do not claim these until their actual chain and position checks succeed.

The November11 owner-authorized Hyperliquid/CCTP revision supersedes earlier crosschain exclusions for this one Testnet workflow under `trade.perps`; it does not create a bridge product or permit mainnet writes. See `docs/16_PERPETUALS_INTEGRATION.md`. Peridot remains historical QA only.
