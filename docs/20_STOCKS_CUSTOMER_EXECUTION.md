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

## In-app treasury funding — v2

Customers use their existing Privy EVM wallet. No faucet visit, address copy, second login or manual wallet import is required. `GET /v1/trade/stocks/grants` takes scoped identity plus account_address; `POST /v1/trade/stocks/fund` takes the same body and an Idempotency-Key. The BFF injects customer/wallet identity. Current wallet ownership, entitlements and Gate1 are required.

A separate server-only Robinhood Testnet treasury holds actual canonical USDG and ETH. Each recipient can receive20USDG and0.001ETH once; at most two recipients are permitted in this prototype. Migration0012 persists a parent grant and exact signed native/token stages before one-use relays, with globally unique treasury nonces/hashes. GET only reconciles canonical two-confirmation native transfer and exact USDG Transfer logs. Timeout/202 does not establish funding. Secrets remain ignored server environment only (`ROBINHOOD_TESTNET_TREASURY_SECRET`); no customer keys are used.

Because the public RPC prunes historical state, readiness uses an explicit canonical receipt verifier in addition to the initial captured balance evidence. It independently checks current deployment/multiplier, actual exact router transactions, deadlines, canonical two-confirmation receipts, exact token Transfer deltas, equal bought/sold share quantities, proper ordering and current flat stock balance. Existing stricter historical adapter reconciliation and tests remain unchanged. A local complete/proof flag cannot enable a market.

## Recovery, portfolio and activity — v3

Stocks remain the only active development task. The network-assets reader now includes each exact allowlisted18-decimal stock token with current contract/multiplier checks. Zero stock balances can be hidden in the consumer table; unavailable reads remain unknown. `GET /v1/trade/stocks/activity` is tenant/customer/wallet scoped and uses current Privy ownership to return durable signed orders and actual grants, with exact confirmed share/USDG amounts; approvals are not purchases.

A read-only server reconciler polls retained signed transaction hashes even after the browser closes. Production stock reconciliation explicitly selects `confirmationMode:'events'`: independently validate canonical transaction/receipt/block, chain46630, contract registry, exact router calldata/deadline/recipient/amount, two confirmations and exact ERC-20 events. Swaps return `balance_basis:'canonical_transfer_events'` with exact signed `balanceDeltas`; approval receipts return `allowance_basis:'canonical_approval_event'`. These describe actual chain events, not invented before/after or current-allowance snapshots. The original historical-balance mode/tests remain unchanged. Source readers and the durable store independently verify the same proof; the browser checks exact deltas before showing Bought/Sold. This preserves recovery when public RPC historical state has been pruned. No read path resends a transaction.

## Asset table follow-up — November 12

Overview and Funds both hide confirmed zero-balance rows while preserving unknown observations. Confirmed Robinhood stock-token balances appear in both shared asset tables. Network holdings refresh after terminal stock events, every15seconds while visible, on tab visibility, and on page navigation. A refresh event received during a live read queues another read, avoiding a lost post-trade update.

For the exact bytecode-verified Robinhood Testnet USDG asset, the network-assets response supplies reserved0 and available equal to the actual wallet balance. Its dollar display uses the explicit `testnet_settlement_unit` accounting convention (1 USD/unit), not a fetched market peg or a promise of redemption. Missing/unverified balances and other same-symbol assets retain unknown values. Stock valuations are not inferred from the stock token ticker.

## Missing holdings / explicit buy follow-up — November 12, 23:04 UTC

The reported customer accounts had zero TSLA in live Robinhood token reads. The retained customer records showed a confirmed USDG allowance and unsigned TSLA swap requests expired before broadcast, with no swap hash. An allowance completion is not a purchase. Buy/Sell now runs the exact approval stage when required, waits for independently confirmed approval on that same retained request, then prepares and authorizes the original exact-amount swap. Failed, uncertain, substituted, expired or unconfirmed approvals cannot advance to a purchase. Passive GET recovery never starts this sequence.

Overview and Funds now show only confirmed positive holdings: both zero balances and unknown per-asset placeholder rows are hidden. Unknown sources are not relabeled as zero.

