# Independent Blend Testnet rate and customer-interest verification

Observed **2026-11-11T18:56:36.195Z**, raw ledger **5679950**. Read-only RPC, official registry, public wallet position, and an explicit PostgreSQL `BEGIN READ ONLY` customer-bound history read. No new customer action preparation, signing, submission, or operation creation. The existing earnings validator reconstructs canonical operation bytes locally to check already-completed signed history. Script typecheck passes and actual live run succeeds.

Run `pnpm exec tsx scripts/verify-blend-rates-readonly.ts --customer-history`. The optional history flag uses the authorized local `DATABASE_URL`; omit it for public rate/position reads. Output contains public asset/rate/position/transaction evidence and no secrets or authentication tokens. Errors print fixed stage/code only.

## Rate conclusion

The displayed **12.97% USDC APY is correctly calculated from this Testnet pool**. It is neither a fixed promised return nor an individual's already-earned annual return. XLM's extreme **584.77%** estimate is likewise the actual current Testnet reserve math. Do not replace either with invented lower numbers or imply mainnet investment returns.

| Input | USDC | XLM |
|---|---:|---:|
| Borrow APR ratio | 0.1516387 | 2.296793 |
| Utilization | 89.46996% | 94.81534% |
| Backstop share of borrower interest | 10% | 10% |
| Supplier APR ratio | 0.1221039 | 1.9599407 |
| Supplier APR percent | 12.21039% | 195.99407% |
| SDK weekly-compounded APY ratio | 0.12970977648927318 | 5.847660885286026 |
| UI APY percent | 12.970977648927317% | 584.7660885286026% |

SDK 4.0.0 `Reserve.setRates` computes supplier APR using integer floor rounding of `borrowAPR × utilization × (1 − backstopTakeRate)`. It estimates supply APY as `(1 + supplierAPR / 52)^52 − 1`. API ratio-to-percent conversion is multiplication by 100, not division by number of suppliers. The script independently replays the piecewise borrow-interest model with bigint arithmetic and asserts exact borrow/supply APR and APY equality with the SDK. This excludes separate BLND emissions and any invented bonuses.

## Individual wallet

Public wallet `GB4PC65ZHBPVEZMAHY2K2KYMS3RFBIN2FQIE3LGTLEHT2DEWVMTD7JYQ`; pool `CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF`.

| State | USDC | XLM |
|---|---:|---:|
| Current SDK-accrued underlying position | 4.0001156 | 0.0502838 |
| Outstanding borrowed | 0.0000000 | 0.0000000 |
| Verified net earned tokens | 0.0001156 | 0.0002838 |
| Earnings accounting starts UTC | 2026-11-11 16:51:45.038 | 2026-11-11 04:30:11.117 |
| User bTokens atomic | 37601290 | 186083 |
| Reserve bSupply atomic | 1506190145639 | 529055796160653 |
| Raw onchain bRate | 1063823081636 | 2701911292073 |
| SDK projected bRate at read time | 1063824057842 | 2702229000384 |
| Raw reserve last accrual UTC | 18:52:38 | 18:25:03 |

bRate has 12 decimals for v2. Underlying atomic amount = floor(bTokens × bRate / 10^12). The wallet owns the stated fraction of reserve bSupply; every supplier's bTokens participate proportionately in the same bRate growth. The wallet's APY is not the reserve APY divided among all users. There is no borrower-interest subtraction for this wallet because its liabilities are zero.

**Observed vs projected:** raw onchain bRate updates on contract interactions; SDK locally accrues the reserve to the read timestamp. The current position and earnings reader use that SDK-accrued underlying position. Thus earned amounts are verified-flow accounting plus currently accrued, unrealized interest, not a claim of newly withdrawn tokens or a separate onchain accrual transaction. Two read-only audits ~44 seconds apart showed unchanged committed raw bRates but SDK-accrued USDC position 4.0001150 → 4.0001156 and XLM 0.0502837 → 0.0502838. No interaction was submitted to force accrual.

