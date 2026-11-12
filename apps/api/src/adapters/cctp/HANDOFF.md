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
