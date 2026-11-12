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

## Fresh integration recheck — November 11, 22:11 EST (November 12 UTC)

Isolated branch `feat/stocks-finish-current` starts at `d5fbfba`. The live reader now also pins the verifier contract/WASM and verifies both `tier.Verifier` and `verifier.TierManager`, in addition to vault/USDC bindings. A same-address tier or funded vault does not establish the identity of its configured verifier.

Fresh Testnet ledger **5685880** still reports **508.4898268 Circle USDC**, customer leverage **0**, missing exact USDC trustline, no positions, and AAPL stored price **308.63**. Vault last modification is unchanged at **3408963**. Public oracle GET now reports **355.63** for sAAPL. None of these reads is a stock trade. `ztellar-live-readiness.json` and `ztellar-chain-review.json` contain the fresh chain observations; transaction/position proof remains null.

GitHub's current main revision remains **7588e2ba33da8220fae8a0123377a70e747b2063**. SHA-256 of the current circuit, verifier and score files exactly matches the previously reviewed revision, so the missing score provenance and wallet-public-signal binding are still unresolved. `provider-recheck.json` records those digests and the current oracle GET response; no provider POST or onchain write occurred. The SODAX first-party Soroswap integration page still describes a mainnet integration. The old EquitX Testnet URL did not supply a usable current deployment.

**What the user can test now:** existing stock search/chart/metrics only. There is no honest executable stock test to ask them to sign yet. Extra Privy/Soroswap credentials do not fix an absent stock Testnet route.

**Specific provider unblock:** SODAX/Soroswap must supply a documented Stellar Testnet stock issuer/contract plus funded solver/AMM quote/build route. Alternatively Ztellar must publish a maintained onchain oracle-update proof and a reviewed, correctly wallet-bound normal-user eligibility route with authenticated input provenance (and source/build/deployment correspondence). Existing customer balance, localStorage tier or an admin-signed manual tier is not a substitute. Once an exact route is approved, the next development step is its restricted quote/build/inspection/reconciliation adapter followed by customer-authorized open/close proof; stocks must stay unavailable until then.

Verification: **14** scoped tests and API typecheck passed. Fresh live reader verified all three pinned WASMs and mutual dependencies using public Testnet RPC; all views required zero signing authorizations. No root/shared/runtime/UI file changed.

## Finite ordinary-user execution-path investigation — November 11, 22:28 EST

**New concrete upstream blocker: the proving key is not publicly available.** The normal frontend's `frontend/lib/zk/generate-proof.ts` calls Groth16 `fullProve` with `/zk/tier_proof.wasm` and `/zk/tier_proof_0001.zkey`. Current public GETs return **200** for the WASM and **404** for that exact `.zkey` URL. GitHub's pinned/current recursive source tree contains `frontend/public/zk/tier_proof.wasm` and `verification_key.json`, but **no `.zkey`**. The normal browser therefore cannot create its proof before simulation. `normal-customer-access.json` records exact URLs/statuses and null execution proof. `ztellar-access.ts` adds a fixed-host GET-only reader; successful HTML fallback is rejected and even available file headers are explicitly unverified. Five tests cover missing artifacts, HTML fallbacks, transport errors, invalid wallets and GET-only behavior.

Reproduce:

```sh
pnpm exec tsx apps/api/src/adapters/stocks/execution/research/probe-normal-customer-access.ts
pnpm exec vitest run apps/api/src/adapters/stocks
```

### Exact maintainer request (no secret credential requested)

1. **Publish the original `tier_proof_0001.zkey` corresponding to the verification key installed at verifier `CAO4EYDG7B5OXUUONZWY6AAUGYQPZD66D2E5NPMKCBIYRO2D6ZEO3HX7`.** Serve it at the normal app URL or provide its official public artifact URL plus SHA-256. The frontend setup script explicitly instructs copying that key into `frontend/public/zk/`. Re-running the randomized setup locally creates a different key, so it cannot repair this missing artifact against an existing deployed verifier. Never reuse the repository's unrelated test proof/public signals for another customer.
2. Confirm the public **`POST https://ztellar-edge.vercel.app/api/oracle`** is the supported third-party refresh route and provide one successful refresh Testnet hash for the pinned vault. The regular trade page invokes this provider-owned route on mount/every60s, with no caller-supplied prices/key. Source `set_price`/`set_prices` explicitly requires vault-admin auth; there is **no permissionless onchain setter**. The service signs using its own environment and returns a hash. Grapnel should verify that hash and fresh exact onchain prices independently. No shared admin secret is needed or appropriate. No POST was called during this review.
3. Publish source-to-deployment build correspondence and intended score semantics. The current ordinary score GET for the reviewed wallet returns **score38, tier2**, a public activity heuristic. This is not identity, KYC or credit verification. Source ageDays uses a hardcoded ledger and returns2855; do not market that as validated account age. An exact genuine proof over the provider-returned heuristic is a real circuit computation, but its source is not authenticated inside the circuit.

### Integration decision once the key exists

The lead could review a **conservative demo heuristic-tier** route without KYC/credit claims, independently bind the wallet field/public signals and exact customer intent/session/signature in Grapnel, and verify the full Groth16 proof against the deployed VK before preparing registration. The upstream verifier itself currently neither compares the public wallet signal to its wallet argument nor requires the wallet auth; **Grapnel must not delegate its customer authorization to that contract**. Whether this independent binding is adequate for the prototype is a lead decision; otherwise the provider must deploy a corrected verifier and publish the supported new configuration. No frontend localStorage tier is accepted.

