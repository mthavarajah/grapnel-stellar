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
