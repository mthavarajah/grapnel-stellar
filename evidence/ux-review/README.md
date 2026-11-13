# Local UX review — November 13, 2026

Actual Chrome walkthrough of Velocity (`localhost:3002`) and the Grapnel owner dashboard (`localhost:3000`), backed by the local API and durable worker. Public deployment was not performed.

## Repairs

- Fetch the current customer authorization response before signing an action that was already prepared in its creation response. The initial swap reproduced the missing-token failure; the repeated swap completed after the repair. Scope and operation identifiers remain checked.
- Obtain the stock provider from the latest Privy wallet snapshot after switching networks. The stale pre-switch snapshot prevented signing. A subsequent actual TSLA buy and approval/sell round trip passed. Network, account, nonce, signature, allowance, simulation and receipt checks remain enforced.
- Keep the business dashboard mounted across navigation so it retains the owner session, business name and loaded workspace instead of repeatedly rebuilding them.
- Show loading indicators while Crypto markets and Earn options load. Do not announce empty/unavailable results during a normal pending read.
- Bind the Crypto heading, change and logo to the selected chart's market and timeframe, preventing stale data from a different selection.
- Omit absent perpetual statistics and exclude perpetual-only metrics from Stocks.
- Display negative perpetual P&L as a signed amount instead of `Unavailable`.
- Read independent Zenex contract pins concurrently, retaining every hash/identity validation and forced checks before financial submission. Read the Horizon balance alongside independent position/config/price reads.
- Validate Earn amounts against exact available base units; a completed withdrawal cannot be repeated against a refreshed zero balance.
- Retain the selected market category in navigation URLs. Format the overview USD total to cents. Distinguish the separate Zenex USDC issuer as `Stellar · Perpetuals collateral`.
- Label Perpetuals wallet setup, funding and trade confirmation separately, and clear the preceding transaction link when the next step starts. Stock display-balance refresh no longer blocks progression to the next authorized step.
- Keep known separate-pool Borrow operations out of Earn cash-flow accounting. A regression still rejects untracked mutations in the Earn pool; the live customer view restored verified zero earnings after Borrow.
- Clarify that broad Blend capability discovery is separate from per-asset/action execution readiness; do not advertise every pool/action as verified.

## Actual browser execution

Public hashes, confirmed balance/position deltas and persisted timestamps are in [live-operations.json](./live-operations.json) and [stock-operations.json](./stock-operations.json). These are live customer-session operations, not fixture transactions.

| Flow | Observed result |
| --- | --- |
| Crypto | 1 XLM swapped for 0.1492948 USDC; both wallet amounts changed |
| Earn | Supplied 0.1 USDC; withdrew 0.0999999 USDC; displayed Earn balance returned to zero |
| Borrow | Added 1 USDC collateral; borrowed 0.1 USDC; used Repay all; verified debt tokens returned to zero; removed 1 USDC collateral |
| Perpetuals | Customer-signed trustline; actual 1,000-token Zenex faucet receipt; opened a $2 XLM long with 1 USDC collateral at 2×; closed it; no open position remained |
| Funds | Received 1 XLM from the existing treasury and returned 1 XLM with the customer signature |
| Stocks | Spent 0.1 USDG for 0.047902326917709772 TSLA; verified the holding and its value on Overview and Funds; approved and sold the exact holding; stock balance returned to zero |

The borrowing pool retained four collateral token base units from interest/rounding after the principal removal. Debt was zero. The separate Zenex collateral balance remains in the customer's wallet; it is not interchangeable with the other USDC issuer. The stock round trip ended at 19.9994 USDG versus 20 before the test, with ETH transaction fees deducted. These are real Testnet balance changes.

## Other browser checks

Overview, Funds tabs, Crypto quote and execution, Earn toggles, Borrow/Repay/Collateral toggles, Stocks search, Perpetuals controls, Activity, profile open/close, page navigation and restored existing sessions were inspected. An oversized stock order was disabled with its amount limit beside the ticket. Borrowing with no collateral showed actionable inline feedback. Selecting AMD changed both the chart and ticket; selecting 1D loaded a different time horizon; keyboard chart inspection displayed the point's price and timestamp.

The owner dashboard was checked through Overview, Customers, API modules, API keys, Request logs and Documentation. Existing keys and customer entitlements were not modified. Account data and the owner session stayed mounted across section navigation after the repair.

Screenshots in this folder show actual application states. The browser extension's viewport override did not change the rendered desktop viewport, so this review does not claim mobile-device verification. Existing-session restoration was tested; a new email OTP login was not repeated. A deliberate local API restart briefly produced a connection error; a subsequent Refresh cleared it and restored verified balances and earnings.

## Timing and validation

- Full automated suite: **2,314 passed, 195 skipped**, 170 passed test files. Skips require separately configured integration environments; they are not claimed as passes.
- Workspace typecheck, API typecheck, Velocity production build, Grapnel dashboard production build (`next build --webpack`) passed.
- New regressions cover current authorization retrieval and ownership, post-switch provider selection, negative P&L display, zero/insufficient Earn balances, and concurrent pin verification that still refuses mismatches.
- API health returned HTTP 200 in about 3 ms in a local sample.
- A direct live Zenex sample measured registry verification at 446 ms and account status at 1,119 ms. This is a sample, not a guaranteed latency or an isolated before/after benchmark.
- [api-latency.json](./api-latency.json) contains actual API request-log timings from the walkthrough. It is not a browser rendering benchmark. Production builds and automated tests ran during parts of the review and can affect local measurements.
- Completed Stellar operations took roughly **7–20 seconds** from durable creation through verified reconciliation. The first Perpetuals use has three sequential transactions. The protocol also imposes a 30-second opening lock before closing.
- TSLA buy took approximately 13 seconds after request creation. Sell required a separate approval and swap; the full combined path took longer, with individual persisted requests around 10 and 17 seconds. Subsequent balance-refresh scheduling was made nonblocking; no new post-change speed benchmark is claimed.

Confirmation, provider responses and signing remain asynchronous. This review does not promise zero network delay, test every offered asset in both directions, or claim exhaustive outage coverage. Initial unsigned failures are retained in the evidence; they were not broadcast or relabeled successful. Testnet-only, exact customer authorization and chain-proof requirements remain intact.
