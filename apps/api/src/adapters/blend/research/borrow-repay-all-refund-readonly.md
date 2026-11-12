# Repay All: deployed Testnet refund branch, unsigned simulation

Observed at ledger **5685571** against the verified dedicated Borrow pool
`CB3447A446DY3USGWPIDXTNQHF5EX24XDQA2EN6TAZP62JTPBTNOA52Q`.
The public customer source was
`GB4PC65ZHBPVEZMAHY2K2KYMS3RFBIN2FQIE3LGTLEHT2DEWVMTD7JYQ`.

This diagnostic runs **one unsigned, three-request simulation**, outside the
production single-request preparer: supply 1 USDC collateral; borrow 0.1 USDC;
repay a maximum 0.1001002 USDC. It creates no session, database operation,
signature or submitted transaction. **There is no transaction hash.** Actual
customer position tokens were unchanged across the diagnostic.

The actual deployed contract emitted a repayment event with principal
**0.1000001 USDC** and **989367 debt tokens burned**. Borrow token conversion
rounding makes this principal one atomic unit above the original 0.1 borrow.
The requested maximum therefore produced a **0.0001001 USDC refund** in
simulation. The simulated final Positions entry has an empty liabilities map.

Blend aggregates transfers across the batch: actual simulated incoming USDC
was 1.1001002 and outgoing was 0.1001001 (the 0.1 borrow plus 0.0001001 refund).
The JSON includes complete diagnostic event XDR, authorization tree/XDR,
state-change before/after XDR, immutable-registry verification and unchanged
actual customer position snapshots. These aggregate batch transfers are not
claimed as the shape of a standalone production repayment.

The protocol source's over-debt repayment branch transfers the requested
amount, burns all remaining debt tokens and refunds the excess:
[Blend apply_repay](https://github.com/blend-capital/blend-contracts-v2/blob/main/pool/src/pool/actions.rs).

**Acceptance boundary:** this proves the deployed contract's nonzero-refund
branch in an unsigned simulation. Actual customer-signed Repay All settlement,
with a confirmed transaction hash, exact incoming/refund metadata and zero
remaining debt, remains pending. Earlier own-QA real repayments proved zero
debt but had no nonzero refund; they do not satisfy this additional proof.

Reproduce without keys:

```sh
pnpm --filter @grapnel/api exec tsx src/adapters/blend/research/borrow-repay-all-refund-readonly.ts
```

The script refuses initial nonzero collateral/debt, mismatched pool repayment
participant/reserve, unexpected transfers or missing zero-debt state evidence.
Its observations are public Testnet reads and simulations, never execution.
