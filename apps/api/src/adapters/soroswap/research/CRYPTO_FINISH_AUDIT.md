# Crypto execution audit — November 11, 2026 local

Fresh unsigned customer-address preparation completed at `2026-11-12T03:12:19.977Z` (November 11 in Toronto). This is preparation evidence, **not a new transaction or customer execution claim**.

- Exact route: standalone Testnet BTC `CB7ICEHVRIRMF3CF6SIP2C2R3Z4E7WRPATT552QSVLIXZ5RSN6KLUDAE` → native XLM SAC `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`, through the pinned direct Soroswap pair.
- Exact input: `0.0000100` BTC (100 atomic). The provider still overestimates tiny-input output because of its fractional fee calculation. The existing reviewed router-view correction produced expected output `0.2528013` XLM and a strict 50bps minimum `0.2515373` before customer approval.
- Actual read-only router view succeeded at ledger `5685898`, with no authorization. Unsigned swap and canonical enforce simulations succeeded at ledger `5685899` with the one inspected source-account authorization.
- Canonical maximum fee: `121369` stroops (`0.0121369` XLM); footprint 6 read-only / 5 read-write keys; 3,591,981 instruction allowance; zero signatures. No transaction was signed or broadcast. The recorded approval has expired and must never be reused.
- Sanitized provider requests, fresh exact quote, simulations and unsigned canonical envelope are in `latest-integer-quote-readonly-inspection.json`. Credentials and headers are absent; `tx_hash` remains null.

All 93 focused adapter/Spot tests passed across nine files:

```sh
pnpm exec vitest run apps/api/src/adapters/soroswap apps/api/src/modules/spot
```

No new reverse-route defect was reproduced, so no speculative change to its financial guards was made. The existing catalog remains seven verified identities and twelve independently inspected direct native-XLM directions. Mainnet asset-list entries and nonnative-to-nonnative routes remain excluded because no inspected Testnet build supports them. Each additional direction still needs its own actual customer execution and reconciled balance proof before being labelled execution-verified.

Customer acceptance: select BTC → XLM, enter `0.0000100` BTC, request a fresh quote, review the output/minimum and approve the newly prepared transaction. Record its actual operation/hash and confirmed BTC debit plus XLM credit/fee separately. Do not reuse this diagnostic envelope or treat the simulations as settlement.
