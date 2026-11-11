# Peridot execution review — 2026-11-11

Status: discovery and unsigned simulation only. No chain writes, activated QA accounts, signing proof, or margin execution hash yet.

## Scoped implementation

- `intents.ts`: exact deployed v3 per-step operations for MockUSDT vault deposit/withdraw, margin transfer/return, begin/swap/activate/cancel open and prepare/swap/finish/cancel close. `close_finish` requires a chain owner check in the workflow because its ABI has no user argument.
- `pool-swap.ts`: QA-only pinned native→MockUSDT Aquarius preparation and signed-envelope inspection. No signing/broadcasting function. Explicit policy is required for automatic restoration of the exact pinned MockUSDT code. Full retrieved WASM bytes must SHA256-match the pin. All other restoration is rejected. Original, canonical, enforced and signed footprints/archive bytes remain identical.
- Strict QA budget: ≤28,000 XLM input, ≤1 XLM fee including restoration rent. Exact one source auth root, one child native transfer, fixed pool/recipients/types and exact footprint keys.
- Fixture `research/swap-scope-readonly.json` is an unsigned RPC record simulation (`broadcast:false`, `signatures:0`, `tx_hash:null`), not acceptance evidence.

## Parent-approved own-QA plan, still pending code review

Up to 3 new memory-key-only Friendbot accounts; ≤2 consolidation payments of 9,995 XLM; one ≤28,000 XLM pool swap; ≤10 MockUSDT vault deposit/margin collateral; one 2× long begin/swap/activate followed by close and collateral return/withdraw. ≤16 initial chain actions including activations; ≤3 recovery owner cancel/close actions. No customer/treasury keys, minting, oracle/config/admin changes or 5% guard relaxation. Explicit signer label: ephemeral_qa_ed25519_NOT_Privy_customer_flow.

Read-only ledger 5681202: XLM reserve 326802.0913341, MockUSDT reserve 59095.0002703, oracle 0.1494122, 30bps fee, deviation 21.0262%. Official estimate for 28,000 XLM gives 4650.7242451 MockUSDT, predicting 2.7022% post-swap deviation. Re-read and re-simulate immediately before actual execution.

## Frozen workflow proposal for lead

Keep shared module `trade.perps`; label UI Margin. A durable parent workflow owns wallet/tenant/market/direction/leverage/collateral amount, wallet binding, frozen pins and policy. Separate durable child operations each have their own exact PreparedAction, approval, unsigned/signed envelope digest, hash, sequence, expiry, chain status and balance/state evidence. Parent states: awaiting_collateral → awaiting_margin_transfer → opening_pending → opening_swapped → open → closing_prepared → closing_swapped → closed, plus recoverable/failed. Next action only after reconciled success and verified chain state; never treat a 202 as filled. Expired pending open/close allows only the exact owner cancel/resume path supported by current ABI. On uncertainty, reconcile known hash before resend.

Current scoped intent DTO is `PeridotStepIntent` in intents.ts. Underlying atomic units are 7dp; vault receipt units/amounts MUST use live exchange-rate conversions and observed receipt deltas rather than blindly scaling metadata decimals. Provider state reads must establish exact position owner, margin asset, base asset, side, debt, phase, pool and 30-minute deadline before each action. A signed QA protocol proof does not establish customer Privy integration acceptance.

## Validation

53 focused tests pass; API TypeScript check passes. Tests mutate auth recipient/amount/extra invocation, amount budgets, code and account keys, archive indices, duplicate scope, network and fees. `state.ts` adds fail-closed owner/pool/asset/phase reads; synthetic state tests do not prove actual deployed PendingOpen/Closing transitions. These reads remain subject to confirmation against actual QA traces. Main canonical margin auth/footprint inspectors and customer route integration remain incomplete. Do not advertise margin executable yet.
