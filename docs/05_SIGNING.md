# 05 — Privy Stellar wallet, transaction assembly and authorization

## Confirmed provider support and limitation
**Privy Stellar is officially listed as Tier 2**, meaning wallet creation and **transaction-aware signing**; Privy does **not** promise to broadcast Stellar transactions (Tier 3 function). Grapnel must build/simulate with `@stellar/stellar-sdk`, sign using the supported Privy interface, submit to Testnet RPC/Horizon, and reconcile. See [Privy chain support](https://docs.privy.io/wallets/overview/chains) and [Tier 2 integration](https://docs.privy.io/recipes/tier-2-wallet-integration). **Do not copy EVM `eth_sendTransaction` calls; this MVP uses Friendbot and Grapnel Testnet treasury, not Privy fiat on-ramp.**

## Setup
- Create a single Privy app for the demo, allowlist both frontend domains as needed. Configure login method (email demo), user-owned Stellar wallet support, and verified session tokens. `PRIVY_APP_ID` client-safe, `PRIVY_APP_SECRET` server-only.
- Create and link wallet by `chain_type: 'stellar'` using current Privy Node/React SDK API; inspect SDK method signatures from docs at install time. Privy wallet `public_key` / wallet address must be validated and converted to a Stellar StrKey `G...` account correctly (Ed25519 encoding).
- Tie `privy_user_id`, wallet ID, and Stellar G-address to tenant/customer. Verify user identity via Privy server token verification before treating wallet as customer's.
- Fund each new Testnet account's XLM reserve/fees with Friendbot if it is not active. Do not store customer wallet private keys. Asset trustlines required for classical issued asset; Soroban token balances are not necessarily Horizon classic balance entries.

## Mandatory test with proof (Gate 1)
1. Sign in as customer in sample fintech through Privy.
2. Create `stellar` wallet; verify `G...` address and public key on Testnet.
3. Get Friendbot activation for G-address; show Horizon account exists and XLM.
4. Generate a low-value XLM payment via Stellar SDK. Validate network/source/destination/amount/fee/seq/timebounds; obtain a Privy Stellar signature through Tier 2 supported method.
5. Attach signature to exact tx XDR; verify signature against transaction hash and wallet public key, submit via Testnet, poll until SUCCESS, fetch confirmation hash and updated balances. Append actual hash to evidence.
6. Independently prove signing a Soroban simulation-driven invocation (e.g. Blend test deposit) works with Privy and correct Soroban authorization entries. Classic payment success alone is NOT proof of Blend execution compatibility.

## Signing protocol (proposed implementation)
```
1. Fintech BFF -> Grapnel POST action with business key, customer_id, idempotency.
2. Grapnel confirms tenant module + customer ownership + validated user intent.
3. Adapter returns a planned action; Grapnel constructs XDR using chain SDK.
4. For Soroban: use `prepareTransaction`/simulation and assemble footprint/resources; prefer customer G-account as tx source so its full envelope signature implicitly authorizes its invocation. If another account pays fees, handle non-source auth entries and enforce-mode re-simulation.
5. Grapnel signs nothing by default; create short-lived PreparedAction with immutable XDR hash + summary and `customer_action_token` tied to validated Privy identity.
6. Browser shows summary, customer approves in Privy; client signs exact prepared transaction/hash via Privy-supported Stellar method.
7. Fintech BFF forwards signed envelope via Grapnel authorize route along with verified user token/operation token.
8. Grapnel verifies signatures, Stellar network passphrase, exact XDR/intent hash, authorized signer, contract IDs, amounts, destinations, min receive, max fees, and freshness. One-use action token consumed.
9. Submit to Stellar Testnet only (Stellar RPC for Soroban; Horizon or RPC for simple payment), store tx hash, then poll getTransaction until SUCCESS/FAILED.
10. Reconcile real asset balance/position deltas; release reservation; return completed only after onchain success.
```

**Note:** The exact Privy Tier 2 Stellar signing API (raw sign vs transaction sign) and how it encodes signature and Soroban auth must be established by a small live spike against the installed SDK. Treat the following as pseudocode, not copy-paste ready:
```ts
const tx = buildWithStellarSdk(validatedAction, 'Test SDF Network ; September 2015');
const prepared = await simulateAndAssembleIfSoroban(tx);
const expectedHash = prepared.hash(); // Stellar SDK signing hash, correct passphrase
const privyResult = await signWithPrivyStellarWallet(customerWallet, prepared, expectedHash);
const signedEnvelope = attachAndVerifySignature(prepared, privyResult, walletPublicKey);
await stellarTestnetRpc.sendTransaction(signedEnvelope);
```
Do not confuse `signMessage`, `signRawHash` (hash bytes), transaction-signing and Soroban auth-entry signing. Choosing the wrong bytes can create signatures that are cryptographically valid but unusable on Stellar. Local tests must include SDK signature validation, actually accepted network transaction and Soroban contract state change.

## Stellar-specific gotchas
- **Classic Stellar issued tokens**: trustline (`changeTrust`) and sufficient XLM minimum reserve; issuer authorization/clawback may restrict transfer. Asset identity is `(code,issuer)`, not `code` alone.
- **Soroban tokens**: contract `C...` ID and decimals; RPC contract balance query. Blend token contract may be a mock USDC unrelated to Friendbot XLM or other Testnet tokens.
- **Stellar Asset Contract (SAC)**: classic asset exposed as Soroban contract. Only treat classic token and SAC as same asset after confirmed wrapping/mapping of exact issuer/network.
- **Fees and reserves**: ensure fee payer and minimum XLM reserve; user could have visible XLM but not enough spendable.
- **Sequence numbers and timebounds**: long user confirmation may expire; rebuild and request a *new* signature, do not reuse expired approval.
- **Soroban**: simulation, invocation auth and resource footprint are not optional; latest ledger/TTL changes may invalidate prepared tx. Verify any sponsorship behavior rather than assume Privy covers Stellar gas.
- **Signer identity**: never use an authorized backend treasury key as proxy for customer consent. Treasury key may sign *only its own* test funding transfers.

## Fallback
Privy is the committed default. If unsupported Tier 2 signing behavior actually fails after a reproducible spike, the lead may approve using Freighter Testnet for customer transaction signing **and must disclose this change in submission**. Do not block on perfection or use server-stored plaintext user keys as a shortcut.

## Documents and checklists
[Stellar SDK](https://stellar.github.io/js-stellar-sdk/) · [RPC transaction submit and poll](https://developers.stellar.org/docs/build/guides/transactions/invoke-contract-tx-sdk) · [Sign Soroban invocations](https://developers.stellar.org/docs/build/guides/transactions/signing-soroban-invocations) · [Stellar Lab](https://lab.stellar.org/) · [Privy chain support](https://docs.privy.io/wallets/overview/chains) · [Privy Tier 2](https://docs.privy.io/recipes/tier-2-wallet-integration).
