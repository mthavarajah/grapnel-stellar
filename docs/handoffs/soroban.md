# Narrow Blend Soroban inspection handoff

**Role/branch:** supplementary chain inspection / feat/inspected-blend-soroban.
**Gates:** no additional gate passed. No private key, customer login, signature, broadcast, supply or withdrawal transaction was used. This work is inspected preparation plus a real read-only simulation.

## Owned files and exports

Only three new files: `apps/api/src/adapters/stellar/blend-soroban.ts`, its `.test.ts`, and this handoff. No shared schema, API composition, manifest, lockfile or existing adapter file changed.

- `BlendSorobanPreparer({network,passphrase,rpcUrl?,gate1Passed,maxFeeStroops?}, dependencies?)` has **no signer or broadcast method**.
- `prepare(ChainAction): Promise<PreparedAction>` refuses to return signable output unless the lead's Gate 1 decision is true. It supports only exact native-XLM `blend.supply` collateral intent. It builds locally, records simulation, validates the entire auth/footprint/resource set, assembles, then enforce-simulates again before returning unsigned XDR and its Testnet signing hash.
- `inspectReadOnly(ChainAction): Promise<BlendInspectionReport>` can run before Gate 1. The report explicitly states `mode:read_only_simulation`, `broadcast:false`, `signable:false`; it does not expose XDR or a signing hash.
- `getVerifiedRegistry()` reads the current official registry, verifies RPC Testnet passphrase, compares live pool executable hash with `hashes.lendingPoolV2`, checks native SAC identity and live reserve config (enabled, 7 decimals/index), and returns `VerifiedBlendRegistry`. It must be obtained freshly for signing/submission review, not supplied by clients.
- `inspectPreparedBlendSupplyTransaction(action,tx,verifiedRegistry,feeCeiling?)` is the synchronous final callback for the canonical transaction verifier. It binds the action summary and digest to exact source/sequence/bounds/fee/operation/auth/resources/footprint.
- `verifyForSubmission(action,signedXdr)` verifies the exact customer signature/envelope, refreshes official registry and live contracts, inspects the transaction again, then enforce-simulates the **unchanged** signed bytes. If footprints/resources/fees changed it requires a fresh preparation and customer approval; it never mutates the signed transaction or sends it.
- Pure `inspectBlendSupplyAuthorization(auth,intent)` and `inspectBlendSupplyFootprint(data,intent,registry,ceiling)` are exposed for focused negative tests/review.

## Scope and safety decisions

Only user-funded native XLM collateral supply with customer G-account as source/fee payer and authorizer is supported. Input operation must byte-match `buildBlendOperation` for `submit(wallet,wallet,wallet,[SupplyCollateral(nativeXlmSac,amount)])`. It accepts no arbitrary provider XDR, non-native token, alternate pool, free recipient, fee sponsor, address authorization, transfer allowance, extra operation or opaque authorization.

Recorded and enforced authorization must each have exactly one source-account entry. Root is the exact approved pool submit arguments; its only child is the exact native-SAC `transfer(customer,pool,amount)`, with no grandchildren or additional grants. Existing generic `verifySignedAction` still binds exact signing hash/envelope; it should reject Soroban without this explicit callback.

The footprint permits only source account; pool/native SAC instances; official pool executable code; that customer's pool Positions; exact native reserve ResConfig/ResData; that reserve's b-token emission/user-emission keys; read-only liquidation Auction check for that same customer; and SAC Balance(pool). It rejects unrelated accounts/contracts/positions/reserves, admin/upgrade keys, writable code, unexpected state archival/extensions, duplicates and unrecognized storage forms. The narrow whitelist deliberately fails closed if a debt-bearing/other pool state needs additional oracle/contracts or new storage. Resource limits: 20m instructions, 1 MiB disk read, 128 KiB write, max 32 footprint entries. Total fee ceiling defaults to 1 Testnet XLM and cannot exceed it. Expiry must be within 120 seconds. Expired entries/restoration needs cause unavailable, not automatic restore transactions.

**Withdrawal remains unavailable** with reason `WITHDRAW_AUTH_FOOTPRINT_PROOF_REQUIRED`. No actual user collateral position exists for a legitimate live withdrawal diagnostic yet. Do not enable withdrawal by guessing the authorization/footprint pattern. Borrow/repay remain blocked by the existing Blend adapter. Supply preparation/simulation does not prove settlement or Privy Soroban compatibility.

## Wiring instructions for lead

