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

54 focused tests pass; API TypeScript check passes. Tests mutate auth recipient/amount/extra invocation, amount budgets, code and account keys, archive indices, duplicate scope, network and fees. `state.ts` adds fail-closed owner/pool/asset/phase reads; synthetic state tests do not prove actual deployed PendingOpen/Closing transitions. These reads remain subject to confirmation against actual QA traces. Main canonical margin auth/footprint inspectors and customer route integration remain incomplete. Do not advertise margin executable yet.

## Newly verified downstream restoration blocker

At ledger 5681615, unsigned simulations against public preexisting provider owners (not Grapnel/customer authorization, no signer or broadcast) independently exercised current v3 `prepare_close_position_v3` and vault `deposit`. Minimum deposit resource fee is **6.2106876 XLM**, close prepare **6.2382247 XLM**. Both exceed the approved 1-XLM cap. Their archived entries are exactly pinned MockUSDT vault INSTANCE, pinned MockUSDT code, and pinned common vault code `c22680741c50eb52758a720b36d44c44b7f3f86271bcb8873ef90734607de120`. Current policy permits only MockUSDT code restoration, so these calls fail policy and must not proceed. The QA rebalance has also not proceeded because obtaining MockUSDT alone would not unlock this downstream action.

`research/existing-scope-readonly.json` and `vault-restore-analysis.json` preserve unsigned traces and decoded keys. `research/positions-readonly.json` captures public preexisting provider positions (all observed rows were Short/Open); they are not Grapnel position proof and several show zero debt shares. One test decodes actual XDR through the state validator. PendingOpen/Closing transitions remain unproven.

Lead review requested: provider externally restores its existing vault/code, or a new narrowly scoped approval for exact pinned same-envelope vault restoration plus one-time fee ceiling. **No broader restoration or higher fee has been implemented/assumed. No writes have occurred.**

## Reviewed scope additions prepared for lead review

Fresh pool quote is now enforced inside both QA prepare and signed-envelope verification: exact pinned `estimate_swap(0u32,1u32,inputu128)` must return auth-free u128 and the approved minimum must be ≥ceil(99.5% of that fresh estimate) and ≤estimate. A caller cannot weaken the guard by supplying a low minimum.

The lead approved a QA-only initial vault deposit exception, implemented in `vault-deposit.ts`: ≤10 MockUSDT deposited, fee ≤8 XLM only while a nonempty subset of the exact MockUSDT-vault INSTANCE/MockUSDT WASM/common-vault WASM are restored. Already-live keys remain RO; the exact sorted unique archived index list must cover every approved RW restoration key, without any extra entry. Normal warm deposit remains ≤1 XLM. Full fetched WASM bytes/hash and executable pins are checked; original/canonical/enforced/signed footprint and extension bytes must agree. No arbitrary account/trustline/storage restore or added operation is accepted.

76 focused tests and API typecheck pass. Live unsigned preparers passed record → canonical → enforce: cold deposit fee 6.8317700 XLM and pool swap fee 0.6967483 XLM. These have no signatures, broadcast or tx hash. New code still requires lead review before own-QA writes.

Additional downstream read-only TTL precheck at ledger5681694: native-vault INSTANCE `CB32OVY4AADCHQT3DLKJYW5QVTWY5MOX7BBNZFT3SDHZ5HPSDDEA2THJ` also has `liveUntil=0`. The common code is approved for the MockUSDT deposit restoration, but this separate native-vault INSTANCE is not approved. No scope expansion is assumed. Long opening must stop if it requires restoring that key. Evidence: `research/ttl-readonly.json`. All margin, troller, oracle, swap-adapter, router and pool instances/codes are live. This was discovered before any QA funding/rebalance write.

## Actual bounded QA execution and runner interruption

Own QA native-to-MockUSDT swap SUCCESS at ledger5681770: `c946a2d64993c27c21ef7ad7ea65d2e2b2ae5cc273be3b8e2b2ab3a121f2cc25`, input28000 XLM, output4650.7242451 MockUSDT, verified wallet delta0→46507242451atomic. Pool deviation became2.271% within unchanged5% policy. Public evidence in `research/qa-evidence.json`. Three Friendbot activations and two own-QA9995-XLM consolidations were confirmed first. Total actions6/19.

Deposit preparation stopped before signing because a first-time owner initializes exactly its own HasBorrowed key RO→RW. Lead approved that narrow variant, committed5f9659c;84tests/typecheck pass and unsigned live preparation succeeds at maxfee6.1739595XLM. No deposit transaction was signed/submitted.

The agent hot-reloaded the committed inspector into the existing memory-only-key process using loopback Node debugging. Reload succeeded, but the closing command used dynamic import in a global evaluation context, which Node rejects with ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING. The rejected promise terminated the QA process. Memory-only keys are unrecoverable; no keys were exported/persisted and no customer/treasury assets were involved. The original QA wallet retains its own remainingXLM/MockUSDT and cannot sign further. Do not repeat rebalance or bootstrap replacement accounts without lead approval. Recovery proposal sent to lead: a fourth QA Friendbot account, ordinary≤10XLM collateral acquisition swap,≤1MockUSDT collateral cycle using remaining13actions (total≤19), with built-in reviewed module hot-reload to avoid debugger/process termination.

