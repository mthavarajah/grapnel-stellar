# Margin workflow coordinator — root integration handoff

This module is **not registered in runtime** and has no public routes, signer, broadcaster or live adapter. Its fixture tests are not Testnet execution proof. Peridot execution guards and protocol proof remain owned by `margin_execution`.

## Files and interfaces

- `types.ts`: server-side structural adapter, immutable workflow economics, canonical provider step/action map, normalized chain evidence.
- `state.ts`: deterministic step/evidence defense: exact owner/market/direction/position ID, terminal chain hash, intent digest, fresh observation and actual receipt/principal/debt/phase changes.
- `service.ts`: tenant-bound Postgres coordinator using existing `OperationService`. A separate parent avoids blocking child operations with the existing single-pending-wallet invariant. Every child is a separate exact customer approval with its own durable operation, reservations, signed bytes and hash. No next step is automatically signed or submitted.
- `schema-proposal.sql`: reviewed-shape proposal only, **not an installed migration**. Root must assign migration number and own integration. Composite wallet/parent/operation FKs, one active workflow/wallet, parent creation idempotency, unique step attempt/operation, immutable economic terms trigger and revision locking/CAS.

Root approved the separate parent model and requested composite isolation, immutable economics and individually approved recovery steps. Table/DTO proposal was sent before runtime/migration changes; this agent edited only `apps/api/src/modules/margin/**`.

## Adapter contract and root wiring

1. `validateWorkflowTerms` must compare exact market/pool/asset IDs, code pins and policy to server configuration, and enforce server collateral/leverage/slippage/fee limits. A caller knowing `pinsHash` is not permission to change economic limits.
2. `assertStepReady` must fail closed unless the exact deployed step has actual current Testnet proof, current pins and phase/owner/quote/liquidity/expiry validation. Structural fixtures do not make a step executable.
3. `prepareStep` must return the existing exact `PreparedAction`, serializable provider baseline and fresh wallet reservation plan. Service requires exact XLM fee, plus underlying collateral for `vault_deposit`, or wallet receipts for `margin_transfer`/`vault_withdraw`. Controller collateral is never counted as wallet spendable. Other steps reserve fee only; parent exclusivity plus provider controller reservation checks prevent protocol collateral reuse.
4. Existing customer authorization and worker verification still inspect exact signed bytes and re-simulate; they must be wired by root for canonical action names. `margin_transfer` maps to `margin.transfer`; `margin_return` maps to `margin.return`.
5. Worker must mark the child completed only after actual chain SUCCESS and its own relevant delta verification. `reconcile` additionally calls trusted adapter `readConfirmedEvidence` for the same stored completed signed hash + baseline, validates normalized evidence, and atomically saves evidence/parent revision. No request accepts caller chain evidence.
6. Every route must call `requireBusiness('trade.perps')` and `requireCustomer`, derive wallet/customer from the verified session, validate strict input, and invoke the coordinator. This module does not replace request authentication/entitlement enforcement.

Parent steps: vault deposit → receipt transfer → begin → open swap → activate → close prepare → direction-specific close swap → finish → margin return → vault withdraw. Begin position ID is set only after actual return value agrees with independently read PendingOpen owner/market/direction. Ownerless finish ABI still requires independently bound exact owner. Pending open/close cancellation is separate, explicitly prepared and approved; swapped states cannot cancel or reswap. Failed/uncertain signed submissions stay bound and block further steps pending exact-hash resolution. A never-signed terminal child can be cleared and explicitly retried as a distinct step attempt.

`MarginBalanceEvidence.marginReceiptAtomic` means **independently verified unreserved controller receipts**, subtracting actual pending/open collateral. It must not include encumbered collateral. Before/after evidence must be transaction-local (metadata/effects) with fresh independent ownership/phase checks, not inferred from a generic submit response. A normalized Closed position may be constructed from protocol-specific close event + zero debt + removed record only if the adapter proves that exact outcome; never merely from RPC SUCCESS. Final zero proceeds with verified Closed/zero debt becomes `recovered` without a fictitious receipt return.

