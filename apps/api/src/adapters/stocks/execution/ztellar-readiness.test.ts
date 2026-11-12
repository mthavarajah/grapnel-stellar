import { describe, expect, it } from 'vitest';
import { Networks, rpc } from '@stellar/stellar-sdk';
import { assessZtellarCandidate, ZTELLAR_CANDIDATE as ids, type ZtellarObservation } from './ztellar-readiness.js';

import { ZtellarReadinessReader } from './ztellar-readonly.js';

const current: ZtellarObservation = {
  networkPassphrase: Networks.TESTNET,
  vault: ids.vault, vaultWasm: ids.vaultWasm, tier: ids.tier, tierWasm: ids.tierWasm, verifier: ids.verifier, verifierWasm: ids.verifierWasm, usdc: ids.usdc,
  vaultUsdcUnits: '5084898268', walletUsdcUnits: null, walletMaxLeverage: 0,
  vaultLastModifiedLedger: 3408963, observedLedger: 5681203,
};

describe('independent Ztellar stock candidate review', () => {
  it('refuses a mainnet RPC before reading any account, code or view', async () => {
    const reader = new ZtellarReadinessReader({ getNetwork: async () => ({ passphrase: Networks.PUBLIC }) } as unknown as rpc.Server);
    await expect(reader.read('GB4PC65ZHBPVEZMAHY2K2KYMS3RFBIN2FQIE3LGTLEHT2DEWVMTD7JYQ')).rejects.toThrow('NETWORK_MISMATCH');
  });
  it('reports actual customer and oracle prerequisites without inventing proof', () => {
    const result = assessZtellarCandidate(current);
    expect(result.blockers).toContain('CIRCLE_USDC_TRUSTLINE_REQUIRED');
    expect(result.blockers).toContain('VALID_ONCHAIN_TIER_REQUIRED');
    expect(result.blockers).toContain('VERIFIED_ORACLE_UPDATE_REQUIRED');
    expect(result.txHash).toBeNull();
    expect(result.verifiedPositionDelta).toBeNull();
  });
  it.each([
    ['mainnet', { networkPassphrase: Networks.PUBLIC }, 'NETWORK_MISMATCH'],
    ['different vault bytecode', { vaultWasm: '0'.repeat(64) }, 'VAULT_IDENTITY_MISMATCH'],
    ['different tier manager', { tier: ids.vault }, 'TIER_IDENTITY_MISMATCH'],
    ['different verifier contract', { verifier: ids.vault }, 'VERIFIER_IDENTITY_MISMATCH'],
    ['different verifier bytecode', { verifierWasm: '0'.repeat(64) }, 'VERIFIER_IDENTITY_MISMATCH'],
    ['same-symbol other USDC', { usdc: ids.vault }, 'COLLATERAL_IDENTITY_MISMATCH'],
    ['zero liquidity', { vaultUsdcUnits: '0' }, 'VAULT_LIQUIDITY_REQUIRED'],
    ['fractional base units', { vaultUsdcUnits: '0.5' }, 'INVALID_VAULT_BALANCE'],
    ['negative balance', { walletUsdcUnits: '-1' }, 'INVALID_WALLET_BALANCE'],
    ['tier outside actual contract caps', { walletMaxLeverage: 3 }, 'VALID_ONCHAIN_TIER_REQUIRED'],
    ['future modification', { vaultLastModifiedLedger: 5681204 }, 'INVALID_LEDGER_OBSERVATION'],
  ] as const)('rejects %s', (_name, patch, expected) => {
    expect(assessZtellarCandidate({ ...current, ...patch }).blockers).toContain(expected);
  });
  it('never equates a recent instance change and large balances with fresh oracle/execution proof', () => {
    const result = assessZtellarCandidate({ ...current, walletUsdcUnits: '900719925474099300000000',
      vaultUsdcUnits: '900719925474099300000000', walletMaxLeverage: 1, vaultLastModifiedLedger: current.observedLedger });
    expect(result.blockers).toEqual(['VERIFIED_ORACLE_UPDATE_REQUIRED', 'SOURCE_BUILD_EQUIVALENCE_REQUIRED', 'VERIFIED_ELIGIBILITY_BINDING_REQUIRED', 'PROVIDER_ROUTE_REVIEW_REQUIRED']);
    expect(result.exposure).toBe('collateralized_synthetic_position');
    expect(result.executable).toBe(false);
  });
});
