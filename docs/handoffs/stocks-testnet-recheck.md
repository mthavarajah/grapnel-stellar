# Stocks: fresh official registry and Testnet recheck

Observed 2026-11-11, evidence timestamps in `apps/api/src/adapters/stocks/evidence/`. No wallet writes, key creation, quote/build/send, customer actions or mainnet transactions.

## Implemented

`readStockDiscovery({ fetch?, now? })` and `parseStockDiscovery(config,tokens,observedAt)` in `apps/api/src/adapters/stocks/discovery.ts`. Live public SODAX GETs use fixed official HTTPS origins, timeout, no credentials and no redirects. Parser binds the registry's Horizon endpoint to an exact network, matches each provider-RWA token to its exact code/issuer/contract tuple and verifies the SAC using Stellar SDK + the correct network passphrase. Missing issuers, duplicates, wrong precision and network relabeling fail closed. Even an authentic Testnet identity remains discovery-only until liquidity and eligibility are separately verified. No execution method is provided.

The registry's `isRwa` classification includes commodity funds and ETFs as well as stock tokens. Output deliberately says `provider_rwa`; callers must classify the relevant subset separately and must not describe all 46 as equities or as underlying share ownership. No shared routes or UI changed.

## Actual provider responses

- `GET https://api.sodax.com/v1/be/config/all`: 200, version 27, Stellar config explicitly `https://horizon.stellar.org` (mainnet).
- `GET https://api.sodax.com/v1/swaps/tokens`: 200. 46 Stellar RWA-marked contracts with exact issuer mappings. All 46 passed mainnet SAC derivation, rather than assuming the chain key `stellar` means Testnet.
- AAPL `CAZSFDNSSR2RKJ2LIIB2Y4G4WOSYYKC4646EUJ63PQLDDHOVQYZ4HDTK`, NVDA `CCQFCT4FHJURUQ4RQA4NHYW5GQRHCBDXF33ADXZRTDTDVGKOJO3ZPEMY`, TSLA `CARLFQDI2S2FSYFB47AZLKGUFZVGBEUVNW77SCJHHHGL2KPGT3TN5PAB`: actual registry contracts, all mainnet. Provider-listed issuer `GDYUTHY75A7WUZJQDPOP66FB32BOYGZRXHWTWO4Q6LQTANT5X3V5HNFA`.
- Testnet Horizon `GET /assets?asset_code={AAPL|NVDA|TSLA}&asset_issuer=<above>`: each 200 with zero records. This does not rule out a different official Testnet issuer; it disproves silently reusing this registry tuple.
- Authenticated `GET https://api.soroswap.finance/asset-list?name=soroswap&network=testnet`: 200, body explicitly `network:mainnet`, 50 assets; do not trust query presence as response network proof. The asset-list docs only define `name`, unlike network-aware pools.
- Authenticated `GET https://api.soroswap.finance/protocols?network=testnet`: 200 `["soroswap","sdex"]`.
- Authenticated `GET https://api.soroswap.finance/pools?network=testnet&protocol=soroswap`: 200, 652 pools. Zero matches for the 46 published RWA contracts and zero matches for their same-code/issuer Testnet-derived SACs. This probes Soroswap pools, not every possible SDEX orderbook or an unpublished alternate issuer.

One initial pools read timed out at 15 seconds; retry completed successfully. No 401/403 access blocker for these reads. The existing Soroswap credential sufficed. No key values captured.

## Concrete missing input / provider request

An API key alone cannot change these mainnet identities into Testnet assets. Ask SODAX/Soroswap, or the user claiming an existing verified Testnet route:

> Please provide your current **Stellar Testnet** stock integration source: stock token code, exact G issuer and C SAC, decimals, network passphrase, official Testnet registry/API base URL, accessible token distribution method, and a live pool/orderbook/route ID with funded liquidity against a specific Testnet quote asset. Please confirm permitted test-user jurisdictions/transfer restrictions and whether a partner API key has a Testnet scope. We currently receive registry v27 bound to mainnet Horizon; AAPL/NVDA/TSLA from that issuer have no Testnet asset records and no matching Soroswap Testnet pool. If a separate sandbox exists, please supply its documentation and access process.

The [official SDK configuration](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/CONFIGURE_SDK.md) documents partner-portal-minted `x-api-key` for protected swaps routes, with 401 missing/invalid and 403 scope/org failures. No protected financial endpoint was attempted. Partner access would only unblock stock execution if it includes the missing eligible Testnet registry and liquidity; not merely mainnet credentials.

## Primary sources

- [SODAX API](https://www.sodax.com/system/sodax-api)
- [SODAX official SDK configuration / API key / dynamic config](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/CONFIGURE_SDK.md)
- [Live SODAX config](https://api.sodax.com/v1/be/config/all), [live swap-token registry](https://api.sodax.com/v1/swaps/tokens)
- [Soroswap docs index](https://docs.soroswap.finance/llms.txt), [asset-list reference](https://docs.soroswap.finance/api-reference/market-data/asset-lists.md), [pools reference](https://docs.soroswap.finance/api-reference/market-data/pools.md)

## Validation

`pnpm exec vitest run apps/api/src/adapters/stocks/discovery.test.ts`: 8 passing tests. `pnpm --filter @grapnel/api typecheck`: passed. Real `readStockDiscovery()` call: returned 46 verified mainnet RWA identities. Test fixtures exercise identity and fail-closed behavior only; no execution success claimed. Stocks Gate 2 remains unresolved pending a verified eligible Testnet stock route.
