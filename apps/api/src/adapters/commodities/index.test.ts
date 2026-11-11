import { describe, expect, it } from 'vitest';
import { NETWORK_PASSPHRASE } from '@grapnel/contracts';
import { CommodityAdapter, COMMODITIES_BLOCK_REASON } from './index.js';

describe('commodity Testnet availability gate', () => {
  it('refuses implicit or non-Testnet configuration', () => {
    expect(() => new CommodityAdapter({ network: 'mainnet', passphrase: NETWORK_PASSPHRASE })).toThrow('explicit Stellar Testnet');
    expect(() => new CommodityAdapter({ network: 'testnet', passphrase: 'Public Global Stellar Network ; September 2015' })).toThrow('explicit Stellar Testnet');
  });

  it('keeps markets empty and explicitly blocked until issuer and liquidity proofs exist', () => {
    const adapter = new CommodityAdapter({ network: 'testnet', passphrase: NETWORK_PASSPHRASE });
    expect(adapter.markets()).toEqual([]);
    expect(adapter.availability()).toMatchObject({ module: 'trade.commodities', execution_status: 'blocked', reason: COMMODITIES_BLOCK_REASON, executable: false, markets: [] });
  });

  it.each(['quote', 'prepare'] as const)('never simulates or advertises %s without a verified route', async action => {
    const adapter = new CommodityAdapter({ network: 'testnet', passphrase: NETWORK_PASSPHRASE });
    await expect(adapter[action]()).rejects.toMatchObject({ code: 'EXECUTION_UNAVAILABLE', details: { module: 'trade.commodities', execution_status: 'blocked', reason: COMMODITIES_BLOCK_REASON } });
  });
});
