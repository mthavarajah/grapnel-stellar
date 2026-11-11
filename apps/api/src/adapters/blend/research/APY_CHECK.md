# XLM Testnet variable APY check

Observed 2026-11-11T03:47:25.954Z, official TestnetV2 pool metadata ledger 5669040. Full raw and SDK-accrued values are in `apy-check.json`. All calls were read-only; no signer or broadcast was used.

The displayed **582.62%** matches the current SDK estimate. There is no factor-of-100 formatting bug: the adapter passes `reserve.estSupplyApy` unchanged and the fintech uses `Intl.NumberFormat` with `style: 'percent'` once.

- Supply APR fraction: `1.9566814` = 195.66814% APR.
- Estimated supply APY fraction: `(1 + 1.9566814 / 52) ** 52 - 1 = 5.826186057257479`.
- Percentage formatting: `582.62%`.
- Borrow APR fraction: `2.29432` = 229.432%.
- Raw utilization: 94.75969%, above the reserve's 50% target.
- Raw interest rate modifier: `100000000`, seven decimals = 10×, the SDK's maximum modifier.
- Backstop take rate: `1000000`, seven decimals = 10%.

These inputs explain the large current estimate. The SDK derives borrow interest from the utilization curve and interest rate modifier, then supplier APR from borrower APR, utilization and the share remaining after the backstop take. Its supplier APY assumes weekly compounding.

`PoolV2.load` also locally accrues reserve state from the onchain `last_time` (03:09:43Z here) to the read time. The captured raw utilization and locally accrued utilization therefore differ slightly. The rate calculation precedes that local accrual step. This estimation does not write ledger state or create customer earnings. The figure is an estimate from Testnet conditions and should never be presented as fixed, guaranteed, mainnet yield or earnings already received. Dividing it by 100 again would incorrectly display 5.83%.

Primary implementation source: [Blend SDK reserve.ts](https://github.com/blend-capital/blend-sdk-js/blob/main/src/pool/reserve.ts), `setRates`, `accrue`, and `ReserveV2` scaling; installed official SDK 4.0.0 matches the weekly-compounding formula. Exact live pool/token identities came from the [official Testnet registry](https://raw.githubusercontent.com/blend-capital/blend-utils/main/testnet.contracts.json).
