# Gate status

## Gate 0 — passed
Foundation commit: `6ed12fd`; OpenAPI detail and Privy dependency follow-up `c0a272f`.
Frozen version: 0.1.0. See docs/14_GATE0_FREEZE.md.
Contract tests: 10 passed. Baseline applied on local PostgreSQL 16.

## Gate 1 — pending
Real Privy-signed Stellar Testnet customer payment not yet proven. Privy credentials absent at initial inspection. API key/tenant/customer authorization tests pending integration. No fallback signer authorized.

## Gate 2 — pending, execution gated on Gate 1
No confirmed treasury grant/return, Soroswap swap, or Blend supply/withdraw recorded. Public provider reads and adapter unit tests do not pass this gate.

## Gate 3 — pending
Public application URLs, public project repository and functional video absent. Railway/Vercel connections offered; neither confirmed connected. Existing unrelated private grapnel-api repository will not be overwritten.

## Independently confirmed infrastructure evidence
Treasury `GCY4DPMIBYCQ352UDKVWDJFKRXOIB2YCOLF2PQFUZHZPYU4WD4PW3LBE` activated via Friendbot; Horizon confirmed successful transaction `f89109f4379358f0e11771eef6e3aa7e9797dd9b99bf5c576ad3a61d37f76a36`, ledger 5659589. Balance read: 10000.0000000 native Testnet XLM. This is treasury activation ONLY, does not pass Gate 1 or treasury grant/return acceptance. Server-only key is ignored and not committed.
