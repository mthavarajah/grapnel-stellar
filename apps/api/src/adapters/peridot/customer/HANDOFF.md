# Customer Peridot adapter — incremental integration handoff

This adapter never signs or submits. Customer Privy acceptance is **not proved** by the captured QA transactions or offline signature tests. Overall readiness defaults to false and remains false until every required phase/recovery binding, exact summary, settlement extractor and close quote exists, plus the injected verifier independently establishes a full actual current Testnet round trip.

## Constructor and runtime composition

```ts
const adapter = new PeridotCustomerAdapter({
  server: chain.server,
  nativeBalance: async customer => (await chain.getClassicBalances(customer.walletAddress)).find(x => x.asset_id === XLM.id)!,
  horizonTransaction: hash => chain.horizon.transactions().transaction(hash).call(),
  verifyRoundTripProof: trustedCurrentRoundTripVerifier,
  bindings: additionalReviewedPhaseBindings,
});
const funding = new PeridotCollateralFundingAdapter(adapter.chain, () => adapter.executionReady());
const service = new MarginWorkflowService(operations, adapter, PERIDOT_CUSTOMER_POLICY);
// Bind adapter.termsFor, creationReadyFor, readinessFor, quoteFor as methods.
// createMarginExecutionBridge(operations, adapter, PERIDOT_CUSTOMER_POLICY)
// collateralFunding: { adapter: funding, ready: () => adapter.executionReady() }
```

`PERIDOT_CUSTOMER_POLICY` exports the exact canonical deployment pins hash and policy version. Receipt identity is `stellar-testnet:soroban:<MockUSDT vault>`; receipt decimals are6, while underlying decimals are7. No raw receipt amount is rescaled when reserving or reconciling. Initial customer scope is fixed Long2x, collateral at most1MockUSDT,50bps policy ceiling,1XLM normal fee/8XLM exceptional reviewed cold deposit fee. Exact markets/pool/assets, Privy identity, wallet, canonical workflow intent and private baseline bind every operation.

The initial default binding set covers the independently reviewed deposit, receipt transfer and begin guards. It is insufficient for enabling a customer workflow. Further `CustomerPhaseBinding` entries must supply their own guard, historical inspector, exact `publicAction`, transaction-local `readEvidence`, and close `quoteTerms` where relevant. Missing recovery phases also keep readiness false. This prevents a partial adapter from trapping customer funds behind an unimplemented close.

The helpers' QA-labelled preparation metadata stays private. Their unsigned builders and public-key envelope/freshness checks are reused only after independent exact customer PreparedAction/source/hash/signature checks; neither the label nor cryptographic validation constitutes an actual customer execution proof. No QA private file/key is referenced.

## Funding interface

- `quoteCollateral({amount}, customer)` returns exact native XLM input, actual pool estimate, ceil99.5% minimum and60-second expiry.
- `prepareCollateralSwap({operationId,amount,minimumOutputAtomic}, customer)` returns existing `MarginPreparation`. One native reservation covers exact principal+max fee. Summary is `margin.collateral_swap`, pinned native→MockUSDT, correct pool/customer recipient and decimal amounts.
- `verifyCollateralSwap({prepared,baseline}, signedXdr, customer)` binds the private helper and approved summary, independently checks the customer signature and re-runs exact fresh pool guards.
- `readFundingEvidence({prepared,baseline,txHash}, customer)` requires RPC SUCCESS, matching Horizon source/hash/ledger/actual fee, transaction-local native principal debit and MockUSDT credit, plus independently observed gross wallet debit including actual fee. Reconciliation does not depend on the new-intent readiness flag.

The initial open quote uses the exact pending amount from an unsigned inspected record simulation, not a guessed2x arithmetic amount. It chooses the full fresh pool quote (zero effective output slippage, within the frozen50bps ceiling) after the strict oracle floor check; a moving oracle may still require cancel/requote. No original approved minimum is silently changed.

## Evidence and tests

`research/*-transaction.json` captures public readonly `getTransaction` responses for actual QA funding, deposit, transfer and begin hashes. These are own-QA Ed25519 transactions, not customer Privy acceptance. No write endpoint was called by this agent.

14 focused offline tests passed, including actual metadata decoding, wrong fee/hash/wallet/time rejection, absent/duplicate metadata rejection, policy tampering, missing round-trip readiness and exact signature substitution checks. API TypeScript check passed. The recorded metadata tests use explicit independently-observed fixture balances; they are not new live balance verification.

V3 debt caveat: `Position.debt_shares` can remain0 after a real borrow. Snapshot reads bind the actual per-position MockUSDT vault `get_margin_borrow_balance(positionId)`; future activation/close extractors must use its transaction-local MarginBorrowPrincipal/Snapshot evidence. Never relabel legacy zero shares as zero debt.

Remaining work: rolling integration of actual proven open-swap/cancel/activate/close/return/withdraw guards and metadata extractors; fresh customer round-trip acceptance; independent position valuation. Root owns routes, migrations, authorization/worker hooks, asset registration and frontend.

## Rolling phase integration: open swap and unswapped cancellation

The default set now also includes reviewed `open_swap` and `open_cancel` bindings. Their pure provider state predicates inspect **actual committed metadata**, reformatted without a simulation or invented entry change. Actual snapshots and decoded records must agree. Open swap proves vault borrow principal/snapshot, exact token recipients/output, pending digest and actual per-position vault debt; legacy debt shares are not used as debt proof. Cancellation proves exact record deletions, free receipt restoration and zero debt.

After cancellation, `positionSnapshot(..., true)` accepts absence only after all five position/perps/pending/execution/close getters return null, the user list excludes the ID, and the actual per-position vault debt is zero. Errors are never treated as missing records. This removes the old reader's inability to verify a successfully removed position. Private snapshots preserve tagged BigInt types for these exact state checks.

