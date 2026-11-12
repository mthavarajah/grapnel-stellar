# Hyperliquid Testnet solver adapter

Offline implementation only. No provider account, faucet call, transfer, order or chain proof was created during implementation. Fixture hashes, balances and keys in `solver.test.ts` are explicit offline data.

## Frozen surface

`HyperliquidSolverAdapter` exports `readLiquidity`, `prepareSubaccount`, `prepareTransfer(request, 'fund' | 'return', amountAtomic7)`, `prepareOrder`, `send` and `reconcile`. Dependency/result exports are in `types.ts`. Only `trade.perps` requests are accepted; Robinhood stocks require a separate provider adapter.

The lead injects the verified, server-loaded scoped wallet, fixed Testnet transport, source payment reader, current exact Freighter intent verifier, operator access/capacity policy, master signer resolver and durable repository. No default transport, private key, eligibility decision or balance exists. A successful HTTP response is never sufficient authorization, ownership or settlement proof.

Repository `reserveProviderAction` must serialize the **global master** nonce namespace and reject nonce/cloid/request reuse across tenants. Reserve uncommitted capacity separately before preparation. `saveProviderPayload` must be immutable/idempotent. `claimProviderSend` must atomically compare the exact stored payload hash and permanently consume its send claim. The adapter automatically persists the signed payload and reloads it before returning preparation. The root can persist returned reconciliation results through its `recordProviderResult` method. Do not treat an acknowledgement as a completed operation.

## Provider behavior

- HyperEVM RPC must independently report chain 998; L1 EIP-712 signing remains Exchange/1337 with Agent source `b`.
- Creation and cash transfers use the master signature without a vault. Orders use the master signature with `vaultAddress` equal to the verified customer subaccount. Recovery requires the master address; an EOA-only customer order adapter is not used to pretend the subaccount owns a private key.
- Creation proof requires actual `subAccounts` ownership and the deterministic 16-character tenant/customer/identity-wallet-scoped name. Root persists that proof and configures a new adapter scope with the returned subaccount before allocation.
- Native USDC allocation/return uses safe integer USD × 10^6. Stellar atomic7 amounts must be divisible by 10; rounding is forbidden. Actual current master/subaccount capacity is read, not inferred from SQL credits.
- Cash settlement requires one matching provider ledger event visible for both accounts, an identical actual provider hash/time, exact opposing `marginSummary.totalRawUsd` changes, and unchanged positions. The signing hash is never a provider transaction hash. A segregated idle master is required. Concurrent cash activity causes an unknown result requiring operator reconciliation.
- **Live acceptance is still required for ledger `user`/`destination` semantics**, particularly returns. The conservative matcher treats user as source and destination as recipient; conflicting live source data must be captured and reviewed, never loosened merely to obtain success.
- IOC orders validate native/xyz registry identity and USDC collateral identity, precision, current leverage, reduce-only behavior, exact fills and actual resulting position. Partial IOC fills retain their executed size. No silent leverage update occurs.
- Initial deposits fund **native perp USDC only**. xyz orders require independently verified existing xyz collateral. This adapter does not move native collateral to xyz or advertise xyz as funded from a native deposit.
- Timeout, repeated send or expired artifact proceeds only to reconciliation. Ambiguous/absent/capped/duplicate ledger or fill proof remains unknown. Neither master nor subaccount balances are fabricated.

## Outstanding integration and acceptance

Root must connect scoped provider actions and reservations, Freighter-approved intent/source receipt checks, configured eligible funded master, provider transport, current signer storage and recovery handling. Root controls Stellar escrow/payout. A Stellar payout must follow verified return cash, never a provider acknowledgement. No live financial operation is authorized by this handoff.

Run `pnpm exec vitest run apps/api/src/adapters/hyperliquid/solver/solver.test.ts` and `pnpm --filter @grapnel/api typecheck`.
