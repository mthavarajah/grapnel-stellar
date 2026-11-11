# Markets, BFF and unified funds QA — 2026-11-11

Read-only QA of current main through `fc031c0` and the running API/fintech at localhost:3001/3002. No customer transaction was signed, submitted, minted, or broadcast.

## Actual live reads

- `trade.spot` is enabled for the configured business, but the running API still reports `blocked` with `SOROSWAP_XDR_INSPECTOR_REQUIRED`. Current crypto market read returned HTTP 200 with an empty array. A usable live swap is not yet verified by this QA pass; rerun after the lead wires/restarts the inspected adapter.
- `trade.stocks`, `trade.perps`, and `trade.commodities` are disabled and discovery-only; each actual markets request returned HTTP 403 `MODULE_NOT_ENABLED`. No execution actions are advertised. Invalid business key returned 401.
- Anonymous fintech session, all four market-class BFF reads, Earn summary, and USDC-status reads returned HTTP 401 `CUSTOMER_SESSION_REQUIRED`.
- Legacy `/fund` and `/return` routes returned HTTP 307 to `/funds`.
- Actual signed-out browser visits to `/markets`, `/earn`, and `/funds` returned to `/login` with no dashboard navigation visible.

## Isolated UI fixtures

Explicit fixtures on the current fintech build verified all four class tabs: an exact XLM→issuer-USDC preparation route renders only when advertised; Stocks/Perpetuals/Commodities show unavailable and expose no quote action. Switching into unavailable categories made no provider-market request. Funds renders one navigation entry and internal Get funds / Return funds tabs. No financial POST was made during this QA pass. Visual inspection of `/tmp/grapnel-funds-readonly-qa.png` found no layout issue.

The earlier dedicated UI pass additionally verified quote expiry denial, disabled spot module, required USDC setup, provider errors, exact minimum output, and no automatic quote/order/signing. Those were fixtures, not provider execution proof.

## BFF/session checks

Focused Vitest run: **28 passed** across BFF routes, encrypted session handling and client idempotency. Added negative boundary checks for quote/order denial when Spot is disabled, missing wallet signing gate, disabled stock/perp/commodity reads, and missing idempotency key on both unified funds actions. Each negative test asserts no upstream call. Existing checks cover tenant/customer binding, foreign operations, origin validation, cookie integrity/expiry, and redirect denial while forwarding credentials.

No production auth or capability rule was weakened. No implementation UI defect was found in the checked states; the live swap capability remains the integration blocker described above.
