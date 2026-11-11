import { GrapnelError, NETWORK, NETWORK_PASSPHRASE } from '@grapnel/contracts';
import {CommodityDiscovery,type ApprovedCommodityCandidate,type CommodityDiscoveryReads} from './discovery.js';
export {CommodityDiscovery} from './discovery.js';
export type {ApprovedCommodityCandidate,CommodityDiscoveryReads,CommodityCandidateDiscovery} from './discovery.js';

export const COMMODITIES_BLOCK_REASON = 'NO_VERIFIED_TESTNET_COMMODITY_ISSUER_OR_LIQUID_ROUTE';

export interface CommodityAdapterConfig { network: string; passphrase: string; approvedAssets?:readonly ApprovedCommodityCandidate[]; }
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
  private readonly discovery:CommodityDiscovery;
  constructor(readonly config: CommodityAdapterConfig) {
    if (config.network !== 'testnet' || config.passphrase !== NETWORK_PASSPHRASE) {
      throw new GrapnelError(400, 'NETWORK_MISMATCH', 'Commodity discovery is restricted to explicit Stellar Testnet');
    }
    this.discovery=new CommodityDiscovery(config.approvedAssets??[]);
  }

  availability(): CommodityAvailability {
    return {
      module: 'trade.commodities', provider: 'stellar-testnet', network: NETWORK,
      execution_status: 'blocked', reason: COMMODITIES_BLOCK_REASON, executable: false,
      markets: [], evidence_file: 'apps/api/src/adapters/commodities/research/availability.json',
    };
  }

  /** Read live facts for the lead-approved finite registry. Successful reads still
   * cannot authorize execution or add an executable market. */
  async discover(reads:CommodityDiscoveryReads){
    const candidates=await this.discovery.discover(reads);
    return {module:'trade.commodities' as const,network:NETWORK,executable:false as const,execution_status:candidates.some(c=>c.execution_status==='discovery_only')?'discovery_only' as const:'blocked' as const,reason:candidates.some(c=>c.execution_status==='discovery_only')?'COMMODITY_EXECUTION_INSPECTION_AND_CHAIN_PROOF_REQUIRED':COMMODITIES_BLOCK_REASON,candidates};
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
