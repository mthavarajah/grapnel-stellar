# Direct Testnet swap inspector

Scope is one direct `soroswap` router `swap_exact_tokens_for_tokens` from native XLM SAC to exact classic USDC SAC. No reverse route, aggregator, multihop, extra fees, approvals, sponsorship, restore, arbitrary auth, extra account or contract is accepted. Code is under `../inspector.ts`; parent runtime/signing/UI files were not changed.

Current official Core registry and live RPC verify router/pair executable hashes, both tokens' Stellar Asset Contract executable, pair tokens/factory and positive reserves. The current generic Soroswap asset list remains mainnet and rejected. Registry provenance does not transfer ownership to Grapnel.

The original unsigned provider transaction is inspected first. Only its expiry and numeric resource budgets/resourceFee/fee may be reconstructed. The exact operation/auth, source/sequence, footprint, memo and remaining preconditions stay byte-identical. The transformation verifier reconstructs these approved changes from the original and compares full envelope bytes. Envelope expiry is narrowed to the quote (<=120sec), never extended. The invocation's existing deadline may be up to one hour, but the same immutable signed envelope cannot be used after the much shorter transaction expiry. Deadline changes are never permitted.

Actual provider budget2477968 instructions was below fresh enforce simulation2491101. Canonical reconstruction adds ten percent instruction padding (max10m), preserves/increases exact observed read/write budgets under1MiB/128KiB, and pads resourceFee by ten percent+1000stroops under the total1XLM ceiling. A second enforce simulation must preserve exact auth/footprint and fit declared budgets/fee. Unknown state, changed requirements, restore or expired quote fails closed. No signing method exists in this class.

## Exports and integration

- `SoroswapDirectInspector(pairId).market()` performs live verification and returns exact XLM/USDC registry metadata, `route_verified_at` and no execution proof.
- `.inspect` is a `SpotXdrInspector` callback. Adapter `prepare` still requires Gate1 and now accepts only verified canonical narrowing/resource reconstruction.
- `.verifyForSubmission(action,signedXdr)` verifies the actual customer signature via the common verifier, exact approved summary/digest, live contracts/sequence, and enforce simulation of unchanged signed bytes. Root must enforce current Gate1, business entitlement and customer session before use.
- `inspectApprovedSwapTransaction(action,tx,registry)` is a synchronous scope callback for the shared signature verifier.
- `inspectSwapTransaction`, `narrowSwapTimebounds`, `reconstructSwapResources`, `assertCanonicalSwapTransformation` support independent review/tests.
- `NATIVE_SAC`, `USDC_SAC`, `USDC_ISSUER` identify the only allowed assets.

`markets()` includes additive `preparation_available`, derived from configured provider key+Gate1+inspector+verified route. `executable` and `execution_status:testnet_verified` still require actual chain proof. Root owns the public version note, runtime and UI integration.

Root still needs: customer-authorized exact USDC trustline (helper is root-owned); durable spot quote/market assets persistence; exact XLM input+fee reservation/sequence locking; worker verification/broadcast and independent actual USDC credit/XLM debit reconciliation; browser scope/approval for `spot.swap`; current Gate1 checks. Never promote a quote or diagnostic simulation into swap execution proof.

## Actual read-only evidence

`unsigned-build.json` holds a real unsigned provider build for an existing public Testnet diagnostic account whose exact trustline was independently read from Horizon. The account is not controlled by Grapnel; no account or transaction was created, signed or broadcast. The final report records successful enforce simulations at ledgers5677622/5677623, unchanged auth+5RO/5RW footprint, instructions2477968->2740212, resourceFee21511->24667, unchanged total122020stroops and narrowed expiry. All financial transaction/operation/customer hashes remain null. This is inspection evidence only.

Reproduce with configured server-only credentials from repository root:

```sh
pnpm exec tsx apps/api/src/adapters/soroswap/research/inspect-readonly.ts
```

The script only calls quote/build, Horizon/RPC reads and simulations. It requires an existing exact trustline and never creates one. It emits no key, signed XDR or signable action. Provider timeouts remain possible; never substitute a stale build. Focused tests replay unsigned evidence offline with fixed time; they are not execution evidence.
