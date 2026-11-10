# 02 — Architecture, boundaries, identities, workflows

## One repo, three deployable web services, one worker
```
apps/
  api/                  # Fastify API, direct integrations and background worker
    src/{server.ts,worker.ts,db/,routes/,modules/,adapters/,lib/}
  dashboard/            # Next.js Grapnel B2B dashboard
  fintech-demo/         # Next.js distinct demo company app + BFF server routes
packages/
  contracts/            # Zod + TypeScript API request/response definitions
openapi/grapnel.yaml    # Generated or manually validated 3.1 spec
tests/{integration,e2e,security}/
scripts/{smoke-testnet.ts,seed-demo.ts}
evidence/testnet.json   # Runtime evidence, no fabricated values
```
API & worker may be the same code artifact with separate commands `node dist/server.js` and `node dist/worker.js`; use a managed PostgreSQL. No Kafka/Redis/microservices. All writes go through durable `operations` and idempotency in Postgres. Frontends deployed independently; all external providers (except Privy customer signing) accessed server-side by Grapnel API. The Testnet treasury signer resides exclusively in Grapnel server/worker secrets.

## Request path
```
Fintech browser -> Fintech Next.js server (customer session)
   -> Grapnel Fastify (business key)
   -> lookup tenant/key -> live module entitlement -> customer ownership -> eligibility
   -> durable operation + reservation -> provider adapter -> prepared XDR
   -> customer signing UI via Privy -> signed transaction to Grapnel
   -> Stellar RPC (simulate/submit) -> polling worker -> verified state
   -> customer reads GET /operations, balances, positions
```
Dashboard login uses an **independent admin session**, not business API key; dashboard creates/revokes API keys and updates entitlement table. Admin changes are effective on next request. The sample fintech BFF holds its business key in its own server environment. Customer browser uses Privy authentication and signing only. The business BFF maps its own authenticated user ID to `external_customer_id`; do not trust a browser-supplied Grapnel `customer_id`.

## Three identity layers
- `admin_user_id`: dashboard owner; can change modules/keys, no automatic authority to move a customer's funds.
- `tenant_id` and `api_key_id`: B2B developer credentials; identify tenant and allowed modules, no signing rights.
- `customer_id`, `privy_user_id`, `stellar_address`: owner of wallet assets. Verify Privy identity token on server, map to customer + tenant, require action-specific wallet signature. A sample tenant may share a Privy app with another demo tenant; still enforce complete tenant/customer isolation and avoid assuming Privy users are automatically cross-tenant portable.

## Wallet and signing interface (freeze)
```ts
type Network = 'stellar-testnet';
type AssetIdentity = {
  id: string; // internal stable ID, e.g., stellar-testnet:classic:USDC:G...
  network: Network;
  kind: 'native' | 'classic' | 'soroban';
  code: string; issuer?: string; contractId?: string; decimals: number;
  verified: boolean; sourceUrl: string;
};
type PreparedAction = {
  operationId: string;
  customerId: string;
  network: Network;
  walletAddress: string;
  unsignedXdr: string; // only after builder/simulation/inspection
  signingHashHex: string; // if chosen Privy signing method requires it
  summary: { action: string; fromAssetId?: string; toAssetId?: string;
    amount?: string; recipient?: string; contractId?: string;
    maxFeeStroops?: string; minReceive?: string; expiresAt: string };
  authorization: { method: 'privy_stellar'; expiresAt: string };
};
interface WalletSigner {
  provisionForCustomer(customerId: string, privyUserId: string): Promise<{ privyWalletId: string; stellarAddress: string; publicKey: string }>;
  verifyClientSignedAction(action: PreparedAction, signedXdr: string, customerIdentity: string): Promise<void>;
}
interface NetworkExecutor {
  prepareAndSimulate(input: ChainAction): Promise<PreparedAction>;
  submit(signedXdr: string, operationId: string): Promise<{ txHash: string; state: 'submitted' }>;
  reconcile(txHash: string): Promise<'completed'|'failed'|'pending'>;
}
```
`signingHashHex` is computed by Stellar SDK with the correct Testnet network passphrase and XDR. **Never sign raw arbitrary hex supplied by the browser, fintech BFF or provider**. For Soroban, same-source customer G-account authorization can be implicit via full envelope signature. If fee payer differs or other signers exist, handle auth entries explicitly per official docs. Proof required.

