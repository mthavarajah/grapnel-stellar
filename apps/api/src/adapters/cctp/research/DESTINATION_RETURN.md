# Unsigned CCTP destination and return integration

Owned new adapter files only: `destination.ts`, `return.ts`, `destination.test.ts`, and this research directory. No routes, schema, migrations, runtime signer, UI, dependencies or entitlement changes. No deployment or financial writes.

## Exported integration surface

`CctpDestinationPreparer(dependencies)` exposes:

- `prepareMint(request, stellarSourceTxHash)` — one sandbox Iris read, strict raw V2 header/body decoding and source-event comparison, unsigned HyperEVM `receiveMessage`.
- `prepareCoreApproval(request)` — exact native Circle USDC approval to the pinned CoreDepositWallet, only after a persisted separately confirmed destination mint.
- `prepareCoreDeposit(request)` — exact `deposit(amount,0)`, only after the native balance and exact allowance match. A direct ERC20 transfer is never substituted.

`CctpEvmRequest` contains `{operationId, customer:CustomerContext, evmAccount, amountCctpAtomic, expiresAt, maxGas, maxFeePerGasWei, maxPriorityFeePerGasWei, maxTotalFeeWei}`. All amounts and fee quantities are decimal integer strings; the USDC amount is six-decimal atomic units, positive and at most 1000 USDC. Transaction lifetime is at most 120 seconds at review; maximum gas is 3 million, gas price 1000 gwei, total fee 1 HYPE. Lower caller limits remain effective. Native USDC bridge fees are fixed at zero and standard finality at 2000. A provider requiring any nonzero bridge fee fails the unsigned chain simulation rather than silently deducting it.

Dependencies are injected public-read transport/fetcher/clock, optional registry verifier, and **trusted server readers** `readBinding`, `readEligibility`, `readSourceBurn`, `readMintProof`. No browser flags can supply these proofs. The binding matches business/customer/wallet/Stellar address/EVM account/chain998. Eligibility must explicitly establish the preexisting HyperCore mainnet state required by Circle's Testnet guide; unknown or absent state fails closed. This adapter performs no mainnet read or activation. Source proof must include the actual confirmed Stellar source event `sourceMessageHex`, ledger, source transaction hash, exact amount and tenant/customer bindings. The attested message may change Circle-filled nonce/finality/fee/expiration fields but must preserve every source-committed immutable field, including caller, domains, token, amount and recipient.

Unsigned EVM actions contain no signature. `inspectUnsignedCctpEvmAction(action, {...callIntent, expectedNonce}, now)` checks the fixed per-stage target/calldata, exact trusted nonce, chain998, sender, zero native value, customer context, amount, source/message linkage, EIP1559 fields, fee limits, expiry and recomputed signing digest. The preparer performs `eth_call` and `eth_estimateGas`, verifies HYPE gas and latest/pending nonce equality, pads estimated gas by 20%, and rechecks nonce before returning. The default transport refuses all RPC methods outside its read/simulation allowlist. Root must persist the original digest, hold its wallet/nonce lock, and repeat review and fee/reservation checks immediately before signing/submitting. A prepared action is not permission to spend and not execution evidence.

`confirmDestinationMint(request, sourceHash, decodedMessage, destinationHash, readTransport)` separately reads a successful destination receipt, its canonical block with two confirmations, exactly matching MessageReceived/USDC mint logs and historical token balances. Its return includes **both distinct hashes**, message hash/nonce, block hash and before/after balances. No destination proof is inferred from a source hash or Iris `complete` status.

`confirmCoreDepositTransfer(request, mintProof, depositHash, readTransport)` verifies the exact deposit transaction/input/source, successful canonical receipt, one matching USDC transfer to CoreDepositWallet and exact historical wallet debit. It returns `evmDepositConfirmed:true` but **`hyperCoreCreditConfirmed:false` and `execution_status:blocked`**. Root must reconcile the actual matching HyperCore ledger credit before calling the account funded or allowing trading. A deposit receipt alone cannot prove tradable margin.

## Return integration

