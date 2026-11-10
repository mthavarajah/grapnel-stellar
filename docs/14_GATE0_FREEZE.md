# Gate 0 freeze — contract v0.1.0

Lead owns packages/contracts, openapi, root tooling/lockfile, migration numbering, .env.example and integration composition. All agents must read this and the required role docs before implementation. Changes require lead approval and versioned note here.

## Serialized conventions
UUID database IDs (do not use illustrative cus_/wal_/op_ prefixes). HTTP fields use snake_case; PreparedAction uses camelCase exactly as packages/contracts. Standard data/meta and error/meta envelopes per docs/03_API. Financial POSTs require Idempotency-Key. Customer context proof travels as X-Customer-Identity (Privy token) for initial financial requests; authorize also accepts privy_identity_proof. Business key never substitutes for customer proof. Customer creation binds external_customer_id to verified Privy user on wallet creation; one-time binding cannot be overwritten.

Owner demo login: POST /v1/dashboard/login {secret}; server compares ADMIN_LOGIN_SECRET, issues HttpOnly owner session cookie; GET /v1/dashboard/session returns {business_id,csrf_token}; mutations require X-CSRF-Token and exact allowed Origin. Business key cannot create owner session. Login is rate limited. Production cookies Secure. Seed tenant UUID 00000000-0000-4000-8000-000000000001, all modules disabled, no keys/balances/operations seeded.

## Ownership, isolated worktrees
- api: apps/api/src excluding adapters, wallet module, funding/spot/lending modules; API test files under apps/api. Root server composition owned by API agent during Wave A; lead integrates adapters later.
- chain: apps/api/src/adapters/stellar, apps/api/src/adapters/privy, apps/api/src/modules/wallets only. No frontend edits; provide signer integration instructions in handoff.
- funding: apps/api/src/adapters/testnet-funding, apps/api/src/modules/funding only.
- spot: apps/api/src/adapters/soroswap, apps/api/src/modules/spot only.
- blend: apps/api/src/adapters/blend, apps/api/src/modules/lending only.
- dashboard: apps/dashboard only.
- fintech: apps/fintech-demo only (including client signer).
- qa: tests, scripts, .github, deploy, evidence/README.md only. Lead owns evidence/testnet.json and root README.
- Each agent owns docs/handoffs/<role>.md for its handoff/research evidence. Lead incorporates source corrections into docs/13_SOURCES.md.

Agent dependency additions: change only own app manifest if exclusive app owner. API dependency requests go in handoff; do not edit lockfile/root manifest. No agent edits shared contracts/migrations. Worktrees branch from Gate 0 commit; commit only scoped changes; lead cherry-picks after review. Never commit environment files or generated private keys.

## Integration interface
Core exports buildApp(options) in apps/api/src/app.ts. It should accept injectable pg Pool and IdentityVerifier for isolated tests; production verification must fail closed without Privy. Shared errors are GrapnelError. API exports safe helpers/services from src/lib/context.ts / src/modules/operations/service.ts and reports exact APIs in handoff. Provider agents build framework-independent adapters first; routes can export Fastify plugins but must not invent core internals. Lead wires them after API handoff.

Stellar adapter exports canonical prepareAndSimulate, signature verification, submit/reconcile and classic payment/balance helpers; use contracts NetworkExecutor/PreparedAction. Provider preparation may be implemented during Wave A but financial provider execution is prohibited until Gate 1 proof. Gate 1 requires Privy-signed actual payment plus auth tests; missing credentials must be reported as blocker, not bypassed with local customer keys. Treasury provisioning/reads allowed; outgoing provider execution waits for Gate 1.

Provider execution defaults blocked/discovery_only. testnet_verified requires recorded independent chain verification. Live discovery and preparation must not be misrepresented as executable readiness. Writes blocked with structured EXECUTION_UNAVAILABLE until signed path and intent inspector are validated. In-process mocks only in tests.