Amounts and IDs are canonical raw decimal strings; receipt values come from observed deltas and the live exchange rate. Never rescale raw receipts from the token display decimals. Each next-step minimum/maximum output is separately approved and must be freshly bounded by the provider against frozen slippage/oracle policy. Deposit's exceptional max fee is frozen separately; provider guards must restrict cold restoration to reviewed exact keys. Protocol QA signers are never substitutes for customer Privy acceptance.

## Verification

```sh
pnpm exec vitest run apps/api/src/modules/margin/state.test.ts
MARGIN_WORKFLOW_TEST_DATABASE_URL=postgres://localhost/grapnel_margin_workflow_test pnpm exec vitest run apps/api/src/modules/margin/service.test.ts apps/api/src/modules/margin/state.test.ts
pnpm --filter @grapnel/api typecheck
```

40 tests passed:24 offline state/evidence and16 dedicated disposable Postgres coordinator cases. DB suite requires exact database name `grapnel_margin_workflow_test` before resetting its schema; it cannot target development data. It exercises real SQL constraints, atomic child creation/reservations, idempotency and rollback. Provider/chain adapter is an explicit offline fixture; no external requests, signing, broadcasting or acceptance hashes were produced by this agent.

Remaining root work: install reviewed migration; register actual asset/receipt identities; bind live verified provider steps, authorization and worker; add public scoped routes and frontend approvals; execute customer Privy acceptance. Do not advertise customer Margin execution from this coordinator alone.

## Scoped HTTP follow-up

Root installed the proposal as migration `0003_margin_workflows.sql` and froze shared public validators in contract0.2.1. Service DB tests now use the actual migration only. `routes.ts` consumes those shared validators and exports `registerMarginRoutes`; root still owns runtime registration.

Routes: POST/list GET `/v1/trade/margin/workflows`, customer-scoped GET`/:id`, POST`/:id/reconcile`, POST`/:id/steps/:step`, and trusted read-only preparation POST`/:id/steps/:step/quote`. Every route checks current `trade.perps` business entitlement and verified customer/wallet binding before service/provider reads. Create and each step require visible ASCII1–200-character Idempotency-Key. Public responses whitelist snake_case IDs, exact raw amount/asset, phase/revision, operation/position IDs, readiness and permitted next steps; private pins/policy/baselines/owner evidence never serialize.

Create additionally requires explicit trusted `creationReadyFor(terms,customer)===true` **before persistence**. Missing service, terms constructor, overall readiness or quote adapter returns structured EXECUTION_UNAVAILABLE. Read/list/reconcile remain usable for existing workflows even when new creation is blocked. Per-step readiness defaults blocked; next_steps is the intersection of phase order and actually proven steps. Source quote terms must be canonical, exact to the step, expire within120seconds and preserve workflow revision while fetched. A quote never creates an operation; actual preparation rechecks fresh provider bounds. Browser-supplied revision, owner, tx hash, evidence, fullterms/pins/policy are rejected.

Root must bind trusted `termsFor`, `creationReadyFor`, `readinessFor` and `quoteFor` only to actual verified provider state. No optimistic default is provided. Existing operations authorization remains unchanged. Service list reads at most20 exact tenant/customer/wallet rows, active first then newest, for recovery beyond browser local storage.

Latest follow-up:43 route tests +25 reducer tests +16 actual0003 Postgres tests pass (84 total); API typecheck passes. Zero-refund open cancellation now becomes recovered after mandatory verified cancellation evidence, avoiding an impossible zero-amount return.

## Execution bridge follow-up

`MarginExecutionAdapter` adds the confirmed concrete-driver signature `verifyStepForSubmission(context + baseline + prepared, signedXdr, customer)`. `createMarginExecutionBridge(operations,adapter,approvedPolicy)` exports `verifyForSubmission(prepared,signedXdr)` and worker `verifyDeltas(operationId,txHash)`. It never signs, sends or advances the parent.

