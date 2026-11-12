# AGENT 01 — Lead / Core API / Contracts / DB

**Read:** root `AGENTS.md`, `docs/00_PRODUCT.md`, `01_WORK_PLAN.md`, `02_ARCHITECTURE.md`, `03_API.md`, `04_DATABASE.md`, `11_TESTS_SECURITY.md`. This agent is **the single owner** of shared contracts, migrations, root tooling and integration decisions. Coordinate other agents; never let frontend/provider agents silently change API shapes.

## Deliverables
- Bootstrap pnpm/TypeScript strict monorepo with `apps/api`, `apps/dashboard`, `apps/fintech-demo`, `packages/contracts`, `openapi/grapnel.yaml`; root scripts `lint`, `typecheck`, `test`, `test:integration`, `smoke:testnet`.
- Fastify API with Zod validation, shared errors and response envelopes, `/health`, `/docs`, `/openapi.json`, strict Testnet config.
- DB migrations per `04_DATABASE.md`, unique composite tenant customer FK, atomic idempotency and balance reservations.
- Owner dashboard authentication and tenant/module endpoints; business key generation, hash, metadata and revocation; immediate permission changes with existing same secret; per-request module entitlement check.
- Customer mapping and verified Privy identity context; `GET /v1/capabilities`, operations status API, portfolio normalization, API request audit log.
- Async worker with row-lock job claims, onchain status polling, no duplicate broadcasts or false completions.
- Publish frozen schemas and example JSON for other agents. Own all root/shared changes and merges.

## Implementation sequence
1. Initialize workspace and strict TS lint/typecheck. Define stable module IDs and error codes. Module catalog has exactly 6: `capital.wallets`, `capital.testnet_funding`, `capital.lending`, `trade.spot`, `trade.stocks`, `trade.perps`. Remove fiat on/off-ramp routes/DB fields.
2. Implement DB and auth middleware including owner session distinct from business key.
3. Write tests for API key secret lifecycle, same-key entitlement updates, cross-tenant requests and idempotency.
4. Define `PreparedAction`, `AssetIdentity`, `FinancialOperation`, capabilities, quote and lending responses from doc 02/03.
5. Merge Wallet agent's actual `WalletSigner` and Stellar executor only after it satisfies Gate 1; provider implementations must use shared operation service.
6. Integrate Spot/Testnet Funding/Blend with actual transaction reconciler, then frontends.

## Do not do
- Invent `GET /v1/dashboard/modules` semantics conflicting with docs.
- Encode entitlements permanently into API key/JWT, force key rotation on module save.
- Allow business key alone to authorize customer signature.
- Mark `completed` before ledger finality.
- Accept free-form contract IDs or quote amounts from caller as trusted.
- Build a cross-chain or standalone Ledger product.

## Acceptance
Integration tests: 401 invalid/revoked, 403 disabled, permission change with same secret, strict tenant object isolation, 409 idempotency collision, 202 state machine, concurrent customer wallet and treasury asset funding locks, customer proof denial, no network='public'. Pass all to QA with reproducible commands and sanitized sample responses. Package OpenAPI validates and matches Fastify routes.
