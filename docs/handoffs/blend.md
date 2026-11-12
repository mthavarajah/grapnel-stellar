# Blend lending handoff — feat/blend

**Role:** Agent 05, Blend. **Gates:** Gate 0 consumed. Gate 1 signing proof and Gate 2 lending execution remain blocked. No onchain writes were performed by this agent.

## Files and exports

- `apps/api/src/adapters/blend/index.ts`: `BlendAdapter`, live markets/positions/capabilities, exact native-SAC and classic-SAC identity normalization, read-only token balance simulation, guarded collateral builders. `buildBlendOperation(intent)` and `inspectBlendOperation(op,intent)` provide complete pre-simulation operation byte comparison against locally reconstructed `submit` intent.
- `apps/api/src/adapters/blend/blend.test.ts`: 13 isolated tests, explicitly offline fixtures.
- `apps/api/src/adapters/blend/research/testnet-read.json`: timestamped sanitized real read evidence; absent customer/transaction evidence remains null.
- `apps/api/src/modules/lending/routes.ts`: `registerLendingRoutes(app,{adapter,operations,balanceReader})`, using existing core auth, customer ownership guards and shared durable OperationService.

`new BlendAdapter({network:'testnet',passphrase:NETWORK_PASSPHRASE,gate1Passed:false}, {prepareAndSimulate?})` exports:
- `markets()` returns the live normalized array.
- `positions(customerContext)` reads actual wallet-backed pool positions; failure throws and never becomes an invented empty position.
- `capabilities()` returns discovery_only when current pool reads succeed, blocked when unavailable; actions is always [] pending chain proof.
- `prepare('supply'|'withdraw'|'borrow'|'repay',{operationId,marketId,assetId,amount},customerContext)` is gated. Supply/withdraw locally build only XLM collateral requests. Borrow/repay always return EXECUTION_UNAVAILABLE until separately proven.

Routes register `/v1/capital/lending/markets`, `/positions`, and all four financial POSTs. Customer positions require verified customer identity and exact tenant wallet mapping. Writes use Idempotency-Key, position advisory lock, prevent other unsettled actions on the same position, and reserve supply wallet XLM through core fresh authoritative balance and reservation service. No broadcast happens in a DB transaction. Prepared actions are stored through core and customer approval continues with the shared GET operation / authorize flow.

## Actual current Testnet observations

Official registry read: `https://raw.githubusercontent.com/blend-capital/blend-utils/main/testnet.contracts.json`; latest file commit `3e719416a3c8c3ada8cc1e82ac088953c087205d`.

Pool `CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF` exists on current Testnet. PoolV2.load returned name TestnetV2, status 0, four reserves, and current ledger 5659630 in the first SDK probe. RPC reported exact Testnet passphrase, protocol 30. Later adapter probe at 2026-11-10T14:47:19.492Z / reserve reads ledger 5659683 confirmed all four assets and actual token balances held by the pool. These are preexisting Blend deployments, not Grapnel contracts.

Native XLM SAC `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` equals `Asset.native().contractId(Networks.TESTNET)` and metadata reports 7 decimals. Read-only `balance(pool)` simulation reported 117650327429152 atomic XLM (11765032.7429152 XLM), not a fabricated treasury/customer amount. Actual available liquidity is read from token.balance, not inferred by subtracting aggregate pool accounting totals. Unknown balance remains null and cannot unlock withdrawal.

**Correction required in docs/08_BLEND.md and docs/13_SOURCES.md:** current USDC contract `CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU` is a Stellar Asset Contract of classic Testnet issuer `GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56`, code USDC, decimals 7. It is not currently an unrelated standalone contract-native mock token. The adapter validates the exact classic asset -> SAC derivation using current token metadata. This is still a specific Testnet token, not redeemable mainnet USDC, and no treasury inventory or successfully executed funding-to-lending route has been proven. wETH/wBTC are also specific issuer Testnet assets. No funding compatibility is automatically advertised.

