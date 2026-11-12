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
