# Verified direct Testnet crypto expansion

This commit adds exact direct native-XLM routes for five official Soroswap Testnet standalone tokens: XTAR/Dogstar, USDC/USDCoin, XRP/Ripple, BTC/Bitcoin and EURC/EURoCoin. These are Testnet token identities, not a claim of native Bitcoin/XRP ownership or real Circle stablecoin rights. The distinct existing classic Blend-issuer USDC remains its own asset. No native/cross-network/mainnet asset is substituted.

## Discovery evidence

`verified-core-assets.json` is a fresh independent RPC verification of all13 explicitly Testnet assets in official `core/public/tokens.json`. The native SAC matches the Testnet passphrase; classic SACs are recomputed from their exact chain-read code/issuer; standalone contracts match the pinned official token WASM and chain-read name/symbol/7-decimal metadata. The networkless mainnet asset list remains rejected. Mainnet SODAX AVAX and stocks are not eligible merely because the provider UI lists them.

`testnet-assets-discovery.json` preserves broader read-only research:13core assets+8random research entries+3Blend registry assets. Random entries are **not** added to the offered catalog. The official factory contains649pairs; its exact native pair mappings and current onchain reserve/code/factory verification establish the five standalone routes plus the existing classic USDC route. Missing direct mappings do not become fake pools or implicit multihop execution. Broad REST probes received429, recorded as rate limits rather than absence of liquidity; subsequent discovery used read-only official factory storage instead.

## Exact inspection

- Router `swap_exact_tokens_for_tokens`, ordered path length2, exact source recipient/input/minimum/deadline, one source-account authorization and one exact input-token transfer to the approved pair.
- Finite token/pair pins are exported from `direct-assets.ts`; token executable hash is `263d165c1a1bf5a0dddbd0f21744a55cd8cacedf96ade78f53c570df11490e46`. Router/pair hashes and factory come from current official Testnet registry and live code checks.
- Standalone footprint is exactly11unique keys: source native account; wallet and pair token Balance keys; native pair Balance; pair INSTANCE; token INSTANCE; native/router instances and three approved executable hashes. Token INSTANCE may be RO (6RO/5RW) or RW only when its exact index is declared archived (5RO/6RW). No classic trustline belongs in this scope.
- Lead-approved Protocol23 automatic restoration is confined to sorted unique in-bounds indices of already-inspected persistent RW contractData. Native accounts, trustlines, code, RO keys, extra keys or separate RestoreFootprint operations are forbidden. Live protocol must be>=23; original/canonical/enforce/signed data extensions, authorization and footprint bytes must match. Changed state requires a new approval. Legacy USDC stays on its ext0 scope.
- Fees/resources remain bounded, including restoration rent inside the same reviewed envelope:<=1XLM,<=10m instructions,1MiB reads,128KiB writes. Canonical preparation narrows expiry and adds bounded numeric resource padding before customer approval; a second enforce simulation must fit. No arbitrary XDR is signed.

BTC tiny atomic outputs exposed integer rounding: one-basis-point provider tightening was insufficient (out390/provider minimum388 versus approved strict minimum389). The adapter now makes at most one calculated tighter retry (25bps here), while keeping the original approved50bps and strict ceiling check. Zero slippage stays exact. No minimum or precision rule is weakened.

## Root integration exports

- `SoroswapConfiguredInspector`: `markets()`, `inspect`, `verifyForSubmission`, `registryForMarket`. Legacy `market()`/`registry()` return the existing classic USDC route; no nominal/private-field typing dependency is required.
- `STANDALONE_NATIVE_ROUTES`, `APPROVED_TOKEN_WASM`, `standaloneAsset(route)`, `standaloneAssetId(contract)`, `isApprovedStandaloneAssetId(id)`.
- `discoverVerifiedTestnetAssets():Promise<{asset:AssetIdentity,wasmHash?:string}[]>` returns only independently verified official core Testnet metadata, not random research assets.
- Market serialization adds approved `asset_in`/`asset_out` identities (including chain-verified optional names) while preserving IDs. `preparation_available` stays distinct from actual `executable` proof.
- Spot reservations/deltas accept `stellar_rpc_testnet` only for the finite approved standalone IDs; native/classic assets still require Horizon. Non-native principal is held separately from XLM fee. Reverse native output is gross transfer, with actual fee separately reconciled against net wallet credit.
- `SpotProofReadiness` resolves the matching registry per market and accepts standalone operation transfer events (three topics) only for approved token contracts; actual native/SAC events retain exact asset markers. Every asset/direction requires its own real completed proof. Existing forward/reverse classic USDC proof is preserved.

