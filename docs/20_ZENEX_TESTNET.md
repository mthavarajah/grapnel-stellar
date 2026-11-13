# XLM Perpetuals — Zenex Stellar Testnet

Owner direction, November 12/13, 2026: replace the active GMX catalog with Zenex Testnet, XLM/USD only. “Zedek” in the request refers to the Zenex venue linked in the preceding exchange. Stocks, Crypto, Earn and Borrow retain their existing providers. Public deployment is deferred. Old GMX and Hyperliquid records remain available for historical recovery; new GMX funding/preparation is disabled.

## Verified provider identity

Official frontend: https://testnet.zenex.trade/ . Public Testnet API: https://api-testnet.zenex.trade/v1/config . Exactly one market, `xlm-usd`, is listed. Exact contracts, issuer and feed are frozen in `packages/contracts/src/index.ts`; code hashes are in `apps/api/src/adapters/zenex/index.ts` and rechecked against current Stellar Testnet instances. Mainnet documentation addresses are never substituted.

Collateral is the actual Testnet SAC `CD4MP2QV4LABFU5OL6Y5RICCLQIX7TWT6T6J546EDYVUXHH6RS2V5S2O`, classic USDC issuer `GCLSQU55UGBZQITOD4JFGEMIFAAUZSHZ6V2BK7BQNZ2F76V5KNXLOUGC`, seven decimals. It differs from the existing Earn/Borrow USDC issuer. No bridge, EVM trading account, shared collateral balance, or assumed dollar peg is introduced.

## Customer process

The existing verified Privy Stellar wallet authorizes the exact Testnet envelope. On the first explicit Long/Short click, missing collateral is handled within that transaction flow: prepare a customer-signed trustline when needed, then request the provider's actual Testnet faucet to the session wallet, and verify sufficient confirmed collateral before preparing the trade. No setup or funding write runs on page load. The ticket has no separate Get funds/Refresh controls; balances refresh automatically and on focus. A durable claim flag precedes the external faucet request. Canonical exact-token mint/transfer events establish receipt; a provider response alone does not establish completion. Definite refusals terminate; uncertain requests retain their state for recovery and are never automatically claimed again.

Long/Short preparation builds `create_order` locally, with exact side, notional, collateral, 0.5% adverse price bound, and ledger expiration. Every signable transaction is simulated. Independent server and browser inspectors bind the displayed intent, source-only authorization, exact transfer, bounded fee and pinned contracts. Product caps: 1–20 USDC collateral, $40 notional, 1–10× leverage; the protocol's 20× ceiling is not advertised as a verified product limit. Fees and price-movement headroom must still fit current initial margin.

Order creation is not a fill. The durable Stellar worker retains the signed hash, polls the same transaction, then verifies the matching keeper `open_fill`/`close_fill` event, successful execution receipt and actual position delta before completing. Closing uses the full-close sentinel. The protocol's 30-second opening lock is displayed. Orders that rest can be cancelled; only canonical cancellation proof releases the original request as failed/cancelled, never as an executed trade. Exact customer/tenant checks apply to reads and writes.

## API contract version 0.4.4

- `GET /v1/trade/zenex/status?customer_id=&wallet_id=` — exact wallet balance, live positions and pending durable operations.
- `POST /v1/trade/zenex/prepare` — identity plus kind `open|close|cancel|trustline`; open includes side, collateral and leverage; close includes side; cancellation includes order id. Returns the existing operation contract.
- `POST /v1/trade/zenex/fund` — identity only; requires `Idempotency-Key`; requests actual provider funds.
- Existing `/v1/operations/:id` and `/authorize` handle signing and recovery.
- Catalog, detail, price history and overview now select `zenex-testnet:perps:XLM`. No module identifiers change.
- `PreparedAction.summary.perpetual` binds exact XLM order fields. Optional operation `display_side` accompanies the notional for consumer Activity.

All actions require current `trade.perps`, `capital.wallets` and verified customer ownership. New writes also require Gate 1 and reverified provider roundtrip evidence.

## Chain proof and limits

`evidence/zenex-roundtrip.json` records a **controlled QA keypair**, not a customer Privy execution claim. Actual Testnet USDC mint, Long/open-close and Short/open-close were independently checked against canonical chain events and successful keeper receipts. Both positions ended at zero. A second four-action roundtrip through the actual Grapnel adapter is captured in `evidence/zenex-adapter-roundtrip.json`; canonical cancellation is captured in `evidence/zenex-cancellation.json`. The inspected API preparation and signing verifier were separately exercised without broadcasting a customer transaction.

Prices use the provider's current Chainlink Data Streams ticker with its origin timestamp and exact 18-decimal values. All six UI ranges request actual UDF history from `XLMUSD` with appropriate resolutions. Overlapping initial buckets are clipped; no candles are invented. Pending order reconciliation paginates canonical events with a bounded 1,000-event safety limit. A faucet timeout without a returned hash requires recovery; it does not authorize a second claim.

Provider source references: https://github.com/zenith-protocols/zenex-sdk-js (reviewed commit `45f4d818af455528c850b16269ec5015440f3148`), `contracts/market/{contract,types,keys}.ts`, and the official `zenex-agent` protocol/API references. The SDK's latest peer requires a different Stellar SDK major; this integration uses the reviewed ABI and existing pinned Stellar SDK without upgrading unrelated signing flows.

## Database-backed acceptance correction

The initial adapter tests did not exercise asset foreign keys in `balance_reservations`. Customer setup completed (Privy trustline and actual faucet credit), but order preparation hit PostgreSQL `23503` because the distinct Zenex USDC was missing from `assets`. The preparation transaction now registers the exact live-verified issuer/SAC before reserving it. Conflicting registry metadata is rejected rather than overwritten.

`reservations.test.ts` reproduces the missing-asset failure against a fresh disposable PostgreSQL database, then verifies registration and the real reservation insert. `evidence/zenex-durable-roundtrip.json` proves actual Long/open-close and Short/open-close through Fastify HTTP preparation, cryptographic authorization, persisted operation/hash, the durable worker, canonical keeper fills and reservation release. This uses a controlled QA keypair and an explicit isolated test identity verifier in a `_test` database; it is not a production Privy login claim.
