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
