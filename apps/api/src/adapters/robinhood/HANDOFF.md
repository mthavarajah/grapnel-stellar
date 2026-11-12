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

## Nov. 12 follow-up: USDG approved and venue reads verified

The lead reports the owner explicitly chose separate Stellar USDC, HyperEVM USDC and Robinhood USDG balances. The earlier USDC-on-Robinhood blocker is therefore superseded; **no USDC/USDG substitution is made**.

The official-doc-linked published `@synthra-swap/sdk@0.1.6` contains an explicit `ChainId.ROBINHOOD = 46630` deployment registry. Its legacy Testnet QuoterV2 and SwapRouter02 have nonempty runtime code and both return the expected factory and WETH9. Package integrity, exact registry/ABI excerpts and code hashes are saved in `research/sdk-registry-evidence.json` and `research/venue-evidence.json`.

`quoteExactInputSingle` succeeded for USDG→stock and stock→USDG for all five assets using read-only `eth_call`. The production reader additionally verified pinned runtime code, token decimals, stock implementation/multiplier, factory pool, pair identity and fee before each of ten quotes. Reproduce with:

```sh
pnpm exec tsx apps/api/src/adapters/robinhood/research/live-reader-check.mts
pnpm exec vitest run apps/api/src/adapters/robinhood/index.test.ts
```

**These Testnet AMM prices do not reflect real-world stock prices.** For example, the captured 1 USDG buy returned about 1.816 TSLA token units. This is a real Testnet pool quote with significant size/price impact, not an accurate underlying-share price. Reader output explicitly declares `price_basis: testnet_pool_quote`, `executionStatus: discovery_only`, and expires within 30 seconds. Display oracle prices must remain separate from executable pool quotes.

Provenance improved: official Arbitrum Testnet launch article explicitly lists Tesla, Amazon, Palantir, Netflix and AMD faucet stocks. Its Foundation-linked application deployment script pins TSLA/AMZN/NFLX addresses. PLTR/AMD share the same live proxy beacon, implementation and UI multiplier; their exact-address confidence remains `shared_beacon_corroboration`, not a fictitious direct official address registry. The beacon's verified AccessControlsRegistry source uses role-based access, not owner(). Captured creator/default-admin checks and official source links are in venue/provenance evidence.

`registry.ts` and `index.ts` implement the lead-approved immutable registry and reader only. `readStockMultiplier(symbol)` returns actual Testnet token identity, block and positive 18-decimal multiplier for a separate oracle-display reader. No execution capability is advertised. Actual customer binding, treasury inventory/allocation, explicit trade authorization, transaction simulation/submission, receipt and asset balance deltas remain the trading acceptance gates.

The public RPC prunes historical state quickly. Saved evidence remains an observation at its captured block; fresh verification must read a recent block. Do not treat a pruned-block error as proof that the previously captured read never occurred.

## Exact unsigned stock transactions and chosen funding alternative

`transactions.ts` exports `createRobinhoodTransactionAdapter({rpcRequest?,now?})` and `ROBINHOOD_FUNDING`. This adapter never signs or submits a transaction. Root owns tenant/customer Privy EVM wallet binding, exact transaction authorization, persistence, signing, gas-fee approval and broadcasting.

- `prepareApproval({customerAddress,asset:'USDG'|StockSymbol,amountBaseUnits})` verifies the reviewed Testnet deployment and token runtime/decimals, builds **only** ERC20 `approve(reviewedRouter, exactAmount)`, simulates the exact call and estimates gas. There is no unlimited approval; per-call input is capped at one million whole token units and uint256 bounds. Approval expiry is a local authorization expiry: ERC20 approve itself has no deadline, so root must reject submission after expiry.
- `prepareSwap({customerAddress,symbol,side,amountInBaseUnits,slippageBps})` obtains a fresh verified pool quote, verifies real spendable token balance, router allowance and nonzero Testnet ETH. It builds a single `exactInputSingle` with the customer as output recipient, exact input, positive minimum output and fee3000 inside `multicall(uint256 deadline,bytes[])`. Deadline is at most30seconds after the observed quote, slippage is bounded0–1000bps. If approval is missing it returns `approvalRequired:true, simulation:'approval_required'`, **not** a successful simulation; root must confirm exact approval and refresh the swap quote before submission. When allowance exists it requires exact eth_call simulation and a bounded gas estimate. No signing/broadcast method exists.
- `reconcileTransaction({txHash,expectedPrepared})` re-encodes the reviewed exact intent, compares chain/from/to/value/calldata against the chain transaction, checks canonical block hash and at least2confirmations, checks receipt status and inclusion before expiry. Exact allowance is independently read for approvals. For swaps both receipt Transfer deltas and block-before/block-after asset balances must match exact input and minimum output. Same-block additional balance movement is ambiguous and fails closed for independent reconciliation. Pruned historical state also requires independent reconciliation rather than invented proof. This is a read-only state machine; `pending` never becomes success merely because a hash exists.

The deadline ABI was verified on deployed runtime: future-deadline empty multicall eth_call succeeded, expired-deadline call reverted `Transaction too old`. `research/router-abi-evidence.json` records exact requests, responses, selectors and the pinned router code hash. This is ABI/read proof, not a trade execution.

### Funding configuration for the customer UI

The chosen alternative is **actual Robinhood Testnet USDG**, separately funded; there is no claimed Stellar→Robinhood bridge or synthetic destination balance.

- Official [Paxos Testnet USDG deployment documentation](https://docs.paxos.com/guides/stablecoin/usdg/testnet) explicitly lists Robinhood Testnet USDG at `0x7E955252E15c84f5768B83c41a71F9eba181802F` (6decimals).
- [Official Paxos faucet with USDG / Robinhood preselected](https://faucet.paxos.com/?token=USDG&network=ROBINHOOD). The official frontend displays100tokens per request and one request per wallet per day. Provider-side availability and limits remain authoritative. No claim was submitted by this agent.
- [Official Robinhood Testnet ETH faucet](https://faucet.testnet.chain.robinhood.com/) supplies gas. The last direct GET was HTTP429; no rate-limit/CAPTCHA bypass was attempted. Gas balance and sufficient approved fee must exist before actual execution.
- No canonical USDC→USDG Testnet swap/bridge was verified. The18-decimal owner-mintable token named USDC is not Circle USDC. Mainnet bridging documentation cannot establish a Testnet route. Actual prefunded USDG or the official USDG faucet is the actionable funding path.

Primary source hash/config observations are in `research/funding-evidence.json`. Transaction scenarios are offline fixtures, not user-chain proof. Live buy/sell receipts and balance changes remain absent until root authorizes and completes customer execution.
