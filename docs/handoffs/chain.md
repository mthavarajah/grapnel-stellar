# Chain / Privy handoff — feat/stellar-wallet

Gate 0 frozen contract consumed. **Gate 1 is blocked: no configured Privy app credentials or authenticated customer session. No wallet activation, payment, Soroban execution or transaction hash is claimed.**

## Owned implementation
- `apps/api/src/adapters/stellar/index.ts`: `StellarTestnetExecutor(config)` implementing official Testnet endpoint/network checks; `preparePayment(input)` with exact native/classic identity, available balance/reserve and fee checks; `verifySignedAction`; `attachRawSignature`; `activateAccount`; `getClassicBalances`; `submit`; `reconcile`.
- `apps/api/src/adapters/privy/index.ts`: `createPrivyClient`, `PrivyIdentityVerifier`, `PrivyWalletSigner`, `validateStellarPublicKey`.
- `apps/api/src/modules/wallets/service.ts`: `WalletService(pool, identityVerifier, executor, signer)` with `provision(businessId, customerId, identityProof)`, `get(businessId,walletId)`, `balances(businessId,walletId)`. Core lead wires routes after review.
- Matching adapter unit tests: fixtures use random local keypairs **only offline**, never sent to chain or represented as Privy.

Config: `{network:'testnet',passphrase:NETWORK_PASSPHRASE,rpcUrl?:officialTestnet,horizonUrl?:officialTestnet,maxFeeStroops?:'1000000'}`. Explicit official URL allowlist fails closed; custom Testnet providers require reviewed configuration extension.

`preparePayment({operationId,customerId,walletAddress,recipient,asset,amount,action?})` returns frozen PreparedAction. `verifySignedAction(action,signedXdr)` checks exact Testnet digest, source, body, fee ceiling, expiry, one operation, no memo/extra signers, and exactly one valid customer signature. `submit` only accepts classic payment and verifies signature/live network again. Caller MUST store deterministic `parseTestnetTransaction(signedXdr).hash().toString('hex')` and envelope durably BEFORE broadcast. Uncertain errors expose tx_hash for reconciliation; caller must not resend a new transaction.

Balances read Horizon and current base reserve; subtract selling liabilities, native minimum balance and conservative fee ceiling. WalletService also subtracts all active SQL reservations. Unauthorized trustlines cannot be spent. No Blend/Soroban holdings are invented or counted as wallet spendable.

`prepareAndSimulate` currently fails EXECUTION_UNAVAILABLE: a generic contract allowlist does not verify invocation arguments, nested authorization recipients/values or footprint. An adapter-specific reviewed inspector plus source-only auth simulation is required before enabling Soroban. This is an explicit implementation limitation in addition to missing Gate 1 proof. No arbitrary provider XDR signing.

## Actual provider reads / source corrections
Official docs retrieved 2026-11-10:
- https://docs.privy.io/wallets/overview/chains — Stellar Tier 2; no managed broadcasting.
- https://docs.privy.io/recipes/tier-2-wallet-integration.md — Stellar signs Stellar SDK transaction hash with raw_sign; returned signature is Ed25519 hex. Recipe wallet example still uses user_id; **installed @privy-io/node 0.38.0 actual create type requires `owner:{user_id}` for user ownership**. We use installed type and current create-wallet doc below.
- https://docs.privy.io/wallets/wallets/create/create-a-wallet.md — user owner vs entity attribution distinction; entity-only does not grant signing authority.
- https://docs.privy.io/wallets/using-wallets/other-chains.md — React extended-chain `useSignRawHash` signature and raw_sign REST path.
- https://docs.privy.io/controls/authorization-keys/keys/create/user/request.md — server alternate requires authorization_context.user_jwts for user authority, not app secret alone.
- https://docs.privy.io/user-management/users/identity-tokens.md — `users().get({id_token})` verifies signed identity token; identity tokens omit user_can_sign. Verifier therefore fetches current user `_get(id)` and current wallet metadata before accepting user wallet ownership.
- Official Horizon root GET https://horizon-testnet.stellar.org responded JSON successfully. This is infrastructure reachability, **not chain execution proof**.

## Fintech browser signer integration
Use current `@privy-io/react-auth/extended-chains`:

```tsx
const {signRawHash} = useSignRawHash();
// Only after UI displays stored PreparedAction.summary and customer explicitly approves:
const {signature} = await signRawHash({
  address: prepared.walletAddress,
  chainType: 'stellar',
  hash: `0x${prepared.signingHashHex}`
});
```

`signature` is `0x` plus 128 hex digits (64-byte Ed25519 signature). Using Stellar SDK on the browser, parse prepared unsignedXdr with TESTNET passphrase, recompute digest equality, verify signature with wallet G-address, then `tx.addSignature(address, Buffer.from(signature.slice(2),'hex').toString('base64'))` and `tx.toXDR()`. Equivalent server helper `attachRawSignature` is exported, but this code is server-only because file also imports Node modules. Fintech should implement the short equivalent browser helper, never import entire server adapter. Submit signed envelope plus identity proof and one-use operation action token to BFF authorize flow. The rawSign hook uses the logged-in user's wallet authorization; no app secret in browser.

User Stellar wallet can be created client-side with extended-chain `useCreateWallet().createWallet({chainType:'stellar'})`; refresh identity token after wallet linkage. Server WalletService can provision with explicit user owner, then browser must refresh identity/session before spend. Never sign arbitrary hash from browser input or use server authorization key to impersonate customer.

## Verification
- `pnpm --filter @grapnel/api typecheck`: passed.
- `pnpm exec vitest run apps/api/src/adapters`: 13 tests passed before final reserve/trustline follow-up; rerun included in commit verification.
- Tests cover exact raw signature, missing/wrong/extra signatures, mainnet digest, changed intent, expired token, wrong network URL/passphrase, unavailable opaque Soroban, pending reconciliation, absent Privy config, missing customer binding, key/address mismatch.

Dependency approved by lead: @privy-io/node 0.38.0 (lead owns manifest/lock). Existing SDK: @stellar/stellar-sdk 14.3.0.
Env names required: PRIVY_APP_ID, PRIVY_APP_SECRET, STELLAR_NETWORK, STELLAR_NETWORK_PASSPHRASE, STELLAR_RPC_URL, STELLAR_HORIZON_URL. No secret export or server raw_sign feature implemented. No Freighter fallback used or authorized.

Next: wire WalletService/routes with core context; configure Privy client and allowed origin; prove real browser-signed payment and exact wallet deltas; implement protocol-specific Soroban inspectors before any Blend/Soroswap execution; capture independent chain evidence only then.
