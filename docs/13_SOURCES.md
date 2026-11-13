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

## November12 — Privy/CCTP/Robinhood funding revision
- Privy explicitly documents HyperEVM Testnet chain998 and React `supportedChains` / `defaultChain`: https://docs.privy.io/recipes/hyperliquid/hyperevm . Same Privy identity can own separate Stellar and EVM wallets; this does not supply tokens or waive HyperCore recipient requirements.
- New Privy apps must enable identity tokens: https://docs.privy.io/user-management/users/identity-tokens . Verified new-app login after enabling that setting; saved fintech sessions now bind to the app ID.
- CCTP prerequisites and actual contract/event observations refreshed in `adapters/cctp/research/testnet-registry-read.json` and `source-event-read.json`; read-only observations are not execution proof. Existing-mainnet-state and Testnet receive-limit ambiguity remain in https://developers.circle.com/cctp/concepts/cctp-on-hypercore . No verified remaining-capacity counter was found.
- Official Robinhood USDG source: https://docs.paxos.com/guides/stablecoin/usdg/testnet and https://faucet.paxos.com/?token=USDG&network=ROBINHOOD . Sanitized funding/router evidence under `adapters/robinhood/research/`. All five markets use verified Testnet USDG pools; reference prices come from Robinhood official REST and never substitute for execution quotes.

### November12 — Stocks completion

- USDG token artwork: official Global Dollar brand guidelines https://globaldollar.com/brand, hosted token logo https://424565.fs1.hubspotusercontent-na1.net/hubfs/424565/GDN_USDG_Token_32x32.png. Downloaded unchanged for local asset display; artwork does not establish token identity.
- Robinhood delayed recovery re-read: all ten existing own-QA buy/sell hashes independently confirmed through canonical transaction/receipt/ERC20-event reads. Exact proof and timestamps in `evidence/robinhood-recovery-verification.json`. No new chain transactions or fabricated historical balances were used.

## Hyperliquid refresh — November 12, 2026, 22:17 UTC

