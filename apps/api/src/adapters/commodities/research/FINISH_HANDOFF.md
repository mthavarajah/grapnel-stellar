# Commodities local finish review

Fresh read-only review: `current-review.json`, November 12 2026 03:12 UTC (November 11 local). No signing, submission or deployment occurred.

## Changes

- Discovery validates freshness against the time each provider response arrives. Previously an RPC call taking over one second could make the provider's newly timestamped response look like a future observation; a quote expiring during the request could also be accepted against the old start time.
- Returned discovery asset metadata is cloned. A caller cannot mutate it and thereby change the private reviewed registry used by subsequent requests.
- Three regression tests cover slow fresh reads, quotes expiring in flight and returned metadata mutation. All 22 commodity tests pass; API typecheck passes.

## Actual provider requests

The existing read-only catalog probe verified Stellar Testnet RPC passphrase, read the official Soroswap core registry and SODAX documentation/directory, queried the exact XAUM contract instance, and used the configured server credential for Soroswap catalog/protocol/quote requests. Sanitized responses are recorded in `current-review.json`.

- Official core registry still has 13 Testnet assets; none is a commodity candidate.
- SODAX documentation still explicitly says it is mainnet-only, with no Testnet chains or RPC endpoints.
- Authenticated Soroswap commodity catalog returns XAUM on mainnet.
- Exact XAUM contract has zero live Testnet instance entries at ledger 5685902.
- Exact 1 XLM to XAUM Testnet quote returns HTTP 400 with zero routes. Credentials work; protocols returns HTTP 200.

## Unresolved dependency

A first-party issuer/Soroswap must provide an explicitly Stellar Testnet commodity identity, exact decimals and code/issuer or contract hash, transfer eligibility and a seeded XLM/USDC route. A production API key or user test does not supply these missing deployments. No executable market was added, and quote/prepare remain fail-closed. The checked set is finite, not an exhaustive claim that every commodity project has been excluded.

No shared contract, UI, runtime or top-level documentation was changed. The lead should incorporate these current facts into docs/13_SOURCES.md and the user-facing status. No customer tests are required for this blocked provider path.
