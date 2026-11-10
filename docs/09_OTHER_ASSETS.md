# 09 — Optional Trade categories: stocks, commodities, perps

## Why these are lower priority
They remain **business-selectable modules in the catalog**, but the submission must have genuine **Stellar Testnet** functionality. As researched November 10, stocks/SODAX and real-world commodity issuer access do not establish a usable Testnet route; Noether provides Testnet perps but trading keys are closed beta and Ontario is a restricted jurisdiction. Therefore these are **P2 discovery/read-only**, not required execution. Do not display Buy/Sell as working until a live eligible Testnet path is proven.

## Tokenized stocks: `trade.stocks`
Candidate: **SODAX + Soroswap** for Robinhood-issued stock tokens; announced mainnet support. Provider [SODAX API](https://www.sodax.com/system/sodax-api), [Soroswap](https://github.com/soroswap/sdk). Adapter discovery steps: get supported networks, tokens, pair routes, execute eligibility (issuer restrictions, jurisdiction), quote/intent lifecycle; if no explicit Stellar **Testnet** route, return `readiness=discovery_only`, `executable=false`, explanation `MAINNET_ONLY_OR_UNVERIFIED`. Never label dummy shares as Robinhood-issued, do not assume stock tokens give voting/ownership rights. For demo, display a permitted non-trading informational card with accurate illustrative status, not pretend fill.

## Commodity tokens: `trade.commodities`
Candidate: verified Stellar gold-linked issuer, optional via Soroswap / Stellar DEX route. Need immutable issuer `(asset_code,issuer)` or Soroban `C...`, current supported ledger, transfer eligibility, actual orderbook/pool liquidity, legally correct token rights (gold exposure is not necessarily physical bullion redemption). Oil, silver, copper: **no verified tradable Testnet providers**. A locally deployed mock `DEMO_GOLD` can demonstrate the *asset adapter shape* but must be labeled fictional, not a real regulated product, and only counted as functional Testnet if actual swap/transfer succeeds. Do not write a mock RWA contract without lead approval.

## Perpetuals: `trade.perps`
Provider [Noether developer docs](https://docs.noether.exchange/developers), [endpoint reference](https://docs.noether.exchange/developers/reference), [Testnet app](https://testnet.noether.exchange). Public market API: `GET /v1/markets`, `/v1/oracle/prices`, `/v1/positions/open` (public positions). Trading when authorized: `POST /v1/orders/prepare` returns unsigned XDR; user signs; `POST /v1/tx/submit`; authenticated `GET /v1/account/me/positions`. Key creation needs wallet challenge and beta allowlist. API key auth: `Authorization: Bearer <keyId>:<secret>` AND `X-Timestamp` unix seconds. Requests may return `403 not_in_beta` or `451 region_restricted`. **Noether explicitly lists Ontario among restricted jurisdictions**; do not try to bypass geographic restrictions. For Waterloo competition, show only public, non-restricted market data (read availability permits it) and disable trade action unless legally/provider-authorized. Perps are leveraged and liquidation-prone, not a savings product.

## API contract
All categories use the same `/v1/trade/markets`, `/v1/trade/quotes`, `/v1/trade/orders` (when actually executable), `/v1/trade/positions`. Tenant module `trade.stocks`/`trade.perps`/`trade.commodities` controls access; `execution_status` also controls whether allowed. If unavailable:
```json
{ "error": { "code":"EXECUTION_UNAVAILABLE", "message":"No verified Stellar Testnet execution route for this market", "retryable":false, "details":{"module":"trade.stocks","execution_status":"discovery_only"} } }
```

## Do NOT spend P0 time on
Cross-chain bridges, non-Stellar portfolio, speculative issuers, marketing claims about real shares/gold oil, proxy/VPN provider access, or derivatives execution from prohibited regions. Feature cards can communicate breadth while fully distinguishing operational readiness.
