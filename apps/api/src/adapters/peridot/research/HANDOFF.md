# Peridot Stellar Testnet margin discovery and read-only adapter

## Scope and actual findings

This adapter replaces no runtime or UI by itself. Root approved the existing `trade.perps` module namespace for this provider, while `instrument_type:leveraged_margin` explicitly identifies the actual product. It is **not perpetual funding, Noether trading, a mainnet broker, or the separate Robinhood market**. Public Testnet configuration plus chain identities establish exactly one XLM / **Mock USDT** pair, with long/short UI directions and2–5x leverage. Reflector's16oracle assets are feeds, not16verified trading offerings. No additional Stellar Testnet margin asset is invented.

The collateral is a standalone Soroban token named `Mock USDT`, symbolUSDT, decimals7; it has no classic issuer and is not Tether-issued USDT, Circle USDC or the existing Blend/Soroswap tokens. The code and metadata are independently verified. Its balance/funding must not be conflated with any existing customer asset. Both vault receipt tokens report decimals6; exchange rates are scaled1e6. Receipt accounting and underlying amounts require exact bigint conversions, never UI decimal assumptions.

`config.ts` contains all10reviewed contract addresses and9WASM hashes. `chain-discovery.json` records actual instance XDR, storage, complete deployed ABI entries/function argument types, SHA256-verified WASM code hashes and byte lengths. Native XLM is an explicitly recomputed Testnet SAC. These contracts belong to Peridot/Aquarius/Reflector, not Grapnel. The public page chunk hash/source is in `source-review.json`; only public DOM-listed scripts were fetched, all200, without browser identity, private state, special headers, or access bypass. No Alchemy key embedded in client configuration is copied; Grapnel uses the public Testnet RPC.

## Verified current market block

Live adapter report `latest-readonly-inspection.json`,2026-11-11T20:27:24Z,ledger5681039:

- Onchain oracle XLM/USD0.1490152; timestamp20:25:00Z. MockUSDT/USD is independently read; the resulting XLM/MockUSDT oracle ratio is0.1491276.
- Actual pool reserves imply0.1808280MockUSDT/XLM, approximately21.2572percent deviation. The pool is not swap-paused. Both vault underlying assets and margin controller links match their exact pins.
- The policy remains a strict5percent oracle band. The docs and public frontend say5percent; deployed long execution config returns `open_slippage_scaled:50000` and `max_open_deviation_scaled:100000` with scale1e6 (10percent). Both raw fields remain exposed for review; neither is silently substituted for the stricter approved policy. The live gap fails either band. **No slippage change or transaction sequence can bypass this block.**
- Long pair config reports maxleverage5, maintenance5percent, liquidationincentive1percent. The same getter for Short returnsnull; public frontend offers Short, but null/default semantics have not been assumed as independent write proof. Raw values are retained.
- Available liquidity observations are9371653653XLMatomic and623483682306MockUSDTatomic; these are provider-vault liquidity, not customer balances or position proof.

`market-views.json` preserves25actual auth0view simulations atledger5680400/5680401, including pool estimate1XLM→1802850MockUSDTatomic. No envelope was signed or submitted, no account was created, no token was minted and no pool state was changed. Execution/transaction evidence remainsnull.

## Read-only integration exports

```ts
import {PeridotMarginAdapter, PERIDOT_MARKET_ID} from './adapters/peridot/index.js';
const peridot = new PeridotMarginAdapter({readSourceAddress: existingTestnetPublicAddress});
await peridot.markets();
await peridot.history(PERIDOT_MARKET_ID, '1d');
peridot.capabilities();
```

Optional injectable `server`, `fetcher`, `now` support reproducible tests. The reader independently checks explicit Testnet passphrase and every pinned executable before returning a market. Pool token order, vault-underlying links, controller links and exact MockUSDT metadata must match. View simulations must succeed without restore and with authorization count0. Unknown code/network/identity/auth fails closed. No external trading API key is needed for these public reads. Actual direct contract transactions still require the customer's Privy signature and Grapnel's exact prepared-operation authorization.

MarketID is exactly `stellar-testnet:peridot:XLM-USDT-MARGIN`, provider`peridot`; common underlying/reference-price/source/time fields match the existing market consumer shape. `base` and `collateral` are explicit AssetIdentity values. Risk values are JSON-safe decimal strings, not floating financial amounts. Unknown utilization/open-interest/statistics remainnull. All markets have `execution_status:discovery_only`, `executable:false`, `preparation_available:false`. `prepare()` always returns structured `EXECUTION_UNAVAILABLE` pending Phase2 approval/inspection. There is no Noether import or endpoint.

