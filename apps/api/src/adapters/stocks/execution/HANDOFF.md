# Stock execution investigation — 2026-11-11

**Result: blocked; no stock transaction submitted, no accepted execution claim.**

This scoped branch adds a reproducible public Testnet contract/code/ABI reader, sanitized observations, and a tested candidate readiness assessment. It changes no runtime routes, customer UI, frozen API schemas, signer, database, funding registry or shared contracts. `ztellar-readiness.ts` is a review helper, not a financial adapter. No unsigned stock transaction is offered until the lead approves an exact route. Proof fields remain null.

## Ztellar Edge: real existing collateralized synthetic protocol, currently not ready

First-party source: https://github.com/Rohitamalraj/Ztellar-Edge/tree/7588e2ba33da8220fae8a0123377a70e747b2063

Source calls this **synthetic exposure**. It is not ownership of stock shares. Its deployed vault stores collateralized positions; opening/closing does not mint or trade the separately published synthetic token contracts.

`research/ztellar-chain-review.json` records actual reads from https://soroban-testnet.stellar.org, explicitly checked against `Test SDF Network ; September 2015`, observed ledger 5681203 on 2026-11-11. Contract executable WASM was fetched by code hash, its SHA-256 verified against that deployed hash, and its ABI extracted. This verifies the deployed bytes and ABI, **not** reproducible correspondence to the Git source; the Rust/stellar toolchain is not installed in this environment.

| Role | Exact deployed identity | Deployed WASM SHA-256 |
|---|---|---|
| Vault | `CDQANGYCMZQKYSR6GQAXR7FEF3PALRMEDR65ONKSSJGAVDI23DM5YNQM` | `bbdd2079eea1ee289bc55e1ae5526b65772a390033f774acae0c5173d203f3fb` |
| Tier manager | `CC7EF4NGJDLQECANFXHXA32UAHYQKVU6Z57COFSR2WIB5TMQL3G4EKQF` | `24feb0e4ceca7a8c10660f3927ff00179b96748e423bdcc248bc4ddca57d7374` |
| Verifier | `CAO4EYDG7B5OXUUONZWY6AAUGYQPZD66D2E5NPMKCBIYRO2D6ZEO3HX7` | `4fa9aa3386c8530ddac90aa4aff37af442cfd6e8e404bdceaf4bc1874d106a51` |
| Circle Testnet USDC SAC | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` | Stellar Asset Contract, classic issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |

USDC has **7 decimals**; onchain prices use **6 decimals**. It is distinct from Grapnel's current Blend USDC. Never treat balances as interchangeable by symbol.

The source market IDs are 0 AAPL, 1 TSLA, 2 NVDA, 3 MSFT, 4 AMZN, 5 GOOG, 6 META, 7 NFLX, 8 AMD, 9 JPM, 10 SPY and 11 PFE. Those are source-declared synthetic exposures, not an accepted executable market catalog.

Actual auth-free RPC views:

- `get_vault_usdc_balance()` and USDC `balance(vault)` both report **5084898268 units = 508.4898268 USDC**. This is actual collateral liquidity, not an unlimited settlement guarantee.
- Public customer `GB4PC65ZHBPVEZMAHY2K2KYMS3RFBIN2FQIE3LGTLEHT2DEWVMTD7JYQ`: `get_max_leverage` returns **0**, `get_tier` returns **null**, positions are **[]**.
- Customer USDC balance read fails with SAC error13, **missing exact Circle USDC trustline**, rather than returning an invented balance.
- `get_price(0)` returns **308630000 = $308.63**.
- Vault instance last modification ledger **3408963** closed **2026-07-03T06:23:05Z**, independently read from Horizon. This predates the November11 observation by months.
- Public read-only `GET https://ztellar-edge.vercel.app/api/oracle` currently returns AAPL **355.14** and its own timestamp. That frontend quote does not update or attest to the onchain stored price. Evidence is in `research/public-source-reads.json`.
- No onchain price timestamp/round method exists in the fetched vault ABI. A recent instance modification alone would not establish oracle freshness: opening a position also changes the instance counter. A separate exact verified oracle-update transaction is required.
- Separate sAAPL/sTSLA/sNVDA contracts exist and report total supply0, but their stored `Vault` is **CDJUUXRCKJFLOGTQ77Z4VOZRPTZG2X5VB3IQAZRG6CSCONJAK57TU45X**, different from the advertised current vault. Do not present these as a verified token mint/redemption route.

Deployed API shape (confirmed ABI):

- `open_position(wallet: address, asset: u32, direction: u32, leverage: u32, collateral: i128)` requires actual customer auth, valid tier, and real USDC transfer.
- `close_position(wallet: address, position_id: u64)` requires matching customer auth and returns collateral plus/minus synthetic PnL.
- Source `close_position` **caps its payout to current vault liquidity**. A fully funded trade must not be mistaken for guaranteed full proceeds; lead review of this settlement policy is required.
- `verify_and_register(wallet, proof, public_signals)` is a real BLS12-381 Groth16 verifier route, not the frontend's locally cached tier. Actual valid customer-bound proof registration must be inspected and proven before borrowing a tier value from its scoring endpoint.

### Exact next steps before this could execute

