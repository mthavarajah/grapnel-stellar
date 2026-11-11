import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Account, Keypair, SorobanDataBuilder, StrKey, nativeToScVal, rpc } from '@stellar/stellar-sdk';
import { GrapnelError, NETWORK_PASSPHRASE, type AssetIdentity } from '@grapnel/contracts';
import { SorobanTokenBalanceReader } from './token-balances.js';

const wallet = Keypair.random().publicKey();
const token = StrKey.encodeContract(Buffer.alloc(32, 7));
const wasm = Buffer.from('official-token-wasm-fixture');
const hash = createHash('sha256').update(wasm).digest('hex');
const asset: AssetIdentity = {
  id: `stellar-testnet:soroban:${token}`, network: 'stellar-testnet', kind: 'soroban', code: 'BTC',
  contractId: token, decimals: 7, verified: true, sourceUrl: 'https://raw.githubusercontent.com/soroswap/core/main/public/tokens.json',
};
function dependencies(options: { passphrase?: string; wasm?: Buffer; amount?: bigint; auth?: unknown[]; simulationError?: boolean } = {}) {
  const server = {
    getNetwork: async () => ({ passphrase: options.passphrase ?? NETWORK_PASSPHRASE, protocolVersion: '30' }),
    getContractWasmByContractId: async () => options.wasm ?? wasm,
    getAccount: async () => new Account(wallet, '19'),
    simulateTransaction: async () => options.simulationError
      ? ({ error: 'simulation failed', id: 'fixture', latestLedger: 1, _parsed: true, events: [] } as unknown as rpc.Api.SimulateTransactionResponse)
      : ({ id: 'fixture', latestLedger: 19, _parsed: true, events: [], minResourceFee: '0', transactionData: new SorobanDataBuilder(),
          result: { auth: options.auth ?? [], retval: nativeToScVal(options.amount ?? 12345678n, { type: 'i128' }) } } as unknown as rpc.Api.SimulateTransactionSuccessResponse),
  };
  const reader = new SorobanTokenBalanceReader('https://soroban-testnet.stellar.org', { [token]: hash }, {
    server: server as unknown as Pick<rpc.Server, 'getNetwork' | 'getAccount' | 'getContractWasmByContractId' | 'simulateTransaction'>,
    now: () => '2026-11-11T16:00:00.000Z',
  });
  return reader;
}

describe('Soroban Testnet token balance reader', () => {
  it('reads exact pinned token.balance through a fresh read-only simulation', async () => {
    await expect(dependencies().getBalances(wallet, [asset])).resolves.toEqual([{
      asset_id: asset.id, asset, wallet_amount: '1.2345678', reserved: '0.0000000', spendable: '1.2345678',
      as_of: '2026-11-11T16:00:00.000Z', source: 'stellar_rpc_testnet',
    }]);
  });

  it('treats an authoritative zero balance as zero', async () => {
    await expect(dependencies({ amount: 0n }).getBalances(wallet, [asset])).resolves.toMatchObject([{ wallet_amount: '0.0000000', spendable: '0.0000000' }]);
  });

  it('rejects a substituted contract identity and unpinned token', async () => {
    const other = StrKey.encodeContract(Buffer.alloc(32, 8));
    await expect(dependencies().getBalances(wallet, [{ ...asset, contractId: other }])).rejects.toMatchObject({ code: 'UNVERIFIED_SOROBAN_ASSET' });
    const unpinned = new SorobanTokenBalanceReader('https://soroban-testnet.stellar.org', {}, {
      server: { getNetwork: async () => ({ passphrase: NETWORK_PASSPHRASE }) } as never,
    });
    await expect(unpinned.getBalances(wallet, [asset])).rejects.toMatchObject({ code: 'SOROBAN_ASSET_UNAVAILABLE' });
  });

  it('rejects a wrong official wasm hash and wrong RPC network', async () => {
    await expect(dependencies({ wasm: Buffer.from('substituted wasm') }).getBalances(wallet, [asset])).rejects.toMatchObject({ code: 'SOROBAN_ASSET_UNAVAILABLE' });
    const reader = new SorobanTokenBalanceReader('https://soroban-testnet.stellar.org', { [token]: hash }, {
      server: { getNetwork: async () => ({ passphrase: 'Public Global Stellar Network ; September 2015' }) } as never,
    });
    await expect(reader.getBalances(wallet, [asset])).rejects.toMatchObject({ code: 'NETWORK_MISMATCH' });
    expect(() => new SorobanTokenBalanceReader('https://rpc.example.com', {})).toThrow('official Stellar Testnet RPC');
  });

  it.each([
    ['wrong precision', { decimals: 6 }],
    ['unverified identity', { verified: false }],
    ['non-Soroban kind', { kind: 'classic' as const }],
  ])('fails closed on %s', async (_label, change) => {
    await expect(dependencies().getBalances(wallet, [{ ...asset, ...change }])).rejects.toMatchObject({ code: 'UNVERIFIED_SOROBAN_ASSET' });
  });

  it('rejects auth requirements, negative/non-i128 results and simulation failures', async () => {
    await expect(dependencies({ auth: [{}] }).getBalances(wallet, [asset])).rejects.toMatchObject({ code: 'SOROBAN_BALANCE_UNAVAILABLE' });
    await expect(dependencies({ amount: -1n }).getBalances(wallet, [asset])).rejects.toMatchObject({ code: 'SOROBAN_BALANCE_UNAVAILABLE' });
    await expect(dependencies({ simulationError: true }).getBalances(wallet, [asset])).rejects.toMatchObject({ code: 'SOROBAN_BALANCE_UNAVAILABLE' });
  });
});
