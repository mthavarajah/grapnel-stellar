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
