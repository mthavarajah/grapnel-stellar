# Robinhood Chain Testnet stocks: discovery handoff

Status: **discovery_only / execution blocked**, 2026-11-12. No external transaction, faucet claim, approval, signature, deployment, or terms acceptance was performed. This change contains research only; it does not modify the shared provider contract or enable trading.

## What is verified

- Official [network docs](https://docs.robinhood.com/chain/connecting/) identify Testnet chain **46630**, RPC `https://rpc.testnet.chain.robinhood.com`, gas ETH. Actual RPC returned `0xb626`; evidence pins all subsequent contract reads to one block.
- Five candidate Testnet Stock Token contracts exist and return 18 decimals: TSLA, AMZN, PLTR, NFLX, AMD. Addresses and exact requests/responses are in `research/rpc-evidence.json`. They were discovered in project deployment records, not a current official Testnet registry. **Existence and ticker do not prove canonical issuer provenance.**
- Official Paxos faucet frontend configuration links Robinhood USDG to `0x7E955252E15c84f5768B83c41a71F9eba181802F`. RPC returns `Global Dollar`, `USDG`, **6 decimals**. This is USDG, not USDC. Bundle URL, SHA256 and configuration excerpt are preserved.
- Candidate `0xbf4479C07Dc6fdc6dAa764A0ccA06969e894275F` reads `USDC`, **18 decimals**. Explorer verified source is a simple Ownable OpenZeppelin ERC20 with owner-only mint and a 1-million initial mint. This **does not establish Circle USDC provenance**. See `research/usdc-named-token-source.json`.
- Legacy Synthra Testnet V3 factory `0x911b4000D3422F482F4062a913885f7b035382Df` reports stock/USDG pools for all five candidates at fee 3000, all with nonzero active liquidity at the captured block. Stock/USDC-named-token pools also exist. Nonzero liquidity is not an executable quote, price-quality check, or successful buy/sell proof.
- A third-party project explicitly deployed its own mintable USDC stand-in `0xFF00eA84190AeD0B1AbEF4fbC45E51258f2799BA`. Its five seeded pools contain that token. **Do not use this to satisfy USDC identity or Grapnel execution proof.**

## Exact blockers

1. **Current official Testnet stock registry is absent from the public catalog.** `GET https://api.robinhood.com/rhj/assets` returned 203 entries, every deployment on mainnet 4663 and zero on 46630. Mainnet contracts/catalog must not be silently copied. Official Testnet faucet direct GET returned 429; browser inventory was unavailable in this agent session. No CAPTCHA or rate-limit bypass attempted. Therefore faucet quantities, eligibility/claim limits and authoritative Testnet stock addresses remain unverified.
2. **No canonical Circle USDC on Robinhood Testnet verified.** The owner requested USDC mirroring. USDG is a separate settlement asset and requires an explicit lead/owner product and conversion decision; do not relabel it. Prefunded solver destination inventory and return solvency must exist independently of a Stellar receipt.
3. **Supported Testnet execution API/router/quoter is not frozen.** Current official [Synthra API docs](https://docs.synthra.org/docs/api-surfaces) link `https://ghost-trading-api.synthra.org/v1/chains`; live response lists mainnets including 4663 but excludes 46630. Never send Testnet intents to the current mainnet API. Pool reads alone do not validate router/quoter ABI, fee/slippage bounds, amount-in/out, approvals, recipient, or both trade directions.
4. No customer RH-chain wallet binding, solver settlement extension, destination inventory, USDC buy/sell quote, actual transaction, receipt, balance delta or return proof is supplied by this research. Keep capability blocked until those gates pass.
5. Real [Stock Tokens](https://docs.robinhood.com/chain/stock-tokens/) provide economic exposure and are not direct share ownership. The [read-only prices/assets API](https://docs.robinhood.com/chain/stock-token-apis/) is not an order-execution API. Raw stock-underlier prices require the documented corporate-action multiplier; do not display them as executable Testnet pool quotes.

## Reproduce read-only checks

From repository root (dependencies installed):

```sh
node apps/api/src/adapters/robinhood/research/probe.mjs
node apps/api/src/adapters/robinhood/research/http-probe.mjs
```

`probe.mjs` only uses `eth_chainId`, `eth_blockNumber`, `eth_getCode`, and `eth_call`, rejects any other chain ID, and has no account or signing API. Amounts and liquidity are serialized integer strings. `http-probe.mjs` GETs public official catalogs. It refreshes the HTTP snapshots; the captured Paxos bundle excerpt/hash is retained from the discovery capture.

## Primary sources and scope

- [Robinhood connecting](https://docs.robinhood.com/chain/connecting/), [contracts](https://docs.robinhood.com/chain/contracts/), [Stock Token APIs](https://docs.robinhood.com/chain/stock-token-apis/), [public Testnet launch](https://robinhood.com/newsroom/robinhood-chain-launches-public-testnet/).
- [Paxos official faucet](https://faucet.paxos.com/), configuration bundle referenced in HTTP evidence.
- [Synthra contracts](https://docs.synthra.org/docs/contract-addresses), [API surfaces](https://docs.synthra.org/docs/api-surfaces). Current docs are mainnet-focused, not Testnet deployment proof.
- [rwa-index self-deployment record](https://github.com/RaYYeR220/rwa-index/blob/main/deployments/rh-testnet.md): primary evidence for that project's own mock token and deployments only. Their swaps are not Grapnel proof.
- [Quaestor USDG self-deployment record](https://github.com/N-45div/Quaestor/blob/main/deployments/stocks-robinhoodTestnet-usdg.json): separate project pools; not canonical registry.

Lead owns any docs/17 solver API/schema extension. Do not connect these candidates to executable capabilities until canonical identity, destination settlement asset, venue and authorized end-to-end trade/return are verified.