## Current proven boundary and per-step integration contract

Recovery QA funding SUCCESS `27189228854fbcf81a2c063e3b25e8295b6db36a5eadb1ca3672e14fc9534b8f`, ledger5681862,10XLM→1.5300316MockUSDT. Vault deposit SUCCESS `b2088aa2520e9d7bb33f616b10440768623798810e92e4cef23e2c67449f2f20`, ledger5681865,1MockUSDT→9999780rawreceipts at exchange-rate1000022. These are ephemeral own-QA signatures, not Privy customer or API workflow proof. Public recovery evidence records global9/19actions; private QA key persists only in lead-approved0700temporary directory/0600file outside repo, never artifacts/env/stdout. No debugger is used in recovery.

Shared runtime/contracts are untouched. Root should map provider step intents into the existing exact PreparedAction interface, with one durable operation and customer approval per step, never automatically signing later legs. Frozen provider step input is `PeridotStepIntent`; all raw token amounts/position IDs are canonical strings. Persist parent workflow/wallet/customer/tenant, approved market/policy/pins, direction/leverage, original principal cap, selected receipt amount, latest verified position ID, each child operation/hash/state evidence, pending expiry and recovery action. Every prepare rechecks Testnet pins/full relevant code, current source sequence, oracle≤5% and freshness, user ownership, allowed phase, balances, receipts and liquidity; each signed check re-simulates enforce and requires exact original/canonical/enforced/signed auth/footprint/archive bytes and ≤fee cap.

- **Setup funding**: direct pinned Aquarius native→MockUSDT, separate QA-only `qa_funding` purpose≤10XLM, fresh ceil99.5% minimum. No customer capability follows merely from this QA action.
- **Vault deposit**: `deposit(user,underlyingu128)` exact underlying≤1MockUSDT in revised QA. Auth root+one MockUSDT.transfer(user,vault,inputi128). Verify actual underlying decrease and new receipt increase, current exchange rate (not metadata decimal scaling). Cold restore exception only reviewed pinned keys≤8XLM. Tested actual first-user own HasBorrowed initialization.
- **Margin transfer (review pending)**: `transfer_spot_to_margin(user,MockUSDT,receiptu128)`. Exactly deposited unallocated receipts, live receipt*rate/1e6≤1MockUSDT; receipt wallet balance sufficient. Auth root+one receipt-vault.transfer(user,margin,receipti128). Frozen transfer-scope.json allows owner substitution only; no restoration; exact7RW keys, including provider-internal MarginWithdrawBypassV2(user) used by the canonical receipt transfer. Verify wallet receipt decrease and controller margin-receipt increase by identical amount. Unsigned exact warm preparation maxfee0.0567666XLM passed; not yet submitted.
- **Begin open (unsigned behavior observed, inspector pending)**: `begin_open_position_v3` as canonical builder; verify unreserved margin receipts,2×Long QA cap, pool/oracle/liquidity, live quote minimum, fresh counter→nextposition ID. Unsigned aligned-pool public-owner simulation succeeds with one root auth and no children, returns hypothetical13843 (not an executed Grapnel position). It writes only exact new-position/controller reservation/index fields and debt-vault MarginHasBorrowed(nextID); all fields/pins must be reviewed in its own frozen manifest. Successful chain result must match independently read nextposition owner/PendingOpen/base/quote/side/amount/pool/deadline. Never prepare swap before confirming this.
- **Open swap**: exact(user,positionID); only owner PendingOpen, before expiry, no existing execution output; inspect every real observed child/value/scope before approval. Require confirmed output balance+pending execution delta.
- **Activate**: exact(user,positionID); owner PendingOpen with confirmed swap output, before expiry. Verify actual Open position, receipt collateral, nonzero matching debt, perps data and user positions after confirmation.
- **Prepare close**: owner Open position, real remaining collateral/debt; exact(user,ID). Validate confirmed Closing and pending-close amount/deadline.
- **Close swap**: side-specific canonical call; owner Closing, before expiry, no prior received-debt output; exact slippage/amount/recipient review. Confirm debt-asset output in pending close, never reswap after output.
- **Finish close**: deployed ABI `finish_close_position_v3(ID)` has no user argument. Must independently establish exact owner binding and Closing/output state before this owner-signed transaction; no generic ownerless finish permitted. Confirm zero/repaid debt, terminal status and actual margin receipt proceeds.
- **Margin return/vault withdraw**: exact verified unreserved recovered receipts, no open/pending debt using them; separately approved canonical calls. Confirm margin→wallet receipt movement, then receipt burn and actual underlying return. Only delete private QA recovery key once position/debt/margin recovery is verified.

No open/swap/activate/close execution proof or production durable customer Margin integration is claimed by this handoff.
