# Hyperliquid Testnet readonly adapter handoff

## Scope and sources

`HyperliquidTestnetReader.readMarkets()` verifies the fixed HyperEVM RPC reports chain998, then calls fixed `https://api.hyperliquid-testnet.xyz/info` with `{ "type": "metaAndAssetCtxs" }`. These are auth-free **reads**, despite the provider's JSON-RPC/Info transport using HTTP POST. There is no mainnet request, exchange request, signer, order, approval, bridge, account query or financial-write method.

The first/native perpetual DEX universe is returned in original index order, including delisted entries. Context count and unique names are checked; amount/price/funding metrics remain exact source decimal strings, optional absent values remain null. Delisted flags follow provider semantics (omitted means false). No stock-share/commodity classification, fabricated prices or executable capability is inferred. HIP-3 DEX discovery is not implemented or represented as covered.

Primary schema source: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals . Network source: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm . API docs often show the mainnet hostname as an example; this adapter never uses it.

## Freshness / bounded responses

Every call has an8second native AbortSignal deadline, no cache or credentials, and redirects rejected. Responses must be JSON and at most2MiB (both declared-size and streaming cap checked). HTTP Date, when supplied, must be no more than60seconds old or30seconds in the future. Requests exceeding the elapsed deadline fail even if a test transport ignores abort. Metadata supports at most2048 entries. Wrong chain, missing or mismatched contexts, duplicate markets, malformed decimals, numeric JSON amounts and missing required metrics fail closed.

`source.receivedAt` and HTTP Date are transport observations. The source endpoint supplies no per-market oracle timestamp, so `providerMarketTimestamp` remains null; this reader does **not** attest to oracle freshness from HTTP receipt alone.

## Actual live read (single probe)

`research/testnet-markets.json` was created by one live `readMarkets()` invocation at **2026-11-12T03:50:34.483Z** (November11 Toronto). Chain ID returned0x3e6. Info returned **213** entries, **54** delisted. Example SOL: mark83.174, oracle83.355, funding0.0000125, openInterest10136.3, dayNotionalVolume548270.28688, all preserved as strings. Result remains `discovery_only`, `executable:false`.

```sh
pnpm exec vitest run apps/api/src/adapters/hyperliquid/reader.test.ts
pnpm exec tsx apps/api/src/adapters/hyperliquid/research/probe-readonly.ts
```

**18 tests passed**, and isolated strict TypeScript checking passed for all four TS files. Full API typecheck in this older worktree is affected by existing `trade.commodities` references in app/runtime/routes against the concurrently updated shared contract package (module removed by lead); no shared code was changed by this adapter. Re-run full API checks after lead integration.

## Funding / access requirements are not solved by this reader

See `docs/research/hyperliquid-testnet.md` for source-backed review. Most consequential facts:

