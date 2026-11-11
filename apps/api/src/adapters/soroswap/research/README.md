# Authenticated Testnet discovery — 2026-11-11 UTC

`authenticated-discovery.json` contains actual sanitized READ-ONLY provider responses. Authorization values are absent. No signing, broadcasting, customer consent, wallet/position change, or execution proof exists.

- `GET /protocols?network=testnet`: 200, `soroswap` and `sdex`.
- `GET /asset-list?name=soroswap`: 200, explicitly **mainnet**, 50 assets. The current adapter correctly rejects this list as a Testnet registry. `GET /asset-list` exposes mainnet list providers only.
- Broad `GET /pools?network=testnet&protocol=soroswap&protocol=sdex` and Soroswap-only discovery timed out at 20/15 seconds; these timeouts do not establish no liquidity.
- Exact native XLM SAC to Blend-registry USDC SAC pool lookup: 200, one pool, `CBR76WMT6J733CCVBP23M2EL5QGP5HXLPEFNFZGZ7IB6QHOJAHP7YM3V`.
- `POST /quote?network=testnet`: 201, actual 1 XLM quote. Original requested 50 bps yielded out 1419926/min 1412826 atomic USDC; strict customer ceiling bound is 1412827. Provider floors by an atomic fraction. Lead approved requesting 49 bps while retaining the original strict 50 bps validation. Actual tighter request returned 201 and passed the original bound. Zero slippage stays exact; insufficient output always fails.
- `GET /api/testnet/{router,factory,aggregator}`: 200 with explicit Testnet IDs in the evidence. Router/factory agree with official Core registry. These are preexisting protocol deployments, not Grapnel contracts, and this observation alone is not independent executable-code verification.
- `POST /quote/build?network=testnet` from the public treasury source: 428 `CREATE_TRUSTLINE`, errorCode13. No swap XDR was returned. The nested XDR is a separate unsigned `changeTrust` action; it was decoded only and remains unapproved.

## Exact output identity and prerequisite

USDC issuer `GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56`; deterministic Testnet SAC `CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU`. The SAC was independently recomputed with Stellar SDK `Asset.contractId(Testnet)` and matches the existing Blend registry identity. Native input SAC is `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`.

The provider-generated trustline has one classic `changeTrust`, source matching the treasury, fee100 stroops, zero signatures and maximum signed-int64 trust limit. Do not sign it generically. After Gate1, the lead must implement a narrow customer-approved trustline preparation path: verified tenant/customer session and owner; exact allowlisted classic code/issuer and derived SAC; source/signing key; current sequence; one operation and no extra signer/recipient/invocation; approved bounded trust limit; reviewed fee; narrow nonexpired timebounds; existing trustline check; native reserve/fee preservation; exact immutable summary/hash; one-use consent, durable worker broadcast and independent confirmed trustline inspection. Prefer constructing this classic transaction locally over treating nested provider XDR as an approved action. Customer must approve its own trustline; treasury signing cannot prove customer control.

Only after that prerequisite and actual Gate1 can a fresh quote/build yield the real swap invocation/auth/footprint needed for a route-specific inspector. Registry execution flags remain unset. Shared signing contracts, runtime worker spot execution and output-delta reconciliation remain lead integrations; this evidence cannot unlock swaps.

## Primary sources

- https://github.com/soroswap/sdk/blob/main/src/soroswap-sdk.ts (network-specific protocols, quote/build, pools and contract lookup; asset-list has no network parameter)
- https://github.com/soroswap/sdk/blob/main/src/types/quote.ts
- https://raw.githubusercontent.com/soroswap/core/main/public/testnet.contracts.json
- https://raw.githubusercontent.com/blend-capital/blend-utils/main/testnet.contracts.json

Tests:17 Soroswap mocked-interface regression tests pass; API typecheck passes. Live quote/read results above are discovery evidence only.
