# Stock route discovery — November11,2026

No eligible real Stellar Testnet stock execution route was found. This is a concrete network/asset/provider-route blocker, not a missing UI button. No stock order, account, trustline, signature or transaction was created. Existing crypto execution is not substituted for a stock trade.

## Live checks

`discovery.json` contains sanitized public GET evidence:

- SODAX `/v1/swaps/tokens`200:22 chain keys,66 Stellar tokens,46 marked `isRwa`. The published `stellar` native SAC is `CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA`, deterministically **mainnet**, not required Testnet `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`.
- `/v1/be/config/spoke/chains`200 lists `stellar` and other production chains; no explicit Stellar Testnet chain key appears. `/v1/swaps/tokens/stellar`200 lists the same production tokens. Passing `stellar-testnet` to the documented parameterized token endpoint does not establish a Testnet token registry; its exact response is recorded.
- `/v1/be/config/spoke/all-chains-configs`200 identifies AAPL classic issuer `GDYUTHY75A7WUZJQDPOP66FB32BOYGZRXHWTWO4Q6LQTANT5X3V5HNFA`, code `AAPL`, published SAC `CAZSFDNSSR2RKJ2LIIB2Y4G4WOSYYKC4646EUJ63PQLDDHOVQYZ4HDTK`. Recomputing its SAC on mainnet exactly matches the published address. The identical code/issuer derives a different Testnet SAC `CBPIIKEK3G3FWVXCXRARECYRIPHBKFPA4W2QDMNFTLZK4QHXXR2L2S7X`.
- The published AAPL contract is not found on official Testnet RPC. Horizon Testnet exact `AAPL`+issuer asset lookup200 returns zero records. Symbols alone cannot substitute a different issuer or a mock share.

Official SODAX docs state swaps execute with mainnet funds. The official Soroswap case study explicitly enables its SODAX integration only on mainnet; the current stock announcement describes separate SODAX solver-based execution and geoblocking. Soroswap's local AMM API key is not evidence of a Testnet stock solver route.

## Code

`StocksTestnetDiscovery` performs fixed public GET capability discovery and returns no tradable market catalog. It identifies the mainnet native sentinel and refuses preparation with structured `EXECUTION_UNAVAILABLE`/`STOCKS_ROUTE_USES_MAINNET_ASSETS`. Even a future Testnet marker cannot unlock execution without independently verified stock token identity, issuer eligibility, actual solver liquidity, exact inspected signed intent and chain proof. There is no mainnet write path, SDK installation, mock token or fake fill.

Reproduce public GET probe from repository root:

```sh
pnpm exec tsx apps/api/src/adapters/stocks/research/probe-readonly.ts
```

Current published discovery routes work without credentials. Adding another API key cannot turn the returned production assets into Testnet assets. Moving forward requires provider-supplied **Stellar Testnet** stock issuer/contracts + supported chain/solver configuration + actual eligible Testnet liquidity/quote/build access and documented user eligibility. If those are supplied, code must inspect exact intent/auth/asset/recipient/fee and prove actual Testnet settlement before execution claims. Mainnet or cross-network execution conflicts with current project boundaries.

## Primary sources rechecked

- https://docs.sodax.com/developers/http-api (official host, read routes, specs)
- https://docs.sodax.com/developers/http-api/swaps (tokens/quote/intent lifecycle)
- https://docs.sodax.com/ (explicit mainnet execution in getting-started guidance)
- https://www.sodax.com/partners/soroswap (mainnet-only integration gate)
- https://www.sodax.com/news/sodax-partners-with-soroswap-to-bring-first-robinhood-stocks-to-stellar-traders (November9 stock integration announcement; solver execution/geoblocking)
