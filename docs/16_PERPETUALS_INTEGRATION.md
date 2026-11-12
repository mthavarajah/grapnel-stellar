# Perpetuals — Hyperliquid Testnet integration freeze

The owner explicitly replaced the customer-facing Peridot Margin feature with Hyperliquid **Perpetuals**, and authorized a Stellar Testnet USDC crosschain funding/return flow. This is an exception to the original Stellar-only execution scope; it does not authorize mainnet writes. The existing `trade.perps` module remains the entitlement. No separate bridge product is introduced.

## Networks and actual assets

- Stellar customer wallets retain the explicit Test SDF Network passphrase.
- HyperEVM uses Testnet chain ID 998; perpetuals execute on HyperCore, not directly as EVM contract trades.
- Circle CCTP lists Stellar domain 27 and HyperEVM domain 19 with Testnet support. Source/destination assets and contract links must be read and pinned before financial preparation.
- Circle Stellar Testnet USDC issuer is `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`; its SAC is `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`.
- Existing Blend/Soroswap USDC from issuer `GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56` is a different asset and is not eligible for this CCTP route.
- Stellar amounts have seven decimal places; CCTP messages use six. Reject nonrepresentable amounts instead of silently rounding them.

## Frozen discovery interface

Read-only Hyperliquid adapter uses only the pinned Testnet `/info` endpoint and chain998 RPC. Universe, exact symbol/index pairing, delisted state, current string prices and source metrics are validated; errors never produce invented zero prices or positions. Public Grapnel market rows identify `provider:hyperliquid`, `network:hyperliquid-testnet`, `asset_class:perps`, `module:trade.perps` and `market_id:hyperliquid-testnet:perps:<universe index>`. No execution is advertised until financial proof exists. Price data does not establish customer balances or permission to trade.

## Required financial workflow

1. Bind the exact tenant, customer, Stellar wallet, eligible HyperCore account and immutable order intent. A business key never supplies customer spend authorization.
2. Obtain the customer's approval of the exact canonical-USDC transfer/burn, amount, recipient and maximum fees. If escrow is used, separately persist and reconcile custody/deposit attribution before advancing.
3. Reconcile source confirmation, unique CCTP burn message, attestation and destination mint. A source hash alone is not destination funding.
4. Reconcile the actual HyperEVM-to-HyperCore deposit and the exact trading account balance before order submission. Distinct customers cannot share an unsegregated position or be credited from the same deposit.
5. Enforce the exact customer-approved asset, side, size, leverage, slippage, account and fees. Persist signed action/nonce before submission; recover by exchange order/client ID before any retry. Order acknowledgement is not a fill.
6. Read confirmed fills and the actual position. Closing is reduce-only and reconciles the remaining position, realized PnL, fees and withdrawable collateral.
7. Transfer only actual withdrawable proceeds back through the verified CCTP route and Stellar forwarder to the bound wallet. Confirm the customer's exact Stellar USDC balance delta before reporting completion. Losses/fees reduce the returned amount.

Every stage needs durable, idempotent operation records, unique external proof identifiers, tenant isolation and a recoverable interrupted state. Treasury-funded mirrored payments are settlement/conversion, not evidence of a CCTP bridge. No automatic new transaction follows an ambiguous send.

## Current blockers and proof gates

- Hyperliquid Interface terms displayed by the Testnet app name Ontario as restricted. Those terms describe the hosted Interface, so they do not alone prove a blanket API prohibition. An Ontario-eligible automated Testnet integration has not been confirmed; do not bypass a restriction or represent eligibility as verified.
- Circle's HyperCore Testnet guide requires the receiving address to have existing HyperCore mainnet state and imposes a Testnet receive limit. No mainnet deposit/activation is authorized. An already eligible, funded account or an officially supported Testnet activation path is required.
- Canonical Circle-USDC bridge completion, HyperCore order/fill/close and actual return to Stellar are all unverified locally. Evidence stays null until actual proof.
- Peridot is no longer the customer provider target. Its already funded own-QA position is being recovered without opening another position.

## Ownership

