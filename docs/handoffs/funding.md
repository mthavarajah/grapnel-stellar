# Funding handoff

**Role/branch:** Agent 03 / feat/testnet-funding.
**Gate completed:** Gate 0 consumed; Gate 1 and Gate 2 remain unpassed.
**Changed files:** apps/api/src/adapters/testnet-funding/{index.ts,funding.test.ts}, apps/api/src/modules/funding/{service.ts,routes.ts}, docs/handoffs/funding.md.

Implemented an XLM-only allowlist, live treasury inventory discovery, Testnet network checks against Horizon's actual network_passphrase, native reserve/sponsorship/selling-liability calculation, bigint amounts, strict fixed-treasury return, and treasury-signed preparation. Preparing transactions does not broadcast. Configuration and Gate 1 approval both default to unavailable; absence of credentials produces null treasury availability and an explicit blocked reason.

FundingService accepts the shared durable OperationService via a structural port. create('fund'|'return', body, verifiedCustomerContext, idempotencyKey) delegates atomic idempotency to core, rechecks tenant/customer/wallet/Privy ownership, obtains global funding, treasury-sequence and wallet-asset advisory locks, enforces cumulative customer/tenant/global grant caps, and refuses concurrent pending treasury transactions. Customer quota is tied to verified Privy user across tenants, rather than a browser or key. Grant XDR + deterministic hash + recipient baseline are persisted before queuing a core broadcast job. Return reserves amount plus max fee and calls core setPrepared, so it follows the shared one-time authorization flow. There is no provider call from inside a worker execution path in this role's code.

## Integration

```
const adapter = new TestnetFundingAdapter({
 network: config.network,
 networkPassphrase: config.passphrase,
 treasurySecret: process.env.DEMO_TREASURY_SECRET,
 enabled: process.env.TESTNET_FUNDING_ENABLED === 'true',
 gate1Passed: false, // true ONLY after lead verifies Gate 1 evidence
});
const service = new FundingService(adapter, new OperationService(pool));
await registerFundingRoutes(app, {service,requireBusiness,requireCustomer,success});
```

All config values must be injected by the integration lead; no secret is hardcoded. Module route factory registers funding-assets, fund and return, requires core business/entitlement and verified customer hooks, validates shared FundingInputSchema, returns the shared 202 operation.

Core worker job type is `broadcast`, matching customer authorization jobs. Lead must configure shared worker chain submission and balance-delta reconciliation. Fund operation result_json includes recipient, asset_id, amount_atomic, before_recipient_atomic and expires_at, all computed before the broadcast. Only chain success plus recipient delta verification may complete a grant. Core reconciliation should update testnet_funding_transfers status/tx_hash to mirror finalized operations. Ambiguous submission must retain the deterministic hash and reconcile before any retry. An expired ambiguous transfer remains conservatively pending until explicitly reconciled; no automatic new treasury payment is built.

## Actual provider evidence

At implementation, an unauthenticated read of `https://horizon-testnet.stellar.org` returned network_passphrase `Test SDF Network ; September 2015` and history_latest_ledger/core_latest_ledger `5659570`. This is infrastructure read evidence only. No treasury account was provisioned, no outgoing funds were sent, no Privy signing occurred, and no transaction hash or position delta exists. Evidence JSON remains untouched.

Official sources checked: https://developers.stellar.org/docs/learn/fundamentals/lumens (native reserve, liabilities and sponsorship), https://github.com/stellar/friendbot (native faucet). SDK @stellar/stellar-sdk 14.3.0 installed from Gate 0. Friendbot is not called by this adapter; wallet activation belongs to Chain. No USDC/Blend/Soroswap asset compatibility is claimed; provider_compatibility is empty.

## Commands and outcomes

- `pnpm install --frozen-lockfile`: passed.
- `pnpm --filter @grapnel/api typecheck`: passed.
- `pnpm test apps/api/src/adapters/testnet-funding/funding.test.ts`: 9 passed.
- Tests use mocked Horizon responses and local random cryptographic fixtures only; they do not represent real onchain execution.

Negative checks cover mainnet network config/server, missing treasury, unpassed signing gate, funding kill switch, exact asset allowlist, decimal precision, reserve/liability preservation, customer reservation overdraw, wrong customer context, fixed return recipient, unsigned customer envelope, treasury-only fund signature and no broadcaster calls.

**Environment names:** DEMO_TREASURY_SECRET, TESTNET_FUNDING_ENABLED, TESTNET_FUNDING_MAX_PER_CUSTOMER_ATOMIC, TESTNET_FUNDING_MAX_PER_TENANT_ATOMIC, TESTNET_FUNDING_MAX_GLOBAL_ATOMIC. No dependency additions.

**Blockers:** no configured treasury/Privy credentials and Gate 1 proof; no live PostgreSQL service tests or outgoing funding/return proof. QA must test quota/concurrent/idempotent behavior against actual Postgres after integration; unit tests do not assert database concurrency. The funding cap is lifetime until the demo DB is reset, no rate window. Endpoint rate limiting is supplied by core/global HTTP rate limiter.
