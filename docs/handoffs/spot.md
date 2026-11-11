# Spot agent handoff

**Role/branch:** Soroswap / `feat/spot`.

**Gate completed:** Adapter implementation only. Gate 1 remains pending; no Gate 2 swap proof.

**Changed paths:**
- `apps/api/src/adapters/soroswap/index.ts`
- `apps/api/src/adapters/soroswap/spot.test.ts`
- `apps/api/src/modules/spot/service.ts`
- `apps/api/src/modules/spot/routes.ts`
- This handoff.

## Actual provider checks

Official source reviewed 2026-11-10:
- https://github.com/soroswap/sdk at revision `46edd48ecef91dacc6d9d5d8571170aa7f482ab9`.
- `package.json`: package **`@soroswap/sdk` 0.5.0**, despite README install examples mentioning `soroswap-sdk`.
- https://github.com/soroswap/sdk/blob/46edd48ecef91dacc6d9d5d8571170aa7f482ab9/src/soroswap-sdk.ts
- https://github.com/soroswap/sdk/blob/46edd48ecef91dacc6d9d5d8571170aa7f482ab9/src/clients/http-client.ts
- https://github.com/soroswap/sdk/blob/46edd48ecef91dacc6d9d5d8571170aa7f482ab9/src/types/quote.ts

The adapter uses native fetch against the exact SDK endpoints; no new dependency:
- Bearer API key in Authorization, server only.
- `GET /protocols?network=testnet`
- `GET /asset-list?name=soroswap` — SDK provides **no network parameter**. Adapter rejects any list whose network is not explicitly `testnet`; the SDK default network cannot establish asset-list identity.
- `POST /quote?network=testnet` with decimal-string atomic `amount`, `EXACT_IN`, protocols and numeric `slippageBps`. Current source types define numeric `slippageBps`; README examples include a stale string example.
- `POST /quote/build?network=testnet` with immutable stored quote and same customer from/to.
- SDK also defines `POST /send?network=testnet`; this adapter deliberately leaves signed submission to the common durable worker. It does not broadcast.

Live unauthenticated observation:

```text
GET https://api.soroswap.finance/protocols?network=testnet
HTTP 401
{"statusCode":401,"error":"Unauthorized","code":"MISSING_CREDENTIAL","message":"Missing credential. Get an API key at https://console.soroswap.finance/register and send it as \"Authorization: Bearer sk_...\"","registerUrl":"https://console.soroswap.finance/register"}
```

No API credential was available; no valid Testnet protocol list, token list, quote, liquidity, build XDR, swap hash or balance delta was obtained. No onchain writes were made. No fallback provider was substituted.

## What works in code

`SoroswapSpotAdapter(config, fetcher?, inspect?)` exports `capability()`, `markets()`, `market(id)`, `protocols()`, `assetList()`, `quote(...)`, `prepare(...)`.

Default market registry is empty. A market requires independently verified Testnet asset contract IDs and decimals; labels alone cannot seed assets. Runtime quote normalization rejects lossy JSON numbers, wrong input/output identities/amounts, zero output, slippage violations, unsupported protocols/paths, gasless trustlines and uninspected extra fees. Request errors are sanitized. Built XDR cannot become a PreparedAction without Gate 1 and an injected adapter-specific invocation/auth/recipient/minimum/fee/simulation inspector. Substituted inspector output is rejected.

`SpotService(adapter,pool,operations,reserveQuoteSpend?)` persists quotes and orders to frozen tables. Quote idempotency is stored in `trade_quotes.provider_quote_json_redacted` with a request hash, guarded by a tenant+key transaction advisory lock. No schema change is needed. Customer binding is verified inside the transaction. Same-key response is immutable even if expired; clients use a fresh key to request a new quote. Orders use shared `createIdempotent` and `setPrepared`; a locked quote can be consumed once. `orders.id = operations.id` permits the accepted operation ID to work for `GET /trade/orders/:id`.

`registerSpotRoutes(app,deps)` exposes frozen trade routes. `requireBusiness` always enforces the matching entitlement; `requireCustomer` binds identity for quote/order/positions. Optional `readPositions` must read actual holdings; absent reader returns unavailable rather than fake positions.

## Integration requirements for lead

1. Wire factory using shared helpers. `SpotRouteDependencies.requireBusiness` returns `{businessId}`; `requireCustomer(request,customerId,walletId?)` returns shared CustomerContext; `success` is shared envelope.
2. Build a registry from independently verified live Testnet assets/routes and persist matching `assets`/`provider_markets` rows before quoting. Nothing in this commit invents/auto-registers a market.
3. Supply `SpotXdrInspector` only after actual Soroban/native route inspection and simulation tests. Generic contract allowlists are insufficient.
4. Supply `ReserveQuoteSpend`: reserve exact input **and fee asset**, prevent wallet sequence conflicts, use fresh chain data plus DB reservations in the same operation transaction. Missing port keeps order creation unavailable.
5. Shared worker must reconcile actual source/output balance deltas and then populate `orders.actual_*` before declaring completed. `SpotService.order()` hides actual fills until operation completion.
6. `capability()` stays blocked until live evidence promotion is implemented by lead; enabling tenant entitlement alone never unlocks a route. Market `execution_verified_at` must come only from independently verified evidence, never an environment claim or provider quote.

**Secrets needed by name:** `SOROSWAP_API_KEY`; existing Privy/Testnet settings and validated Gate 1 decision.

## Validation

```text
pnpm install --frozen-lockfile
pnpm --filter @grapnel/api typecheck
pnpm exec vitest run apps/api/src/adapters/soroswap/spot.test.ts
15 tests passed
```

Tests are explicit mocked interface tests, not chain proof. They cover network mismatch, missing key, exact units and Testnet paths, wrong provider inputs/outputs, slippage, precision, asset confusion, route protocol, networkless asset list, 429/timeouts, stale quote, Gate 1/inspector enforcement, and XDR substitution.

**Actual transaction hash / contract deployment:** none.

**Blocked acceptance:** Soroswap API credential, live Testnet registry/liquidity, validated transaction inspector, Gate 1 customer signing proof, actual swap and balance deltas.

## Authenticated follow-up — 2026-11-11 UTC

Provider access now works. See `apps/api/src/adapters/soroswap/research/README.md` and actual sanitized responses. Testnet protocols and an exact native-XLM/Blend-USDC route/quote are confirmed through authenticated reads. The generic asset list is mainnet and remains rejected. Build returns428 requiring an exact classic USDC customer trustline; no swap XDR/signature/broadcast exists. Gates remain pending.

Lead approved adapter-only change: request provider slippage one basis point tighter (bounded at zero), validate against the original strict approved ceiling bound. Actual provider request49/approved50 quote passes; zero-slippage and one-atomic-bound regressions pass. Seventeen unit checks and API typecheck pass. No shared contract changes or market activation.
