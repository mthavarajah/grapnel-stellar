# AGENT 02 — Privy + Stellar Wallet / Signing / RPC

**Read:** root `AGENTS.md`; docs `02_ARCHITECTURE`, `03_API`, `04_DATABASE`, `05_SIGNING`, `06_FUNDING`, `08_BLEND`, `11_TESTS_SECURITY`, `13_SOURCES`. Owned code: `apps/api/src/adapters/privy/**`, `apps/api/src/adapters/stellar/**`, wallet service routes with lead coordination, `apps/fintech-demo/src/lib/privy-signer` integration contract (coordinate with Fintech agent).

## Primary goal
**Prove a Privy Tier 2 Stellar wallet can sign and submit a real Stellar Testnet transaction**, then a Soroban Blend transaction. This is the critical integration blocker; do it before polishing any other module.

## Sequence / proof
1. Read live [Privy chain support](https://docs.privy.io/wallets/overview/chains) and [Tier 2 guide](https://docs.privy.io/recipes/tier-2-wallet-integration). Find exact SDK `chain_type=stellar`, React/Node signing API and supported signature serialization. Pin SDK versions.
2. Sign in through sample Privy session; verify identity token server-side. Create customer-linked Privy Stellar wallet; check `G...` address derivation and Ed25519 public key.
3. Fund with Friendbot, verify `G...` account via Horizon and read XLM reserves.
4. Build classic XLM payment with Stellar SDK using network passphrase Testnet. Build signing hash, invoke Privy Stellar Tier 2 signature, attach decorated signature and verify (or use Privy's documented full tx signing). Broadcast Testnet, poll actual SUCCESS and explorer hash. Do not export user key or replace with treasury key.
5. For Soroban: simulate Blend pool invocation, assemble footprint/auth entries, confirm Privy can sign **required Soroban authorization**, submit, and query actual state. Document any extra auth-signature handling.
6. Implement stable `PreparedAction` creation, signature verification and one-time authorization token verification; only sign previously validated approved transaction intent. Store no keys.
7. Implement chain balance readers: classic native XLM, classic trustlines/issuer and Soroban token contract balances (distinguish!). Integrate fee/XLM-reserve protection and exact bigint decimals.

## Handshake with other agents
Lead controls shared types. Spot/Blend and Testnet Return provide an action plan / unsigned XDR; you provide canonical signing+submit/reconcile functions. For `capital.testnet_funding` RETURN, verify customer signature over a payment to the **configured fixed treasury recipient**; for FUND, the treasury signer is server-only and must not be routed through customer Privy. Fintech may use browser Privy UI but shouldn't build Stellar transactions directly. Define a client-side `signPreparedAction` helper consuming the exact `PreparedAction` schema, and return signed XDR for authorization endpoint. If existing SDK APIs don't offer browser signing flow, coordinate alternate Privy supported approach with lead; no secret export workaround.

## Blockers and fallback
If Privy implementation cannot actually sign Stellar/Soroban despite Tier 2 docs, capture sanitized exact error/SDK version/test steps and alert lead immediately. Lead may permit Freighter Testnet fallback for the hackathon; don't silently switch or call a local keypair proof 'Privy'. Stellar Testnet reset may invalidate previous contracts; re-read official registry.

## Acceptance
Real verified Testnet wallet G-address, real signed tx hash, private key never in repo/log/browser DB, user approval required, wrong-wallet signature rejected, wrong network/issuer rejected, Soroban auth proof separately assessed, API wallet balance equals chain. Submit handoff with hashes, actual SDK methods and caveats.
