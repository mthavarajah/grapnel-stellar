# Noether Testnet perps — current eligibility and read-only integration

**Observed:** 2026-11-11 18:22–18:26 UTC. **Scope:** `apps/api/src/adapters/perps/noether.ts` and its focused tests. Public GETs only. No wallet challenge, API key, customer address check, account request, order preparation, transaction submission, signature, or chain write was performed.

## Testnet versus regional eligibility

The current official developer overview explicitly says the documented API is the Testnet deployment. In that same Testnet-specific overview, trading endpoints under `/v1/orders` and `/v1/tx` may return HTTP 451, the restricted-jurisdiction list includes Ontario, and the Terms of Service rules apply whether or not edge blocking fires. The [official Noether Terms of Use](https://noether.exchange/terms) separately say that using the interface represents that the person is not a resident/citizen of, or accessing from, Ontario and is not disguising location with a VPN. The docs header says Testnet funds are not real, but neither the overview nor the terms provide a Testnet exemption from those restrictions. Therefore `trade.perps` execution remains blocked for the Ontario demo; simulated/test funds do not authorize an exception.

The [authentication guide](https://docs.noether.exchange/developers/authentication) says key issuance is closed beta and allowlist-gated. A fresh address-free `GET /v1/keys/beta-status` returned `{ gated: true, allowed: false }`; this is global status only and does not establish a particular wallet's eligibility. We did not send an address to the status endpoint.

## Current public Testnet observations

Direct requests, all `GET`, to the documented gateway:

| Endpoint | Result |
|---|---|
| `/v1/health` | HTTP 200; `status=ok`; `network=testnet`; indexer ledger age 2 seconds at 18:22 UTC (28 seconds during the adapter check at 18:26). |
| `/v1/markets` | HTTP 200; 16 current oracle entries: BTC, ETH, XLM, SOL, XRP, ADA, BNB, TRX, HYPE, DOGE, ZEC, LINK, BCH, LTC, PUMP, UNI. Prices are provider values in 7-decimal atomic strings. |
| `/v1/markets/stats` | HTTP 200; 16 rows. At 18:26, pool snapshot reported `stale=false`, ledger 5679584; custody snapshot `stale=false`, deficit `0`. BTC row: 9 open positions; long OI `828444000000`, short OI `1212600000000`, net OI `-384156000000`, volume24h `0`, long/short headroom each `1000000000000`. |
| `/v1/keys/beta-status` | HTTP 200; `gated=true`, `allowed=false` without an address. |

The market list is data discovery, not venue eligibility or approval to trade. The official [markets guide](https://docs.noether.exchange/developers/rest-api/markets) currently describes 14 open and 16 listed markets in its latest snapshot and cautions that PUMP and UNI were listed but not open in an earlier dated snapshot. The live stats endpoint does not itself prove those two risk configurations are enabled. No market is promoted to executable by this adapter.

The new `NoetherPublicAdapter.marketStats()` method reads only the documented public `/v1/markets/stats` endpoint, checks Testnet health, preserves integer strings and returns missing capacity/health fields as `null`. It marks the whole snapshot `discovery_only`, `executable=false`, `reason=REGION_RESTRICTED`. No shared API contract or route changed.

## Conditions to revisit execution

Do not enable execution based on Testnet status, market listing, a global beta response, or a UI setting. Revisit only after Noether publishes or directly confirms in writing that the exact Testnet trading flow and the customer’s jurisdiction are eligible, its current Terms no longer disallow the customer’s access, and any closed-beta wallet/key approval is granted. Then require the lead’s review of the exact provider API/XDR flow, customer intent/signature validation, transaction simulation, and verified Testnet transaction plus position/balance deltas. If the customer is still in a restricted jurisdiction, continue to block and do not use a VPN, alternate gateway, proxy, or false region header.

## Verification

- `pnpm exec vitest run src/adapters/perps/noether.test.ts`: 18 passed. Added coverage for 7-decimal market-stat strings, nullable/missing capacity (never filled with zero), duplicate/float rejection, and a regional denial latch on the stats path.
- `pnpm exec tsc --noEmit`: passed for the API.
- Live adapter read of `/v1/health` and `/v1/markets/stats` at 18:26 UTC: 16 rows; returned `execution_status=discovery_only`, `executable=false`; no signer/broadcast path was exercised.
- Sources: [Testnet developer overview and regional restrictions](https://docs.noether.exchange/developers), [closed-beta authentication and beta-status semantics](https://docs.noether.exchange/developers/authentication), [public markets and stats](https://docs.noether.exchange/developers/rest-api/markets), [Terms of Use](https://noether.exchange/terms), [endpoint reference](https://docs.noether.exchange/developers/reference).
