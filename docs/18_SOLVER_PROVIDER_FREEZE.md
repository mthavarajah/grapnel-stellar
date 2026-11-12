# Funded solver providers — latest owner freeze

Supersedes the abandoned custom Stellar exchange proposal and extends docs17. No custom mock-equity/perp engine is to be deployed. Existing module IDs remain `trade.perps` and `trade.stocks`; they are separate products and providers.

* Perpetuals: HyperCore Testnet execution, HyperEVM Testnet chain998 where relevant. Actual prefunded master USDC is allocated to a unique verified customer subaccount. Native-perp funding does not imply xyz venue funding.
* Stocks: Robinhood Chain Testnet chain46630. Canonical stock-token contracts, quote asset, liquidity and actual buy/sell venue must be read and verified. Mainnet4663 addresses, USDG, test-USDC and canonical USDC are not interchangeable. No custom token or stock perpetual substitution.
* Customer source: exact configured Stellar Testnet USDC issuer/asset, existing Privy-authenticated fintech identity plus separately proved Freighter wallet. Wallet spend requires exact customer signature. Customer EVM keys are not exported.
* Mirroring: source escrow confirmation AND actual destination allocation are required before spendable trading credit. No destination mint or bridge completion is implied. Withdrawal is actual destination release followed by a verified Stellar treasury payout, including realized PnL/fees and actual available pool liquidity.

## Shared Perpetuals workflow API freeze

Fintech BFF maps these browser paths to `/v1/trade/solver/...`, injects current tenant-bound customer/identity-wallet IDs, and never accepts browser-supplied ownership IDs. All financial POSTs require idempotency keys and current entitlements. Public request IDs are not authorization.

| Browser BFF path | Method | Body / result |
|---|---|---|
| `solver-status?asset_class=perps` | GET | `{provider:'hyperliquid-testnet',configured,reason,wallet,asset,source_balance,trading_balance,withdrawable,equity,positions,preparation_available,execution_available}`; monetary values are decimal strings or null |
| `solver-wallet-challenge` | POST | `{freighter_address,asset_class:'perps'}` → frozen SolverChallenge |
| `solver-wallet-bind` | POST | `{challenge_id,proof,asset_class:'perps'}` → status |
| `solver-deposit-prepare` | POST | `{amount,asset_class:'perps'}` → public SolverRequest with prepared exact Stellar payment when ready |
| `solver-deposit-authorize` | POST | `{request_id,signed_xdr,asset_class:'perps'}` → durable request status |
| `solver-order-prepare` | POST | `{market_id,side,size,limit_price,leverage,reduce_only}` → request and SEP53 challenge bound to exact SolverOrderTerms |
| `solver-order-authorize` | POST | `{request_id,proof}` → durable request status |
| `solver-withdraw-prepare` | POST | `{amount,asset_class:'perps'}` → request and SEP53 challenge bound to fixed recipient/asset/amount |
| `solver-withdraw-authorize` | POST | `{request_id,proof,asset_class:'perps'}` → durable request status |
| `solver-request?request_id=<uuid>` | GET | scoped public request; reads/reconciliation never create a replacement transaction |

`wallet` is null or `{id,freighterAddress,assetId,escrowAddress,masterAddress,subAccountAddress}`. `asset` is the exact verified Stellar asset identity with seven decimals. `positions` use actual provider fields `{symbol,size,entry_price,unrealized_pnl,leverage}`. `source_balance` and destination balances never substitute for one another. `SolverRequest` public output contains id/kind/module/terms/state/intentHash/challenge/prepared/txHash/result/expiresAt, never master signing keys or raw signed provider actions.

Freighter proof is `{scheme:'stellar-sep53-v1',signer_address,signature_base64}`. Canonical challenge message is independently reconstructed using `adapters/freighter/index.ts`; mutable browser terms/opaque hashes cannot authorize a different intent. The optional `businessId` is supplied in server challenge scope; browser checks expected customer, identity wallet, Freighter address, origin and terms. Server checks full tenant context and consumes the nonce atomically.

Provider adapters own only their folders. Lead owns contracts, migrations, routes, runtime and claims. No live execution is advertised until actual network/account/asset/capacity/approval checks pass; acceptance evidence stays absent until real transaction and balance/position proof exists. Robinhood workflow types and execution gates will be frozen after discovery, not guessed from the Perpetuals interface.

Status extends the public response with `scope:{businessId,customerId,identityWalletId}`, `policy:{assetId,escrowAddress,masterAddress}`, `selected_market` (fresh source configured leverage or null), and `pending_request_id` (scoped unresolved request or null). Public requests include businessId/customerId/identityWalletId/walletId so browser verification never accepts opaque hashes. HyperEVM USDC, HyperCore collateral, Stellar USDC and Robinhood USDG are separate balances, not aliases. The owner accepted actual USDG settlement on Robinhood after discovery.

## Owner revision — November12: resume actual CCTP with Privy

Latest owner instruction: use Privy wallets, actual Circle CCTP for Hyperliquid funding, and find an alternative funding route for Robinhood stocks. This supersedes the parked CCTP decision and Freighter-first solver plan for Perpetuals. Preserve existing reviewed CCTP and direct Privy EVM account/order interfaces; do not wire the unfinished Freighter solver into the customer card. Stellar USDC from Circle and Blend/Soroswap USDC remain distinct. HyperEVM receipt is not HyperCore collateral. No source burn until destination eligibility, gas, exact binding and actual token compatibility are checked. No mainnet activation or deposit is authorized.

Robinhood settlement remains exact Testnet USDG. Research actual official faucet or a verified exchange/bridge route; a treasury conversion must be labeled as such, never as CCTP minting USDG. Lead owns any shared route, migration, runtime and contract changes. Adapter, UI and research paths remain disjoint until the next integration freeze.
