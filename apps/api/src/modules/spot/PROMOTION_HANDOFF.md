# Execution proof promotion

`SpotProofReadiness` checks a fresh exact route and independently reads current successful Stellar Testnet RPC transaction metadata for completed durable spot operations. A stored boolean, timestamp, quote, simulation or expired cached proof cannot promote execution.

Verification binds order/quote amounts, exact asset identities, recorded historical wallet deltas, independently confirmed net fee and ledger, exact immutable customer-signed envelope/digest and Ed25519 signature, historical transaction scope at the confirmed ledger close time, and the actual native debit/exact USDC credit token events from operation metadata. It does not depend on the customer's current balance (funds may have moved since settlement). All original signature-time expiry checks remain active on execution paths; historical inspection is only used for already-confirmed chain proof.

Adapter constructor execution timestamps are ignored. Only the internally branded verifier result promotes a market, with a30-second validity window. Expired or missing proof demotes execution; route failure also disables preparation. Refreshes are coalesced and cached for25seconds. Protocol/code/footprint changes invalidate historical scope matching. If RPC metadata ages out or becomes unavailable, execution status fails closed until independent proof can be read again. No transaction is initiated.

Actual validation on November11: independently re-read customer swap `eb4e7f22eac0b36195047ac231074ede70d7f1930e43d9f897557d43438b7e9a`, ledger5678121,100XLM input,150312556 atomic exact-issuer USDC output,16407stroops net fee. The stored completion/deltas and signed envelope matched chain metadata; promotion returned true. `confirmed-proof-fixture.json` is a sanitized offline replay of these public chain facts with private database identity fields replaced. Tests are replay checks, not new execution evidence.

## Root runtime patch (not applied by this agent)

Import `SpotProofReadiness` from `./modules/spot/proof.js`.
After constructing `spot`, construct:

```ts
const spotReadiness=new SpotProofReadiness(db,spot,spotInspector,chain.server);
```

Use `trade.spot:()=>spotReadiness.capability()` in capabilities.
Pass `refreshReadiness:()=>spotReadiness.refresh()` to `registerSpotRoutes`; the optional hook is already implemented after business/customer authorization on quote/order calls and business authorization on market reads. This avoids races between capability and market requests and refreshes current route/proof before preparing an action. Existing `preparation_available` remains separate so the first real swap can establish proof.

No public endpoint/schema changes. Reverse USDC-to-XLM proof must be promoted independently after reverse route/inspector/reservation support and actual confirmed customer execution; this implementation currently promotes only the proven XLM-to-USDC direction.
