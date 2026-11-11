import { GrapnelError, NETWORK, NETWORK_PASSPHRASE } from '@grapnel/contracts';

export const COMMODITIES_BLOCK_REASON = 'NO_VERIFIED_TESTNET_COMMODITY_ISSUER_OR_LIQUID_ROUTE';

export interface CommodityAdapterConfig { network: string; passphrase: string; }
export interface CommodityAvailability {
  module: 'trade.commodities';
  provider: 'stellar-testnet';
  network: typeof NETWORK;
  execution_status: 'blocked';
  reason: typeof COMMODITIES_BLOCK_REASON;
  executable: false;
  markets: [];
  evidence_file: 'apps/api/src/adapters/commodities/research/availability.json';
}

/** Fail-closed placeholder for the module until an issuer-backed Testnet asset and route are verified. */
export class CommodityAdapter {
  constructor(readonly config: CommodityAdapterConfig) {
    if (config.network !== 'testnet' || config.passphrase !== NETWORK_PASSPHRASE) {
      throw new GrapnelError(400, 'NETWORK_MISMATCH', 'Commodity discovery is restricted to explicit Stellar Testnet');
    }
  }

  availability(): CommodityAvailability {
    return {
      module: 'trade.commodities', provider: 'stellar-testnet', network: NETWORK,
      execution_status: 'blocked', reason: COMMODITIES_BLOCK_REASON, executable: false,
      markets: [], evidence_file: 'apps/api/src/adapters/commodities/research/availability.json',
    };
  }

  markets(): [] { return []; }

  async quote(): Promise<never> { return this.unavailable(); }
  async prepare(): Promise<never> { return this.unavailable(); }

  private unavailable(): never {
    throw new GrapnelError(409, 'EXECUTION_UNAVAILABLE', 'No verified Stellar Testnet commodity issuer and liquid route are available', false, {
      module: 'trade.commodities', execution_status: 'blocked', reason: COMMODITIES_BLOCK_REASON,
    });
  }
}
