# 09 — Optional Trade categories: stocks and margin

## Current local implementation — November 11
Stocks and Margin remain business-selectable modules. Access entitlements do not grant provider execution. The Stocks screen displays the provider's informational catalog and underlying-stock price history; SODAX routes are mainnet-only, and the alternative Ztellar Testnet candidate remains blocked by stale onchain pricing and eligibility provenance.

Peridot replaces Noether under `trade.perps`. The current Stellar Testnet catalog has one verified XLM/MockUSDT market, search, interactive source-backed charts and a resumable customer approval workflow. Separate generated-account QA proves the protocol roundtrip; customer Margin acceptance remains pending. No customer position is claimed from QA proof. See [gate status](15_GATE_STATUS.md).

## Tokenized stocks: `trade.stocks`
Candidate: **SODAX + Soroswap** for Robinhood-issued stock tokens; announced mainnet support. Provider [SODAX API](https://www.sodax.com/system/sodax-api), [Soroswap](https://github.com/soroswap/sdk). Adapter discovery steps: get supported networks, tokens, pair routes, execute eligibility (issuer restrictions, jurisdiction), quote/intent lifecycle; if no explicit Stellar **Testnet** route, return `readiness=discovery_only`, `executable=false`, explanation `MAINNET_ONLY_OR_UNVERIFIED`. Never label dummy shares as Robinhood-issued, do not assume stock tokens give voting/ownership rights. For demo, display a permitted non-trading informational card with accurate illustrative status, not pretend fill.

## Historical Noether research — retired from runtime
Provider [Noether developer docs](https://docs.noether.exchange/developers), [endpoint reference](https://docs.noether.exchange/developers/reference), [Testnet app](https://testnet.noether.exchange). Public market API: `GET /v1/markets`, `/v1/oracle/prices`, `/v1/positions/open` (public positions). Trading when authorized: `POST /v1/orders/prepare` returns unsigned XDR; user signs; `POST /v1/tx/submit`; authenticated `GET /v1/account/me/positions`. Key creation needs wallet challenge and beta allowlist. API key auth: `Authorization: Bearer <keyId>:<secret>` AND `X-Timestamp` unix seconds. Requests may return `403 not_in_beta` or `451 region_restricted`. **Noether explicitly lists Ontario among restricted jurisdictions**; do not try to bypass geographic restrictions. For Waterloo competition, show only public, non-restricted market data (read availability permits it) and disable trade action unless legally/provider-authorized. Perps are leveraged and liquidation-prone, not a savings product.

## API contract
Retained trade categories use the same `/v1/trade/markets`, `/v1/trade/quotes`, `/v1/trade/orders` (when actually executable), `/v1/trade/positions`. Tenant module `trade.stocks`/`trade.perps` controls access; `execution_status` also controls whether allowed. If unavailable:
```json
{ "error": { "code":"EXECUTION_UNAVAILABLE", "message":"No verified Stellar Testnet execution route for this market", "retryable":false, "details":{"module":"trade.stocks","execution_status":"discovery_only"} } }
```

## Scope boundaries
Cross-chain bridges, non-Stellar portfolio, speculative issuers, marketing claims about real shares, proxy/VPN provider access, or derivatives execution from prohibited regions. Feature cards can communicate breadth while fully distinguishing operational readiness.