SDK live read APYs are fractional rates and variable; `supply_apy_variable` 0.126... means about 12.6%, and values above 1 occur on current highly utilized Testnet pools. These are SDK estimates from current reserve data, not promised yield. Position collateral/debt values remain separate from spendable wallet amounts. No USD NAV, collateral price or health factor is invented.

## Sources and version correction

- https://github.com/blend-capital/blend-sdk-js / source revision `8d4d8799fc831096a28fd4dd76c33a764dfd086d`, installed npm `@blend-capital/blend-sdk@4.0.0`.
- https://docs.blend.capital/tech-docs/integrations/integrate-pool — current versioned APIs `PoolV2.load` and `PoolContractV2` (Pool and PoolContract are abstract in current SDK).
- https://raw.githubusercontent.com/blend-capital/blend-sdk-js/main/src/token.ts — SAC identity metadata.
- Official Stellar RPC `https://soroban-testnet.stellar.org`, only configured endpoint permitted.

SDK4 depends on Stellar SDK17.4.0, while Grapnel's canonical SDK remains14.3.0. We intentionally cross the boundary only with base64 operation XDR and primitive data; no XDR/class objects are passed across SDK versions. The SDK17-produced operation was parsed/compared by SDK14 in tests. Lead approved dependency addition and owns manifest/lock. No shared schemas or migrations changed.

## Safety and unfinished execution

Gate1 defaults false; no customer/treasury keys are used here. Canonical Stellar executor currently rejects Soroban prepare/submit until full simulated auth, footprint, fee and nested invocation inspection exists. The implemented inspector only verifies the complete **pre-simulation** single `submit` operation including source/recipient/amount/request kind/contract/auth bytes. It does not claim to validate new auth/footprint inserted by simulation, and never exposes an unsimulated op as a customer-signable PreparedAction. The injected canonical `prepareAndSimulate` remains required and currently fails closed. Supply and withdraw therefore cannot execute yet even after simply changing a configuration boolean.

Withdrawal requires active pool/reserve, sufficient current collateral, actual token liquidity and no debt anywhere in the pool. Debt-bearing withdrawal remains blocked until a reviewed risk/oracle estimator is proven. Borrow/repay always blocked; stale/unknown oracle never permits credit. Supply checks reserve cap; core checks fresh wallet reserve/fee/spendable and active reservations. No unknown collateral is counted as wallet holdings.

## Checks run

- `pnpm --filter @grapnel/api typecheck`: passed.
- `pnpm exec vitest run apps/api/src/adapters/blend/blend.test.ts`: 13 passed.
- Direct RPC getNetwork/getLedgerEntries: pool/XLM/USDC instances exist, Testnet passphrase verified.
- Official SDK PoolV2.load: succeeded with 4 reserve configs/data.
- Read-only token.balance simulation: all four reserve balances read through adapter.
- Actual `BlendAdapter.markets()` live probe: succeeded; complete normalized JSON preserved in research/testnet-read.json.

No supply/withdraw transaction hash, no signed customer action, no position delta, no Gate2 success. Missing credentials and canonical Soroban execution inspector are explicit blockers. Parent may integrate read endpoints now; outgoing operations remain gated. No new environment variable names beyond existing Stellar/Privy config.

## Superseding customer Borrow acceptance — November 12 UTC
The earlier gated Borrow statement describes the initial implementation. The dedicated borrowing pool now has actual customer Privy USDC borrow, full Repay All and collateral-withdrawal acceptance. See [borrow](../../evidence/borrow-usdc-customer.json), [repay](../../evidence/repay-usdc-customer.json) and [withdrawal](../../evidence/withdraw-usdc-collateral-customer.json). Debt tokens are zero after repayment; 30 collateral receipt units remain after withdrawal as rounding dust. The separate Earn-pool USDC withdrawal acceptance is not implied.
