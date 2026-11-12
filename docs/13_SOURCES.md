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
| Tokenized stocks/margin | Protocol/product claims | Keep discovery-only and restrictions unless proven legal Testnet execution |
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

## Authenticated provider follow-up — 2026-11-10 (local date)
Privy SDK 0.38.0 `users().list({limit:1})` authenticated successfully; no user data was retained. This does not establish customer consent or signing. Soroswap `GET /protocols?network=testnet` and exact-asset pool discovery returned 200; `POST /quote?network=testnet` returned 201. The SDK's networkless `/asset-list?name=soroswap` returned `network: mainnet` and remains rejected for execution. Quote minima floor atomic amounts; the adapter requests one basis point tighter tolerance while keeping its original strict customer ceiling bound. Unsigned `/quote/build?network=testnet` returned 428 CREATE_TRUSTLINE for the exact Testnet USDC issuer. Sanitized requests/responses and route identities: `apps/api/src/adapters/soroswap/research/authenticated-discovery.json`. No trustline or swap was signed or submitted. Fresh unsigned Blend withdrawal preflight rejected with contract error #1217; `apps/api/src/adapters/blend/research/withdraw-preflight.json` records the source account, exact pool/asset and ledger. A real customer collateral position is still required before withdrawal trace inspection.

### Privy Stellar public-key response compatibility
Authenticated read of the current customer Stellar wallet returned a 66-character hexadecimal public key: a `00` prefix followed by the 32-byte Ed25519 key. The 32 key bytes independently match the decoded Stellar G-address. The parser now accepts this exact encoding alongside raw hex and the matching G-address, and still rejects any mismatched key, different prefix or incorrect length. No private key, identity token or customer address is recorded here. Regression checks and a live public-key comparison passed; this is wallet-format validation, not a customer signature or transaction proof.

## Parallel provider recheck — Nov. 11, 2026, evening local time
- Soroswap: fresh unsigned BTC→XLM customer-address quote/build/enforce passed at ledger 5685899. No signature or submission; actual reverse execution remains a customer acceptance item. See `apps/api/src/adapters/soroswap/research/CRYPTO_FINISH_AUDIT.md`.
- Stocks: public Testnet reads at ledger 5685880 confirmed the funded candidate vault but stale onchain pricing and unresolved eligibility provenance; SODAX stock routes remain mainnet-only. Verifier bytecode/configuration bindings are now checked. See `apps/api/src/adapters/stocks/execution/HANDOFF.md`.
- Peridot: the separate generated QA signer completed the actual normal Margin roundtrip, including atomic close, collateral return and receipt withdrawal. Final transaction `96fee4b166a406bebff02cd1791c1da0898ec6b913bc3e3e4912d42bbbe94ae3` independently returned `successful:true` from Testnet Horizon at ledger 5685880, fee 35963 stroops. The full manifest verifier passes; this is not customer Privy proof. New customer exposure remains blocked pending expired-swapped recovery and pre-begin/cancel-only exit handling. See `apps/api/src/adapters/peridot/customer/research/real-roundtrip-verification.json`.
