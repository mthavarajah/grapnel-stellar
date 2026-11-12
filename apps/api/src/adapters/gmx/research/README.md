# GMX Arbitrum Sepolia fallback feasibility — November 12, 2026

Research only. No venue switch, frontend integration, funding transaction, approval, order or deployment was performed. `ownExecutionProof` is null. Permission simulation must not be described as an executed mint.

## Finding

GMX has a currently operating Testnet perps venue on Arbitrum Sepolia, chain421614. A fresh EVM EOA is not subject to HyperCore's existing-mainnet-account prerequisite at the protocol calls examined. A Privy-created Ethereum wallet can use the usual EVM signing flow. A complete new-account funding/trading flow is **not yet verified**, because native gas-faucet eligibility and an actual customer open/close remain untested.

## Actual read-only chain observations

Read from the [official public RPC](https://docs.arbitrum.io/chain-info) at block328592441, timestamp1794510223. Full sanitized data is in `2026-11-12-evidence.json`.

- Ten markets returned from Reader.getMarkets(DataStore,0,100).
- All ten use short collateral `0x3253a335E7bFfB4790Aa4C25C4250d206E9b9773`, six decimals, onchain symbol/name USDC. The [GMX frontend token registry](https://github.com/gmx-io/gmx-interface/blob/master/sdk/src/configs/tokens.ts) classifies it **USDC.SG**, separate from USDC GMX at `0x3321Fd36aEaB0d5CdfD26f4A3A93E2D2aAcCB99f`. Neither token should be substituted for Circle-issued USDC or Stellar USDC.
- USDC.SG balances held at ETH and BTC market addresses were respectively50445532398099 and1816029876307 base units (50,445,532.398099 and1,816,029.876307 tokens). These are actual custody balances; they are not exact available risk capacity or an advertised customer balance. Last three markets had zero USDC.SG custody balances.
- Read-only `eth_call` of USDC.SG.mint(freshAddress,100000000) succeeded without revert from a random address with transaction count0 and native balance0. This shows the examined mint path does not require a preexisting role/mainnet state; it did not mint anything. Native ETH is still required for a real transaction.
- Live successful [keeper execution transaction](https://sepolia.arbiscan.io/tx/0x13abf88cce93d7a7a82e597a1e705578a74e2b24038d32fd0bf354c5c87778b8), block328591682, emitted PositionDecrease and OrderExecuted through the pinned EventEmitter. It closed another user's BTC short: sizeDeltaUsd500×10^30, collateralTokenUSDC.SG, and final size0. This proves contemporary keeper activity; it is not Grapnel acceptance evidence.

## Registry mismatch requiring resolution before signing

The [published GMX deployment page](https://docs.gmx.io/docs/api/contracts/addresses/) and its `updates` deployment manifest list ExchangeRouter `0x6B489dD5bB1AAE8df246359d59aA7316760a75d2` / Reader `0x92659fEf40582ceCC3CBa4D096d28291C238D358`. Those were used for market discovery.

However, the actually served [official Testnet frontend](https://test.gmx-interface.pages.dev/) bootstrap and [current frontend contract source](https://github.com/gmx-io/gmx-interface/blob/master/sdk/src/configs/contracts.ts) use ExchangeRouter `0x3Fb6d5429612588510341eA60AacC282dB264295` / Reader `0x1543f5e73b9d329d7DE25ADC98120F13D29bC53b`. Both newer addresses have deployed code. Permanent DataStore `0xCF4c2C4c53157BcC01A596e3788fFF69cBBCD201` and EventEmitter `0xa973c2692C1556E1a3d478e745e9a75624AEDc73` agree. Do not silently mix ABI/router generations; verify active router handlers/roles and exact createOrder calldata before offering signatures.

## Free gas options, with limits stated honestly

- [Alchemy Arbitrum Sepolia faucet](https://www.alchemy.com/faucets/arbitrum-sepolia) advertises0.1ETH/24h but explicitly requires0.001ETH and sufficient Ethereum mainnet activity. It does not solve fresh-wallet funding.
- [ethfaucet.com Arbitrum Sepolia](https://ethfaucet.com/networks/arbitrum/arbitrum-sepolia), listed by Arbitrum's official chain-info page, advertises0.1ETH/24h using BringID verification. Its page does not state a mainnet balance requirement. A claim was not attempted; eligibility remains unverified.
- [PK910 Sepolia PoW faucet](https://sepolia-faucet.pk910.de/), also listed by Arbitrum, funds Ethereum Sepolia after captcha/mining; a later transfer using the [official Arbitrum Testnet bridge](https://docs.arbitrum.io/arbitrum-bridge/quickstart) can provide ArbSepolia ETH. Current public faucet config shows captcha and PoW modules and a minimum claim0.05SepETH. No mining/claim/bridge was performed. Anti-abuse eligibility may still apply.

## Practical next gate

1. Bind the customer's exact Privy EVM wallet for chain421614 and obtain native Testnet ETH through a verified free route or an explicitly funded Testnet gas treasury.
2. Verify the active frontend router/handler registry, then explicitly authorize a bounded mint of the actual USDC.SG collateral. Reconcile its real Transfer and wallet balance change.
3. Implement exact collateral approval and GMX createOrder with a customer-reviewed execution fee. Persist raw signed transactions/nonces before one-use sends.
4. Prove keeper OrderExecuted, real position creation, reduce-only close, and returned collateral balance. Until those hashes and deltas exist, execution remains unverified.

This route uses Arbitrum Sepolia collateral directly. It does not transport, mirror, convert or spend Stellar USDC automatically. Any Stellar settlement path would need separate architecture and proof.
