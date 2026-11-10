# Evidence and verification

`testnet.json` is owned by the integration lead. Null means no verified result; it must not be replaced by sample hashes. Unit tests and disposable SQL records are explicit fixtures, never chain evidence.

`pnpm smoke:testnet` independently rechecks the Testnet network, any recorded transaction hashes, current account balances and configured API health/OpenAPI. It performs no signing, funding, contract write or broadcast. Its output explicitly does not certify signer attribution or historical position/balance deltas. `--require-full` fails until manual/provider-specific acceptance verification is available; do not use a green read-only exit as Gate 2 approval.

Evidence distinctions:

| Record | Proves | Does not prove |
|---|---|---|
| `treasury_activation` | Friendbot activated treasury with native XLM | Privy customer signing, treasury grant, USDC inventory |
| `local_api_checks` | Local HTTP key/entitlement behavior | Public deployment or blockchain execution |
| Blend `research/testnet-read.json` | Current provider contract/reserve reads | Supply, withdrawal or customer position delta |
| `gate1` | Only after real customer signing and auth tests are independently checked | Soroswap or Blend execution |
| `funding`, `return`, `soroswap`, `blend_supply`, `blend_withdraw` | Exact successful provider operations once separately verified | Any missing adjacent flow or asset compatibility |

A successful chain entry should include the runtime timestamp, Grapnel operation ID, signer/provider, exact asset ID plus issuer/contract, amount, transaction hash, explorer URL, source/destination, ledger, chain result and independently observed before/after balances or positions. Keep provider-owned contracts distinct from contracts deployed by Grapnel. Testnet resets can make old evidence disappear; rerun reads before submission and record reset failures honestly.

Submission acceptance still needs public dashboard/API/fintech URLs, a public source repository and the real one-minute functional screen recording. Deployment files and scripts are preparation only.
