# Market presentation and Activity review

November13,2026. Actual Yahoo Finance USD equity history verified for TSLA, AMZN, PLTR, NFLX and AMD across Live, 1D, 1W, 1M, 1Y and All (30 successful source reads). `history.json` records actual point counts, timestamps, prices and source URLs. No transactions were submitted for this verification.

Stock charts use the underlying equity's source observations, not the unrelated Robinhood Testnet USDG liquidity-pool exchange ratio. Yahoo historical closes and source regular-market price/time power the presentation chart; headline follows the displayed history. Live uses the latest available trading-session hour. Weekends/closed sessions do not fabricate prices; source times are shown. Source history intervals vary by range. If unavailable, the existing Robinhood recorded bid series remains a separately identified fallback with observed-only coverage. References never replace exact trading quotes, amount math or chain proof.

Chart lines/dots remain blue; percentage changes retain green/red. Hover prices round with at least two decimal places and extra precision for small assets. Earn labels now have10px separation from inputs. Velocity Activity has Stellar and Robinhood Chain views; current Zenex actions remain Stellar operations. Grapnel Activity is unchanged by this split.

Verification: all545 frontend tests pass;22 stock reader/service tests pass; API typecheck and Velocity production build pass. Authorized business API reads independently returned the correct stock identity, range and Yahoo source for all30 combinations (`api-history.json`). Signed price/percentage changes also use the rounded presentation formatter with at least two decimals. Unknown previous-close metrics are omitted rather than using a range-start close.

Normal equity overnight/weekend closures are joined visually using their actual timestamps; gaps beyond four days remain broken for daily/intraday source intervals. Crypto gap rules are unchanged. Screenshot checks cover Earn inputs, both network Activity views, stock yearly/live charts, rounded tooltips and signed changes.