1. Provider confirms the pinned source revision corresponds to deployed code (reproducible build) and accepts Grapnel integrating its existing synthetic vault and its settlement terms.
2. Provider maintains prices and supplies a fresh successful `set_price(s)` **Testnet transaction hash**, exact prices, ledger/time and authentication chain. The public app exposes `POST /api/oracle`, which signs provider-owned updates; **this agent did not invoke it**, because the lead requested read-only review before financial writes. A GET quote or a POST response alone is not chain proof.
3. Source has exposed upstream admin credentials in scripts. None were imported, derived, reproduced or used. Provider should rotate that admin and publish a verified configuration before integration; do not copy or rely on the exposed credential.
4. Customer approves exact Circle USDC trustline and funding, then a valid exact customer-bound verifier call. No manual tier assignment or localStorage bypass.
5. Lead freezes the adapter/customer authorization/operation intent shape, allowing only the pinned vault and USDC contract, exact asset/direction/leverage/collateral/position ID, inspected full Soroban auth tree, caps/fees/expiry, simulation and durable reconciliation.
6. Execute customer-authorized open **and close**, record hashes, verify vault positions and wallet/collateral deltas. Only then change execution status to `testnet_verified`.

No mainnet secret, provider signing credential, contract deployment, faucet call, oracle update, tier registration or customer financial write was performed here.

## Other providers checked

### Peridot Robinhood

First-party source: https://github.com/PeridotFinance/PeridotV2-Robinhood/tree/5f542a08d61658d6a5dcd658867eb68e12fc464f

README and its mainnet margin manifest describe Solidity NVDA/USDG contracts on **Robinhood Chain mainnet**, chain ID4663. Read-only JSON-RPC `eth_chainId` at `https://rpc.mainnet.chain.robinhood.com` returned `0x1237` (=4663), stored in `public-source-reads.json`. This excludes the Robinhood NVDA margin page as Stellar Testnet execution. Existing Peridot Stellar Testnet crypto margin is a separate product/asset route; another agent owns it.

### SODAX / Soroswap stock catalog

Existing repo evidence under `../research/HANDOFF.md` and `../evidence/testnet-probes.json` establishes production stock token identities and no same-issuer Testnet counterpart/liquidity. A Soroswap API key cannot make a mainnet-issued stock a Testnet asset. Official source: https://docs.sodax.com/developers/http-api/swaps and https://www.sodax.com/partners/soroswap . Needed from provider: exact Stellar Testnet stock issuer/contracts, chain/solver config, actual funded eligible Testnet liquidity, signed quote/build interface and a test execution hash. No guessed issuer or synthetic Grapnel share is substituted.

### EquitX

Official Testnet announcement: https://equitx.substack.com/p/equitx-partners-with-runtime-verification . Official public source https://github.com/EquitXDev/equitxdev at `987e4fbeeade02f7a744d5117a0ad14a5fe22140` only supplies local `Standalone Network ; February 2017` deployment configuration, not current public Testnet contracts. Current `https://test.equitx.com/` GET fails hostname certificate validation (`ERR_TLS_CERT_ALTNAME_INVALID`). TLS validation was not disabled. Needed from provider: current valid host, public Testnet deployment manifest, source/code hashes, actual pool inventory, eligible stock identity and inspected customer signing interface.

### Agama Stellar

First-party https://github.com/agamafinance/agama-stellar explicitly describes its stock tokens and venue as stand-ins: its core mints tokens at its own price and retains dollars instead of an independent stock venue. It likewise uses stand-in USDC/credit vault and presently falls back to admin-set reference quotes. This does not satisfy the user's prohibition on pretend stock shares; excluded rather than relabeled as real stock execution.

## Reproduce / tests

From this worktree root, with dependencies installed:

```sh
node apps/api/src/adapters/stocks/execution/research/probe-stock-candidates-readonly.cjs
pnpm exec vitest run apps/api/src/adapters/stocks/execution/ztellar-readiness.test.ts
pnpm --filter @grapnel/api typecheck
```

11 tests cover current actual prerequisites, mainnet rejection, exact contract/code/token drift, malformed/negative/zero integer balances, invalid onchain tiers/ledgers, and the fact that recent instance changes or large balances do not prove fresh price data or completed execution.

## Follow-up: permission provenance and reusable live reader

`ZtellarReadinessReader.read(wallet)` now performs live fixed-endpoint reads and returns exact deployment hashes/dependencies, bigint-string vault/customer collateral, actual max leverage and position IDs, all12 onchain synthetic prices, and the strict assessment. It checks Testnet before any account/code/view read, verifies fetched WASM bytes against pinned deployment hashes, rejects configuration drift and any unexpected signing authorization in a view. There is no transaction prepare/send method. The rerun result is `research/ztellar-live-readiness.json` (still blocked, proof null). API typecheck and **12** scoped tests pass.

`research/ztellar-permission-review.json` pins SHA-256 digests and exact paths/lines of reviewed permission source. Important distinctions:

- Oracle POST **is intentionally called by its regular trade-page consumer** on mount and every60 seconds; source route is unauthenticated and accepts no caller-supplied price/vault/key, instead using its server configuration. That explains intended behavior but does not constitute permission for this agent to trigger financial writes. No POST was called.
- Tier proof establishes a circuit computation over a caller-supplied private score. Source has no oracle signature or verifiable account-state commitment. Its score endpoint is a public wallet-history heuristic, and even its age heuristic uses a hardcoded ledger55000000 rather than the current5681203. It proves neither KYC, creditworthiness nor collateral ownership.
- Verifier source declares the wallet public signal but does not compare it to the `wallet` argument and does not require wallet auth for tier registration. Current source/frontend derives its so-called wallet secret from public address/week and falls back to localStorage when actual verification fails. None of those patterns are copied into Grapnel.
- `VERIFIED_ELIGIBILITY_BINDING_REQUIRED` therefore remains a distinct blocker. A legitimately computed conservative demo tier and exact customer binding would still need explicit lead/provider review; no invented KYC/credit assertion is acceptable.
