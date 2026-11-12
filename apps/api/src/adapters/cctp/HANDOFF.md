# CCTP Testnet registry and encoding handoff

Owned paths: `apps/api/src/adapters/cctp/**` only. No root contracts, routes, entitlements, database, UI, dependency or environment changes.

Implemented read-only calls:
- Stellar RPC `getNetwork` and `getLedgerEntries` for the three official CCTP instances and Circle USDC SAC. Check Testnet passphrase, instance TTL, exact observed WASM pins, transmitter domain27, messenger/forwarder contract links and Circle issuer/7-decimal metadata.
- HyperEVM Testnet RPC `eth_chainId`, `eth_getBlockByNumber`, `eth_getCode`, `eth_getStorageAt`, and `eth_call` for ERC20 `decimals()`, transmitter `localDomain()` and messenger `localMessageTransmitter()`. Reads use a single block, chain998, bounded responses and pinned host, observed proxy and EIP1967 implementation fingerprints, domain19, exact linked transmitter and six-decimal USDC. These bytecode fingerprints are observed identity pins, not source audits or proof of executable bridge permission.
- Exact bigint seven-to-six decimal conversion rejects any nonzero seventh decimal. Circle itself truncates that dust; this helper intentionally rejects silent changes to approved debits. Six-to-seven conversion checks signed i128 bounds.
- Strict EVM recipient bytes32 encoding and Stellar G-account return hook encoding, using the fixed official Testnet CctpForwarder as mint recipient/caller. Root must bind the final G address to the verified customer session; these are encoding helpers, not customer authorization.

Actual live observation: `research/testnet-registry-read.json`. Stellar ledger5686400, HyperEVM block0x422da4b. Registry identity checks passed. No wallet secret, signing, simulation, token approval, burn, mint, bridge deposit, trading call, account creation or mainnet request was made. `execution_status` stays `discovery_only`; transaction hash is null.

