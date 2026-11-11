import { describe, expect, it, vi } from 'vitest';
import { Asset, Networks } from '@stellar/stellar-sdk';
import { readFileSync } from 'node:fs';
import { projectStockCatalog, readStockCatalog } from './catalog.js';
import { SODAX_CONFIG_URL, SODAX_TOKENS_URL, type StockDiscovery } from './discovery.js';
import { StocksTestnetDiscovery, assessStockNetwork } from './index.js';
const snapshot = (): StockDiscovery => JSON.parse(readFileSync(new URL('./evidence/sodax-registry.json', import.meta.url), 'utf8'));
describe('informational stock catalog — offline official metadata snapshot', () => {
  it('projects actual exact identities without prices or execution readiness', () => {
    const rows = projectStockCatalog(snapshot());
    expect(rows).toHaveLength(42);
    const apple = rows.find(row => row.underlying_symbol === 'AAPL')!;
    expect(apple).toMatchObject({ market_id: `sodax:catalog:mainnet:${apple.contract_id}`, network: 'stellar-mainnet',
      asset_class: 'stocks', classification: 'provider_rwa', underlying_name: 'Apple',
      price_status: 'unavailable', reference_price: null, latest_price: null, stats: null,
      executable: false, preparation_available: false, execution_status: 'discovery_only', reason: 'MAINNET_ONLY', source_url: SODAX_TOKENS_URL });
    expect(apple.issuer).toBe(snapshot().candidates.find(a=>a.symbol==='AAPL')?.issuer);
    expect(rows.every(row=>row.observed_at===snapshot().observed_at)).toBe(true);
    expect(new Set(rows.map(row=>row.market_id)).size).toBe(rows.length);
  });
  it('excludes commodity/Treasury funds and newly listed or renamed unreviewed categories', () => {
    const s = snapshot(); s.candidates[0]!.name = 'Unreviewed renamed product';
    const symbols = projectStockCatalog(s).map(row=>row.symbol);
    for (const symbol of ['USO','SLV','GLD','SGOV','SPCX']) expect(symbols).not.toContain(symbol);
    expect(symbols).toContain('SPY'); expect(symbols).toContain('QQQ');
  });
  it('rejects network relabeling, different issuer, duplicate identity and source replacement', () => {
    const a = snapshot(); a.candidates[0]!.network = 'testnet';
    expect(()=>projectStockCatalog(a)).toThrow('does not match');
    const b = snapshot(); b.candidates[0]!.issuer = b.candidates[0]!.contract_id;
    expect(()=>projectStockCatalog(b)).toThrow();
    const c = snapshot(); c.candidates.push(c.candidates[0]!);
    expect(()=>projectStockCatalog(c)).toThrow('Duplicate');
    const d = snapshot(); (d as {tokens_source:string}).tokens_source='https://example.invalid';
    expect(()=>projectStockCatalog(d)).toThrow('provenance');
  });
  it('keeps a separately verified Testnet identity distinct and still non-executable', () => {
    const s = snapshot(); s.candidates = s.candidates.filter(a=>a.symbol==='AAPL');
    const a=s.candidates[0]!; a.network='testnet'; a.contract_id=new Asset(a.symbol,a.issuer).contractId(Networks.TESTNET);
    const row=projectStockCatalog(s)[0]!;
    expect(row).toMatchObject({network:'stellar-testnet',reason:'TESTNET_ROUTE_AND_ELIGIBILITY_UNVERIFIED',executable:false,reference_price:null});
    expect(row.market_id).toBe(`sodax:catalog:testnet:${a.contract_id}`);
    expect(row.market_id).not.toBe(projectStockCatalog(snapshot()).find(a=>a.symbol==='AAPL')?.market_id);
  });
  it('reads official GET metadata via the class without changing execution-market eligibility', async () => {
    const s=snapshot(); const stellar=s.candidates.map(a=>({symbol:a.symbol,name:a.name,decimals:a.decimals,address:a.contract_id,chainKey:'stellar',isRwa:true}));
    const config={version:s.registry_version,supportedChains:['stellar'],spokeChainConfig:{stellar:{horizonRpcUrl:'https://horizon.stellar.org',trustlineConfigs:s.candidates.map(a=>({assetCode:a.symbol,assetIssuer:a.issuer,contractId:a.contract_id}))}}};
    const fetcher=vi.fn(async(input: string|URL|Request,init?:RequestInit)=>{expect(init?.method).toBe('GET');return new Response(JSON.stringify(String(input)===SODAX_CONFIG_URL?config:{stellar}));}) as typeof fetch;
    expect((await readStockCatalog({fetch:fetcher,now:()=>new Date(s.observed_at)}))).toHaveLength(42);
    const adapter=new StocksTestnetDiscovery({network:'testnet',networkPassphrase:Networks.TESTNET},fetcher);
    expect((await adapter.catalog())).toHaveLength(42);
    expect(fetcher).toHaveBeenCalledWith(SODAX_TOKENS_URL,expect.objectContaining({method:'GET'}));
    expect(assessStockNetwork({stellar:[{symbol:'XLM',address:Asset.native().contractId(Networks.PUBLIC)}]},['stellar']).markets).toEqual([]);
  });
});
