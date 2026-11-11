import { Asset, Networks } from '@stellar/stellar-sdk';
import { readStockDiscovery, SODAX_CONFIG_URL, SODAX_TOKENS_URL, type StockDiscovery } from './discovery.js';

/** Reviewed provider code/name pairs from the dated official registry snapshot.
 * This is a display-category selection, never an eligibility allowlist.
 * Excludes commodity funds GLD/SLV/USO and Treasury fund SGOV. SPY/QQQ remain
 * equity-fund references, without implying their tokens convey share ownership.
 * Newly listed or renamed rows require review; never classify arbitrary RWAs as stocks.
 */
const stockCatalogNames: Readonly<Record<string, string>> =
{
  "SPCX": "SpaceX Class A",
  "NVDA": "NVIDIA",
  "GME": "GameStop",
  "MSTR": "Strategy",
  "AAPL": "Apple",
  "TSLA": "Tesla",
  "MU": "Micron",
  "SNDK": "SanDisk",
  "SPY": "SPDR S&P 500 ETF Trust",
  "QQQ": "Invesco QQQ Trust",
  "GOOGL": "Alphabet Class A",
  "AMZN": "Amazon",
  "MSFT": "Microsoft",
  "META": "Meta",
  "CRCL": "Circle",
  "COIN": "Coinbase",
  "PLTR": "Palantir",
  "TSM": "Taiwan Semiconductor",
  "AMD": "AMD",
  "INTC": "Intel",
  "BABA": "Alibaba",
  "AMC": "AMC Entertainment",
  "HIMS": "Hims & Hers Health",
  "LLY": "Eli Lilly",
  "COST": "Costco",
  "TTWO": "Take-Two Interactive Software",
  "RBLX": "Roblox",
  "IBM": "IBM",
  "MRNA": "Moderna",
  "LULU": "Lululemon",
  "SNAP": "Snap",
  "WYFI": "WhiteFiber, Inc.",
  "RIVN": "Rivian Automotive",
  "NFLX": "Netflix",
  "BULL": "Webull",
  "QUBT": "Quantum Computing",
  "NET": "Cloudflare, Inc. Class A common stock",
  "SKHY": "SK hynix Inc. American Depositary Shares",
  "JNJ": "Johnson & Johnson",
  "UPS": "UPS",
  "DJT": "Trump Media & Technology Group",
  "RDDT": "Reddit"
};
export interface StockCatalogMarket {
  market_id: string;
  provider: 'sodax';
  asset_class: 'stocks';
  classification: 'provider_rwa';
  network: 'stellar-mainnet' | 'stellar-testnet';
  symbol: string;
  name: string;
  underlying_symbol: string;
  underlying_name: string;
  contract_id: string;
  issuer: string;
  decimals: number;
  reference_price: null;
  latest_price: null;
  price_status: 'unavailable';
  stats: null;
  executable: false;
  preparation_available: false;
  execution_status: 'discovery_only';
  reason: 'MAINNET_ONLY' | 'TESTNET_ROUTE_AND_ELIGIBILITY_UNVERIFIED';
  source_url: typeof SODAX_TOKENS_URL;
  observed_at: string;
}

/** Informational catalog projection, separate from the empty executable Testnet market registry. */
export function projectStockCatalog(discovery: StockDiscovery): StockCatalogMarket[] {
  if (discovery.provider !== 'sodax' || discovery.source !== SODAX_CONFIG_URL || discovery.tokens_source !== SODAX_TOKENS_URL
    || !Number.isFinite(Date.parse(discovery.observed_at))) throw new Error('Unverified stock catalog provenance');
  const seen = new Set<string>();
  return discovery.candidates.flatMap(candidate => {
    if (candidate.classification !== 'provider_rwa' || !['mainnet', 'testnet'].includes(candidate.network)
      || candidate.decimals !== 7 || candidate.executable !== false
      || candidate.execution_status !== 'discovery_only') throw new Error('Invalid stock discovery identity');
    const passphrase = candidate.network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
    if (new Asset(candidate.symbol, candidate.issuer).contractId(passphrase) !== candidate.contract_id)
      throw new Error('Stock catalog contract does not match issuer and network');
    const market_id = `sodax:catalog:${candidate.network}:${candidate.contract_id}`;
    if (seen.has(market_id)) throw new Error('Duplicate stock catalog identity');
    seen.add(market_id);
    if (stockCatalogNames[candidate.symbol] !== candidate.name) return [];
    return [{ market_id, provider: 'sodax', asset_class: 'stocks', classification: 'provider_rwa',
      network: candidate.network === 'mainnet' ? 'stellar-mainnet' : 'stellar-testnet',
      symbol: candidate.symbol, name: candidate.name, underlying_symbol: candidate.symbol, underlying_name: candidate.name,
      contract_id: candidate.contract_id, issuer: candidate.issuer, decimals: candidate.decimals,
      reference_price: null, latest_price: null, price_status: 'unavailable', stats: null,
      executable: false, preparation_available: false, execution_status: 'discovery_only',
      reason: candidate.network === 'mainnet' ? 'MAINNET_ONLY' : 'TESTNET_ROUTE_AND_ELIGIBILITY_UNVERIFIED',
      source_url: discovery.tokens_source, observed_at: discovery.observed_at } satisfies StockCatalogMarket];
  });
}
export async function readStockCatalog(options: { fetch?: typeof fetch; now?: () => Date } = {}): Promise<StockCatalogMarket[]> {
  return projectStockCatalog(await readStockDiscovery(options));
}