## Operation lifecycle
`accepted -> validating -> preparing -> awaiting_customer_authorization -> submitted -> confirming -> completed`; errors can be `rejected`, `expired`, `failed`, `recovery_required`. Store `prepared_xdr_hash`, approved intent snapshot, `tx_hash`, provider refs, network, last_checked_at, error_code. A submitted chain tx's final success must be checked via RPC; HTTP 200 from provider or `PENDING` from RPC is not completion.

## Internal balance availability
Wallet balances from Horizon for native and issued assets (include trustline authorization), Soroban RPC for contract-native balances, Blend positions from its pool SDK, Noether positions from venue indexer if enabled. Only wallet-held token amounts and independently verified withdrawable liquidity contribute to spendable USDC. Blend collateral and perp margin are *locked/encumbered*. Reservations use serializable transaction or row lock on `(tenant,customer,wallet,asset)` and sum active reservations; release on finality/recovery.

## Provider adapter contract
```ts
interface AdapterCapabilities { provider: string; networks: Network[]; modes: ('read'|'quote'|'execute')[]; status: 'testnet_verified'|'discovery_only'|'blocked'|'simulation'; reason?: string }
interface FinancialAdapter<TRequest, TPosition> {
  capabilities(): Promise<AdapterCapabilities>;
  validate(request: TRequest, customer: CustomerContext): Promise<void>;
  prepare(request: TRequest, customer: CustomerContext): Promise<PreparedAction>;
  reconcile(operation: Operation): Promise<{ state: string; positions?: TPosition[]; txHash?: string }>;
}
```
Methods vary between spot/funding/lending. Shared responsibility: tenant auth, custody boundaries, conversion of units, transaction inspection, operation status, idempotency. Providers must NOT call Grapnel core from web frontend directly.

## Environmental contracts
- Network passphrase: `Test SDF Network ; September 2015`.
- RPC: `https://soroban-testnet.stellar.org` (or configured reliable Testnet provider).
- Horizon: `https://horizon-testnet.stellar.org`.
- Testnet explorer: `https://stellar.expert/explorer/testnet/tx/<hash>`.
- Network aliases **never inferred from NODE_ENV**. Require `STELLAR_NETWORK=testnet` and refuse `public`.
- Test assets must include exact issuer or contract identity and clear `demo_only` labeling; never rename a custom token to official USDC.

## Testnet Funding signing and operations
- `fund` is a Grapnel-controlled treasury payment, **not** a customer wallet debit; its signing path must use a separately configured Testnet treasury signer with only allowlisted assets, quotas, treasury lock and idempotency. Fintech receives status via Grapnel API, not private treasury key.
- `return` is a customer wallet debit: construct a restricted `PreparedAction` with fixed treasury recipient, verify Privy customer approval and available wallet balance; no business key alone can drain funds.
- Friendbot is limited to new Stellar account activation and XLM reserve; never identify it as a USDC source. Funding asset eligibility is determined by canonical registry + confirmed treasury inventory + protocol-specific compatibility checks.
- Remove all fiat sessions, deposit-provider callbacks and payout state machines from this hackathon architecture. Internal operations still provide retry/reconciliation and real transfer hashes.

## Client behavior
The sample fintech should call `/v1/capabilities` on load; entitlement is updated live and menu appears/disappears. If a currently displayed module is disabled, Grapnel still blocks write and UI explains. For any action, client shows `Awaiting signature`, `Submitting`, `Confirming`, `Completed` or `Failed` based on operation GET. It does NOT immediately optimistically claim asset purchased or money paid.

## Source grounding
[Privy Tier 2 Stellar](https://docs.privy.io/wallets/overview/chains) · [Stellar transaction SDK](https://developers.stellar.org/docs/build/guides/transactions/invoke-contract-tx-sdk) · [Stellar JS SDK](https://stellar.github.io/js-stellar-sdk/) · [Soroswap SDK](https://github.com/soroswap/sdk) · [Blend SDK](https://github.com/blend-capital/blend-sdk-js).
