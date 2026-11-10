# 08 — Blend v2 Lending, Borrowing & Yield adapter

## Goal / what asset the user owns
Use Blend on **Stellar Testnet**, not Aave. Customer can supply supported asset to Blend pool, see variable supply interest and pool exposure, withdraw subject to liquidity and health; optionally borrow against permitted collateral and repay. When supplied, value sits in a Blend **protocol position** rather than spendable wallet balance. These are risky DeFi positions, not bank savings or guaranteed yield.

## Verified official sources
- [Blend integration guide](https://docs.blend.capital/tech-docs/integrations/integrate-pool): `PoolContract.submit`, `SupplyCollateral`, `WithdrawCollateral`, pool reserve/user state.
- [Blend SDK JS](https://github.com/blend-capital/blend-sdk-js): npm `@blend-capital/blend-sdk`, `Pool.load`, `PoolContract`, `RequestType`, `PositionsEstimate`, pool user positions.
- [Blend Utils Testnet deployments](https://github.com/blend-capital/blend-utils/blob/main/testnet.contracts.json), source for pool/token IDs; verify current ledger existence each deployment.
- [Blend deployment scripts](https://github.com/blend-capital/blend-utils): how to create pools if external testnet pool missing; **DO NOT** deploy custom pool unless lead explicitly accepts additional contract work and time.

## Testnet references at research date, NEVER treat as forever-valid
`testnet.contracts.json` lists:
- Pool `TestnetV2`: `CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF`
- Blend mock `USDC` Soroban contract: `CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU`
- XLM SAC reserve: `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`
**MUST** load these from official source and verify contracts/pool reserves by RPC on latest Testnet. Stellar Testnet resets. These are preexisting Blend deployments, not deployed by Grapnel. Friendbot native XLM and this Blend Soroban mock USDC token are distinct assets.

## First integration spike
1. With `@blend-capital/blend-sdk`, load `Pool.load({rpc: STELLAR_RPC_URL,passphrase:Networks.TESTNET}, poolId)`; confirm supported asset IDs, pool status, reserve config, utilization, available liquidity.
2. Load `await pool.loadUser(customerGAddress)` and `PositionsEstimate.build(...)` after pool oracle. Check APR/APY sourced from current reserves and mark timestamp; remember emissions are separate incentives, not guaranteed interest.
3. **Prefer XLM reserve for first real supply** because Friendbot funds XLM directly. Preserve sufficient XLM reserve and fees. If using Blend mock USDC, fund that **exact token** from a verified source into the Testnet treasury and expose it only if `capital.testnet_funding` has actual spendable inventory. Do not claim conversion unless proven.
4. Construct `PoolContract(poolId).submit` with `RequestType.SupplyCollateral`, correct contract `C...` reserve asset and raw atomic amount. Simulate/prepare; with customer G-account as transaction source, full envelope signing provides source-account authorization; otherwise handle explicit auth entries; customer signs, submit via Testnet RPC, poll success, reload `loadUser` to prove position change.
5. Construct matching `WithdrawCollateral` within actually withdrawable health/liquidity, sign and submit; confirm wallet received asset and Blend position reduced.
6. For P1 borrowing, first supply an accepted collateral type, use `PositionsEstimate`/pool risk math to check limits; build `Borrow` request, then `Repay` with exact token amount; test health and liquidation boundaries.

## SDK-style operation (verify exports/types at compile)
```ts
import { PoolContract, RequestType, Pool } from '@blend-capital/blend-sdk';
import { xdr } from '@stellar/stellar-sdk';
const opXdr = new PoolContract(poolContractId).submit({
  from: customerGAddress, spender: customerGAddress, to: customerGAddress,
  requests: [{ request_type: RequestType.SupplyCollateral,
               address: reserveTokenContractId, amount: amountAtomicBigInt }]
});
const contractOperation = xdr.Operation.fromXDR(opXdr, 'base64');
// TransactionBuilder -> Soroban simulation + assembly -> customer Privy signer -> RPC -> verify chain.
```
For a simple noncollateral supply, Blend also has `Supply` / `Withdraw` variants; choose based on actual product behavior and risk. `SupplyCollateral` specifically affects borrowable collateral, and user must see its implications. `submit_with_allowance` requires separate token approval; use `submit` unless verified need.

## Grapnel REST endpoints
`GET /v1/capital/lending/markets`, `GET /v1/capital/lending/positions?customer_id=`, `POST /v1/capital/lending/{supply,withdraw,borrow,repay}`. All reads tenant-scoped; write requests require `Idempotency-Key`, module entitlement and customer signature. Market ID resolves through verified onchain registry, never a free-form contract parameter from caller.

Response position fields:
```json
{ "pool_contract_id": "C...", "asset_id": "stellar-testnet:soroban:C...", "supplied": "12.3400000", "borrowed": "0", "collateral_value": null, "supply_apy_variable": null, "health_factor": null, "as_of_ledger": null, "liquidity_status": "unknown", "readiness": "discovery_only" }
```
Replace nulls only from real current Blend SDK/RPC reads. For XLM reserve supply, show **XLM**, not USDC yield. For a custom/mock Testnet USDC, label test USDC nonredeemable.

## Funding and safety
A successful transfer of any token merely named USDC cannot automatically fund Blend's `CAQC...` reserve; asset identity gate must reject wrong token. Stale oracle or reserve health => no borrow. Do not count supplied balance as spendable in spot or Testnet return. Do not allow withdrawal that would make existing debt undercollateralized; run Blend estimate/simulation and check slippage/liquidity before signing. Show liquidation risk and variable rates.

## Tests
- On-chain read: current pool ID exists, supported reserve and decimals, pool active.
- Real Testnet supply + position reload + withdraw + wallet balance delta; hashes captured.
- Unit: wrong contract, asset mismatch, amount rounding, insufficient wallet XLM reserve, two concurrent supply operations, unknown pool, expired auth, stale oracle, available liquidity, borrow-capacity rejection.
- Provider failure: return `409 EXECUTION_UNAVAILABLE` and reason, don't create locally invented position.