Only after the exact proving key, oracle refresh, source/deployment and customer-binding policy are settled can a reviewed unsigned registration simulation be meaningful. Then the customer must authorize any actual registration, exact Circle USDC trustline/funding, restricted open and close through the normal operation service. Until that sequence produces real position/balance deltas and hashes, executable stocks remain incomplete. This is a provider artifact/configuration requirement; another Privy or Soroswap credential and another customer button click cannot resolve it.

Reviewed primary source paths, all at revision `7588e2ba33da8220fae8a0123377a70e747b2063`: `frontend/lib/zk/generate-proof.ts`, `frontend/lib/stellar.ts`, `frontend/app/api/oracle/route.ts`, `frontend/components/zk/prove-access-flow.tsx`, `circuits/scripts/setup.sh`, `contracts/synth_vault/src/lib.rs`, and `contracts/zk_verifier/src/lib.rs` in https://github.com/Rohitamalraj/Ztellar-Edge . No admin scripts/keys were imported or used; no proof generated from invented inputs; no eligibility submission, oracle write or financial transaction performed.

## Original proving material recovery — November 11, 22:58 EST

The finite official-source recovery attempt is complete. GitHub reports **zero releases, zero tags, zero Actions artifacts**, no current `.zkey` or `.gitattributes`/LFS pointer, and no commit history for the exact original proving-key path. A filtered no-checkout clone's **25 public commits** likewise contains no historical `.zkey` or `.gitattributes` object path. The explicit `frontend/public/zk/.gitignore` excludes `tier_proof_0001.zkey` and describes it as approximately200MB. The normal proof loader still references only `/zk/tier_proof_0001.zkey`; the published API route list has candles/faucet/oracle/prices/score and **no proof-generation API**. The canonical key GET still returns404. Evidence: `research/proof-artifact-recovery.json`.

New positive compatibility evidence: at **Testnet ledger5686441**, every public verification-key point (alpha, beta, gamma, delta, all6IC points) exactly matched the deployed verifier storage using the normal frontend's BLS12-381 coordinate serialization. Public key is Groth16/BLS12381 with5public signals. `research/public-key-match.json` records the result. The public VK is available at https://ztellar-edge.vercel.app/zk/verification_key.json and SHA256 **`2f3b00a7b196b1cca19be66191b7a8c593fb75d22aae2e2d9652e7693c78139b`**. Deployed VK ScVal-XDR SHA256 is **`cf5aa9c6e87cd401d2a732f318df93163059335aa55673f25cc05f1acae15d0f`**. This establishes an exact target for the missing original key; it does not make proving possible from a verification key alone.

Related official source artifact digests at revision7588e2b:

- Circuit WASM (`frontend/public/zk/tier_proof.wasm`): SHA256 `deb57776d06f97a5f4e972bea0d5090ee8b01b266b4328c600dcee2c3a9f1ba5`.
- Normal loader (`frontend/lib/zk/generate-proof.ts`): SHA256 `7d1f22db40e34d1f6179672ca028d0e596a42def58304ce39e8c409ce0225db2`.
- Proving-key exclusion (`frontend/public/zk/.gitignore`): SHA256 `ad534ca074811a08ff52de2e44313a198dc88db6c54489bed7353b47614bad3c`.
- **Missing proving-key checksum remains null**, rather than inventing its bytes or substituting a newly generated key.

Focused EquitX alternative: official `EquitXDev` account has only `equitxdev` and `EquitX-Documentation`. Current application source remains revision `987e4fbeeade02f7a744d5117a0ad14a5fe22140` (August19,2024), with only localhost8000/`Standalone Network ; February 2017` config. The official documented Testnet host https://test.equitx.com/ still fails `ERR_TLS_CERT_ALTNAME_INVALID`; certificate validation was preserved. No current public Stellar Testnet deployment manifest or ordinary executable route was recovered. Sources: https://github.com/EquitXDev/equitxdev and https://github.com/EquitXDev/EquitX-Documentation .

### Exact request the user can forward (no message sent)

Contact the maintainer of https://github.com/Rohitamalraj/Ztellar-Edge with:

> Please publish the original `tier_proof_0001.zkey` used with the deployed Stellar Testnet verifier `CAO4EYDG7B5OXUUONZWY6AAUGYQPZD66D2E5NPMKCBIYRO2D6ZEO3HX7`, as a public download with SHA256. The normal app URL https://ztellar-edge.vercel.app/zk/tier_proof_0001.zkey currently returns404. The matching published verification_key.json SHA256 is `2f3b00a7b196b1cca19be66191b7a8c593fb75d22aae2e2d9652e7693c78139b`; all its points match the deployed verifier. Please confirm third-party use of the normal oracle refresh service and provide a current successful Testnet price-update hash. No admin key is requested.

Publishing the matching original key is the smallest concrete upstream action. If lost, a new setup requires the **provider** to deploy/configure its corresponding verifier and publish a complete consistent normal-user proof bundle, source/deployment evidence and supported eligibility behavior. Do not forge proof/tier signals, reuse another wallet's example proof, obtain exposed admin secrets or silently deploy a different verifier in Grapnel. Existing conservative binding/oracle requirements still apply. No oracle POST, proof-generation attempt, eligibility submission or trade was performed in this review; no legitimate client compatibility patch can recover unpublished original proving material.