- Live Testnet info requests (`perpDexs`, `allPerpMetas`, `spotMeta`, optional annotations) returned 1008 slots / 279 venues, including 658 active markets. Native BTC `metaAndAssetCtxs` and 97 fifteen-minute candles were read; no market prices were synthesized. Full source-qualified active identities and the two zero-collateral account reads are preserved in `evidence/hyperliquid-catalog-verification.json`.
- Rechecked [official Testnet faucet](https://hyperliquid.gitbook.io/hyperliquid-docs/onboarding/testnet-faucet): prior same-address mainnet deposit is required for its 1000 mock-USDC claim. No mainnet writes were made.
- Rechecked [Circle HyperCore considerations](https://developers.circle.com/cctp/concepts/cctp-on-hypercore#testnet-recipient-address-limitations): recipient mainnet state, 1000-Testnet-USDC receiving limit, and silent failure for missing mainnet state remain documented. These prerequisites were not bypassed; no new CCTP burn or HyperCore execution proof is claimed.

## GMX provider selection refresh — November 12, 2026

The owner selected GMX for customer Perpetuals. The live `https://arbitrum-sepolia-test.gmxapi.ai/v1/markets` response lists six perpetual markets: ETH, BTC, CRV, XAU, XAG and XPT. Reader.getMarkets returned ten deployed market records; each of the six listed records matched the exact market/index/long/short addresses on chain421614. See `evidence/gmx-catalog-verification.json`. Listed markets are distinct from deployed-but-unlisted records and from successful trade proof. No Testnet equities, forex or energy listings were present in this response. Four synthetic index identifiers returned no ERC20 decimals data; their precision must be verified against official provider configuration rather than guessed. `/markets` without the `/v1` prefix returned404.

- 2026-11-13 00:02 UTC: Robinhood Testnet RPC chain46630 independently verified customer transaction `0x4d58307453739100b5073d5db16e847545542b406473dbf7fc9a3b028d08e04c` as USDG approval only, not a stock swap. `eth_getTransactionByHash`, canonical receipt Approval event and block-pinned `balanceOf`/`allowance` reads preserved in `evidence/customer-stock-approval-followup.json`. Explorer: https://explorer.testnet.chain.robinhood.com/tx/0x4d58307453739100b5073d5db16e847545542b406473dbf7fc9a3b028d08e04c . No customer share receipt is claimed by this approval evidence.

- 2026-11-13: GMX Arbitrum Sepolia controlled-QA BTC open/close independently verified from exact creation transactions, canonical keeper receipts, protocol position events and final Reader absence. Evidence: `evidence/gmx-btc-roundtrip.json`; keeper open https://sepolia.arbiscan.io/tx/0xee726fe09233e683ffa9733b12f609cb4d3a196448fc29cda443f6ebcb7d72a2 and close https://sepolia.arbiscan.io/tx/0x41ff581feea0e86d1281108131cb35884de95777fc8adb8c6a8f57286e01e73d . QA proof does not establish customer browser execution.

- 2026-11-13: Rechecked the six listed GMX Arbitrum Sepolia markets against the official API and onchain Reader. Synthetic index precision18 and logo source URLs verified against https://raw.githubusercontent.com/gmx-io/gmx-interface/master/sdk/src/configs/tokens.ts . Separate backing-token price and reserve math follow https://github.com/gmx-io/gmx-synthetics/blob/main/contracts/market/MarketUtils.sol and Keys.sol. CRV/Gold Long and Silver/Platinum Short canonical open/close evidence is preserved per market under evidence/gmx-*-roundtrip.json. CRV logo: https://github.com/spothq/cryptocurrency-icons/blob/master/128/color/crv.png . Metal logos use the URLs in GMX's official token configuration.

- 2026-11-13: Higher-resolution Velocity wordmark obtained unchanged from the University of Waterloo publication https://uwaterloo.ca/daily-bulletin/2023-01-05 at https://uwaterloo.ca/daily-bulletin/sites/default/files/uploads/images/0105velocity-1.png (679×213); source/checksum recorded in `apps/fintech-demo/public/brand/velocity-sources.json`. The current official Velocity website still uses its smaller co-branded483×67 footer image. Trading is a separate product text descriptor.

- 2026-11-13: Independently revalidated the actual customer Privy ETH mint/approval/open/full-close flow using canonical GMX Testnet creation/keeper receipts, exact position events and current Reader absence. Evidence: `evidence/gmx-customer-roundtrip.json`. Keeper open: https://sepolia.arbiscan.io/tx/0x749a1183486b07a737dcd055eaa0755fa09aa795a6a3ef1baf0701d29f8ab1e0 ; keeper close: https://sepolia.arbiscan.io/tx/0x465d384b22d15f0e7b02b485917a188878034390bfa436ccc04b5bcf331f2b15 . Read-only activity-source verification preserved the same five actual funding/approval/trade records in `evidence/gmx-customer-activity.json`; its injected ownership fixture is explicitly labeled and is not a substitute for HTTP authorization tests.

### Zenex Stellar Testnet, November 13, 2026 UTC

Official Testnet frontend and `/v1/config` served one XLM/USD market. `/v1/prices/tickers` returned current Chainlink origin timestamps; `/v1/prices/udf/history?symbol=XLMUSD` returned all six requested UI horizons. Live instance hashes and exact SAC issuer were checked, not copied from mainnet docs. SDK reviewed at commit `45f4d818af455528c850b16269ec5015440f3148`. See `docs/20_ZENEX_TESTNET.md` and `evidence/zenex-roundtrip.json` for four canonical controlled-QA keeper fills.


### November 13 — chart denominations and historical coverage

- Official Binance market-data-only endpoints: https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md and https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md . Live `exchangeInfo` verified XLMUSDC/BTCUSDC/ETHUSDC/XRPUSDC as USDC-quoted trading pairs. Closed klines and timestamped 24-hour ticker observations supply the UI's USDC reference series. `evidence/market-chart-review/provider-history.json` preserves source URLs, intervals and actual first/latest points for every tested window.
- Official Robinhood Stock Token APIs: https://docs.robinhood.com/chain/stock-token-apis/ . The published endpoints provide live underlying bid/ask, asset metadata and corporate actions; no historical candle endpoint is listed. The app retains actual recorded official quotes and discloses coverage rather than inventing older candles. Observed history for all five stocks and all six ranges is in `evidence/market-chart-review/stock-history.json`.
- Zenex Testnet UDF history: https://api-testnet.zenex.trade/v1/prices/udf/history . One-year history succeeded; requests extending to two/five years or the epoch returned `upstream_unavailable` during this review. All therefore means the available verified one-year series, explicitly labeled with its coverage date. No execution capability or signing proof was changed.

### November13 — underlying stock presentation history

Verified actual `https://query1.finance.yahoo.com/v8/finance/chart/{TSLA,AMZN,PLTR,NFLX,AMD}` JSON responses (USD, exact symbol, EQUITY), all six requested display ranges; evidence: `evidence/stock-reference-review/history.json`. Range/interval pairs: Live 1d/1m with last session hour, 1D 1d/5m, 1W 5d/30m, 1M 1mo/1h, 1Y 1y/1d, All max/1mo. Source timestamps and regular-market observations are preserved, missing prices omitted. Public undocumented endpoint may be unavailable or delayed; never an execution/settlement source. Robinhood's [official REST docs](https://docs.robinhood.com/chain/stock-token-apis/) document live raw underlying bid/ask; recorded bid observations remain the disclosed fallback. No simulated backfill or claimed full-range coverage.
