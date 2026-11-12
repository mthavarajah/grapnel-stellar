# Robinhood customer execution — lead freeze v1, November 12

Existing `trade.stocks`, canonical Robinhood Chain Testnet46630 and USDG6, stock18. Reuse the currently authenticated Privy embedded EVM wallet. No secondary login, manual wallet input, fabricated balance or Stellar conversion. Existing verified registry and transaction adapter remain authoritative for contract pins, simulation and receipt/token delta verification.

Lead owns runtime integration/BFF/finance; backend delegate owns ONLY new `modules/stocks/execution-*` files/tests and migration0011. Provider delegate owns `adapters/robinhood/**`, ownQA runner and evidence. UI delegate owns only GMX helper/components until released. All shared changes require lead coordination.

## API

All paths `/v1/trade/stocks/`; identity is `customer_id,wallet_id`, injected by authenticated BFF. Require current trade.stocks and capital.wallets entitlements, tenant-bound identity and independently verified current Privy EVM ownership. Financial writes additionally require Gate1 and Idempotency-Key.

- GET `status`: identity, optional account_address, exact market_id.
- GET `requests`: identity, optional request_id; absentID recovers existing pending request.
- POST `prepare`: identity, account_address, kind `approval|swap`, market_id, side `buy|sell`, amount human decimal string, slippage_bps0..100.
- POST `authorize`: identity, request_id, signed_transaction rawEVMhex.

IDs `robinhood-testnet:stocks:TSLA|AMZN|PLTR|NFLX|AMD`. Approval/swap20USDG or10stock cap, exact bigint amounts, source balances distinct. Status returns snake_case scope/account, actual `native_balance`, `settlement_balance`, `stock_balance`, `allowance`, `execution_available` gated per symbol and actual current verified registry. No wallet yields null balances.

Public request `{id,business_id,customer_id,wallet_id,account_address,kind,market_id,state,expires_at,intent,transaction,tx_hash,proof}`. Intent is exact adapter `StockPreparedTransaction`. Transaction `{chainId:46630,type:'eip1559',to,data,value:'0',nonce,gas,maxFeePerGas,maxPriorityFeePerGas}`, all numeric quantities except chainId are decimal strings. State prepared/sending/confirming/completed/reverted/unknown/cancelled. Persist exact raw signature and deterministic hash before one-use send. Scope every record lookup; global account pending and signed nonce constraints prevent cross-session double submission. Expire only unsigned drafts; GET never signs/sends. Actual canonical receipt plus exact token deltas prove swap completion. Approval alone is not a trade. Unknown responses recover the same hash, never silently replace or resend.

Provider verification is own-controlled Testnet buy/sell roundtrip with canonical receipt/token balance evidence. Quotes, faucets and UI mocks do not establish execution. Acceptance remains blocked until actual chain proof. Reference stock USD chart and Testnet USDG pool execution price remain separate.

## Additive swap quote verification fields

A public execution request additionally returns `quote:null` for an approval or `quote:{amountOutBaseUnits,minimumOutBaseUnits,slippageBps,observedAt,expiresAt,blockNumber}` for a swap. These are the actual verified adapter quote fields, durably preserved with the prepared request. Decimal base-unit strings remain exact. The minimum must equal `floor(amountOutBaseUnits * (10000 - slippageBps) / 10000)` and match the exact transaction intent; quote observation/expiry must match the intent timestamps. The browser independently verifies this against its captured slippage choice before signing. This quote is the Testnet pool quote, never the official underlying-equity reference price.