For an explicitly **hypothetical one-day constant-state projection**, SDK accrual from each raw reserve's lastTime gives ~0.0013381 USDC on this wallet's ~4 USDC and ~0.0002700 XLM on ~0.05028 XLM. These are estimates, not observations of a full day. Per one underlying token the simple APR daily fractions are 0.0003345312 USDC and 0.0053697005 XLM. Actual future rates and rounding can change; a year's realized yield cannot be verified from hours of exposure with intervening deposits/withdrawals.

`LendingEarningsReader` validates customer/tenant/wallet binding, completed operation intent/signature/proof, matching public Horizon history and freshness. Accounting is current collateral + completed withdrawals − completed supplies − initial baseline. It returns null instead of inventing earnings if proof/history is incomplete. The XLM 0.05 withdrawal is included; comparing current balance only to the original 0.1 deposit would falsely report a loss.

## Existing confirmed flow evidence

- [XLM supply 0.1](https://stellar.expert/explorer/testnet/tx/eed88945a8c1327f260a1808136d3c3e8c2dd2f62607628fe8ce95d04d54af35)
- [XLM withdrawal 0.05](https://stellar.expert/explorer/testnet/tx/c5483ff9c241eb8f9449c32f1cb5556f6d4071df82474e754bc9bd298ba0c268)
- [USDC supply 4](https://stellar.expert/explorer/testnet/tx/1ad63c4281c7fd6a730a914c6f182beb60b6a9872103882b4a9506caa572a09a)

USDC identity is the Testnet classic issuer `GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56`, SAC `CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU`; XLM SAC `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`. Script verifies token asset-to-contract mapping and explicit Testnet passphrase; it does not infer identity from ticker.

## Official sources

- [Official SDK reserve source, setRates and accrue](https://github.com/blend-capital/blend-sdk-js/blob/main/src/pool/reserve.ts); installed implementation independently checked at npm version **4.0.0** (script fails on a different version).
- [Official v2 reserve contract: interest accrual and bRate](https://github.com/blend-capital/blend-contracts-v2/blob/main/pool/src/pool/reserve.rs).
- [Official v2 interest model](https://github.com/blend-capital/blend-contracts-v2/blob/main/pool/src/pool/interest.rs).
- [Official protocol-token documentation](https://docs.blend.capital/tech-docs/core-contracts/lending-pool/protocol-tokens).
- [Official v2 whitepaper: interest sharing and lending assets](https://github.com/blend-capital/docs-v2/blob/main/blend-whitepaper.md).
- [Official Testnet deployment registry](https://raw.githubusercontent.com/blend-capital/blend-utils/main/testnet.contracts.json).

## Sanitized raw audit output

This is a timestamped snapshot, not a replacement for future live reads.

```json
{
  "observed_at": "2026-11-11T18:56:36.195Z",
  "mode": "read_only_no_signing_no_broadcast",
  "network": "stellar-testnet",
  "sdk_version": "4.0.0",
  "pool_contract_id": "CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF",
  "wallet_address": "GB4PC65ZHBPVEZMAHY2K2KYMS3RFBIN2FQIE3LGTLEHT2DEWVMTD7JYQ",
  "rates": [
    {
      "symbol": "XLM",
      "asset_id": "stellar-testnet:native:XLM",
      "reserve_contract_id": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      "raw_ledger": 5679950,
      "raw_reserve_last_time": "2026-11-11T18:25:03.000Z",
      "raw_data": {
        "dRate": "3678750196978",
        "bRate": "2701911292073",
        "interestRateModifier": "100000000",
        "dSupply": "368426503257758",
        "bSupply": "529055796160653",
        "backstopCredit": "43538329607023",
        "lastTime": 1794421503
      },
      "raw_config": {
        "index": 0,
        "decimals": 7,
        "c_factor": 9000000,
        "l_factor": 9000000,
        "util": 5000000,
        "max_util": 9500000,
        "r_base": 5000,
        "r_one": 300000,
        "r_two": 2000000,
        "r_three": 10000000,
        "reactivity": 50,
        "supply_cap": "170141183460469231731687303715884105727",
        "enabled": true
      },
      "utilization_atomic": "9481534",
      "backstop_take_rate_atomic": "1000000",
      "independent": {
        "borrow_apr_atomic": "22967930",
        "supply_apr_atomic": "19599407",
        "borrow_apr": 2.296793,
        "supply_apr": 1.9599407,
        "apy": 5.847660885286026
      },
      "raw_sdk": {
        "borrow_apr": 2.296793,
        "supply_apr": 1.9599407,
        "estimated_supply_apy": 5.847660885286026,
        "ui_percent": 584.7660885286026
      },
      "current_sdk_projection": {
        "type": "SDK_projection_to_read_time_not_committed_raw_bRate",
        "borrow_apr": 2.296793,
        "supply_apr": 1.9599407,
        "estimated_supply_apy": 5.847660885286026,
        "ui_percent": 584.7660885286026,
        "b_rate": "2702229000384",
        "as_of": "2026-11-11T18:56:35.000Z"
      },
      "position": {
        "market_id": "stellar-testnet:blend:CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF:CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
        "pool_contract_id": "CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF",
        "reserve_contract_id": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
        "asset_id": "stellar-testnet:native:XLM",
        "supplied": "0.0502838",
        "collateral": "0.0502838",
        "borrowed": "0.0000000",
        "wallet_spendable": false,
        "supply_apy_variable": 5.847660885286026,
        "health_factor": null,
        "as_of_ledger": 5679950,
        "as_of": "2026-11-11T18:56:35.545Z",
        "readiness": "discovery_only"
      },
      "b_tokens": "186083",
      "user_share_of_b_supply": {
        "numerator": "186083",
        "denominator": "529055796160653"
      },
      "daily_constant_state_projection": {
        "type": "estimate_not_observed_interest",
        "from": "2026-11-11T18:25:03.000Z",
        "to": "2026-11-12T18:25:03.000Z",
        "b_rate_before": "2701911292073",
        "b_rate_after": "2716419747728",
        "per_one_underlying_apr_fraction": 0.0053697005479452055,
        "user_underlying_before": "0.0502779",
        "user_underlying_after": "0.0505479",
        "user_interest": "0.0002700"
      }
    },
    {
      "symbol": "USDC",
      "asset_id": "stellar-testnet:classic:USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56",
      "reserve_contract_id": "CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU",
      "raw_ledger": 5679950,
      "raw_reserve_last_time": "2026-11-11T18:52:38.000Z",
      "raw_data": {
        "dRate": "1079831710987",
        "bRate": "1063823081636",
        "interestRateModifier": "13991403",
        "dSupply": "1327609537705",
        "bSupply": "1506190145639",
        "backstopCredit": "2617610910",
        "lastTime": 1794423158
      },
      "raw_config": {
        "index": 3,
        "decimals": 7,
        "c_factor": 9500000,
        "l_factor": 9500000,
        "util": 7000000,
        "max_util": 9500000,
        "r_base": 5000,
        "r_one": 300000,
        "r_two": 1000000,
        "r_three": 10000000,
        "reactivity": 20,
        "supply_cap": "170141183460469231731687303715884105727",
        "enabled": true
      },
      "utilization_atomic": "8946996",
      "backstop_take_rate_atomic": "1000000",
      "independent": {
        "borrow_apr_atomic": "1516387",
        "supply_apr_atomic": "1221039",
        "borrow_apr": 0.1516387,
        "supply_apr": 0.1221039,
        "apy": 0.12970977648927318
      },
      "raw_sdk": {
        "borrow_apr": 0.1516387,
        "supply_apr": 0.1221039,
        "estimated_supply_apy": 0.12970977648927318,
        "ui_percent": 12.970977648927317
      },
      "current_sdk_projection": {
        "type": "SDK_projection_to_read_time_not_committed_raw_bRate",
        "borrow_apr": 0.1516387,
        "supply_apr": 0.1221039,
        "estimated_supply_apy": 0.12970977648927318,
        "ui_percent": 12.970977648927317,
        "b_rate": "1063824057842",
        "as_of": "2026-11-11T18:56:35.000Z"
      },
      "position": {
        "market_id": "stellar-testnet:blend:CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF:CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU",
        "pool_contract_id": "CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF",
        "reserve_contract_id": "CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU",
        "asset_id": "stellar-testnet:classic:USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56",
        "supplied": "4.0001156",
        "collateral": "4.0001156",
        "borrowed": "0.0000000",
        "wallet_spendable": false,
        "supply_apy_variable": 0.12970977648927318,
        "health_factor": null,
        "as_of_ledger": 5679950,
        "as_of": "2026-11-11T18:56:35.853Z",
        "readiness": "discovery_only"
      },
      "b_tokens": "37601290",
      "user_share_of_b_supply": {
        "numerator": "37601290",
        "denominator": "1506190145639"
      },
      "daily_constant_state_projection": {
        "type": "estimate_not_observed_interest",
        "from": "2026-11-11T18:52:38.000Z",
        "to": "2026-11-12T18:52:38.000Z",
        "b_rate_before": "1063823081636",
        "b_rate_after": "1064178963895",
        "per_one_underlying_apr_fraction": 0.0003345312328767123,
        "user_underlying_before": "4.0001120",
        "user_underlying_after": "4.0014501",
        "user_interest": "0.0013381"
      }
    }
  ],
  "history": {
    "status": "read_only_verified_reader",
    "earned": [
      {
        "asset_id": "stellar-testnet:native:XLM",
        "earned": "0.0002838",
        "earned_since": "2026-11-11T04:30:11.117Z"
      },
      {
        "asset_id": "stellar-testnet:classic:USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56",
        "earned": "0.0001156",
        "earned_since": "2026-11-11T16:51:45.038Z"
      }
    ],
    "flows": [
      {
        "type": "blend.supply",
        "state": "completed",
        "tx_hash": "eed88945a8c1327f260a1808136d3c3e8c2dd2f62607628fe8ce95d04d54af35",
        "asset_id": "stellar-testnet:native:XLM",
        "amount": "0.1",
        "created_at": "2026-11-11T04:30:14.923Z",
        "explorer_url": "https://stellar.expert/explorer/testnet/tx/eed88945a8c1327f260a1808136d3c3e8c2dd2f62607628fe8ce95d04d54af35"
      },
      {
        "type": "blend.withdraw",
        "state": "completed",
        "tx_hash": "c5483ff9c241eb8f9449c32f1cb5556f6d4071df82474e754bc9bd298ba0c268",
        "asset_id": "stellar-testnet:native:XLM",
        "amount": "0.05",
        "created_at": "2026-11-11T15:27:01.942Z",
        "explorer_url": "https://stellar.expert/explorer/testnet/tx/c5483ff9c241eb8f9449c32f1cb5556f6d4071df82474e754bc9bd298ba0c268"
      },
      {
        "type": "blend.supply",
        "state": "completed",
        "tx_hash": "1ad63c4281c7fd6a730a914c6f182beb60b6a9872103882b4a9506caa572a09a",
        "asset_id": "stellar-testnet:classic:USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56",
        "amount": "4",
        "created_at": "2026-11-11T16:51:44.231Z",
        "explorer_url": "https://stellar.expert/explorer/testnet/tx/1ad63c4281c7fd6a730a914c6f182beb60b6a9872103882b4a9506caa572a09a"
      }
    ]
  },
  "realized_annual_apy": null,
  "realized_annual_apy_reason": "Short observation window and mixed deposits/withdrawals do not establish a realized annual return. Daily values are explicit constant-state projections; earned amounts are token-denominated verified flow accounting, not annualized rates."
}
```