Use `preparer.prepare(input)` as the injected Blend `prepareAndSimulate` dependency only after Gate 1 verification. Before then it fails closed; live `inspectReadOnly` is a diagnostic only.

For canonical verification, fetch registry freshly and inject:

```
const registry = await preparer.getVerifiedRegistry();
verifySignedAction(action, signedXdr,
  (approved, tx) => inspectPreparedBlendSupplyTransaction(approved, tx, registry));
```

The canonical verifier's optional third callback is a lead-owned extension. This supplementary file remains compatible with the current two-argument function through a narrow local call-signature cast: it invokes the callback when supported and explicitly performs the same inspection afterward when the old verifier ignores it. The integrated verifier must not permit arbitrary invokeHostFunction without the callback. After signature authorization, the durable worker must call `verifyForSubmission` before any future Soroban broadcast, record hash/envelope before sending, and reconcile actual position/token deltas before completed.

**Fee reservation:** actual resource fee observed around 525k stroops, above the generic 10k reserve. Reserve supply amount **plus the PreparedAction summary's exact maxFeeStroops**, and fee-only for any future withdrawal, against fresh native spendable balance. It is insufficient to rely on the classic-payment fee reserve. Unknown/changing fee/resources require new preparation and consent.

SDK14's `rpc.assembleTransaction` adds minResourceFee to the builder fee, while its `TransactionBuilder.build` also adds transactionData.resourceFee. This was reproduced with a 10,000-stroop fixture producing 20,100 total instead of 10,100. Preparation explicitly clones the raw transaction with inclusion fee100 and validated simulation data/auth, so the builder adds the resource fee exactly once. Fees use bigint checks; token amounts use exact bigint throughout. No SDK version or manifest change needed.

## Actual read-only observations

Observed 2026-11-10T20:46:04.949Z, latest ledger 5663984, running the actual new `inspectReadOnly` implementation with Gate1 false and already activated treasury public account `GCY4DPMIBYCQ352UDKVWDJFKRXOIB2YCOLF2PQFUZHZPYU4WD4PW3LBE` as diagnostic source:

- Official pool `CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF`.
- Native reserve `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`, amount 1.0000000 XLM.
- Both record and final enforce-mode simulation passed.
- Resource fee 525497 stroops; total 525597 stroops including 100 inclusion fee.
- Exactly 1 source-account auth entry; 6 read-only and 4 read-write footprint entries.
- `signable:false`, `broadcast:false`. No transaction hash exists, no balance or position changed. Evidence file was not edited by this agent.

A prior diagnostic at ledger 5663658 also passed enforce-mode simulation and confirmed the footprint shape; the new module's later probe above is the relevant implementation check. Treasury is not used as a substitute customer signer: it was never signed, only public state simulated.

## Tests and sources

Strict API typecheck passes; focused inspection suite **24/24 passed**, and existing Stellar tests **10/10 passed**. Focused offline tests cover valid exact source grant; substituted amount/customer/pool/token; extra auth/children/nested grants; address credentials; unproved withdrawal; foreign account/position/token/admin/unknown contract/code footprint mutations; fee/resource bounds/duplicates/missing required mutations; wrong network/registry executable; gate denial versus non-signable report; exact unsigned preparation; offline exact signed-envelope recheck; wrong recipient/asset/expiry/allowlist; simulation errors/restoration/changed enforce authorization. No fixture is sent to network.

Official/current primary sources reviewed 2026-11-10:
- https://developers.stellar.org/docs/build/guides/transactions/signing-soroban-invocations — full transaction/source-account implicit authorization.
- https://developers.stellar.org/docs/build/guides/transactions/invoke-contract-tx-sdk — simulate/assemble/sign separation.
- https://raw.githubusercontent.com/blend-capital/blend-utils/main/testnet.contracts.json — exact pool/native SAC/executable hash.
- https://raw.githubusercontent.com/blend-capital/blend-contracts-v2/main/pool/src/storage.rs — bounded Positions/ResConfig/ResData/EmisData/UserEmis/Auction storage key semantics.
- Installed @stellar/stellar-sdk 14.3.0 rpc/server.d.ts and rpc/transaction.js, @stellar/stellar-base 14.1.0 transaction_builder.js — `enforce` API and resource-fee assembly behavior.

No additional environment variables/dependencies. Lead must still review/wire, configure Privy, prove customer-authorized supply, implement actual position-delta reconciliation and later validate withdrawal before advertising execution.
