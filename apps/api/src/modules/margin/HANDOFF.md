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