The bridge loads one exact joined operation/step/parent/customer/wallet record, requiring tenant/customer/wallet composite matches, module/provider/canonical step action, active-child link, frozen policy/terms hash, exact step request, canonical intent digest, stored prepared summary/XDR digests, wallet source and valid actual wallet signature. Unknown margin actions such as separate collateral funding are rejected here; root dispatches them independently. Submission accepts only a never-submitted awaiting approval or a worker-submitted operation with exact persisted signed bytes/hash; all other states fail before provider calls. The real adapter must freshly inspect code/auth/state/fees, immutable scope and simulation before any root broadcaster can send.

Worker delta verification requires the same retained signed envelope/hash and independently supplied actual chain evidence plus reducer predicates. It returns `DeltaVerification` only; the worker records child completion before `service.reconcile` separately advances the parent. Confirmed-hash reconciliation remains possible after approval expiry and never calls the submission guard or rebroadcasts. Missing adapter or mismatched evidence returns verifiedfalse. No generic RPC success, a202, mock provider guard or QA transaction promotes production capability.

Signed uncertainty remains linked pending explicit same-hash recovery. The subsequent optional FAILED-evidence interface below now permits a narrowly verified included failure to clear its attempt; SUCCESS evidence never justifies a failed retry.

Latest bridge tests:34 explicit offline crypto/DB-port guard cases pass. Together with43 HTTP +25 reducer +17 actual0003 Postgres cases,119 tests cover this module. The offline envelope fixture is a simple payment used only for generic signature/hash binding; it is explicitly **not a Peridot operation proof**, and the concrete provider inspector remains mandatory. No provider/network write was performed by this agent.

## Verified failure recovery and late reconciliation

Root froze optional `MarginAdapter.readFailedEvidence(context + baseline + txHash,customer)` returning exact `MarginFailureEvidence`: Testnet, FAILED, hash, ledger, owner, step, intentHash, observedAt, `principalAndPositionUnchanged:true`, `sourceSequenceConsumed:true`, canonical positive feeStroops. This is trusted adapter output only, never caller input. Concrete adapter must independently prove RPC FAILED, included ledger, exact approved envelope/source, actual charged fee and transaction-local absence of financial/position changes except that fee.

Service considers this proof only for a durable failed child with retained signed envelope/hash. Before fetching proof it revalidates stored intent/request/prepared digests, canonical step, exact wallet signature/hash and frozen fee cap. Evidence must be fresh (15seconds, at most1second future), same owner/intent/step/hash, positive included ledger, both strict true assertions and actual positive fee not exceeding the signed fee. It then locks parent and failed operation, repeats revision/active-child/state/hash/signed-bytes/prepared checks, saves failure evidence and confirmed_at, and clears only the active link. Phase, position and receipts remain unchanged. Old failed child, signed bytes and hash remain durable. Same idempotency key returns that old attempt; only an explicit fresh key prepares a new separately approved child. Missing failure adapter, uncertain submission, timeout, submitted/confirming/recovery state, mismatched evidence and concurrent changes retain the child. No automatic signing or resend follows failure proof.

Successful begin/close-prepare reconciliation now accepts a valid already-expired pending deadline when fresh independently read state proves the actual confirmed transaction. This records historical facts so individually approved owner cancel/recovery remains possible after a delayed worker. It does **not** permit stale evidence or an expired swap/activation: concrete prepare/sign/readiness guards must still reject those actions and offer only permitted recovery. Missing/malformed pending state/deadline remains rejected.

Bridge now also requires a string Privy identity prefixed `did:privy:` before deriving its customer context. Actual session/token verification remains root authorization responsibility.

Latest:151 tests pass (35 bridge,43 HTTP,40 state/failure reducer,33 actual0003 Postgres), API typecheck passes. Added failure mismatches, exact signature retention, retry semantics, external-read status races and concurrent recovery CAS tests. Test adapters remain explicit offline fixtures; no real transaction failure or provider execution is claimed from them.
