# Market QA handoff — 2026-11-11

## Scope and result

Independent market workflow harness is under `tests/integration/markets.test.ts`. **7/7 tests passed** against an exclusively created disposable PostgreSQL database `grapnel_market_qa_20261111_test`; test TypeScript compilation passed. Only tests and this handoff changed. No production source, API contract, provider evidence, signer or chain state was modified.

The HTTP/DB suite exercises actual Fastify routing, business/customer identity checks, SQL quote/order records, reservations, one-use action authorization, and durable worker state. Provider replies, local keys/signatures, balances and worker chain responses in this suite are explicitly isolated fixtures. They are not Stellar execution evidence.

Coverage:

- Exact native XLM and issuer-qualified Testnet USDC market identities; a fixture market remains discovery-only.
- Stored normalized quote amounts and strict customer slippage floor; a provider response one atomic unit below minimum is rejected.
- Invalid key, forged customer identity and cross-tenant customer denial before any provider call.
- The same business key loses/restores Spot access immediately when its entitlement changes.
- Expired and foreign quotes rejected before preparation.
- `202` creates an awaiting-approval operation, and identical idempotent order requests recover the same ID. A second order using the same quote is rejected.
- Approval binds exact transaction hash to the customer's Ed25519 signature and a one-use action token; a foreign signature and replay are rejected.
- Pending RPC state never yields a completed order or a fill; the same persisted hash is polled without a second send. Even mocked RPC success remains confirming if balance-delta verification fails.
- Unconfigured stocks and perps return no fabricated market records or fills.

## Commands

This suite **resets its database schema** to keep the global worker from claiming another test suite's fixture jobs. Supply an exclusive disposable database ending in `_test`; it intentionally does not reuse `API_TEST_DATABASE_URL` by default.

```sh
createdb grapnel_market_qa_test
MARKETS_TEST_DATABASE_URL=postgres://localhost/grapnel_market_qa_test \
  pnpm exec vitest run tests/integration/markets.test.ts
pnpm exec tsc --noEmit -p tests/tsconfig.json
```

`tests/live/markets-readonly.ts` is an explicitly opted-in, read-only provider diagnosis. It has no signing or submission endpoint and does not create accounts, trustlines, funds or orders. Inject credentials server-side; do not put secrets in command arguments or commit them.

```sh
RUN_LIVE_MARKET_READS=true pnpm exec tsx tests/live/markets-readonly.ts
```

It requires `SOROSWAP_API_KEY`. Optional `MARKETS_DIAGNOSTIC_ACCOUNT` must be an existing public Testnet account with the exact authorized USDC trustline. The default public diagnostic account is the same preexisting one used in the Spot agent's unsigned build research; it is not a customer signer.

## Actual read-only provider observation

Observed `2026-11-11T15:42:21.404Z`:

- Horizon reported the Testnet network passphrase, and the existing diagnostic account had the exact authorized `USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56` trustline.
- Authenticated `GET /protocols?network=testnet`: **200**, `soroswap` and `sdex`.
- Authenticated `POST /quote?network=testnet`: **201**, exact 1 XLM input (`10000000` atomic), expected output `1494807` atomic USDC, minimum `1487482` atomic. Provider request was 49 bps so its rounded minimum satisfies the customer's strict 50 bps bound.
- Authenticated `POST /quote/build?network=testnet`: **201**, one unsigned `invokeHostFunction`, one auth entry, raw fee `80884` stroops.
- Input SAC `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`; exact output SAC `CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU`, recomputed from issuer and Testnet passphrase.

This is quote/build availability only. It does not establish safe provider-XDR approval, enforce-mode simulation, signature, broadcast, swap completion or a balance change. The Spot agent owns final envelope/auth/footprint inspection and simulation; the lead owns runtime/BFF/signing/settlement integration. Actual Soroswap Gate 2 proof is still pending.

## Other market categories

The current REST routes return empty lists for stocks and perps. Repository source review (`docs/09_OTHER_ASSETS.md`, `docs/13_SOURCES.md`) records no verified eligible Stellar Testnet stock/SODAX route, while Noether trading needs beta access and records an Ontario restriction. This QA task did not attempt access circumvention or claim a fresh legal/eligibility determination. These categories should remain unavailable until a separately approved and verified route exists.

No production defects were found in the covered HTTP/service boundaries. Re-run the harness after lead integration, and add the Spot inspector's focused tests when its exported API lands. Fixture success never fills `evidence/testnet.json`.
