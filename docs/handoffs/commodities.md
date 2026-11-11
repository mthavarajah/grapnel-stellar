# Commodities Testnet availability handoff

Status: **blocked / discovery only**. No commodity action is executable. No transaction was signed or broadcast.

## Implemented

- Added a fail-closed `trade.commodities` adapter in `apps/api/src/adapters/commodities/`.
- Availability returns `execution_status: blocked`, no markets and `NO_VERIFIED_TESTNET_COMMODITY_ISSUER_OR_LIQUID_ROUTE`.
- Quote and prepare return structured `EXECUTION_UNAVAILABLE`. Mainnet and non-Testnet passphrases are rejected.
- Added a read-only probe and sanitized evidence at `apps/api/src/adapters/commodities/research/availability.json`; no credentials or account balances are recorded.

## Evidence and blocker

At the recorded observation time, the Testnet Horizon code lookup showed ticker collisions (`GOLD`: 112 issuers; `XAU`: 27; `XAG`: 5; etc.). These are not verified commodity assets. `WTGOLD` had zero matches. The XAU.CL issuer's own TOML identifies its network as Public Global Stellar Network and states its tokens are not physically gold-backed. Its exact Testnet classic asset lookup contained zero records; its derived Testnet SAC had no XLM SDEX bids or asks; an exact Soroswap Testnet XLM-to-SAC quote returned HTTP 400 `Quote Failed`. It is excluded regardless of these liquidity results because the issuer disclaims physical backing.

Official references reviewed:

- XAU.CL issuer metadata: <https://xau.cl/.well-known/stellar.toml>
- Stellar Horizon Testnet asset endpoint: <https://horizon-testnet.stellar.org/assets>
- Stellar Horizon Testnet SDEX order book: <https://horizon-testnet.stellar.org/order_book>
- Soroswap SDK/provider references: <https://github.com/soroswap/sdk>
- WisdomTree Gold Token documentation (product backing description; no matching Testnet issuer/asset was found): <https://wisdomtree.gitbook.io/wisdomtree-gold-token>

The ticker scan is deliberately finite and does not establish that no other commodity tokens exist. It establishes that no candidate from this checked set met the required chain identity, issuer provenance, commodity backing, and live route requirements. Do not enable this adapter or show tradable instruments until an issuer-verified Testnet asset and a fresh executable provider route are supplied and then pass the shared signing, simulation, inspection, and balance-delta gates.

## Integration

No shared API, dashboard, contract, route, or runtime file was changed. The lead may expose the adapter's blocked capability for diagnostics, but must not advertise execution. To unblock, provide a first-party commodity issuer's exact Stellar Testnet asset identity plus issuer provenance, and confirm live Soroswap/SDEX liquidity at the time of integration. Re-run the probe and record new evidence before implementing quote/build/simulation paths.

## Verification

Focused adapter tests cover network rejection, blocked availability and fail-closed quote/prepare behavior. Probe is read-only and reports `signed: false`, `broadcast: false`.

## Fresh catalog and chain review — 2026-11-11T18:24:05Z

A second independent probe is implemented at `apps/api/src/adapters/commodities/research/catalog-probe.ts`; sanitized results are in `catalog-review.json`. It verifies RPC Testnet passphrase, records official source content digests, checks the exact catalog XAUM contract instance on Testnet, and requests an authenticated quote. It never signs, submits or deploys.

- [SODAX's current official documentation index](https://docs.sodax.com/llms.txt) explicitly states: **“SODAX is mainnet-only (no testnet chains or RPC endpoints exist)”**. The reviewed document returned 200; its SHA-256 is recorded in the probe result. [The official directory](https://www.sodax.com/partners/asset-directory) mentions PAXG, XAUt and commodity-linked funds GLD/SLV/USO, but these directory listings do not override the documented network limitation. A production API key cannot create a Testnet environment.
- The [official Soroswap core token registry](https://raw.githubusercontent.com/soroswap/core/main/public/tokens.json) explicitly identifies 13 Testnet assets: XLM, XTAR, USDC, XRP, ARST, AQUA, EURC, BTC, BRL, UXIV, CYON, JAMN, VEOF. None is a commodity candidate in this checked list.
- Authenticated Soroswap `/asset-list?name=soroswap` returned 200 with an explicitly **mainnet** XAUM listing, `CC2RBGYNCFBCVENIDL5BFBWPH4OUZM2UA3OD2K2N54GLMWCC4KWPVAGO`. It remains excluded. The new catalog guard does not promote a symbol, `verified:true` flag or syntactically valid contract ID into Testnet commodity proof.
- The exact XAUM contract's live instance lookup on Stellar Testnet returned **zero entries at ledger 5679560**. This is a current liveness observation, not a claim that every archive or future deployment was exhaustively searched.
- Provider credentials work: Testnet protocols returned 200 (`soroswap`, `sdex`). Exact Testnet 1-XLM-to-catalog-XAUM quote returned **400**, no route. Missing provider key is therefore not the blocker.

### Implemented availability reader

`CommodityAdapter.discover(reads)` now exposes an injectable, read-only availability reader for a **finite lead-reviewed registry**, defaulting to empty. It validates exact Testnet identity, classic issuer-to-SAC mapping or standalone WASM hash, first-party provenance, fresh chain metadata, exact 1 XLM quote, integer min-receive bound, route allowlist and expiry. Wrong network fails before contract/quote reads. Failed or stale providers yield blocked diagnostics. Even valid contract and quote observations yield only `discovery_only`, never executable actions or markets; invocation inspection, simulation, customer approval and chain proof remain separate gates.

Integrate only with server-owned `approvedAssets` and trusted read callbacks. Do not accept registry records or attestations from business/customer HTTP input. No approved commodity candidates are currently configured. Existing executable paths remain unavailable and `markets()` remains empty.

### Exact provider request to unblock

Ask Matrixdock/Soroswap (or another first-party commodity issuer) for:

1. An explicitly **Stellar Testnet** deployment/registry: exact contract or classic code+issuer, decimals, executable hash/standard, and first-party Testnet provenance.
2. A statement of what the Testnet asset represents and its transfer eligibility; mainnet gold rights cannot be inferred for a developer token.
3. A current seeded Testnet XLM/USDC pool or orderbook, router/pair IDs, and a documented quote/build route that accepts the exact Testnet asset.
4. An issuer-approved Testnet token source if customer/treasury inventory is needed.

For SODAX specifically, the dependency is an actual documented Testnet deployment and API environment, because its current official docs exclude Testnet. Do not request a generic production API key as if it would unblock this MVP.

Verification: **19 focused tests pass**, covering catalog network confusion plus approved-registry identity, metadata, liquidity, stale observations and fail-closed execution semantics. API typecheck passes. No new chain writes or execution evidence were produced.
