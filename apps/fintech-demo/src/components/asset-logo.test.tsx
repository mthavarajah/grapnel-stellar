import{readFileSync}from'node:fs';import{createHash}from'node:crypto';import{describe,it,expect}from'vitest';import{renderToStaticMarkup}from'react-dom/server';import{AssetLogo,ASSET_LOGO_PATHS,assetLogoPath}from'./asset-logo';
const root=new URL('../../../../',import.meta.url);
const repo=(path:string)=>JSON.parse(readFileSync(new URL(path,root),'utf8'));
const publicFile=(path:string)=>readFileSync(new URL(`../../public${path}`,import.meta.url));
describe('Bundled local asset logos',()=>{
 it('covers every observed Noether underlying and SODAX catalog candidate plus all current Soroswap symbols',()=>{
  const perps=repo('apps/api/src/adapters/perps/research/public-discovery.json').markets.map((x:{underlying:{symbol:string}})=>x.underlying.symbol);
  const stocks=repo('apps/api/src/adapters/stocks/evidence/sodax-registry.json').candidates.map((x:{symbol:string})=>x.symbol);
  for(const symbol of [...perps,...stocks,'XLM','USDC','XTAR','BTC','XRP','EURC'])expect(assetLogoPath(symbol),symbol).not.toBe('/assets/logos/asset.svg');
 });
 it('uses local valid SVG or PNG content for every mapped path',()=>{for(const path of new Set(Object.values(ASSET_LOGO_PATHS))){expect(path).toMatch(/^\/assets\/[a-z0-9/-]+\.(svg|png)$/);const file=publicFile(path);if(path.endsWith('.svg')){const svg=file.toString('utf8');expect(svg).toMatch(/<svg[\s>]/);expect(svg).not.toMatch(/<html|<script|<foreignObject|\bonload\s*=|<image[^>]+(?:https?:|data:)/i);}else expect(file.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');}});
 it('records an exact source, rights notice and checksum for each downloaded mark',()=>{const manifest=JSON.parse(publicFile('/assets/logo-sources.json').toString('utf8'));for(const row of manifest){expect(row.source).toMatch(/^https:\/\//);expect(row.license.length).toBeGreaterThan(5);expect(createHash('sha256').update(publicFile(row.file)).digest('hex')).toBe(row.sha256);expect(ASSET_LOGO_PATHS[row.symbol]).toBe(row.file);}});
 it('renders meaningful alt text and local paths, including unknown generic assets',()=>{expect(renderToStaticMarkup(AssetLogo({symbol:'BTC',name:'Bitcoin',assetId:'exact-id',size:32}))).toContain('alt="Bitcoin logo"');expect(renderToStaticMarkup(AssetLogo({symbol:'BTC',size:32}))).toContain('width="32"');expect(assetLogoPath('btc-perp')).toBe(ASSET_LOGO_PATHS.BTC);expect(assetLogoPath('unknown')).toBe('/assets/logos/asset.svg');expect(renderToStaticMarkup(AssetLogo({symbol:'UNKNOWN'}))).not.toContain('https://');});
});

describe('Namespace-bound Hyperliquid market artwork',()=>{
 const manifest=JSON.parse(publicFile('/assets/hyperliquid-logo-sources.json').toString('utf8'));
 it('covers all recorded supported crypto, equity and index symbols with actual artwork',()=>{
  expect(manifest.downloaded_count).toBe(187);expect(manifest.missing).toEqual([]);expect(manifest.logos.filter((row:any)=>row.category==='crypto')).toHaveLength(158);expect(manifest.logos.filter((row:any)=>row.category==='equity')).toHaveLength(27);expect(manifest.logos.filter((row:any)=>row.category==='index')).toHaveLength(2);
  for(const row of manifest.logos)expect(assetLogoPath(row.provider_symbol,'hyperliquid-testnet:perps:750009',row.provider_symbol),row.provider_symbol).not.toBe('/assets/logos/asset.svg');
 });
 it('verifies actual file signatures, safe SVG content and every source checksum',()=>{
  for(const row of manifest.logos){expect(row.source).toMatch(/^https:\/\//);expect(row.license).toContain('no open license asserted');const b=publicFile(row.file);expect(createHash('sha256').update(b).digest('hex')).toBe(row.sha256);
   if(row.file.endsWith('.svg')){const svg=b.toString('utf8');expect(svg).toMatch(/<svg[\s>]/);expect(svg).not.toMatch(/<(?:script|foreignObject|iframe|object|embed)\b|\bon\w+\s*=|(?:href|src)\s*=\s*["']\s*(?:https?:|javascript:|\/\/)/i);for(const value of svg.matchAll(/(?:href|src)\s*=\s*["'](data:[^"']+)/gi))expect(value[1]).toMatch(/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i);}
   else if(row.file.endsWith('.jpg'))expect(b.subarray(0,3).toString('hex')).toBe('ffd8ff');else if(row.file.endsWith('.ico'))expect(b.subarray(0,4).toString('hex')).toBe('00000100');else throw Error('Unreviewed artwork format');
  }
 });
 it('reuses recognized company artwork only for an exact supported builder namespace',()=>{
  expect(assetLogoPath('AAPL','hyperliquid-testnet:perps:750009','xyz:AAPL')).toBe(ASSET_LOGO_PATHS.AAPL);
  expect(assetLogoPath('xyz:AAPL')).toBe('/assets/logos/asset.svg');expect(assetLogoPath('AAPL','hyperliquid-testnet:perps:750009','other:AAPL')).toBe('/assets/logos/asset.svg');expect(assetLogoPath('xyz:BTC','hyperliquid-testnet:perps:750009')).toBe('/assets/logos/asset.svg');
  expect(assetLogoPath('SKHX','hyperliquid-testnet:perps:750009','xyz:SKHX')).toContain('/hyperliquid/xyz-skhx.svg');
 });
 it('does not strip arbitrary multiplier prefixes or accept noncanonical market identities',()=>{
  expect(assetLogoPath('kPEPE','hyperliquid-testnet:perps:17')).toContain('/hyperliquid/kpepe.svg');expect(assetLogoPath('kAAPL','hyperliquid-testnet:perps:17')).toBe('/assets/logos/asset.svg');
  for(const id of ['01','-1','1000000000'])expect(assetLogoPath('AAPL','hyperliquid-testnet:perps:'+id,'xyz:AAPL')).toBe('/assets/logos/asset.svg');
 });
});
