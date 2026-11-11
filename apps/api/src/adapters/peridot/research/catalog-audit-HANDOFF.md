# Peridot offering audit — bounded public source + current Testnet registry

Observed **2026-11-11T21:53:38Z**. Current registry read at ledger **5682073**, pair view simulations at **5682074**. All successful simulations required **zero authorization entries**. No signing, faucet, submit, token mint, account creation, or other onchain write. Execution evidence remains null.

## What is actually offered

| Official surface | Published assets/pair | Network / product | What this establishes |
|---|---|---|---|
| Current `/app/margin` plus margin documentation | **One XLM / Mock USDT pair**, documented long/short, 2–5x | Stellar Testnet leveraged margin | One currently published Testnet margin asset pair, not a broad BTC/ETH/perpetual catalog |
| Current Networks & Assets documentation | **Three: XLM, USDC, EURC** | Stellar **mainnet lending**, optional boosted variants | These are lending pools, not three Testnet margin markets |
| Same network documentation | BSC hub; Arbitrum, Base, Ethereum, Polygon, Avalanche spokes | EVM multi-chain **lending** | Six named EVM networks; docs do not establish margin instruments on each chain |
| Separate official PeridotV2-Robinhood README | **NVDA / USDG** | Robinhood chain **4663 mainnet**, margin | Separate mainnet deployment; no Stellar Testnet route is established by this README |

The present Grapnel XLM margin row matches the **one pair in the current official Stellar margin app**. No additional publicly offered Stellar Testnet margin symbol was found in this bounded review. Do not call this a proof that no other private, old, or undisclosed deployment exists.

The provider's published long/short description does not by itself prove either route executable through Grapnel. Existing adapter execution is disabled. The fresh side-specific configuration discrepancy below is another reason not to convert the app description into an execution claim.

## Fresh controller registry: four vaults, two underlying tokens

Read the **persistent** `SupportedMarkets` key on controller `CDMXPWG55776NECXQMWNBXMEQXZUAWA2AJBCQS7SU7SA64XHMO3KB3O6`, whose shape is confirmed by official source. This is stronger evidence than assuming the two vaults already pinned in Grapnel are the whole lending registry.

| Supported vault | Underlying | Margin controller |
|---|---|---|
| `CAGPHU6OE23PKSMSQLJ2IWDRMATAHD5HFBBX3S43UUJ4WP2IOH6KQC5A` | Mock USDT `CDPXNHHVSLX3HFAHV7XOISM23MZH36WSXTO45RNDOBIDFZBGTSOVD4OY` | Alternate `CA5QDPU2C5QIA4NVNSBDBEGBOL6ET6ETVWJVP4KVO3F45NRXMOOU6OMI` |
| `CAWSZ65ADUYCT557CHHN4A2MFQIKL3PRATGIRW4UM2J3VE5ZL3DIN7OD` | Native XLM `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` | Same alternate controller |
| `CB32OVY4AADCHQT3DLKJYW5QVTWY5MOX7BBNZFT3SDHZ5HPSDDEA2THJ` | Same native XLM | Current public app controller `CAKKHUGHP67UA4F42QOYPKNGRSBJEOE62MGDXA2UURTEYFOQGSMIRUFO` |
| `CCEW6NSPCV7XUEQV75ZMII5HK5DGXK5JP2QOTGLV4UFLDBPEKRGO4Y4B` | Same Mock USDT | Same public app controller |

All four entries are enabled in the registry. Their underlying name/symbol/decimals and margin-controller links were fetched using read-only contract views. **Four vaults do not mean four different trading assets**: they collapse to exactly two unique underlying contract IDs. Native SAC identity is explicit; Mock USDT has a standalone Soroban contract, not a classic Tether issuer.

The alternate controller is **not referenced in the current public margin page chunk**. Its WASM hash is `403b4813c559b57494499044a4601d9c55438384c09fee74a692c05aab0a3118`. Current app controller hash remains `da68ef52027b0821141b071eeac29ef0c2cef0b269864ca266de56e427c2d7e2`.

## Bounded pair-config matrix