## Asset identity
Circle Stellar Testnet USDC issuer is `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`, SAC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`. It is NOT existing Blend/Soroswap demo USDC issuer `GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56`. Existing customer balances cannot be reused by symbol.

HyperEVM Testnet native Circle USDC is `0x2B3370eE501B4a559b57D449569354196457D8Ab`, six decimals. Domain19 is not EVM chain998. Perpetual trading occurs on HyperCore; a HyperEVM mint alone is not a tradable margin balance.

## Remaining execution blockers
1. Circle's official HyperCore guide says a Testnet recipient must already exist on HyperCore mainnet, may receive at most1000Testnet USDC, and absent mainnet-state recipients fail silently. Do not perform mainnet activation under this task. Root needs an already eligible Testnet recipient or provider-supported resolution. No mainnet state was queried here.
2. Account activation/outbound fees and destination gas must be included. `CoreDepositWallet.deposit(amount,destinationDex)` uses destinationDex0 for perps; plain ERC20 transfers to that contract are not deposits. HyperCore balances are protocol credits; native USDC remains in CoreDepositWallet. The return path must redeem then burn/mint/forward through the exact Stellar forwarder.
3. Registry reads do not prove current remote messenger/token mappings, pause/denylist permissions, mint capacity, Circle attestations, recipient eligibility, liquidity, or execution. Instance storage has MIGRATING=true; this observation alone is not interpreted as either ready or blocked. Any write integration requires reviewed ABI, exact intent/auth/fee inspection and full actual route proof.
4. No Ontario API eligibility assertion is made; the other provider-research task owns access terms. A successful public RPC read does not establish trading permission.
5. No private treasury credits may be presented as a canonical bridge transfer. Actual proof requires source burn, Circle message/nonce, destination mint/deposit, HyperCore fill/position, and reverse redemption/mint with exact balance changes.

## Validation
`pnpm exec vitest run apps/api/src/adapters/cctp/cctp.test.ts` (24 tests).
`pnpm --filter @grapnel/api typecheck`.
`pnpm exec tsx apps/api/src/adapters/cctp/research/probe-readonly.ts` refreshes public read-only evidence; default tests never use network.

## Primary sources
- https://developers.circle.com/cctp/concepts/supported-chains-and-domains
- https://developers.circle.com/cctp/references/stellar-contracts
- https://developers.circle.com/cctp/references/stellar
- https://developers.circle.com/stablecoins/usdc-contract-addresses
- https://developers.circle.com/cctp/references/contract-addresses
- https://developers.circle.com/cctp/references/hypercore-contract-addresses
- https://developers.circle.com/cctp/references/coredepositwallet-contract-interface
- https://developers.circle.com/cctp/concepts/cctp-on-hypercore
- https://developers.circle.com/cctp/howtos/transfer-usdc-from-hyperevm-to-hypercore

## Unsigned source burn extension

New `preparer.ts`/`inspector.ts` implement source burn preparation only. No signing, submission, approval, attestation mint or trading method exists.

The frozen request uses operation/customer context, exact Stellar atomic amount, EVM recipient, destinationDomain19, expiry and network fee ceiling. A **separate server-owned recipient binding reader** is mandatory and must match tenant, customer, wallet, source address, EVM recipient, HyperEVM Testnet and chain998. A request recipient alone never authorizes transfer. Root must return bindings only for independently verified/eligible destination accounts and retain its broader venue access gate.

Actual deployed WASM ABI was independently read at ledger5686988 (`research/burn-abi-read.json`). The eight-argument `deposit_for_burn` call fixes Circle USDC, domain19, exact trusted recipient bytes32, permissionless zero destination caller, zero USDC transfer fee and standard finality2000. The network fee ceiling is separate, at most1XLM. Any route requiring nonzero CCTP fee fails simulation; it is not silently deducted. Source snapshots and SHA256 hashes of relevant official files are in `burn-source-review.json`; this is ABI/source analysis, not a claimed reproducible deployed bytecode audit.

The code rejects precision loss and amounts above1000USDC. Auth must be exactly one source-account root matching all eight arguments, with no address nonce, extra signer or child invocation. The resource inspector rejects restores, extra contracts, governance/foreign balance/nonce writes, duplicate keys, excess fees and resources. It allows only source config reads and exact customer Circle USDC trustline, messenger allowance and messenger token balance writes. The source sequence, network, time bounds, memo, signing hash, summary and unsigned envelope are checked. Record and enforce simulations must agree on auth and footprint, fit the approved resources, and pass a final source sequence/expiry check before returning PreparedAction with `summary.action=perps.fund_cctp`.

**Actual current customer preflight remains blocked.** At ledger5687026 the CircleUSDC trustline is absent, the balance getter returns Contract#13 trustline-missing, and the exact allowance getter returns0. No burn transaction was prepared. `research/customer-burn-readiness.json` records public Horizon and unsigned getter observations, signatures0, no customer approval, broadcastfalse and tx_hashnull. Existing GATALT USDC cannot substitute for CircleUSDC. Circle `deposit_for_burn` requires a separate prior token allowance; this preparer never adds or bypasses approval. A real successful funded burn simulation/footprint remains an acceptance item; the happy-path transaction tests use explicit offline fixtures and do not prove execution.

Validation: `pnpm exec vitest run apps/api/src/adapters/cctp` now includes57 tests; API typecheck and secret scan pass. Root still needs exact trustline/allowance customer setup, server-owned binding/eligibility checks, fresh submission verification and the destination/return operation coordinator before any route is advertised executable.

## Customer-signed Circle USDC setup (unsigned preparers)

`setup.ts` exports `CctpUsdcSetupPreparer` with `readStatus(customer)`, `prepareTrustline({operationId,customer,expiresAt})`, and `prepareAllowance({operationId,customer,amountStellarAtomic,expiresAt,maxFeeStroops})`. `CircleUsdcSetupDependencies` accepts the pinned RPC reader, fetcher, clock, registry verifier, fresh status reader and mandatory `readSpendableXlm(customer,operationId): Promise<bigint>` reservation-adjusted native balance callback. Root must derive customer context from its verified tenant/session/wallet lookup and inject this callback before either setup action returns. The status response includes tenant/customer/wallet bindings so substituted cross-tenant status is rejected. Neither preparer authorizes a recipient binding or HyperCore eligibility.

The trustline action is exactly one **classic** `changeTrust`, Circle issuer only, fixed limit `1000.0000000`, fee 100 stroops, customer source, expiry ≤ 120 seconds, no memo/extra operation/signature. Root must reserve an additional 5000000 stroops of XLM plus the fee. This classic operation does not have a Soroban simulation: the preparer checks live issuer/registry, fresh account status, native budget and source sequence, then returns an unsigned action with `summary.action=perps.usdc_trustline`. The summary amount represents the trustline limit, not an asset debit.

After a funded authorized canonical trustline exists, the allowance action is exactly Circle SAC `approve(customer,fixedMessenger,exactAmount,latestLedger + 120)`. The amount is positive, ≤ 1000 USDC, and divisible by 10 Stellar atomic units to preserve the later six-decimal destination amount. This is a separate customer review/signature with `summary.action=perps.usdc_allowance`, `contractId=CircleSAC`, `recipient=fixedMessenger`, and shared `allowanceExpirationLedger`. Approval replaces the exact spender allowance; there is no infinite allowance or unlimited expiration. The ledger expiration is distinct from the ≤ 120 second transaction expiry and from the network fee ≤ 1 XLM. Record and enforce simulations must match the exact source-account root authorization (no nonce or child auth), canonical temporary allowance write, contract/config reads, footprint/resources and sequence; restores or foreign writes fail closed. Actual canonical spendable balance must already cover the exact allowance amount. Root must continue to apply reservation and intent checks at signing/submission.

`setup-inspection.ts` is pure SDK/contracts/registry code, with no Node private APIs or network calls. Root can port `inspectCircleSetupPrepared(action,transaction,{customerId,walletAddress,expectedSequence,currentLedger,now})` into the browser signer. Pass the current ledger for bounded approval freshness. It also exports operation/footprint inspectors, fixed action/asset/limit constants, and exact allowance operation builder. The shared contracts version 0.3.1 optional `summary.allowanceExpirationLedger` was frozen by root in 0ab513a.

Actual public-wallet read-only evidence at ledger 5687685 is in `research/customer-setup-readiness.json`: Circle trustline absent, canonical wallet balance null, messenger allowance 0. The public native balance is explicitly **before reservations** and is not permission to spend. No setup transaction was prepared or signed. No trustline, approval, faucet request, burn or broadcast was performed; tx_hash remains null. `research/probe-setup-readonly.ts` refreshes these reads without pretending its public evidence labels are authenticated application customer IDs.

Official faucet: https://faucet.circle.com/ currently lists **Stellar Testnet**, with a 20 USDC grant every 2 hours per address/network and a reCAPTCHA flow. The customer first needs the exact Circle trustline; the existing GATALT USDC balance cannot substitute. No faucet request was made by this agent. Source: the official Circle faucet page, checked 2026-11-12. Root should link or guide the customer through that provider page, rather than inventing funded balances or bypassing its controls.

Validation: 84 CCTP tests (27 setup tests plus 57 existing adapter tests); API TypeScript check. These tests use explicit offline simulations. A successful actual funded allowance simulation and all source/destination/return execution proofs remain outstanding.

## Actual source and Core proof readers — November 12 refresh

`source-proof.ts` exports `CctpSourceBurnReader`. Its mandatory trusted `readPreparedBurn(request, sourceHash)` callback loads the immutable persisted `{request:CctpBurnRequest, prepared:PreparedAction}` through the full tenant/customer/wallet scope. The reader independently checks successful Stellar Testnet transaction/result, exact approved envelope hash/body/auth, source ledger and the one real `message_sent` event from the pinned transmitter's transaction metadata. Diagnostic events, Iris decoded metadata and a caller-supplied success flag never constitute source proof. Source messages must have Circle's initial zero nonce/executed-finality/fee/expiration fields; the later attestation is checked separately against source-committed immutable fields by the existing destination preparer. A successful attestation response still needs onchain receiveMessage simulation and actual mint receipt.

The deployed transmitter's embedded event specification was read at ledger 5697003 (subsequent refresh recorded in `research/source-event-read.json`): topic `message_sent`, map data with one `message:Bytes` entry. WASM/code pins matched. This is deployed ABI evidence, not a claim of a real customer burn or a reproducible source build.

`core-proof.ts` exports `readHyperCoreEligibility`, `readHyperCoreBaseline` and `confirmHyperCoreCredit`. The eligibility helper makes only the explicitly authorized public mainnet `userRole` READ; user role establishes preexisting mainnet state, while missing/agent/vault/failed reads do not. It never activates or funds mainnet. **This evidence alone is insufficient to authorize source burn.**

The baseline `{accountAddress, rawUsdAtomic6, observedAt}` must be durably captured before customer Core deposit approval/signing. Core confirmation requires the exact scoped confirmed EVM deposit/block, one real matching Testnet ledger deposit, actual ledger hash equal to the verified EVM deposit hash, matching amount, and an exact change in actual `totalRawUsd`. Existing balance, matching date/amount alone, unrelated hashes, duplicates, concurrent ledger activity, and missing proof fail closed. SDK 0.33.3 describes that ledger hash as a HyperCore L1 hash without documenting its relationship to the EVM deposit hash. **Actual matching correlation remains an acceptance prerequisite**; if the provider returns a distinct L1 hash, the route remains blocked until an independent source-backed linkage is reviewed. Never relabel an EVM hash as a Core hash. Raw cash precision beyond six nonzero decimal places is rejected rather than rounded.

`confirmDestinationMint` now additionally reads the actual EVM transaction, checks its exact receiveMessage message input and zero native value, canonical receipt block, actual mint/message events and exact historical canonical-USDC balance delta. An excess coincident balance change cannot be assigned to this customer intent.

### Hard pre-burn capacity blocker

Current [Circle HyperCore documentation](https://developers.circle.com/cctp/concepts/cctp-on-hypercore) still requires existing mainnet state and describes a $1,000 Testnet receive limit; missing-mainnet-state transfers fail silently. The wording does not establish whether the cap is per transfer, cumulative, or resettable. The official Hyperliquid info schemas expose no verified remaining-receive-capacity field. A truncated ledger or a missing Testnet user role does not prove unused lifetime headroom. **Keep source burn blocked with `CCTP_TESTNET_RECEIVE_CAPACITY_UNVERIFIED` until actual provider-supported headroom is established.** The per-transfer amount ceiling in existing preparers is an additional bound, not proof of receive capacity.

The [official Testnet faucet](https://hyperliquid.gitbook.io/hyperliquid-docs/onboarding/testnet-faucet) also requires a previous mainnet deposit by the same address. No documented official Testnet-only activation alternative was found. Mainnet activation/deposit remains unauthorized. Circle documents no minimum Core deposit, but a new account's first outbound action needs at least 1 USDC for the activation charge; that charge and any other actual fees must be approved and reserved before promising a full return.

Fresh public registry checks passed at Stellar ledger 5696959 and HyperEVM block 0x423ab9f; `research/testnet-registry-read.json` records exact latest observations. No source burn, attestation, customer mint, Core deposit, trade, return or signing was performed. Financial evidence remains null. All 165 CCTP tests pass using explicit offline fixtures, and API TypeScript checks pass. Root owns scope persistence, exact customer Privy approvals, nonce/send claims, pre-burn capacity/access/gas gates, and full workflow integration.