## Actual history endpoint

The public frontend's `GET https://peridot.finance/api/markets/xlm-price?range=...` returned200for all five actual selector values:1H(60candles),1D(96),1W(168),1M(180),Max(365dailycandles). Source explicitly reports`binance`; these XLM/USD chart references are distinct from onchain pool fills and oracle observations. `history-probes.json` and the five `history-*.json` files preserve exact data.

Grapnel mapping:live→1H,1d→1D,1w→1W,1m→1M,1y/all→Max. The response retains explicit `provider_range`; Max is labeled `latest_365_provider_daily_candles_not_lifetime`. All-time does not invent earlier history. OHLC bounds, positive bounded decimal prices, ascending timestamps and exact response range/source are checked.403/451stop access without retry/header spoofing;429returns a rate limit. No volume is invented.

## Phase2 frozen-interface proposal — not implemented or approved execution

The deployed ABI has exact methods:

1. `begin_open_position_v3(user:Address, margin_asset:Address, base_asset:Address, margin_ptokens:u128, leverage:u128, side:PositionSide, pool_tokens:Vec<Address>, pool_id:BytesN<32>, pool:Address, amount_with_slippage:u128)->u64`
2. `swap_open_position_v3(user:Address, position_id:u64)`
3. `activate_open_position_v3(user:Address, position_id:u64)`

Opening also needs actual customer MockUSDT receipt collateral: deposit to its exact vault, then `transfer_spot_to_margin(user,asset,ptoken_amount)` if the customer has no margin balance. No automatic mint/faucet is implied. Closing uses `prepare_close_position_v3`, side-specific reverse swap and `finish_close_position_v3`; pending-open cancel/expire and pending-close cancel/expire are explicit recovery methods. The docs/public UI describe30minute unfinished-open expiry. Current onchain parameters remain authoritative and must be read for the exact step.

A safe extension needs a durable workflow parent plus separately approved exact step operations; each signature binds source, current sequence, the exact method/args/position ID, all child auth invocations, allowed code/footprint keys, fee ceiling and expiry. The next step is prepared only after independent confirmation of the prior hash and controller/vault/position state. Retry checks prior hash/status first. Resumable begin/swap/activate state and cancel/expire recovery must survive browser closure. Preparation must check current oracle band and liquidity before any collateral reservation. Root owns operation schema/runtime/signer changes and module/provider revision notes.

The public `Peridot-Soroban` repository commitfe8d562051195dbc0af667367514b479de36fc8d contains v1/v2 source, while deployed ABI/public app use v3. The ABI is extracted, but an audit/source label is not proof of equivalence to current bytecode. Full v3 source or independently reviewed exact invocation/auth/footprint behavior is needed before writes. The separate Robinhood frontend/path has no verified Stellar Testnet deployment in this scope and must not be advertised as one.

Offchain public frontend APIs include wallet challenge/verify, keeper/limit orders, alerts and journal. They are not a published general third-party order API; wallet signatures/keeper permissions cannot be inferred from an API key. None of those write endpoints was called. TP/SL keeper automation requires its own exact authorization policy; it is not enabled by the read adapter. Future provider-access requests should ask for current v3 source/ABI deployment manifest, integration/API policy and keeper authorization docs, plus resolution of the Testnet pool/oracle drift. No access credential can by itself fix that drift.

## Reproducibility

```sh
node apps/api/src/adapters/peridot/research/discover-chain-readonly.cjs
DIAGNOSTIC_STELLAR_ACCOUNT=<existing-public-Testnet-address> node apps/api/src/adapters/peridot/research/discover-views-readonly.cjs
DIAGNOSTIC_STELLAR_ACCOUNT=<existing-public-Testnet-address> pnpm exec tsx apps/api/src/adapters/peridot/research/inspect-readonly.ts
pnpm exec vitest run apps/api/src/adapters/peridot/peridot.test.ts
```

These scripts only perform public ledger reads/view simulations/historyGETs and write local evidence. There is no signing or submission method. The account is only a public view-source; no secret/signing authority is required.

Primary sources:
- https://peridot.finance/app/margin
- https://peridot.finance/docs/margin-trading
- https://peridot.finance/docs/networks-and-assets (mainnet lending, kept separate)
- https://github.com/PeridotFinance/Peridot-Soroban
- https://soroban-testnet.stellar.org (explicit network/code/state verification)
