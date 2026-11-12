# Freighter message proof and exact Testnet deposit helpers

No extension was installed or connected. No customer signature or transaction was requested, created or broadcast. All private keys in tests are ephemeral offline fixtures. This adapter is not execution acceptance evidence.

## Verified provider APIs and signing scheme

Npm registry currently reports `@stellar/freighter-api@6.0.1`; root owns dependency pinning. Published package source includes `requestAccess`, `getAddress`, `getNetworkDetails`, `signMessage` and `signTransaction`. `signMessage(message,{address,networkPassphrase})` returns `signedMessage` plus `signerAddress`; current responses are base64 signatures, with typed legacy Buffer support. `signTransaction(xdr,{address,networkPassphrase})` returns `signedTxXdr` plus `signerAddress`. Every optional `error` is checked. `signBlob` is an extension-internal handler, **not** a public SDK method.

The signing bytes are exactly `Ed25519(SHA256(UTF8("Stellar Signed Message:\n") || UTF8(message)))`, per SEP53 and the actual extension implementation. Raw message signatures and SHA256(message) signatures are deliberately rejected. This is a distinct scheme from existing Privy raw-hash approvals.

Primary sources inspected:

- [Published npm metadata and exact6.0.1 tarball](https://registry.npmjs.org/@stellar%2ffreighter-api/6.0.1)
- [Public API signMessage source, extension revision1d3486980f7b44b91696f8350d84be9bc28f8656](https://github.com/stellar/freighter/blob/1d3486980f7b44b91696f8350d84be9bc28f8656/@stellar/freighter-api/src/signMessage.ts)
- [Actual background signing handler](https://github.com/stellar/freighter/blob/1d3486980f7b44b91696f8350d84be9bc28f8656/extension/src/background/messageListener/handlers/signBlob.ts)
- [Prefix, UTF8 encoding and hashing helper](https://github.com/stellar/freighter/blob/1d3486980f7b44b91696f8350d84be9bc28f8656/extension/src/helpers/stellar.ts)
- [Final SEP53 specification and verification vectors](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md)

## Root integration

Server exports `buildFreighterChallengeMessage(challenge)` and `verifyFreighterMessageProof(challenge,proof,expectedContext,now?)`. The proof is `{scheme:'stellar-sep53-v1',signer_address,signature_base64}`. The exact message is `Grapnel Solver Intent\n` followed by recursively sorted JSON with `{assetId,expiresAt,id,intentHash,network:'stellar-testnet',nonce,origin,purpose,scope,version:1}`. Scope binds business/customer/current identity-wallet ID plus the separate Freighter address. Root must construct the expected context from verified Privy identity and tenant-bound DB records, persist the exact challenge, and atomically consume its nonce once. The cryptographic verifier is stateless; it does not consume challenges, create wallet associations or authorize business-key spending by itself. Root must read actual source account authorization where a G-key alone is insufficient for a multi-signer Stellar account.

Browser `new FreighterWallet(freighterApi)` accepts the real6.0.1 SDK as an injected typed port. `connect()` checks Testnet before/after access; `signChallenge(challenge,expectedContext)` checks exact current scope/origin/purpose/asset/intent and canonical message before requesting a signature, then checks network/address and verifies the SEP53 signature after approval. Both issue no broadcast.

`signDeposit(prepared,expected)` supports only one exact classic USDC payment from the selected Freighter address to the fixed reviewed treasury. Only the existing app Testnet issuer or Circle Testnet issuer is allowed, and the expected asset ID must match the deployment registry selection exactly. Amounts are canonical positive7-decimal atomic strings, divisible10 for six-decimal solver accounting. The helper inspects source, recipient, issuer, amount, SHA256 deposit memo, fee100–1000stroops, at most90seconds timebounds, ordinary transaction/precondition extension and immutable signing hash. Memo is SHA256UTF8(`Grapnel solver deposit\n`+intentHash). It verifies the returned body is unchanged and carries exactly one valid owner signature. There is no opaque generic XDR-signing callback, trustline setup, payment substitution or automatic retry.

Unsigned source sequence/funding, tenant reservations, deposit reconciliation and durable signed-envelope persistence remain root-owned server checks. A customer deposit is not a physical bridge or a Hyperliquid fill. Separate segregated-subaccount allocation, actual execution and eventual Stellar withdrawal need their own evidence.

## Validation

Focused offline tests cover official ASCII/UTF8 SEP53 vectors, cross-tenant/customer/identity-wallet/Freighter mismatch, exact network/origin/asset/purpose/intent, modified messages/nonce/base64/signatures, expired/unbounded challenges, no mainnet message prompts, before/after network changes, exact deposit invariants, six-decimal dust rejection, altered signed envelopes and wrong-key signatures.

Results:35focused tests passed; API and fintech TypeScript checks passed. The frontend helper uses a typed injected SDK port, so root can install/pin6.0.1 without this branch modifying shared manifests or lockfiles. Pending acceptance remains an actual user-approved extension connection/message/deposit flow, followed by durable verified settlement; none is claimed by these offline tests.