Root owns runtime/routes/browser/BFF composition: use `SoroswapConfiguredInspector` instead of a single-pair inspector; aggregate classic and new `SorobanTokenBalanceReader` reads into spot reservations, worker observations and optional wallet balances. The reader's expected hash map is `Object.fromEntries(STANDALONE_NATIVE_ROUTES.map(r=>[r.contract,APPROVED_TOKEN_WASM]))`. There are no shared contract/runtime/routes edits in this commit.

## Actual verification and reproducibility

Five standalone forward directions passed actual unsigned builds and two enforce simulations: XTARledger5678724, USDCoin5678725, XRP5678726, BTC5678651, EURC5678727. BTCreverse passedledger5678652 using an existing public account with3907atomic BTC (discovered via public historical pool ledger and current read-only balance). Reports are under `latest-*-readonly-inspection.json`; no account was created, token minted, signature produced or transaction broadcast. All transaction/operation/customer proof IDs remain null. These are preparation proofs, not execution claims.

From repository root with server-only credentials configured:

```sh
DIAGNOSTIC_TOKEN_CONTRACT=CB7ICEHVRIRMF3CF6SIP2C2R3Z4E7WRPATT552QSVLIXZ5RSN6KLUDAE pnpm exec tsx apps/api/src/adapters/soroswap/research/inspect-readonly.ts
DIAGNOSTIC_TOKEN_CONTRACT=CB7ICEHVRIRMF3CF6SIP2C2R3Z4E7WRPATT552QSVLIXZ5RSN6KLUDAE DIAGNOSTIC_REVERSE=true pnpm exec tsx apps/api/src/adapters/soroswap/research/inspect-readonly.ts
```

Only the finite verified token-contract environment values are accepted. Other reverse diagnostics require an existing funded holder; the script never funds, creates or signs. Per-token names and CIDs are in `direct-assets.ts`.

## Primary sources

- https://raw.githubusercontent.com/soroswap/core/main/public/tokens.json
- https://raw.githubusercontent.com/soroswap/core/main/public/testnet.contracts.json
- https://github.com/soroswap/core/blob/main/contracts/factory/src/storage.rs (exact pair mapping layout)
- https://github.com/stellar/stellar-xdr/blob/main/Stellar-transaction.x (resource extension and archived RW indices)
- https://github.com/stellar/stellar-core/blob/master/src/transactions/TransactionFrame.cpp (Protocol23 validation)

## Bounded cross-token routing probe

The current official SDK [quote request type](https://github.com/soroswap/sdk/blob/main/src/types/quote.ts) explicitly supports optional `maxHops:number`, and its [README quote example](https://github.com/soroswap/sdk#get-quote) uses `maxHops:2`. Neither source establishes the server default; no default is assumed.

Two authenticated read-only requests to `POST /quote?network=testnet` requested exactly1000atomic standalone BTC into standalone XRP, `EXACT_IN`, `protocols:["soroswap"]`,49bps. The initial request omitted `maxHops`; the single lead-approved retry supplied `maxHops:3`. Both returnedHTTP400 with `No path found` / `Quote Failed`, most recently2026-11-11T17:28:24Z. Exact sanitized bodies/responses are in `multihop-btc-xrp-build.json` and `multihop-btc-xrp-maxhops3.json`.

The route is unavailable from the API for these current requests. This is not proof of absent liquidity at every size or of absent paths globally. The request does not prescribe XLM or any intermediate. No build was called, so there is no provider path, authorization tree, or footprint to inspect. No manual router path, guessed protocol, additional probing, signing, broadcasting or synthetic cross-token execution was added. The supported prepared routes remain the12 independently inspected native-XLM directions; nonnative-to-nonnative selection must stay unavailable. A future implementation requires an actual provider quote/build and exact independently reviewed multi-pair auth/footprint before the inspector or signer can expand.