For both controllers, the script deduplicates the two underlying tokens and probes both ordered pairs with both `PositionSide` values. The deployed method's argument names are **`margin_asset`, `base_asset`, `side`**; this matrix must not be relabelled as four different trading symbols.

| Controller | Margin asset | Base asset | Side | `get_perps_pair_config` |
|---|---|---|---|---|
| Current public app | Mock USDT | XLM | Long | Non-null: max leverage5, maintenance50000, liquidation incentive10000 (scale1e6) |
| Current public app | Mock USDT | XLM | Short | **null** |
| Current public app | XLM | Mock USDT | Long | Non-null: max leverage10, maintenance50000, liquidation incentive10000 |
| Current public app | XLM | Mock USDT | Short | **null** |
| Alternate | Mock USDT | XLM | Long/Short | **null** for both |
| Alternate | XLM | Mock USDT | Long/Short | **null** for both |

Execution-config getters also return values, preserved raw in JSON. A non-null generic execution policy or reverse-order pair configuration is **not sufficient evidence of a supported public route**. The public docs and app configure one XLM pair; they advertise short positions but the probed short pair configuration is null. Root was alerted to the exact responses. No adapter behavior was changed by this audit, no new pair was enabled, and no 10x offering is advertised.

The deployed margin ABI provides per-pair getters, **no list-all-pairs method**. Soroban RPC does not list arbitrary unknown persistent keys. Our conclusion is bounded to current official app configuration, official documentation, and all unique underlying-token combinations in this controller's current supported-market registry. Oracle feed count, Aquarius-wide pool count, lending vault count, and supported network count are all different from margin offering count.

## Source freshness / reproducibility

- Current public page: <https://peridot.finance/app/margin>.
- Its DOM-listed chunk: <https://peridot.finance/_next/static/chunks/app/app/margin/page-924ea86e68006f99.js>, HTTP200, SHA256 `eca96d18dfd92f4ce122b65dd8d1fda4fc8b35a86ed481f87557b799da3e37ba`. The chunk names exactly the ten current reviewed contract addresses; alternate-controller address is absent. No embedded client API credential was copied into this report.
- [Official margin docs](https://peridot.finance/docs/margin-trading): Stellar Testnet, XLM/USDT, long/short and2–5x. Re-fetched and checksum recorded.
- [Official network/assets docs](https://peridot.finance/docs/networks-and-assets): three mainnet Stellar lending assets plus separate EVM surface. Re-fetched and checksum recorded.
- [Official testnet deployment script](https://github.com/PeridotFinance/Peridot-Soroban/blob/main/peridot-contracts/scripts/deploy_testnet.sh): two receipt vaults, native XLM and Mock USDT.
- [Official margin deployment script](https://github.com/PeridotFinance/Peridot-Soroban/blob/main/peridot-contracts/scripts/deploy_margin_controller_testnet.sh): same asset types, old default deployment addresses. These defaults are not substituted for current app deployment pins.
- [Official controller storage source](https://github.com/PeridotFinance/Peridot-Soroban/blob/main/peridot-contracts/contracts/simple-peridottroller/src/storage.rs): `SupportedMarkets` is an address→bool map. Public repository source commit pinned for this audit: `fe8d562051195dbc0af667367514b479de36fc8d`.
- [Separate Robinhood deployment](https://github.com/PeridotFinance/PeridotV2-Robinhood): README SHA256 `7ce36743c445ebbfd7563873fa9efe6f9190f61ea87072c0aa7728be5c6a7212`; NVDA/USDG and chain4663 mainnet remain outside Grapnel's Testnet-only write boundary.

Run `node apps/api/src/adapters/peridot/research/catalog-audit-readonly.cjs`. Optional `DIAGNOSTIC_STELLAR_ACCOUNT` supplies an existing public Testnet read source; it is never a signing key. The script fetches public files without browser identity/cookies, verifies explicit Testnet passphrase, inspects live registry and zero-auth view simulations, then writes `catalog-audit-latest.json`. `node --check` and the actual live run pass. The JSON contains exact sanitized identities, source hashes, source timestamps, contract hashes, all eight pair probes and no credentials.
