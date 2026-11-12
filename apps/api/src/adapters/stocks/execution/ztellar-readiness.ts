/** Candidate review only. This is deliberately not a financial execution adapter. */
import { Networks } from '@stellar/stellar-sdk';

export const ZTELLAR_CANDIDATE = Object.freeze({
  sourceRevision: '7588e2ba33da8220fae8a0123377a70e747b2063',
  vault: 'CDQANGYCMZQKYSR6GQAXR7FEF3PALRMEDR65ONKSSJGAVDI23DM5YNQM',
  vaultWasm: 'bbdd2079eea1ee289bc55e1ae5526b65772a390033f774acae0c5173d203f3fb',
  tier: 'CC7EF4NGJDLQECANFXHXA32UAHYQKVU6Z57COFSR2WIB5TMQL3G4EKQF',
  tierWasm: '24feb0e4ceca7a8c10660f3927ff00179b96748e423bdcc248bc4ddca57d7374',
  verifier: 'CAO4EYDG7B5OXUUONZWY6AAUGYQPZD66D2E5NPMKCBIYRO2D6ZEO3HX7',
  verifierWasm: '4fa9aa3386c8530ddac90aa4aff37af442cfd6e8e404bdceaf4bc1874d106a51',
  usdc: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
  usdcIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  collateralDecimals: 7,
  priceDecimals: 6,
  exposure: 'collateralized_synthetic_position',
} as const);

export interface ZtellarObservation {
  networkPassphrase: string;
  vault: string;
  vaultWasm: string;
  tier: string;
  tierWasm: string;
  verifier: string;
  verifierWasm: string;
  usdc: string;
  vaultUsdcUnits: string;
  walletUsdcUnits: string | null;
  walletMaxLeverage: number;
  // Instance modification is NOT an oracle timestamp: position opens also update it.
  vaultLastModifiedLedger: number;
  observedLedger: number;
}

function nonNegativeUnits(value: string): bigint | null {
  return /^(0|[1-9][0-9]*)$/.test(value) ? BigInt(value) : null;
}

/** Reject identity drift and missing prerequisites using exact integer balances.
 *
 * No invocation builder is exported. The current deployed contract has no oracle
 * timestamp/round API, source/deployed reproducibility is unverified, and the
 * provider's collateralized payout policy needs lead review. A funded vault or a
 * refreshed frontend reference quote cannot independently clear those conditions.
 */
export function assessZtellarCandidate(observed: ZtellarObservation) {
  const blockers: string[] = [];
  const expected = ZTELLAR_CANDIDATE;
  if (observed.networkPassphrase !== Networks.TESTNET) blockers.push('NETWORK_MISMATCH');
  if (observed.vault !== expected.vault || observed.vaultWasm !== expected.vaultWasm)
    blockers.push('VAULT_IDENTITY_MISMATCH');
  if (observed.tier !== expected.tier || observed.tierWasm !== expected.tierWasm)
    blockers.push('TIER_IDENTITY_MISMATCH');
  if (observed.verifier !== expected.verifier || observed.verifierWasm !== expected.verifierWasm)
    blockers.push('VERIFIER_IDENTITY_MISMATCH');
  if (observed.usdc !== expected.usdc) blockers.push('COLLATERAL_IDENTITY_MISMATCH');
  const vaultUnits = nonNegativeUnits(observed.vaultUsdcUnits);
  if (vaultUnits === null) blockers.push('INVALID_VAULT_BALANCE');
  else if (vaultUnits === 0n) blockers.push('VAULT_LIQUIDITY_REQUIRED');
  if (observed.walletUsdcUnits === null) blockers.push('CIRCLE_USDC_TRUSTLINE_REQUIRED');
  else {
    const walletUnits = nonNegativeUnits(observed.walletUsdcUnits);
    if (walletUnits === null) blockers.push('INVALID_WALLET_BALANCE');
    else if (walletUnits === 0n) blockers.push('CUSTOMER_COLLATERAL_REQUIRED');
  }
  if (![1, 2, 5, 10].includes(observed.walletMaxLeverage)) blockers.push('VALID_ONCHAIN_TIER_REQUIRED');
  if (!Number.isSafeInteger(observed.observedLedger) || !Number.isSafeInteger(observed.vaultLastModifiedLedger)
      || observed.vaultLastModifiedLedger <= 0 || observed.observedLedger < observed.vaultLastModifiedLedger)
    blockers.push('INVALID_LEDGER_OBSERVATION');
  blockers.push('VERIFIED_ORACLE_UPDATE_REQUIRED', 'SOURCE_BUILD_EQUIVALENCE_REQUIRED', 'VERIFIED_ELIGIBILITY_BINDING_REQUIRED', 'PROVIDER_ROUTE_REVIEW_REQUIRED');
  return {
    executionStatus: 'blocked' as const,
    executable: false as const,
    exposure: expected.exposure,
    blockers,
    // These remain null until actual customer-authorized execution and reconciliation.
    txHash: null,
    verifiedPositionDelta: null,
  };
}
