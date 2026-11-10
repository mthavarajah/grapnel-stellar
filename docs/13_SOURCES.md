# 13 — Research sources, verified scope, unresolved dependencies

**Reviewed 2026-11-10.** This pack is a research-backed architecture and API specification, NOT proof of completed API calls, credentials, deployments or successful trading. Coding agents must revisit the actual pages and current SDK versions immediately before implementation. Record source URL, revision and request/response for changes. We could not open the supplied Velocity Notion URL (404); Devpost is the sourced official requirement surface.

## Challenge
- [Official Devpost overview and prototype requirements](https://blockchain-stellar-ic.devpost.com/): live functional Stellar Testnet prototype, contract IDs **and/or** app URL, 1-minute real demo video, public GitHub/README, 3-minute pitch/trifold board. Deadline Nov 13 2026 8:30 AM EST.
- [Devpost dates](https://blockchain-stellar-ic.devpost.com/details/dates)
- [Velocity public challenge page](https://www.velocityincubator.com/programs-events/the-blockchain-innovation-challenge-powered-by-stellar)
- [User-supplied Notion brief](https://uwvelocity.notion.site/Blockchain-Innovation-Challenge-powered-by-Stellar-03f63713ead683f0a5048160f9a1fd2c): browser 404; not fully reviewed. User-provided "Access to Fair Financial Assets and Affordable Financing: Savings, Credit, and Inflation Resilience" is accepted product direction but not externally verified here.

## Stellar account and chain infrastructure
- [Stellar developer portal](https://developers.stellar.org/): accounts, trustlines, fees, tokens, Soroban, RPC and Horizon.
- [Stellar JS SDK](https://stellar.github.io/js-stellar-sdk/)
- [Contract invocation via SDK with simulation](https://developers.stellar.org/docs/build/guides/transactions/invoke-contract-tx-sdk): real Testnet passphrase `Test SDF Network ; September 2015`, sample RPC `https://soroban-testnet.stellar.org`.
- [Stellar Lab](https://lab.stellar.org/): Testnet account funding, build/sign/inspect transactions.
- [Testnet explorer](https://stellar.expert/explorer/testnet): evidence links; ledger may reset.

## Privy
- [Official chain support tiers](https://docs.privy.io/wallets/overview/chains): **Stellar Tier 2** can create/sign transactions; Grapnel must broadcast, simulate and reconcile (Tier 3 managed sends not promised on Stellar). Fiat coverage is independent and provider/region-specific.
- [Privy Tier 2 wallet integration](https://docs.privy.io/recipes/tier-2-wallet-integration): create supported wallet, build transaction, sign supported interface, attach signature, broadcast externally. Read installed SDK for exact Stellar signing method.
- [Privy recipe index](https://docs.privy.io/llms.txt): wallets, session authorization, auth, signing and app setup.
- [Privy React setup](https://docs.privy.io/basics/react/setup).
**OPEN:** prove actual Privy Stellar customer transaction-signing, Soroban auth, and wallet linkage with onchain Testnet hashes; do not merely quote tier support.

## Stellar Testnet funding (chosen MVP; no fiat)
- [Stellar Friendbot source and endpoint](https://github.com/stellar/friendbot): hosted `https://friendbot.stellar.org`, `GET /?addr=<G-address>`; activates and funds new **XLM** accounts only, not USDC or fiat.
- [Stellar JS SDK](https://stellar.github.io/js-stellar-sdk/): native asset and classic issued-token payments, trustlines and envelope signatures.
- [Stellar developer portal](https://developers.stellar.org/): network asset identity, Horizon balance queries, Soroban RPC, testnet network passphrase.
- [Blend Testnet contract registry](https://github.com/blend-capital/blend-utils/blob/main/testnet.contracts.json): verify that a treasury-held reserve asset is **exactly** the asset accepted by the chosen pool; do not infer compatibility from the `USDC` label.
**OPEN:** provision server-owned Testnet treasury with real confirmed balance, prove customer funding and signed return, validate treasury grant limits and replay recovery. No MoneyGram or Privy fiat API work in this competition build.

## Spot
- [Official Soroswap SDK](https://github.com/soroswap/sdk): `quote`, `build`, `send`, SDK Testnet network enum, underlying protocol enumeration including SDEX/Aqua, API key required, fixed unit BigInt. Docs have apparent package-name inconsistency; inspect SDK package metadata.
- [Soroswap docs](https://docs.soroswap.finance/)
**OPEN:** valid Soroswap Testnet API key, liquidity, contract IDs and actual quote/build/sign/send test. Do not assume a Testnet pair exists just because SDK supports Testnet.

## Blend
- [Blend integrate pool](https://docs.blend.capital/tech-docs/integrations/integrate-pool): supply/withdraw contract operations, pool metadata/positions.
- [Official Blend JS SDK](https://github.com/blend-capital/blend-sdk-js): `@blend-capital/blend-sdk`, `Pool.load`, `PoolContract.submit`, `RequestType.SupplyCollateral` etc, current SDK examples.
- [Official Blend Testnet contract registry](https://github.com/blend-capital/blend-utils/blob/main/testnet.contracts.json): at research time pool `CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF`, mock USDC `CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU`, XLM reserve `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`. Verify live current ledger before use.
- [Blend Utils deployment and mock pools](https://github.com/blend-capital/blend-utils)
**OPEN:** current pool active/liquid and signing supports Soroban auth. **Important:** Blend USDC token `C...` is a separate Soroban asset, not Friendbot XLM or an automatically interchangeable `USDC`. Consider the XLM reserve via Friendbot as the first Blend proof if supported.

## Additional asset classes / restrictions
- [SODAX developer API](https://www.sodax.com/system/sodax-api): existing API for intents/trading; announced stock-token integration with Soroswap, but no verified Testnet eligible route, so read/discovery only until proven.
- [Noether developer overview](https://docs.noether.exchange/developers): public Testnet REST market data; `orders/prepare` + `tx/submit` require beta key and signatures. **Explicit Ontario jurisdiction restriction, potential HTTP 451**; never bypass.
- [Noether API endpoint reference](https://docs.noether.exchange/developers/reference): keys, market data, positions.
- [Stellar tokenized investment assets](https://stellar.org/learn/tokenized-investment-assets): issuer-backed products, not proof of testnet market liquidity, eligible investor rights, or tradability.

## Decision/unknown matrix
| Issue | Verified | Decision |
|---|---|---|
| Challenge needs live Testnet app or contract ID | Official Devpost | Deploy URLs and real transactions, no custom contract necessary |
| Privy Stellar wallet provider | Tier 2 official | Choose Privy; prove end-to-end signing before large development |
| Testnet funding | Friendbot XLM + confirmed treasury inventory | Implement real Testnet funding/return; no fiat feature is exposed |
| Soroswap executable testnet | SDK advertises Testnet | Need real quote and confirmed trade, no automatic success |
| Blend deploy IDs | Official repository lists IDs | Validate live RPC + reserve; test XLM/USDC asset distinction |
| Tokenized stocks/perps/commodities | Protocol/product claims | Keep discovery-only and restrictions unless proven legal Testnet execution |
| Notion detailed criteria | Not available | Reconcile only if user provides export; no invented rules |

## Change management for agents
Record doc/API corrections with: date, official URL, observed API path/request, reason, proposed change, test evidence. Lead updates files. If provider docs evolve, prefer a live tested endpoint over stale prose but do not silently present new behavior as already supported; keep debug logs sanitized.

## Implementation review — 2026-11-10
- Orchestrator re-opened https://blockchain-stellar-ic.devpost.com/ and https://blockchain-stellar-ic.devpost.com/details/dates. Deadline remains November 13, 2026, 08:30 EST. Public repo, functional Testnet prototype URL/contract IDs, one-minute functioning demo, pitch and trifold remain required.
- Gate 0 migration executed successfully against local PostgreSQL 16 in a dedicated development database. This is schema verification, not deployed API or chain evidence.
- Privy server dependency pinned to `@privy-io/node@0.38.0`; Stellar SDK pinned to `@stellar/stellar-sdk@14.3.0`. Browser signing and provider probes require separate agent handoff and live evidence before any gate passes.
- Privy SDK 0.38.0 uses `owner:{user_id}` when creating a user-owned Stellar wallet. Current React extended-chain flow uses `useSignRawHash` with the exact Stellar transaction hash; see docs/handoffs/chain.md for official sources. No live user signing proof exists yet.
- Soroswap SDK source revision `46edd48ecef91dacc6d9d5d8571170aa7f482ab9` confirms `@soroswap/sdk` 0.5.0 and Testnet protocol/quote/build endpoints. Unauthenticated live `/protocols?network=testnet` returned HTTP 401 `MISSING_CREDENTIAL`; no valid quote or swap proof. See docs/handoffs/spot.md.
- Blend SDK 4.0.0 requires versioned `PoolV2.load` and `PoolContractV2`, not older unversioned examples. Current Testnet pool/reserve reads succeeded, with sanitized observations in apps/api/src/adapters/blend/research/testnet-read.json. Current reserve metadata identifies USDC as a SAC for classic issuer `GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56`; exact ID and SAC mapping checked live. Older pack wording calling this necessarily a standalone mock token is superseded by this observation. Treasury USDC inventory and funding-to-Blend compatibility remain unproven. Pool/reserves belong to Blend, not Grapnel.