- Circle now documents **Stellar Testnet domain27 → HyperEVM Testnet domain19 → CoreDepositWallet → HyperCore**. This is a possible real bridge workflow, not locally verified execution. Chain998 is the EVM; perps/fills/positions live on HyperCore.
- **Circle's Testnet HyperCore recipient must already exist on HyperCore mainnet; it can receive at most1000testUSDC, and addresses without mainnet state can fail silently.** Do not automatically activate mainnet or ask the customer to make a mainnet deposit. Need an already eligible account or provider-supported exception/activation. Official source: https://developers.circle.com/cctp/concepts/cctp-on-hypercore . Official faucet likewise requires prior same-address mainnet deposit: https://hyperliquid.gitbook.io/hyperliquid-docs/onboarding/testnet-faucet .
- Use Circle Stellar USDC issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`, not the current Blend USDC issuer by symbol. HyperEVM Testnet Circle USDC is `0x2B3370eE501B4a559b57D449569354196457D8Ab`; legacy mockUSDC2 is a different asset. Verify exact current contracts and attestation routing before writes.
- An independent Stellar treasury payout after trading separate HyperCore funds is **treasury conversion/settlement**, not proof the original asset bridged. Need actual funded inventories, capped liabilities, customer approvals and separate deposit/fill/PnL/payout evidence.
- Current official Interface terms exclude Ontario and ship in Testnet frontend; they do not clearly establish an API/Testnet exemption or blanket protocol prohibition. Clarify allowed automated Testnet/integrator use with provider. This reader neither bypasses restrictions nor turns public data into trading permission.
- A user-owned EVM signer or explicitly approved Testnet agent wallet is separate from the Stellar Ed25519 wallet and business API key. Funding, exact intent signing, cancellation, close-only safety, reconciliation and customer UI remain lead-owned future integration. No execution acceptance is claimed.

## Candle history follow-up

`readCandles(symbol, interval, startTime, endTime)` reads official Testnet `candleSnapshot` after the same fixed chain998 check. Exported `HyperliquidCandleInterval` supports the provider's14 intervals1m through1M. Inputs are bounded to5000intervals and10years, positive safe integer milliseconds, end no later than30seconds beyond current time. Responses have at most5000rows, exact symbol/interval matching, strictly increasing times, intersecting requested windows, valid bar durations and internally consistent OHLC checked with BigInt decimal comparison. OHLCV remain strings; `tradeCount` is an integer. Empty source history returns an empty array. No interpolated candles or fake historical prices.

Return: `{provider,network,executionStatus:'discovery_only',executable:false,symbol,interval,candles:[{openTime,closeTime,open,high,low,close,volume,tradeCount}],source:{infoUrl,requestType:'candleSnapshot',receivedAt,httpDate,maxResponseAgeMs,requestedStartTime,requestedEndTime,maxRows:5000,historicalLimit:'most_recent_5000_source_candles',documentationUrl}}`.

A source bar overlapping the request start may open earlier; the current incomplete bar may close after request end. Both are retained with their actual provider times. Only the provider's most recent5000candles are available. UI timeframe selection must select the corresponding interval/window and must not promise older unavailable data. Source: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint (Candle snapshot).

One additional live auth-free candle probe returned25SOL1h bars for a24hour window at2026-11-12T03:53:28.125Z, saved in `research/testnet-candles.json`. **24 scoped tests and isolated strict TypeScript pass.** Reproduce with `pnpm exec tsx apps/api/src/adapters/hyperliquid/research/probe-candles-readonly.ts`. No mainnet/exchange/signing/deposit method added.

## Explicit xyz builder discovery extension

`readMarkets()` remains native-only for existing callers. New **`readAllMarkets()`** returns one fail-closed fresh snapshot of native plus the single reviewed builder allowlist entry **`xyz`**. It obtains the live `perpDexs` array, requires native null atindex0 and no other null slots/duplicate names, resolves xyz's actual current position, then concurrently requests native and `{type:'metaAndAssetCtxs',dex:'xyz'}`. Missing/malformed/stale/failing sources reject the complete snapshot; `partial:false` is returned only after all sources validate. No cache mixes earlier metrics with a new registry. Other builders such as `pas3307` are not requested or inferred eligible.

All xyz metadata must explicitly declare **`collateralToken:0`** and every name must retain exact `xyz:` qualification. This adapter does not classify any symbol as a stock, commodity or FX instrument. Root/UI classification and execution policy remain separate. Qualified symbols are passed unchanged to candleSnapshot. Delisted rows retain their source indices.

Identity additions on each parsed market: `dex`, `dexIndex`, `localAssetIndex`, `globalAssetIndex`. Existing `assetIndex` equals the same global provider ID. Native global IDs remain their original indices. Builder IDs follow the official formula **100000 + dexIndex *10000 + localAssetIndex**; local source arrays never overwrite native IDs. Source: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/asset-ids . The result's `source.registry.names` preserves registry positions; `source.dexes` preserves each fetch time/HTTPDate and the verified xyz collateral marker.

Actual combined public snapshot at **2026-11-12T04:06:14.554Z**: registry279entries; xyz current index65, USDC collateral0; **213native +70xyz =283 total source markets**. Examples: xyz:TSLA global750001, xyz:NVDA750002, xyz:AAPL750009, xyz:MSFT750010, xyz:GOOGL750012, xyz:AMZN750013. These are source-qualified perpetual markets, not shares. Some have no current midpoint or recent volume, and source mark/oracle/mid prices can differ materially; exact values/nulls are retained rather than substituting a stock-market quote.

Evidence: `research/testnet-builder-markets.json`; reproduce `pnpm exec tsx apps/api/src/adapters/hyperliquid/research/probe-builders-readonly.ts`. **33 scoped tests plus full API typecheck pass.** Added tests cover registry position/ID separation, index65formula, malformed registry, wrong DEX prefix, non-USDC/missing collateral, disallowed builder/index, delisting/index preservation, mismatched contexts, complete-snapshot failure and qualified candle identity. Execution stays `discovery_only`/false; no signatures/orders/deposits or mainnet requests.

## All-source catalog, exact collateral, lazy context extension

`readMarkets()` (native) and `readAllMarkets()` (native+reviewedxyz) are preserved. New **`readCatalog()`** reads every current source DEX using only five initial public requests: fixed chain998 check, then concurrent `perpDexs`, `allPerpMetas`, `spotMeta` and optional `perpConciseAnnotations`. It caches one complete metadata snapshot for60seconds with single-flight behavior and defensive clones. Each HTTP response retains the2MiB/8second controls; the entire catalog operation has a12second abort budget. Mandatory-source failure never falls back to stale data. Annotation-only failure explicitly reports `annotationStatus:'unavailable'` and null categories.

Result: `{markets,dexes,registryNames,annotationStatus,provider,network,executionStatus:'discovery_only',executable:false,partial:false,activeCount,source}`. Markets retain all source/delisted slots with correct global/local IDs, exact qualified `name`, `collateralToken`, `collateral`, `collateralCompatibility:'usdc'|'other'|'unresolved'`, `sourceCategory`/`displayName` and `metricsStatus:'metadata_only'`. All price/funding/interest/volume fields are **null**, because no279-venue context fan-out occurred. Filter `isDelisted` when showing an active catalog; never filter before calculating source IDs.

Collateral metadata includes exact provider tokenIndex/tokenId/name/fullName/size and wei decimals/canonical flag/linked EVM contract. Missing collateral is unresolved; another token namedUSDC is not token0. Source Core USDC token0 reports **weiDecimals8**, whereas HyperEVM/CCTP USDC uses6 settlement decimals. The linked token0 contract points at CoreDepositWallet; do not infer that this field is the USDC ERC20 transfer contract. No financial unit conversion is implemented here.

**`readDexMarkets(dex:string)`** requires the DEX to exist in the current catalog and performs exactly one selected venue `metaAndAssetCtxs` read. The cold path has a12second overall budget; a warm catalog requires only that one source request. It returns selected markets with `metricsStatus:'source_context'`, exact decimal strings/nulls and collateral identity preserved. Source array count, exact name/order, precision, leverage, delisting/margin flags and collateral index must still match the metadata snapshot; changes invalidate the cache and fail with `HYPERLIQUID_CATALOG_CHANGED_REFRESH_REQUIRED`. Other-collateral venues can be read but remain `executable:false`; this does not broaden financial execution permissions. Qualified symbols pass unchanged to candleSnapshot.

The general catalog treats source names as opaque JSON values. Actual Testnet tndex names contain spaces, additional colons, slashes and Unicode, including path-looking text. These retain the exact registered DEX prefix but must never be interpolated unescaped into URLs/HTML/filesystem paths. Use opaque/global IDs or encode the whole name. Candle input validation accepts bounded non-control identifiers in JSON (never as a request URL); scheme-like identifiers are rejected. The older strictly reviewed xyz parser is unchanged.

Provider annotations are claims, **not attestations of stock ownership, oracle accuracy or customer eligibility**. Category strings are kept unchanged (e.g. stocks/equity/Equities/commodities/FX); root owns any presentation mapping. No classification is inferred from a ticker. Standalone commodity module remains retired; all source perpetual categories are represented only as perpetual markets.

Live probe **2026-11-12T04:40:44.339Z**: **279DEXs,1008total markets,658active**,16distinct collateral identities; annotations available. The cached lazy xyz read returned70context rows. A source-compatible catalog has no claim that all1008prices were fetched. Evidence `research/testnet-all-catalog.json` deduplicates collateral identities, records every market identity with explicit null price, and includes the actual selected xyz contexts. Reproduce `pnpm exec tsx apps/api/src/adapters/hyperliquid/research/probe-catalog-readonly.ts`.

**44 scoped tests and full API typecheck pass.** New tests cover complete bounded catalogs, exact collateral/unresolved identities, duplicate/count/namespace drift, delisting without reindexing, annotation failures, cache/single-flight/defensive copies, one-DEX lazy requests, stale-cache source failure and selected metadata changes. No order/deposit/signer/mainnet method was added.

Primary sources: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals (allPerpMetas, perpDexs, concise annotations) and https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot (token identities). Documentation's allPerpMetas example currently depicts contexts as well, while actual Testnet returns metadata objects only. The adapter follows the observed metadata-only response and records it without inventing contexts; source-shape changes fail closed.
