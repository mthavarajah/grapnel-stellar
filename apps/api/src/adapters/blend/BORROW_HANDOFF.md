# Requested-pool XLM / USDC borrowing

## Integration API

`borrow.ts` exports `BlendBorrowAdapter` and the exact target/reserve/asset constants.

```ts
const borrowPreparer = new BlendBorrowSorobanPreparer({
  network: 'testnet', passphrase: NETWORK_PASSPHRASE, gate1Passed,
});
const borrowing = new BlendBorrowAdapter({
  network: 'testnet', passphrase: NETWORK_PASSPHRASE, gate1Passed,
}, {prepareAndSimulate: input => borrowPreparer.prepare(input)});
```

- `borrowing.read(customer)` returns the lead-frozen `{pool_id,as_of,assets}` DTO, with APR/APY ratios, individual collateral/debt, health and safe capacity. The 90% capacity margin is deliberately below the protocol maximum. Debt-free health is null rather than infinity.
- `borrowing.positions(customer)` returns exact pool/market/reserve identities, supplied/collateral/borrowed strings, ledger/as-of, and internal `debt_tokens`, `debt_rate`, `collateral_tokens`, `collateral_rate`, `rate_decimals:12`, `reserve_index`. These support interest-safe transaction-metadata reconciliation.
- `prepare('borrow'|'repay',input,customer)` uses the existing `{operationId,marketId,assetId,amount}` request shape and emits `blend.borrow` / `blend.repay`.
- `prepareCollateral('supply'|'withdraw',input,customer)` emits `blend.borrow_collateral_supply` / `blend.borrow_collateral_withdraw`. No assets or positions are moved between pools. Debt-bearing collateral withdrawal is conservatively rejected until repayment, rather than pretending an unverified max withdrawal.
- `borrowPreparer.verifyForSubmission(action,signedXdr)` verifies the exact prepared signature/envelope, current pool/oracle identity, current risk/position/balance, current sequence and enforce simulation. It never mutates signed bytes.
- `borrowSummaryAction`, `buildBorrowOperation`, `inspectBorrowOperation`, `inspectBorrowAuthorization`, `inspectBorrowFootprint`, `inspectPreparedBorrowTransaction` support lead integration and tests.

Lead owns routes, tenant/customer authorization, operation persistence/idempotency, wallet reservations, worker submission and transaction-metadata reconciliation. Borrow reserves native fees only; repayment/collateral supply reserve principal plus native fees. Incoming borrowing/collateral withdrawal needs the exact wallet receipt (native receipt is gross of the real fee). This adapter has no signer or sender.

## Independent Testnet observations

The requested pool `CB3447A446DY3USGWPIDXTNQHF5EX24XDQA2EN6TAZP62JTPBTNOA52Q` is `Testnet v2.1`. Its deployed WASM bytes hash to `a41fc53d6753b6c04eb15b021c55052366a4c8e0e21bc72700f461264ec1350e`, identical to the official registry lendingPoolV2 hash. Status 1 is permissionless **Active**, while 0 is admin Active; status 1 must not be confused with on-ice. Exact asset indices are XLM 0 and classic USDC 3, with seven asset decimals and twelve reserve-rate decimals. The native SAC and USDC issuer/SAC are the same identities as the older Earn pool, but customer positions are separate.

At ledger 5679966 the requested pool had 83,790.8231059 XLM and 22,838.2372579 USDC liquidity, zero customer collateral/debt. Old-pool collateral remained present and was never reused to invent target-pool capacity. Rates vary; consult timestamped evidence, not a fixed percentage in this handoff.

The target's oracle is the official Testnet mock `CAZOKR2Y5E2OSWSIBRVZMJ47RUTQPIGVWSAQ2UISGAVC46XKPGDG5PKI`, hash `66c0b87b5eb481be594175d59e66ec9a9ac8945be0fec4e09f6c28bf7a1708be`. Raw read-only `lastprice` returned `{price,timestamp}`: XLM 4200000 and USDC 10000000 with seven decimals. These are protocol oracle valuations, not public spot-price quotes. The pinned SDK's `pool.loadOracle()` uses an obsolete XDR `.value` access and failed decoding; the adapter decodes the actual return `ScVal` via `scValToNative`, checks its exact types/decimals/freshness and zero auth. No oracle price was invented or substituted.

`research/borrow-pool-read.json`, `borrow-oracle-read.json`, `borrow-account-read.json` preserve public reads. `borrow-trace-read.json` includes hypothetical combined supply+borrow diagnostic simulations solely to observe scope; production accepts exactly one request, and no diagnostic was signed or broadcast. `borrow-collateral-prepare-read.json` contains independently prepared **unsigned** 1 XLM and 1 USDC collateral supplies with record + enforce simulations, zero signatures, top-level `tx_hash:null`. At 19:35Z their resource-inclusive fees were 525592 and 525834 stroops respectively. They are not onchain proof or customer-authorized operations.

## Scope and acceptance

The adapter is discovery/preparation-ready, **not** borrow/repay Testnet-verified. The actual customer currently has no collateral in this requested pool, so a real customer-approved collateral supply is necessary before a standalone borrow can simulate successfully. Actual customer-approved borrow, repayment, liability-token delta and gross wallet balance changes remain mandatory before declaring execution complete.

No mainnet, arbitrary pool, arbitrary token, flash loan, cross-customer source/spender/to, custom auth signer, sponsor, extra operation, restore/TTL operation, arbitrary oracle, fee above 1 XLM or unknown collateral asset is accepted. Oracle errors block risk-increasing borrowing while permitting valid debt-reducing repayment after its own exact checks.

## Validation

- 25 focused risk, identity, invocation, authorization, footprint, fee/expiry and canonical-envelope tests passed.
- All 52 Blend adapter / new preparer tests passed.
- API TypeScript passes.
- Live requested-pool reads and both XLM/USDC unsigned collateral preparation/enforce simulations passed.
- No private key, wallet identity token, actual signature, operation broadcast or chain transaction was created.

## First-party source references

- https://github.com/blend-capital/blend-utils/blob/main/testnet.contracts.json
- https://github.com/blend-capital/blend-contracts-v2/blob/main/pool/src/pool/status.rs — status 0/1 Active; 2/3 on-ice; 4/5 frozen.
- https://github.com/blend-capital/blend-contracts-v2/blob/main/pool/src/pool/actions.rs — borrow ceil dToken mint, repayment floor burn, collateral withdrawal ceil bToken burn.
- https://github.com/blend-capital/blend-contracts-v2/blob/main/pool/src/pool/submit.rs — exact transfer handling, max-utilization and health floor 1.0000100.
- https://github.com/blend-capital/blend-contracts-v2/blob/main/pool/src/storage.rs — user Positions are persisted even when empty, not removed.
- https://github.com/blend-capital/blend-sdk-js/blob/main/src/oracle.ts — pinned SDK helper decoding and protocol oracle request shape.
