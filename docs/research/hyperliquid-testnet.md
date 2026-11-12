# Hyperliquid Testnet feasibility — read-only review

Observed November 12, 2026 UTC (November 11 Toronto). No account access, signatures, deposits, trades, bridge burns/mints or payouts were performed. This is research, not an execution-ready claim. Existing stocks findings remain unchanged.

## Result

The proposed Stellar deposit → treasury-funded Hyperliquid trade → Stellar payout is technically a **treasury conversion/settlement service**, unless the actual customer asset is burned/minted through a verified bridge. Both legs need independent custody/reservation and reconciliation; Hyperliquid PnL alone cannot prove a Stellar payout. This is an architectural inference from distinct assets/accounts, not a provider bridge claim.

There **is now an official CCTP path worth investigating**, contrary to an assumption that Stellar has no supported bridge. Circle lists Stellar domain27 and HyperEVM domain19, including official testnets. An end-to-end Grapnel transaction is still unproven. [Circle supported domains](https://developers.circle.com/cctp/concepts/supported-chains-and-domains).

## Access: precise scope, no Testnet exemption established

The official app's June15,2026 terms define the governed service as its website-hosted Interface. Section1.6 excludes Ontario persons/entities; section1.1 distinguishes that Interface from the blockchain. Section3.1.5 prohibits circumventing interface restrictions. The current Testnet app ships the same substantive terms component, with Ontario text and no explicit Testnet/API exception. We therefore **cannot infer a blanket protocol/API prohibition from these interface terms, or infer permission from a successful API response**. Clarify authorized automated Testnet use with the provider before treating Ontario customer trading as approved. No bypass or false residency is proposed. Sources: [official app terms](https://app.hyperliquid.xyz/terms), [Testnet terms](https://app.hyperliquid-testnet.xyz/terms); observed Testnet public terms asset `/assets/TermsOfUse-DW5Ysxvo.js`, SHA256 `305ed49b199226c3d2b32b3e10c60ae6109a979cb26673a21f43fb76c257ca17`.

## HyperEVM is not the perpetual order book

Chain998 is HyperEVM Testnet (`https://rpc.hyperliquid-testnet.xyz/evm`, gas HYPE). Actual perpetual order actions and position/fill reconciliation use HyperCore's Testnet API (`https://api.hyperliquid-testnet.xyz`). A successful EVM transaction is insufficient proof of a HyperCore fill. Live read-only `eth_chainId` returned `0x3e6` (=998). [HyperEVM network](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm), [exchange API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint).

## Genuine USDC transfer route and exact identity

Circle describes transfers from supported domains into HyperEVM, followed by `CoreDepositWallet` credit to HyperCore. HyperCore balances are protocol credits; underlying native USDC stays in the HyperEVM deposit contract. **Testnet recipients must already have HyperCore mainnet state, receive at most1000 testnetUSDC, and unsupported addresses can fail silently.** This is an immediate funding/eligibility prerequisite. Do not create mainnet state under this project's Testnet-only authorization. [Circle HyperCore flow and Testnet limitations](https://developers.circle.com/cctp/concepts/cctp-on-hypercore).

| Purpose | Official Testnet identity |
|---|---|
| Stellar Circle USDC | `USDC` issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |
| HyperEVM Circle USDC | `0x2B3370eE501B4a559b57D449569354196457D8Ab` |
| HyperEVM CoreDepositWallet | `0x0B80659a4076E9E93C7DbE0f10675A16a3e5C206` |
| HyperEVM CctpForwarder | `0x02e39ECb8368b41bF68FF99ff351aC9864e5E2a2` |

These differ from Blend's currently used USDC issuer and from the legacy Hyperliquid mock token. Read-only `eth_getCode` returned1798bytes at the listed HyperEVM USDC and2175bytes at CoreDepositWallet; this confirms deployed code presence, not economic correctness or bridge execution. [Circle token registry](https://developers.circle.com/stablecoins/usdc-contract-addresses), [HyperCore enablement registry](https://developers.circle.com/cctp/references/hypercore-contract-addresses).

For a simple staged path, burn exact Circle USDC on Stellar to HyperEVM via CCTP, obtain Circle sandbox attestation and mint, then approve/deposit into CoreDepositWallet (`destinationDex=0` for perps). The latter method is explicitly documented with Testnet contracts. Returning requires redeeming HyperCore credit into HyperEVM USDC, then CCTP back to Stellar. [HyperEVM deposit guide](https://developers.circle.com/cctp/howtos/transfer-usdc-from-hyperevm-to-hypercore).

Stellar burns use its published TokenMessengerMinter `CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP`. Inbound Stellar minting uses forwarder `CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ`, with both mintRecipient/destinationCaller set correctly and customer G-address in hook data. Stellar has7decimals; CCTP message amounts use6, leaving seventh-decimal dust on outbound. [Stellar contract registry](https://developers.circle.com/cctp/references/stellar-contracts), [Stellar forwarding and precision](https://developers.circle.com/cctp/references/stellar).

## Exactly what is needed before implementation/execution acceptance

- **Access decision:** provider clarification for intended Ontario Testnet API/integrator use; no declared Testnet exemption was found.
- **Already eligible/funded HyperCore Testnet account:** evidence of existing mainnet state via public `userRole` read, actual Testnet balance and transfer limits. Official faucet requires prior same-address mainnet deposit. Do not ask the user to deposit mainnet funds to satisfy it. [Official faucet](https://hyperliquid.gitbook.io/hyperliquid-docs/onboarding/testnet-faucet).
- **Signing, not a generic vendor API secret:** user-owned EVM/secp256k1 signer, distinct from the existing Stellar Ed25519 wallet; exact customer approval of financial intent. An owner may explicitly approve a separate Testnet agent/API wallet for permitted trading. Keep any agent key server-only and scope nonces/account mappings. A business API key does not authorize customer trades. [API wallets](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets), [official signing guide](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/signing).
- **Actual inventories/gas:** Circle-issuer Stellar Testnet USDC plus XLM fees/trustline; eligible HyperCore Testnet inventory; HYPE for EVM gas if using CCTP/EVM steps. A direct treasury conversion also requires a separately funded Stellar payout treasury and capped PnL liabilities. Public reads require no paid Hyperliquid API credential.
- **Proof:** real bridge messages/attestations and both-chain effects if calling it a bridge; otherwise disclose treasury conversion and show real Stellar deposit, HyperCore order/fill/position changes and real final Stellar payout separately. No local balance credit is blockchain execution.

The older Arbitrum Sepolia bridge is now marked deprecated. Its docs use mock USDC2 `0x1baAbB04529D43a73232B713C0FE471f7c7334d5`, not Circle Arbitrum Sepolia USDC `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`. Do not interchange these just because both say USDC. [Official USDC/legacy bridge page](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/usdc).
