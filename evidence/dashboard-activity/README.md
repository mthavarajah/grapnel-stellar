# Grapnel Activity verification

November 13, 2026. Visually verified signed-in local owner dashboard: Activity is below API keys and above Request logs; no sidebar Workspace label or topbar avatar. Initial page showed 50 actual persisted Stellar transactions; Load more expanded to all57. Customer reference, wallet, operation status and exact Testnet Explorer links rendered. This indexes this business’s submitted Grapnel operations, not every transaction on Stellar or outside wallet transfers. No chain writes were performed for this change.

Lending positions display only the exact native XLM and issuer-based USDC assets offered in Velocity Earn. Other protocol positions remain stored and accessible through existing backend interfaces.

Targeted tests:10 passing, including owner rejection, tenant-scoped joins, Stellar-only hashes, cursor validation/pagination, customer transaction rows and exact lending-asset filtering. API/dashboard typechecks passed; dashboard production webpack build passed.