26 focused tests and API typecheck pass. Twelve additional cases use captured actual swap/cancel metadata and independently test explicit absence contradictions/transport errors. No additional network write or customer approval was performed.

Activation integration now validates actual committed native receipt mint and TotalSupply delta, collateral/risk/owner transition, exact pending/execution removals, native recipients and no additional borrow. It uses observed minted receipts directly, without inventing an execution exchange rate. Actual v3 vault debt is separate from the legacy zero debt_shares field. Recorded activation metadata regression brings the focused set to27 passing tests; TypeScript passes. Close remains unavailable while the provider's zero-debt PendingClose discrepancy is unresolved.

## Trusted full-cycle verifier

`PeridotRoundTripVerifier` accepts the root-owned null-default evidence file, validates its exact Testnet/QA signer/pins schema, and independently fetches actual RPC plus Horizon confirmations. It checks source signatures, contiguous source sequences, ledger order, reviewed historical invocation guards, committed principal/receipt/borrow conservation, at most one begin/cancel/rebegin recovery, and final independent zero debt/position/receipt state. Positive results cache for at most30seconds with concurrent request coalescing; missing evidence or any required phase guard remains false. A generic configuration flag or customer-provided success is never accepted.

The checker supports the approved atomic-close graph; it does not accept unproven split close steps. The recorded prefix regression independently replays eight real QA transactions through activation, then deliberately remains false at the absent close proof. This is a negative/incomplete proof test, not a green full round trip.37 focused tests pass, including malformed-network/label/pins rejection and concurrent negative verification. Cold-vault restored instance metadata uses its actual previous TotalSupply; restoration is never treated as a newly created zero-supply vault.

## Atomic close customer path

The default customer graph now requires `close_atomic` and does not require or offer the unproven split-close actions. The binding uses the exact reviewed high-compute guard and live network compute limit, fresh pool/oracle/actual-debt floors and exact source signature. Its public summary binds the actual position ID, XLM collateral identity, gross MockUSDT minimum before repayment, no invented collateral amount, and the margin controller recipient.

Settlement proves actual owned position/perps/mapping removal, principal/snapshot/borrow-flag reset, exact repayment from transaction-local borrow indexes, actual native collateral burn/input, pool output, net underlying and receipt mint, and independent zero debt/removed state. The verifier and customer settlement share this committed conservation predicate. Captured actual `e138fc…a4a3b` metadata passes these checks; remaining receipts are9879964 and actual debt zero.38 focused tests and API typecheck pass.

New customer exposure additionally requires `verifySwappedRecoveryProof` to independently verify the expired-swapped interruption recovery path. Missing callback/proof remains false even when the normal round trip is proved. Reconciliation of existing confirmed transactions remains independent of new-intent readiness.

## Recovery completion, real final withdrawal and customer exits

2026-11-12 03:12 UTC: live `PeridotRoundTripVerifier` now returns true for all eleven actual own-QA transactions, including the original unswapped cancellation/replacement and final atomic-close/return/withdraw. Read-only replay command: `pnpm exec tsx apps/api/src/adapters/peridot/customer/research/verify-real-roundtrip.ts`. The resulting `research/real-roundtrip-verification.json` contains a **proposal** for the root-owned manifest, not a customer Privy proof or automatic capability enablement. Root evidence was not changed.

One approved final QA withdrawal `96fee4b166a406bebff02cd1791c1da0898ec6b913bc3e3e4912d42bbbe94ae3` succeeded at ledger5685880, exact source sequence24403398585483275. Burned9879964 receiptatomic; credited9880181MockUSDTatomic, wallet5300316→15180497; free margin/receipt/debt0, user positions[]. Horizon independently confirms fee35963stroops (0.0035963XLM). Global QA count18/21. Private key remains only in the existing private external file; no additional write is authorized or needed for this normal round trip.

Default customer adapters now implement reviewed normal return/withdraw preparation, signed freshness, exact position-bound summaries and actual committed conservation/receipt burn/unchanged instance metadata checks. Withdrawal settlement also requires the exact underlying conversion frozen at preparation. These contexts require the actual repaid position ID; pre-begin or never-borrowed cancellation returns deliberately remain unsupported rather than inventing a repaid ID or weakening debt checks.

SDK live response correction: `getTransaction.createdAt` is a decimal string despite its numeric TypeScript declaration. Chain confirmation now strictly validates/normalizes it before begin timestamp verification. Full provider suite203tests passes; API typecheck passes. Offline tests replay the actual complete protocol metadata and reject remaining final debt, wrong repaid position, altered output/conversion/fees. These tests are not browser customer acceptance.

Missing swapped-recovery proof remains enforced by `verifySwappedRecoveryProof`; this change does not enable new customer exposure. The finite next proof is an **actual expired SWAPPED PendingOpen witness** followed by read-only simulation of `activate_open_position_v3(owner,id)` (record and enforce), inspecting its exact auth/footprint/state changes, then a reviewed actual activation/atomic-close/return/withdraw proof. If activation reverts after expiry, inspect `resolve_pending_open_v3(id)` or `execute_open_position_v3(owner,id)` against the same actual witness; ABI existence alone is not recovery proof. Existing source frontend permits Finish when an execution record exists despite expiry, but the deployedv3source is not published and no such witness was found in the bounded read-only audit. Creating that witness would require a separately approved own-QA begin+swap and waiting past its expiry, then enough action budget to recover; current18/21 leaves3 and cannot cover the full recovery roundtrip. Do not add writes or raise the cap without lead approval.
