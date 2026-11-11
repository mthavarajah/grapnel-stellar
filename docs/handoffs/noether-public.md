# Noether public discovery — 2026-11-11

**Branch:** feat/noether-public-discovery. **Scope:** apps/api/src/adapters/perps/** and this unique handoff. No shared schema, tenant entitlement, route, UI, credential or deployment changes.

## Result and eligibility

Public Noether Testnet market discovery works. Trading is unavailable for the Ontario demo. The current official [regional restrictions](https://docs.noether.exchange/developers#regional-restrictions) explicitly include Ontario and state that provider eligibility terms apply even when edge blocking does not fire. Public read endpoints are permitted independently. No order preparation, submission, wallet challenge, key issuance, account creation, faucet or customer action was attempted. No VPN, alternate gateway, docs playground proxy or region header was used.

[Authentication documentation](https://docs.noether.exchange/developers/authentication) still describes closed-beta key issuance. The actual global beta read returned `gated:true, allowed:false` with no address parameter. This proves that global issuance is gated; it is **not** a tested denial for any particular customer. No HTTP 451 or 403 was observed in the permitted public GETs, and neither status is invented as execution evidence.

## Actual direct requests

The current documented gateway is `https://noether-api.proudmeadow-533cf0d8.germanywestcentral.azurecontainerapps.io`, sourced from the official [reference](https://docs.noether.exchange/developers/reference) and [network configuration](https://docs.noether.exchange/protocol/networks).

| Request | Observed result |
|---|---|
| GET /v1/markets | HTTP 200; 16 actual oracle markets: BTC, ETH, XLM, SOL, XRP, ADA, BNB, TRX, HYPE, DOGE, ZEC, LINK, BCH, LTC, PUMP, UNI |
| GET /v1/health | HTTP 200, reported network testnet; initial observation indexer ledger 5678371 with 1-second age |
| GET /v1/keys/beta-status | HTTP 200; gated true, allowed false without an address |

Fresh adapter-based reproduction, timestamps, request IDs, normalized market observations and exact source URLs are saved in `apps/api/src/adapters/perps/research/public-discovery.json`. Every recorded request is GET. This artifact is market discovery only, not chain transaction proof. Protocol contracts are preexisting Noether contracts; none belongs to Grapnel and none was deployed by this workstream.

## Typed adapter and integration

`apps/api/src/adapters/perps/index.ts` exports `NoetherPublicAdapter`:

```ts
const noether = new NoetherPublicAdapter({
  network: 'testnet',
  networkPassphrase: 'Test SDF Network ; September 2015',
});
await noether.markets();       // NoetherPublicMarket[]
await noether.capabilities();  // AdapterCapabilities, modes ['read']
await noether.betaStatus();    // Global gate status only, no address argument
noether.prepare();            // Always throws EXECUTION_UNAVAILABLE / REGION_RESTRICTED
```

Market fields include market_id, label, asset_class perps, module trade.perps, provider noether, network stellar-testnet; underlying symbol/name/display_decimals; decimal-string reference_price and reference_price_atomic; price_decimals 7; oracle_timestamp/age/status; observed_at/source_url; execution_status discovery_only, executable false, and a concrete Ontario restriction reason. Underlying reference assets are not invented Stellar AssetIdentity entries, funded BTC balances or wrapped-token claims.

The official [market-data guide](https://docs.noether.exchange/developers/rest-api/markets) defines every oracle price as 7-decimal fixed point, independently of underlying display metadata. Conversion uses bigint and the shared fromAtomic helper, never priceFloat. Missing prices stay null, stale observations are marked, and cache hits recompute age. Health must report a healthy testnet gateway before market publication. The host is fixed; redirects fail; only health, markets and address-free beta-status paths are available. There is no generic request, authorization header, region override, XDR signing, order submission or account API.

Concurrent market reads are deduplicated and cached for 15 seconds. HTTP 429 respects cooldown without automatic retries. HTTP 451 or any 403 latches a nonretryable denial; the same instance makes no further provider requests. Capabilities become blocked after such denial. Preparation remains hard blocked even when beta access is reported open.

Lead may integrate markets only into the existing business-entitled public GET market flow. Keep financial write routes unavailable and do not label perps complete or testnet_verified. Provider user-owned keys, customer transaction-intent verification and lawful eligibility would require separate future work; the documented trading gateway binds transaction source to the provider key owner. No implementation shortcut treats a Grapnel business key as that owner.

## Verification

- Existing dependency install: pnpm install --frozen-lockfile --filter @grapnel/api...; no dependency or lockfile edits.
- pnpm --filter @grapnel/api typecheck: passed.
- pnpm exec vitest run apps/api/src/adapters/perps/noether.test.ts: 15 passed, including wrong network, bigint price precision, ignored floating-point price, missing/stale data, cache freshness, rate limit, immutable execution block, restriction stop, and malformed identities.
- Public live probe used the same adapter and saved the observation JSON above. No financial request, signature or transaction hash exists from this workstream.

**Gate status:** read-only discovery implemented; perps execution unavailable due to documented Ontario restriction. No gate, key scope or customer authorization was weakened.
