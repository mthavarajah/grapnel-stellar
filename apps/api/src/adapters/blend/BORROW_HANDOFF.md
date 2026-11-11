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

## Lead-authorized isolated protocol QA — partial, 2026-11-11

These are **QA-owned Ed25519 Testnet accounts**, not customer wallets, not treasury funding, not Privy customer authorization and not Grapnel database operations. Private keys were generated only in process memory, never logged or persisted, and discarded at each safety stop. The application signer was not changed. No actual borrow or repay has yet been sent.

- Attempt 1 `GCWHYNURHSK34EVLV5CDB2TRU4YGYMW7ZEM5CSML3RQ6VEGQBJALXR76`: Friendbot and exact classic-USDC trustline only. Stopped on an instrumentation error: transaction metadata starts after the initial fee debit, so an account-delta-only fee observer was incorrect. Both actual hashes are preserved in `borrow-live-qa-attempt1.json`; no protocol position was created.
- Attempt 2 `GATHIAI4EWQVGZTU23EYBOAH4GDS2E4BLRCAU7I5V3OKA2GFSARYRUBO`: Friendbot and exact classic-USDC trustline only. Stopped before any swap broadcast because the QA wrapper requested `authMode:record` on a provider transaction that already had auth. Official RPC rejects this combination. The lead-approved correction records a clone with only auth cleared, requires its returned authorization bytes and footprint to equal the approved provider transaction, then enforces the unchanged authenticated envelope. No production inspector was weakened.
- Attempt 3 `GAE2LMU74DRUAA3ZIQKJ2SI4ZQX7E4FK4ZLIGNDC35X6VXPLUREOIVPJ`: Friendbot, exact trustline, actual own-account swap of 2 XLM into 0.3017543 classic USDC, and actual requested-pool collateral supply of 10 XLM succeeded. Then standalone USDC borrowing stopped at strict footprint inspection. The onchain diagnostic revealed that other-asset collateral `ResData` is read-only, unlike a combined supply-and-borrow diagnostic. The explicitly lead-approved correction permits only the other pinned XLM/USDC reserve as a read-only health read on a borrow; selected `ResData` remains mandatory read-write and unknown/duplicate/extra authorities remain rejected. Both unsigned standalone borrows subsequently passed record/enforce simulation against this real collateral; neither was signed or broadcast.

Actual third-account swap: `6883fd0fa59bccc942f0e26263ce48b736df09bbb76ec8e229f239d9fe38fe2a`, ledger 5681492, actual fee 16402 stroops. Actual collateral supply: `87306f5f27f85d15fc388e48dcfa4591534aec46ae64a0d9e4ef14d4e10dfd06`, ledger 5681494, actual fee 454401 stroops. Metadata independently confirms exactly 92161669 collateral shares minted, equal to floor(100000000 × 10^12 / 1085049786703), and the wallet debit is exactly the 10 XLM principal plus the actual fee. The resulting QA collateral is not the customer's balance and must not appear in customer portfolio evidence.

Classic `changeTrust` is not supported by Soroban simulation; the lead explicitly approved its exact existing builder/verifier, limit1000, fee100 and live account/base-reserve checks as a narrowly documented classic exception. It is never labeled Soroban-simulated. All other financial QA writes require record/enforce and the strict original transaction inspectors.

Fee semantics were verified independently using an existing public Testnet transaction, solely as a read reference: transaction `1ad63c4281c7fd6a730a914c6f182beb60b6a9872103882b4a9506caa572a09a` declared71912 stroops, but actual CAP0067 native fee-event sum, RPC result `feeCharged` and Horizon `fee_charged` all equal59910. Resource components are11829 nonrefundable +47981 refundable +100 inclusion, including46467 rent. The production worker's use of Horizon's actual fee is correct. See `borrow-live-qa-fee-proof.json`, [CAP0067](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0067.md) and [Stellar ledger XDR](https://github.com/stellar/stellar-xdr/blob/main/Stellar-ledger.x).

Eight actual transactions have been consumed across the three accounts. The original cumulative 10 XLM collateral /2 XLM swap allocations are consumed. Further real writes require a revised explicit lead scope; the QA script now requires an explicit command flag and checks cumulative/global budgets before activating another account. No automated retry or production-auth bypass is present. A failed/partial report remains `complete:false` and does not count as actual borrow/repay acceptance.

## Completed isolated protocol QA — 2026-11-11, ledgers 5681679–5681689

Exact requested pool `CB3447A446DY3USGWPIDXTNQHF5EX24XDQA2EN6TAZP62JTPBTNOA52Q`, own QA account `GCWFA4FRYPQZDIG3WVEDCUQ2EJP67AF2HDNHV3YK6YW3AP3D3WRB2JY2`. Signer label: `ephemeral_qa_ed25519_NOT_Privy_customer_flow`. No customer/treasury key, DB operation, or Privy identity was used; private key remained process memory only and was discarded after successful completion. This proves actual protocol preparation/execution and exact balance/position deltas, **not customer Privy end-to-end acceptance**.

| Operation | Amount | Actual transaction hash |
|---|---:|---|
| Collateral supply XLM | 0.5 | `a58bff0b38ae6e005e596ba38e4f388090a5adbfd3ac0d914997b790d617d959` |
| Borrow USDC | 0.01 | `aab07dd4eea9a543b3811795f268c45212131ddb59e30b6ccfcc66f29d55df3d` |
| Borrow XLM | 0.1 | `d23120eb1a354464d39ce88869890c6c4713bafc33235987b72fd418c7ff5514` |
| Repay USDC | 0.0100001 | `0fa137e039c6929a9001522c478626a4dc4101a7b3d6f691c39e98760eda2574` |
| Repay XLM | 0.1000002 | `e5dbd2c338564fba1fb5b2ea756cd1414b7116a7cf2acf61810a58787ae7535a` |
| Collateral withdrawal XLM | 0.5 | `f6c4903a42db7ae9171928502fd390c690a53635ec4e3060eb8a2cf8633f8c56` |

Both reserves ended at **zero dTokens**, no dust repayment required. Native collateral after withdrawing original principal is 11 bTokens (0.0000011 XLM observed), representing accrued supply interest. Fresh wallet final balances: 9999.6920639 XLM, 0.0301742 USDC. USDC interest buffer came only from the authorized 0.2 QA-owned XLM Soroswap trade, hash `008b506e26a145b4d798f4886141d39d3b826ff8b7f57fa4b4390bf9d9cb711f`.

`research/borrow-live-qa-attempt4.json` preserves raw result XDR, metadata XDR, exact pool mutations and before/after public chain observations. `borrow-live-qa-metadata-proof.ts/json` independently asserts selected bToken/dToken rounding using the execution ResData rates, before/after observations matching transaction Positions, all unrelated positions unchanged, actual wallet principal deltas, and CAP0067 fee-event sum equal to RPC result `feeCharged` and Horizon `fee_charged`. All six exact token calculations passed. Record/enforce, pinned WASM, auth, footprint and fee guards remained active. Trustline uses the previously approved exact classic exception; it is not mislabeled as Soroban simulation.

Budget: prior 8 + this run 9 = 17 transactions, within revised cap 19. Cumulative collateral 10.5 XLM; cumulative setup swaps 2.2 XLM; actual borrowing 0.1 XLM and 0.01 USDC; every transaction below 1 XLM fee cap. No additional chain writes are needed for this isolated QA result.
