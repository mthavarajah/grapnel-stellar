# Markets charts and automatic quotes — November 13, 2026

## Changes

- Crypto reference charts use actual USDC exchange pairs, not USDT prices with a renamed label. Exact source base/quote identities are checked. Closed historical candles retain their true close times, including early closes at old delisting boundaries. A fresh, exact-symbol current ticker is appended at its own source timestamp, so year/all views do not end at an old weekly close. Missing exchange candle periods remain visual gaps.
- All chart views use the selected time window on the horizontal axis. Sparse recorded quotes no longer stretch to imply a full year's history. Stock and Testnet-pool histories show when recording began. Zenex All uses the verified available one-year dataset with an explicit coverage date; two-year, five-year and epoch requests returned `upstream_unavailable`, so no older points are invented.
- Changes and chart lines are red for losses, green for gains and retain the existing colours for zero/unknown changes. Sign detection uses the exact decimal string, including tiny changes and negative zero.
- Crypto automatically requests a live quote after a 450 ms input pause. The Buy amount starts at 0.00, shows Calculating while pending, then displays the provider estimate. Changing amounts/assets/slippage/session invalidates old responses. A quote must match the exact amount, network, provider, pair, slippage and positive bounded outputs; an expired quote cannot execute. Visible, idle tickets refresh expired quotes. No wallet authorization or financial operation is triggered by typing.
- Longer-range charts refresh every minute and on returning to a visible tab; Live refreshes every 15 seconds. Velocity's top-right Reload/Refresh button is removed.

## Actual read verification

- `provider-history.json`: 24 successful direct provider requests across Live/1D/1W/1M/1Y/All for XLM, BTC and XRP USDC references and the XLM Zenex market. It includes actual first/latest points and source URLs.
- `crypto-api-history.json`: all 72 authorized business-API reads across the 12 active Crypto pair directions and six time ranges. Every response matched its requested market/range and contained actual points. Mapped references are in USDC; XTAR/EURC fallback histories retain their true XLM Testnet-pool denomination and recorded-only coverage.
- `stock-history.json`: all 30 histories for the five Robinhood stocks and six ranges. These are recorded official live quotes, not a backfilled year of underlying stock candles. Robinhood's published Stock Token API does not supply historical OHLC. Long windows therefore disclose limited recorded coverage.
- `spot-quotes.json`: actual Soroswap quotes for 1 and 2 XLM with independently simulated Stellar Testnet output. Both passed the same exact-intent validator used by the browser. No transaction was signed or broadcast during this task.

## Browser verification

Chrome access briefly disconnected, then recovered. The actual signed-in Velocity UI was checked after rebuilding and restarting the local API/frontend:

- Entering 2 XLM populated the USDC Buy estimate automatically, without pressing Get quote. The ticket became executable only after a matching fresh quote arrived.
- Crypto showed `USDC per XLM`, a red negative live change, a green positive All change, and two separate historical line segments around a genuine source-data gap.
- Stock 1Y displayed the full one-year axis with its actual recorded coverage at the end. Selecting 1D changed the horizontal window and the computed period change.
- The top-right reload control was absent.

Screenshots preserve actual UI states. See the source URLs and timestamps in the JSON files rather than treating captured prices as permanent values. Public deployment and financial execution changes were outside this task.

Validation: full suite **2,326 passed, 195 environment-dependent skipped**; API typecheck and Velocity production build passed. Browser checks also confirmed that changing the Buy asset from USDC to BTC obtains a matching fresh amount automatically.

A later automatic refresh encountered a real provider timeout (API 503 after about 47.5 seconds). The older estimate stayed visible and execution was disabled. The client now retries one quick transport/5xx quote-read failure, only when the initial failure occurs within 15 seconds and the selection is still current. Authorization/validation failures, rate limits, slow failed requests and financial submissions are never automatically retried by this helper. A failed refresh keeps an inline Get quote recovery message. This is not a guarantee of uninterrupted provider availability.
