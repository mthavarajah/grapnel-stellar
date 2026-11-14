# 07 — Crypto Spot adapter (Soroswap, Stellar DEX, Aquarius)

## Objective
Expose standard REST quote/order/holding endpoints; backend performs **real Stellar Testnet** spot swaps via Soroswap aggregation when a valid Testnet liquidity route exists. Underlying venues may include native Stellar DEX and Aquarius if currently returned by aggregator. Do not create separate SDEx/Aqua adapters unless Soroswap does not offer working Testnet route and lead approves a scoped fallback.

## Sources
- [Official Soroswap SDK repo](https://github.com/soroswap/sdk): API key, `quote`, `build`, `send`, `getProtocols`, `getAssetList`, `getContractAddress`, Testnet flag. Samples include BigInt amounts.
- [Soroswap docs](https://docs.soroswap.finance/), [API](https://api.soroswap.finance) (requires provider key; route/auth documentation may change).
- [Stellar path payments](https://developers.stellar.org/docs/build/guides/transactions/path-payments) for optional native SDEx route, but only if approved.

## Environment
`SOROSWAP_API_KEY` server only, `SOROSWAP_API_URL` optional, `STELLAR_NETWORK=testnet`, chosen `SupportedNetworks.TESTNET`. **Do not derive network from Node's `NODE_ENV`**. Pin SDK version; README examples inconsistently show install `soroswap-sdk` and import `@soroswap/sdk`; inspect package.json/npm exports and compile before finalizing.

## Live integration spike (must precede any UI promise)
1. Get API key. Call `getProtocols(SupportedNetworks.TESTNET)`; save returned provider availability.
2. Load Testnet asset list, discover actual contract ID for XLM SAC and suitable stablecoin asset, verify both on Testnet chain.
3. Query `quote` for a low-value `EXACT_IN` trade, using **bigint atomic amount** and allowed protocols. Check returned route, output, slippage and expiry.
4. Call `build({quote,from:customerGAddress,to:customerGAddress})`; extract unsigned XDR.
5. Validate network passphrase, contract allowlist, amount and authorized transfers; perform any required Soroban simulation/auth entry handling. Let customer sign via chosen Privy Tier 2 workflow.
6. `send(signedXdr, SupportedNetworks.TESTNET)` or direct Stellar RPC; record submitted hash; poll actual ledger result. Compare wallet token deltas before/after.
7. Record verified test pair in `provider_markets` with readiness `testnet_verified` only after a true success.

## Grapnel adapter
```ts
class SoroswapSpotAdapter {
  async markets(): Promise<Market[]>; // only verified registry assets with route flags
  async quote(input: QuoteInput): Promise<StoredQuote>; // provider fee + slippage
  async prepare(quoteId: string, walletAddress: string): Promise<PreparedAction>;
  async reconcile(txHash: string): Promise<ExecutionResult>;
}
```
Example provider SDK shape (illustrative, **recheck installed exports**):
```ts
const quote = await soroswap.quote({
  assetIn: TOKEN_IN_CONTRACT, assetOut: TOKEN_OUT_CONTRACT,
  amount: 10000000n,
  tradeType: TradeType.EXACT_IN,
  protocols: [SupportedProtocols.SDEX, SupportedProtocols.SOROSWAP, SupportedProtocols.AQUA],
  slippageBps: '50'
});
const built = await soroswap.build({ quote, from: customerGAddress, to: customerGAddress });
// NEVER auto-sign built.xdr; inspect and route to the customer's signed intent.
const result = await soroswap.send(customerSignedXdr, SupportedNetworks.TESTNET);
```
Do not assume every protocol enum is supported on Testnet; ask `getProtocols`. Provider quote is not proof of finality; inspect actual resulting balances.

## Asset and order models
`market_id` Grapnel internal stable ID, `asset_in_id` and `asset_out_id` must resolve to exact validated contract `C...` on Testnet. Return requested base/quote amounts as decimal strings; store atomic amounts bigint. `trade_quotes` expire. Order state accepted/awaiting signature/submitted/confirming/completed/failed. `actual_out` only after verified settlement. Include provider route and fee summary in quote to business; do not promise exact final mid-market price.

## Frontend UX
Market dropdown only lists `executable=true` pairs or shows unavailable cards. Customer enters USDC/XLM amount, quote shows actual expected output, slippage and expiry, approves by wallet, sees progress and Testnet explorer link. No chart prices based on stale invented data. Show tokens as contract assets rather than guaranteed native BTC/ETH unless verified wrappers exist.

## Test plan
Unit: decimal->bigint, mock quote normalization, stale quote and slippage rejection, provider 429/timeouts, XDR substitution rejected. Integration: valid Testnet quote; unsigned XDR matches intent; customer signs; confirmed ledger hash; before/after balances reflect trade. Negative: no pair liquidity -> `409 EXECUTION_UNAVAILABLE`; duplicate order returns one chain op, not twice.

## Minimal fallback
If Soroswap Testnet liquidity/credentials aren't available, use an actual Stellar Testnet **native SDEx path payment** only if tested from verified code/issuer, approved by lead, and explicitly labeled as `provider:stellar_sdex`; otherwise keep spot read-only and retain real XLM transfer proof. No local mock swap success.

## November13 catalog review and final owner selection

`https://api.soroswap.finance/api/tokens` currently lists13 Testnet identities and matches the official Core registry. The authenticated `/asset-list?name=soroswap&network=testnet` still reports mainnet and must not be used as a Testnet catalog. The protocol pool endpoint returned694 existing Testnet pools. Seven additional registry symbols were reviewed: ARST/AQUA have direct pools; BRL/UXIV/CYON/JAMN/VEOF have no pools and their mixed Soroswap/SDEX XLM quotes return No path found.

ARST/XTAR, AQUA/XTAR and AQUA/EURC were implemented and tested in both directions with six actual confirmed owned-QA swaps and independently checked transfer/balance deltas. The owner subsequently removed ARST and AQUA; these routes are excluded from active discovery, with implementation and evidence retained for historical recovery. Existing Privy customer signing, module enforcement and exact operation reconciliation remain required. This QA evidence is separate from customer acceptance.

Velocity now offers XLM, issuer-pinned USDC, XTAR, XRP, BTC and EURC. The separate USDCoin contract is hidden without deleting historical balances or proofs. All active route/timeframe combinations are checked in `evidence/soroswap-catalog-review/chart-verification.json`. For Testnet-only pool assets, coverage is limited to actual recorded onchain observations; no historical candles or fiat prices are invented. Reference Crypto histories remain explicitly sourced real-market observations, distinct from exact swap quotes.