`prepareUnsignedCoreWithdrawal(request, binding, eligibility, withdrawableProof, now)` and `inspectUnsignedCoreWithdrawal(...)` implement Circle's published HyperCore `sendAsset` EIP712 schema. The fixed route is Testnet, same bound EVM account, USDC system address `0x2000000000000000000000000000000000000000`, source perps DEX `""`, destination `"spot"`, main account only, exact amount. The root-owned withdrawable proof is tenant-bound and fresh within 15 seconds, with no open orders or positions. Nonce is a millisecond timestamp within 5 seconds of review. Root must allocate that nonce durably, enforce one operation per nonce, authorize the exact typed data with the customer, and reconcile provider ledger plus native USDC credit; exchange `OK` is not credit proof.

**Expiry limitation:** neither standard EIP1559 transactions nor HyperCore's official SendAsset typed schema signs an expiry/deadline. Both return `expiryEnforcement:application_only`. Root must not claim the network automatically invalidates an already signed action at the UI expiry. It must prevent delayed signing/submission and manage nonce/replay safely; do not silently add unsigned fields to the provider's schema.

`CctpReturnPreparer(dependencies)` exposes `prepareReturnApproval(request)` and `prepareReturnBurn(request)`. It additionally requires `readWithdrawalProof` (actual HyperCore ledger and HyperEVM native-USDC balance credit) and `readStellarReceiveCapacity` (fresh authorized **canonical Circle** trustline, sufficient remaining limit after balance/buying liabilities, exact tenant/customer/wallet identity). The burn uses `depositForBurnWithHook(amount,27,pinnedForwarder,canonicalNativeUsdc,pinnedForwarder,0,2000,hook)` and exact prior allowance. Neither a Mock token nor existing GATALT USDC can substitute.

The Stellar hook is explicitly established by Circle's docs and published source: 24 zero magic bytes, uint32 version0, uint32 length56, then the full UTF8 `G...` string; no integrator trailing bytes. Both mintRecipient and destinationCaller are raw32 bytes of the **C... forwarder contract ID**, never the G public key. `inspectEvmToStellarMessage` checks raw message and hook against the exact customer wallet. `buildStellarMintAndForwardOperation(attestation,request)` builds the ABI-proven `mint_and_forward(Bytes,Bytes)` operation only. It deliberately does **not** return PreparedAction: actual funded return simulation/authorization/footprint/resource inspection is still missing. `CCTP_RETURN_UNPROVEN_STAGE` keeps this stage blocked. Root must verify the actual return source event, Circle attestation, full Soroban record/enforce tree/footprint and final canonical USDC G-wallet delta before completion.

## Actual evidence and remaining blockers

`destination-return-read.json`: verified HyperEVM Testnet block `0x42372e3` and Stellar ledger `5694102`, registry/proxy/implementation pins unchanged; downloaded deployed forwarder WASM hash matches and its embedded ABI is exactly `mint_and_forward(message:Bytes,attestation:Bytes)`. Official source files are pinned with SHA256 hashes. This is not a claimed reproducible source-to-deployed-bytecode audit. `probe-destination-readonly.ts` refreshes public configuration/code only.

No funded eligible HyperCore account was supplied. No actual source burn hash or attestation was available. No receiveMessage, token approval, Core deposit, withdrawal, return burn or Stellar mint was signed/submitted. All financial evidence hashes remain null. Actual Core ledger correlation and actual return Soroban scope remain acceptance blockers. Happy-path tests are explicit offline fixtures, never execution evidence.

Validation: 124 CCTP tests (40 destination/return plus 84 existing), API TypeScript check, staged diff/secret checks.

## Primary sources

- https://developers.circle.com/cctp/references/technical-guide
- https://developers.circle.com/api-reference/cctp/all/get-messages-v2
- https://developers.circle.com/cctp/references/contract-interfaces
- https://developers.circle.com/cctp/references/contract-addresses
- https://developers.circle.com/cctp/references/coredepositwallet-contract-interface
- https://developers.circle.com/cctp/howtos/transfer-usdc-from-hyperevm-to-hypercore
- https://developers.circle.com/cctp/howtos/withdraw-usdc-from-hypercore-to-hyperevm
- https://developers.circle.com/cctp/concepts/cctp-on-hypercore
- https://developers.circle.com/cctp/references/stellar
- https://github.com/circlefin/evm-cctp-contracts/tree/63ab1f0ac06ce0793c0bbfbb8d09816bc211386d
- https://github.com/circlefin/stellar-cctp/tree/45746f2c803198bc6cd586475eb3c925f12bb488
- https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm
