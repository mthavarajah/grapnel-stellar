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