Lead owns shared contracts, HTTP routes, DB migrations, runtime integration and claims. Hyperliquid adapter and CCTP adapter work use disjoint owned paths and read-only tools until their write scopes are reviewed. UI work owns customer Perpetuals presentation and cannot invent provider execution or redefine shared contracts.

## Frozen execution adapter ownership

`modules/perpetuals/execution-contract.ts` freezes the internal account/approved-intent/signed-payload/reconciliation interface. Only a separately validated exact customer approval may create an `ApprovedPerpetualIntent`; browser/body booleans cannot authorize it. Account bindings are tenant/customer/wallet specific and globally segregated by actual provider address. A signed payload, nonce and client order ID must be durably stored before sending. The adapter may not create accounts, bridge funds, silently update leverage, use mainnet endpoints, or treat an acknowledgement as a fill. Setting leverage is a separate customer-approved stage before the bounded order. Execution adapter implementation owns only `adapters/hyperliquid/execution/**`; discovery owns sibling reader/catalog files. Tests are offline until an eligible funded Testnet account and signing authority are configured.


## Customer workflow freeze v0.3.1

Migration0007 and `workflow-contract.ts` segregate each EVM account globally and scope all challenges/orders to tenant/customer/Stellar wallet. EVM signing remains in the customer's browser. Account binding requires a one-use five-minute server challenge signed by the Stellar wallet (SHA256 UTF8 message, Ed25519) and EVM wallet (personal_sign). Order approval requires the exact SHA256 human-readable intent signature and the independently reconstructed Hyperliquid Testnet EIP712 order signature. No server-exported customer key or shared treasury-mirror credit is permitted. The immutable signed payload is persisted before an atomic send claim; after ambiguity, only reconciliation is allowed.

PreparedAction summary adds optional `allowanceExpirationLedger` (positive decimal integer string) for a separately reviewed exact canonical Circle-USDC allowance. Existing callers are compatible. This ledger is an authorization limit, not a fee or a transfer amount. Scope and UI approval must preserve it unchanged.


## Owner steering: bridging parked, November12

The owner explicitly parked Perpetuals bridging after the Soroswap/ROZO review. Keep the tested CCTP adapters and setup callbacks for future work, but do not initiate a transfer, enable a bridge capability, or offer spending-approval setup in the current customer card. Current Stocks uses the source-classified Hyperliquid stock/index perpetuals and can be tested through a separately funded customer Testnet EVM account after binding, access verification and exact signatures. This is not a Stellar stock-share route and is not live-fill acceptance proof. The unanswered account/source questions remain prerequisites; no account or balance is fabricated.

## Current owner direction — November 12, 2026, 22:17 UTC

The customer Perpetuals catalog again uses Hyperliquid Testnet, superseding the temporary GMX catalog. Robinhood Stocks stays separate. Work remains sequential, with subagents stopped. The full source catalog contains 1008 slots across 279 venues: 658 active and 350 delisted. All active source-qualified markets are selectable without requiring curated artwork; selected-venue reads provide exact source prices/candles. Listing does not establish execution acceptance or compatible collateral. Of the active entries, 553 declare canonical USDC collateral and 105 declare other collateral. The existing execution adapter still permits native/xyz USDC markets only; other listings remain discovery-only.

The current QA and customer accounts both report zero native HyperCore account value, withdrawable collateral and open positions. See `evidence/hyperliquid-catalog-verification.json` for the timestamped read and complete active listing identities. No funding/open/close proof exists. The order card reuses the current Privy session, uses green Long/red Short selection, collapses funding details, and can prefill an exact opposite-side reduce-only close review. Closing still requires a valid limit, customer review/signatures, live position verification and actual fill reconciliation.

Funding remains unresolved. Hyperliquid's official faucet requires prior mainnet deposit by the same address. Circle's current HyperCore Testnet rules require recipient mainnet state and limit receipts to 1000 Testnet USDC; unsupported recipients can fail silently. No mainnet write is authorized. A genuinely funded Testnet treasury is a candidate alternative, subject to verified recipient activation, exact authorized transfers, durable caps and proof. No balance is credited locally, no new burn is initiated, and parked CCTP setup controls remain hidden unless a verified available route or retained recovery operation exists.