A new controlled-QA buy spent1USDG and increased TSLA by1.811216727459597909 tokens. Receipt `0x867f8d874b9995f1d06ebb4f7bac56b8e52dbee2436f82efd829fa06cce137a5` and the exact positive response from the same `readNetworkAssets` source are preserved in `evidence/qa-tsla-buy-holdings.json`. A subsequent QA cleanup sell restored the original zero stock balance; its hash and effects are included. This proves current protocol execution and holdings-source reads, not the customer's Privy browser flow. That last acceptance test still requires a controllable signed-in customer session.

## Stock execution freeze v5 — signing budget and progress

The bounded transaction signing lifetime is90seconds (previously30); source quote-fetch and multiplier-observation verification still have a30-second budget. Both browser and backend enforce the90-second maximum and absolute expiry. The onchain multicall deadline, exact input/output identities, amount, minimum output/slippage, nonce and capped fee remain fixed. Submission still requires a fresh onchain simulation, current balances/allowance and nonce before sending. A longer signing lifetime does not permit an expired signature or weaker slippage.

`StockExecutionStore.signAndClaim` is an optional backwards-compatible internal interface addition. The PostgreSQL implementation verifies scope/ownership, exact recovered signature/body, fees, nonce, current funding/allowance and fresh simulation once under a row lock, then atomically persists the raw signature/hash and an irrevocable send claim. The network send occurs only after commit. Concurrent requests produce one claim; validator failure rolls back; subsequent authorization reconciles the stored hash. The older two-step interface remains tested for compatible fixtures/recovery. `readStatus` reuses the exact deployment block independently verified by the stock multiplier reader rather than repeating deployment verification.

The client switches to the trading network before obtaining the time-limited transaction. Passive polling uses a separate read lock, cannot consume a Buy/Sell click, and does not replace active execution state or surface transient reads as execution errors. Input validation is hidden while preparing/signing/submitting; missing-source feedback is neutral. Expired, unsigned requests returned with no transaction hash are cleared from the current ticket, while their durable history remains. Signed or uncertain requests are never automatically replaced. The progress dialog yields keyboard focus to the wallet authorization UI.

A real controlled-QA allowance transaction was signed after a deliberate35-second wait, then authorized through `RobinhoodCustomerExecutionService`, live signature/simulation validators and the atomic PostgreSQL claim in3791ms. Receipt and exact allowance proof are in `evidence/qa-stock-signing-window.json`. The test uses an explicitly labeled ownership fixture in a disposable test database and the QA-owned EVM key. It proves the signing budget and execution-service path; it does not claim customer Privy browser verification.

Transient initial-source failures use neutral reconnecting status; permission/session failures remain real errors. An ambiguous POST after a returned signature stays in submission recovery with a spinner, not a new signature attempt. A later balance-refresh failure does not relabel a submitted transaction as failed. The pending read path can recover initial scope/balance availability and yields to explicit actions rather than taking the financial action lock.

## Approval-only customer transaction — November 13, 00:02 UTC

Customer transaction `0x4d58307453739100b5073d5db16e847545542b406473dbf7fc9a3b028d08e04c` is a successful canonical USDG `approve(router,1000000)` transaction. Its only token event is Approval; it contains no stock purchase or Transfer. A direct Robinhood Testnet RPC read found220USDG, zeroTSLA and1USDG allowance for that same sender. Sanitized receipt/call/current-balance evidence is recorded in `evidence/customer-stock-approval-followup.json`. The application retained this operation as a completed approval, with no subsequent swap record.

Inspection found the explicit Retry handler authorized its retained unsigned request directly, bypassing the Buy/Sell approval-to-swap coordinator. Thus retrying an approval could end after approval without purchasing. Retry now selects the correct network, rereads and inspects the same unsigned request, and uses the same coordinator as Buy/Sell. A confirmed approval advances to a newly prepared, separately inspected and signed exact-amount swap. Retried swaps are authorized once without an extra approval. Failed/substituted/uncertain approvals cannot advance; passive recovery still never signs. Flow failures also emit the existing sanitized, same-origin authenticated diagnostic.

Regression tests cover retrying an approval into a purchase, retrying an existing swap, and stopping after failed approval. This change does not itself establish a customer purchase: that requires a new confirmed swap receipt and actual share delta.
