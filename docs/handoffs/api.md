# Core API handoff

Role: Core API / feat/core-api. Gate 0 consumed at 6ed12fd. Gate 1 auth portion verified locally; chain signing proof is not achieved by this role.

## Implemented

- Fastify health, public OpenAPI/Swagger docs; strict Testnet startup configuration; safe JSON envelopes and request IDs.
- Independent owner login/session/logout, HttpOnly cookie, strict owner Origin/CSRF for changes, rate limiting; owner tenant creation, seven-module catalog and atomic revision updates.
- Cryptographic high-entropy business API keys, SHA-256-only storage, one-time secret response, metadata listing, immediate revoke; per-request live module reads.
- Tenant-scoped customer mapping/lookup and Privy identity/wallet ownership guards; production defaults fail closed without injected verified identity provider.
- Durable Postgres idempotency, operations, wallet reservations, prepared action storage, single-use customer authorization; hash+signed envelope persisted before broadcast job.
- Worker row-lock claims, lease/backoff, hash-first recovery; no replacement broadcasts after ambiguous prior attempt. Completion requires chain result plus independent delta verification callback.
- Portfolio uses injected authoritative balance reader. Lending positions deliberately null until adapter integration; no fake cache-to-wallet balances.
- Request audit logs omit bodies, secrets, identity tokens and concrete customer identifiers.

## Integration exports

`buildApp(options)` from `src/app.ts` accepts `pool`, `config`, `identityVerifier`, `verifySignedAction(action,signedXdr,customerIdentity) -> {txHash}`, `balanceReader(address) -> WalletBalance[]`, `capabilities` keyed by module, `registerAdapters(app)`.

`request.grapnel = {pool,config,identityVerifier}`. `lib/context.ts`: `requireBusiness(request,module?) -> {businessId,apiKeyId}`, `requireOwner(request,mutation?)`, `verifyIdentity(request,proof?)`, `requireCustomer(request,customerId,walletId?,proof?) -> CustomerContext`, `success(request,data)`.

`db/index.ts`: `transaction(pool,callback(client))`, `lock(client,key)` (transaction advisory lock).

`new OperationService(pool)`:
- `createIdempotent({businessId,customerId,walletId,module,type,provider,route,idempotencyKey,request}, callback?(client,operationId)) -> {operation,created}`. Callback runs in the transaction; do not broadcast in callback.
- `reserve(client,{businessId,customerId,walletId,operationId,assetId,amountAtomic,spendableAtomic,observedAt,expiresAt})`. Fresh spendable must already exclude fee/reserve. Core subtracts active reservations; uncertain expired reservations remain held.
- `setPrepared(client,businessId,operationId,PreparedAction)`.
- `get(businessId,operationId,withPrepared=false)`, `issueAuthorization(businessId,operationId)`; caller MUST authenticate exact customer before returning prepared action/token.
- `authorize({businessId,operationId,customerId,token,signedXdr,verify})` consumes token and schedules `worker_jobs.job_type='broadcast'`; it never broadcasts itself.
- `recordReconciliation(businessId,operationId,{state,deltaVerified?,result?})`; successful chain result without delta remains confirming. Updates funding transfer state/hash.

`new OperationWorker(pool, {lookup(txHash)->{found,state,deltaVerified?,result?},broadcast(signedXdr)->{txHash},verifyDeltas(operationId,txHash)->boolean})`; `tick() -> boolean`. Default `worker.ts` explicitly reports blocked until lead injects validated chain adapter; no unattended financial provider execution before Gate 1.

## HTTP payloads

- Owner login `{secret}`, returns data `{business_id,csrf_token}`; session GET restores same token. Cookie `grapnel_owner`, mutations `X-CSRF-Token` + allowed Origin.
- Modules GET/PATCH returns data `{modules:[{module,name,provider,description,enabled,execution_status,reason,actions}],revision}`.
- Key POST `{name}` returns data `{id,prefix,last_four,name,created_at,revoked_at,status,secret}` only once; key GET `{keys:[...]}` omits secret/hash.
- Capabilities GET returns `{capabilities:[...],revision}`.
- Customer POST `{external_customer_id}` returns `{customer_id,id,external_customer_id,created_at}`. Identity initially null; chain wallet service must bind only verified identity and must not overwrite.
- Operation GET without X-Customer-Identity omits prepared XDR/token. Verified exact customer GET returns current prepared action and newly minted single-use action token. GET mints a new token superseding older pending tokens to avoid persistently storing raw token.
- Authorize POST per frozen shared schema; returns 202 preparing with deterministic hash. No completion before worker proof.

## Checks run

PostgreSQL 16.13 local disposable DB `grapnel_mvp_api_test`. `API_TEST_DATABASE_URL=postgres://mathuthavarajah@localhost:5432/grapnel_mvp_api_test pnpm exec vitest run apps/api/src/core.test.ts`: **18 tests pass**, including same-secret entitlement edits, revoke, CSRF, tenant isolation, forged/missing customer identity, idempotency collision and concurrent reservation exclusion, one-use authorization, delta-required finality, ambiguous submission recovery.

`pnpm --filter @grapnel/api typecheck`: passes. No provider request, blockchain broadcast or fake transaction evidence from these tests. Test hashes/addresses exist only within explicitly mocked test fixtures.

## Blockers and lead tasks

- Privy credentials not configured; inject Chain agent IdentityVerifier/signature verifier only after actual proof. No fallback signing decision made.
- Lead must compose wallet/funding/spot/lending plugins. No provider source owned by this agent.
- Existing lead dev DB was manually baselined. Migration runner intentionally does not assume an unmanaged schema is identical: initialize migration tracking with the exact `0001_baseline.sql` name after verifying baseline, or use a fresh database. It does not alter unknown preexisting schema.
- Node root .env loader preserves host-injected env values. Server/worker/migrate load it; .env remains ignored.
- No manifest or frozen schema changes. No provider hashes/deploy URLs claimed.
