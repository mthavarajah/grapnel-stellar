# AGENT 04 — Soroswap Crypto Spot

**Read:** `AGENTS.md`, docs `03_API.md`, `05_SIGNING.md`, `07_SPOT.md`, `11_TESTS_SECURITY.md`, `13_SOURCES.md`. Own `apps/api/src/adapters/soroswap/**` and Spot service in API as coordinated; no direct changes to business auth.

## P0 discovery and execution
1. Secure provider API key (server only). Confirm correct installed SDK exports and package version, since official README shows mixed import naming.
2. On **TESTNET** call `getProtocols`, `getAssetList`, `quote`; register exact `C...` token identities and supported routes. If no live route, mark `discovery_only` and notify lead, not an imaginary tradable pair.
3. Implement quotes with exact bigint base units, accurate expected out, min receive, expiry and slippage. Verify no unsanctioned token issuer or contract.
4. `build` quote for customer G-address; inspect returned XDR, pass through shared Stellar `PreparedAction`/Privy signing (Chain agent). No server auto-sign of customer funds.
5. Submit signed Testnet XDR through documented Soroswap `send` or chain executor. Persist transaction reference; reconcile actual confirmed wallet delta and order status.
6. Expose `GET markets`, `POST quote`, `POST orders`, `GET order` using frozen v0.1 contract and module `trade.spot`.

## Negative tests
No liquidity -> 409, stale quote -> reject, swapped XDR -> reject, wrong `asset_id`/issuer -> reject, double order idempotent, wrong tenant -> 404, disabled module -> 403, provider 429/backoff, pending network does not become completed. Store Testnet execution hash in evidence only when verified.

## Fallback
If Soroswap Testnet API key/liquidity unavailable, report exact blocker with official URL, let lead decide optional Stellar native SDEx path-payment implementation. Do not write pretend successful order or promise that an XLM payment is a spot trade.
