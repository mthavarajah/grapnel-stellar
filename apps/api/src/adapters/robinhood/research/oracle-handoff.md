# Robinhood official reference-price reader

Implemented `RobinhoodMarketDataReader` in `market-data.ts`. Reviewed symbols: TSLA, AMZN, PLTR, NFLX, AMD. Read-only live probe returned validated observations for all five; raw sanitized responses and exact source timestamps are in `oracle-rest-evidence.json`. No signatures, account creation, funding, orders or writes were made.

## Official source findings

- [Stock Token APIs](https://docs.robinhood.com/chain/stock-token-apis/) specifies raw underlying-equity USD bid/ask, a 15-second cache and 60 requests/second. It does not provide historical OHLC. Live responses identify mainnet 4663 deployments; these never establish Testnet 46630 token identity. The reader deliberately ignores those deployments and extra undocumented tokenBid/tokenAsk fields.
- [Oracles and Price Feeds](https://docs.robinhood.com/chain/oracles-and-price-feeds/) explains that onchain feeds already include the corporate-action multiplier. Offchain raw prices require a verified multiplier to represent one token. Do not apply a multiplier twice.
- The linked [Chainlink directory](https://docs.chain.link/data-feeds/price-feeds/addresses?network=robinhood) contains a Robinhood mainnet network entry. No Robinhood Testnet network entry was found. The captured hash/excerpt and qualified finding are in `oracle-chainlink-directory.json`. This does not prove that no private/unlisted feeds exist. No mainnet feed address has been reused on Testnet.

## Integration

`read(symbol)` returns underlying reference data. `read(symbol,{basis:'testnet_token'})` additionally requires configured `testnetTokens` and `readTestnetMultiplier` supplying matching symbol/address, chain 46630, positive 18-decimal multiplier, positive block number and observation at most 30 seconds old. The stock reader's approved callback shape matches; root can inject its `STOCKS` registry addresses. Optional `oraclePaused:true` blocks token-equivalent conversion.

Both return bid/ask/midpoint decimal strings, source URL, generatedAt, observedAt, halt state, basis, and `executable:false`. Conversion and midpoint calculations use bigint, preserving odd midpoint fractions exactly. Halted observations remain visible with `status:'halted'`; they never authorize an execution. All execution must use separate exact Testnet pool quotes and approvals.

Only current data generated within 60 seconds (future tolerance 2 seconds) is accepted. Per-symbol 15-second cache and singleflight prevent duplicate upstream reads; a shared source backoff handles 429/5xx/network errors, respects Retry-After and does not blindly retry. No stale fallback is fabricated.

`history(symbol,basis)` returns actual observed points with `observed_only` coverage, first/last source timestamps, count, truncation flag and `historicalOhlcAvailable:false`. Local memory retains 4096 points per symbol/basis. Root must persist observations across restarts and aggregate any candlesticks solely from actual observations. There is no backwards history generator or synthetic line.

Tests: `pnpm exec vitest run apps/api/src/adapters/robinhood/market-data.test.ts`; `pnpm --filter @grapnel/api typecheck`. Live probe: `pnpm exec tsx apps/api/src/adapters/robinhood/research/oracle-probe.ts` (GET only).
