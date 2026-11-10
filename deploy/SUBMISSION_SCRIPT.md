# Functional demo and presentation script

Record only after deployment and gate verification. The current implementation does not itself establish Privy-signed customer payment, treasury grant/return, Soroswap swap or Blend supply/withdraw; show any remaining blocker explicitly. Keep full API keys and all signing secrets off screen.

## One-minute functional recording

- 0–12s: Public Grapnel owner dashboard. Show Testnet module catalog, save a module change, and state that existing API keys change permissions immediately. Keep keys masked.
- 12–22s: Show a real same-key request denied while disabled and accepted after enabling. Show request IDs/activity, not invented financial metrics.
- 22–36s: Independent sample fintech customer login and verified Testnet G-address. Execute Get Testnet Funds only if it is genuinely enabled and confirmed; otherwise show the explicit blocker and label this portion incomplete.
- 36–46s: If verified, show real Soroswap transaction and token deltas. If unverified, show unavailable execution and say the full swap acceptance item remains incomplete.
- 46–55s: If verified, show Blend supply position and matching withdraw proof; otherwise show real pool reads with discovery-only status. Neither market reads nor APY are lending execution proof.
- 55–60s: Public API docs, public repo link and actual verified explorer evidence. State which gates are complete. Friendbot treasury activation is not a customer transaction.

## Three-minute pitch outline

First 30s: Fintech teams serving underserved users face repeated wallet, protocol and reconciliation work. Describe integration cost rather than promising regulated global financial access.

Next 30s: Grapnel is a reusable B2B REST API. Businesses choose modules; customers separately authorize spends. The sample fintech is an independent integration, with its API key retained server-side.

Next 60s: Play the functioning deployed demo above, with honest unavailable states for incomplete acceptance items.

Next 30s: Explain tenant isolation, exact asset identity, durable operations, signature checks and chain reconciliation. Blend rates vary, supplied assets are encumbered, and Testnet tokens have no monetary value.

Final 30s: Describe the next validation work, remaining provider/account access, and plausible business distribution. Do not claim production custody, legal eligibility, guarantees, or fake execution.

## Trifold content

Left: customer problem and repeated integration burden; who buys the API and who owns the customer relationship.

Center: business dashboard → business BFF → Grapnel API → Stellar/Blend/Soroswap. Separate owner identity, business key and customer signing identity. Show Capital and Trade module catalog.

Right: real deployed screenshots, verified Testnet explorer QR/links, key permission demonstration, actual completed gates and visible remaining blockers. Provider-owned contracts are labeled as such. Add public repo and functional demo video QR only after links are verified.
