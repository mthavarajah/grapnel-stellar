# Accurate direct Testnet quotes before customer approval

The lead approved this additive adapter-only callback after the actual provider rounding discrepancy was reproduced. No shared contracts, service, runtime, signing or UI files change here. Existing approved quotes are never edited; a new quote must be requested and reviewed.

## Integration

`InspectorDependencies` adds optional `quoteReadSource?:string`: an explicitly configured **existing public Testnet account** used only as the source of a never-submitted view simulation. There is no hardcoded fallback or signing authority. Root can supply its configured Testnet treasury public address; missing/invalid source fails closed when the reader is invoked.

```ts
const inspector = new SoroswapConfiguredInspector({quoteReadSource: existingTestnetPublicAddress});
const adapter = new SoroswapSpotAdapter(config, undefined, inspector.inspect, inspector.readExactQuote);
```

The fourth optional callback is exported as `SpotExactQuoteReader`:

```ts
(input: {market: SpotMarket; amountInAtomic: string}) => Promise<{
  amount_in_atomic: string;
  amount_out_atomic: string;
  observed_at: string;
  ledger: number;
}>
```

When configured, the reader cannot fall back to the incorrect provider quote. It first verifies the explicit Testnet network, current official registry/router/pair hashes, factory, finite pair membership, exact asset identities/metadata/decimals and direct ordered path. It simulates the official router's `router_get_amounts_out` with the exact i128 input and two exact addresses. The result must be a successful non-restore simulation, auth count zero, exact two-i128 return vector matching input, positive output/current ledger, and at most five seconds elapsed. The adapter independently validates observation age/input/ledger. No invocation is signed or submitted.

For the original customer-approved slippage, the adapter computes `ceil(actual_output * (10000 - approved_bps) / 10000)` using bigint. Before returning/persisting any customer quote, it clones the provider quote and changes **only** `amountOut`, `otherAmountThreshold`, and `rawTrade.amountOutMin`. All input, route, protocol, path, distribution and other fields remain byte-equivalent in their JSON values. The transformation accepts only current single100percent `soroswap` router/direct-path and one exact distribution. Aggregators, multiple routes, unknown field shapes and changed input are rejected. Previous adaptive provider-request bps never determine the new minimum. Zero slippage remains exact. The existing original-envelope/canonical/fresh-enforce/signed inspectors remain unchanged.

## Actual read-only evidence

`integer-fee-quote-proposal.json` is the first independently inspected proposal: official router view ledger5679535, exact100atomic BTC →2528093XLMatomic, auth0; strict50bps minimum2515453; provider build201 and existing inspector success.

`latest-integer-quote-readonly-inspection.json` reruns the complete new production adapter callback/preparation path with the actual customer public address, without authorization or signing. Router view ledger5679577 returned exact corrected quote0.2528093XLM/min0.2515453 at50bps. Provider build201 and both exact swap enforce simulations passed ledger5679578. Canonical envelope:6RO/5RW, ext0,3591981instructions,94787stroopfee, zero signatures. All transaction/operation proof IDs remain null; this is unsigned preparation proof, not execution.

Reproduce from repository root with server-only credentials configured and an existing source holding at least100atomic of the exact standaloneBTC:

```sh
DIAGNOSTIC_STELLAR_ACCOUNT=<existing-public-Testnet-account> pnpm exec tsx apps/api/src/adapters/soroswap/research/inspect-integer-quote-readonly.ts
```

The diagnostic never creates/funds accounts or signs/broadcasts. It writes a public unsigned report only. The production quote view source need not hold the swapped asset; actual build source must hold the exact principal plus sufficient XLM fee.

Primary sources: [official router view](https://github.com/soroswap/core/blob/main/contracts/router/src/lib.rs), [official integer fee calculation](https://github.com/soroswap/core/blob/main/contracts/library/src/quotes.rs), [official current Testnet registry](https://raw.githubusercontent.com/soroswap/core/main/public/testnet.contracts.json). Live code and pair identity checks bind these to the configured Testnet route. No API key or private signing material is stored in evidence.
