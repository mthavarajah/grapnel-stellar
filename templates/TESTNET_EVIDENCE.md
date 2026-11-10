# Testnet evidence record format

Create a machine-readable `evidence/testnet.json` in the code implementation. Never fill anything with fabricated data. Recommended JSON shape:

```json
{
  "network": "stellar-testnet",
  "network_passphrase": "Test SDF Network ; September 2015",
  "verified_at": null,
  "dashboard_url": null,
  "api_url": null,
  "fintech_url": null,
  "github_url": null,
  "video_url": null,
  "customer_wallet_address": null,
  "transactions": {
    "customer_activation_or_xlm_payment": null,
    "testnet_treasury_fund": null,
    "testnet_customer_return": null,
    "soroswap_spot_swap": null,
    "blend_supply": null,
    "blend_withdraw": null
  },
  "existing_provider_contracts": [],
  "contracts_deployed_by_grapnel": [],
  "known_blockers": []
}
```

The funding/return entries are **onchain-only**, never fiat payments or payouts. Friendbot account activation must not be described as USDC funding.

Each actual transaction entry should contain `tx_hash`, `observed_at`, `explorer_url`, exact asset identity (classic code+issuer vs Soroban contract ID), source/destination redacted if privacy requires, onchain result, and corresponding Grapnel `operation_id`. Existing protocol contract IDs should be distinct from Grapnel-owned deployments.
