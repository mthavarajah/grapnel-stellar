import { expect, it, vi } from 'vitest';
import { nativeToScVal, xdr, Networks } from '@stellar/stellar-sdk';
import { ZENEX_TESTNET as P } from '@grapnel/contracts';
import { ZenexTestnetAdapter, ZENEX_PINS } from './index.js';

it('reads every code pin concurrently and refuses mismatches before caching verification', async () => {
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  let corrupt = true;
  const server = {
    getNetwork: vi.fn(async () => ({ passphrase: Networks.TESTNET })),
    getContractData: vi.fn(async (contract: string) => {
      await hold;
      return { val: { contractData: () => ({ val: () => ({ instance: () => ({
        executable: () => ({ switch: () => ({ name: 'contractExecutableWasm' }), wasmHash: () => Buffer.from(corrupt ? '0'.repeat(64) : ZENEX_PINS[contract]!, 'hex') }),
        storage: () => Object.entries({ Token: P.token, Vault: P.vault, Oracle: P.oracle, Treasury: P.treasury }).map(([key, value]) => ({ key: () => xdr.ScVal.scvVec([nativeToScVal(key)]), val: () => nativeToScVal(value) })),
      }) }) }) } };
    }),
  };
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ markets: [{ id: 'xlm-usd', trading: P.market, vault: P.vault, collateral: P.token, collateralDecimals: 7, feedId: P.feed }] }) }));
  const adapter = new ZenexTestnetAdapter(server as never, fetcher as never);
  const check = adapter.verifyRegistry();
  await vi.waitFor(() => expect(server.getContractData).toHaveBeenCalledTimes(4));
  release();
  await expect(check).rejects.toThrow('contract code changed');
  corrupt = false;
  await adapter.verifyRegistry();
  expect(server.getContractData).toHaveBeenCalledTimes(8);
  await adapter.verifyRegistry();
  expect(server.getContractData).toHaveBeenCalledTimes(8);
  await adapter.verifyRegistry(true);
  expect(server.getContractData).toHaveBeenCalledTimes(12);
});
