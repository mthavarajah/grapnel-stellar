import { Asset, Networks } from '@stellar/stellar-sdk';
import { z } from 'zod';

export const SODAX_CONFIG_URL = 'https://api.sodax.com/v1/be/config/all';
export const SODAX_TOKENS_URL = 'https://api.sodax.com/v1/swaps/tokens';
const contract = z.string().regex(/^C[A-Z2-7]{55}$/);
const issuer = z.string().regex(/^G[A-Z2-7]{55}$/);
const token = z.object({ symbol: z.string().min(1).max(12), name: z.string().min(1).max(160),
  decimals: z.number().int().min(0).max(18), address: contract, chainKey: z.literal('stellar'), isRwa: z.boolean().optional() });
const configSchema = z.object({ version: z.number().int().nonnegative(), supportedChains: z.array(z.string()),
  spokeChainConfig: z.object({ stellar: z.object({ horizonRpcUrl: z.string().url(),
    trustlineConfigs: z.array(z.object({ assetCode: z.string().min(1).max(12), assetIssuer: issuer, contractId: contract })) }) }) });
const tokensSchema = z.object({ stellar: z.array(token).max(1000) });

export interface StockDiscoveryCandidate {
  symbol: string;
  name: string;
  decimals: number;
  contract_id: string;
  issuer: string;
  network: 'mainnet' | 'testnet';
  /** This is the provider's RWA flag, not a claim of stock ownership or eligibility. */
  classification: 'provider_rwa';
  executable: false;
  execution_status: 'discovery_only';
  readiness_reason: 'MAINNET_ONLY' | 'TESTNET_ROUTE_AND_ELIGIBILITY_UNVERIFIED';
}
export interface StockDiscovery {
  provider: 'sodax';
  source: typeof SODAX_CONFIG_URL;
  tokens_source: typeof SODAX_TOKENS_URL;
  observed_at: string;
  registry_version: number;
  candidates: StockDiscoveryCandidate[];
}

/** Verifies exact issuer/code/SAC identity. Never re-derives a mainnet address as a tradable Testnet asset. */
export function parseStockDiscovery(config: unknown, tokens: unknown, observedAt: string): StockDiscovery {
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error('Invalid observation timestamp');
  const c = configSchema.parse(config);
  const t = tokensSchema.parse(tokens);
  if (!c.supportedChains.includes('stellar')) throw new Error('Stellar not supported by registry');
  const stellar = c.spokeChainConfig.stellar;
  const network: 'mainnet' | 'testnet' | undefined = stellar.horizonRpcUrl === 'https://horizon.stellar.org' ? 'mainnet'
    : stellar.horizonRpcUrl === 'https://horizon-testnet.stellar.org' ? 'testnet' : undefined;
  if (!network) throw new Error('Unrecognized Stellar network binding');
  const passphrase = network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
  const seen = new Set<string>();
  const candidates = t.stellar.filter(t => t.isRwa === true).map(t => {
    if (seen.has(t.address)) throw new Error('Duplicate RWA contract');
    seen.add(t.address);
    const matches = stellar.trustlineConfigs.filter(a => a.assetCode === t.symbol && a.contractId === t.address);
    if (matches.length !== 1) throw new Error('Missing or ambiguous RWA issuer');
    const identity = matches[0]!;
    if (new Asset(identity.assetCode, identity.assetIssuer).contractId(passphrase) !== t.address)
      throw new Error('RWA contract does not match issuer and network');
    if (t.decimals !== 7) throw new Error('Classic Stellar asset precision mismatch');
    return { symbol: t.symbol, name: t.name, decimals: t.decimals, contract_id: t.address,
      issuer: identity.assetIssuer, network, classification: 'provider_rwa' as const,
      executable: false as const, execution_status: 'discovery_only' as const,
      readiness_reason: network === 'mainnet' ? 'MAINNET_ONLY' as const : 'TESTNET_ROUTE_AND_ELIGIBILITY_UNVERIFIED' as const };
  });
  return { provider: 'sodax', source: SODAX_CONFIG_URL, tokens_source: SODAX_TOKENS_URL,
    observed_at: new Date(observedAt).toISOString(), registry_version: c.version, candidates };
}

/** Public GETs only. Fixed origins, no credentials, redirects, quoting, signing or execution methods. */
export async function readStockDiscovery(options: { fetch?: typeof fetch; now?: () => Date } = {}): Promise<StockDiscovery> {
  const fetcher = options.fetch ?? fetch;
  const read = async (url: string): Promise<unknown> => {
    const response = await fetcher(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`SODAX discovery HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > 2_000_000) throw new Error('SODAX discovery response too large');
    return JSON.parse(text) as unknown;
  };
  const [config, tokens] = await Promise.all([read(SODAX_CONFIG_URL), read(SODAX_TOKENS_URL)]);
  return parseStockDiscovery(config, tokens, (options.now?.() ?? new Date()).toISOString());
}
