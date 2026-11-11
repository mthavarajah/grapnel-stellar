import {test,expect,type Page,type Route} from '@playwright/test';

// SDK-free, fully isolated UI fixtures only. Never authenticate a fabricated session
// against Privy/provider HTTP, and never mistake displayed fixture data for chain proof.
const origin=process.env.E2E_FINTECH_URL??'http://localhost:3002';
test.use({serviceWorkers:'block'});
test.beforeEach(async({context})=>{
 const allowed=new URL(origin).origin;
 await context.route('**/*',route=>new URL(route.request().url()).origin===allowed?route.continue():route.abort('blockedbyclient'));
});
const now=new Date().toISOString();
const market=(symbol:string,price:string|null,status:'current'|'stale'|'unavailable')=>({
 market_id:`stellar-testnet:noether:${symbol}-PERP`,label:`${symbol}-PERP`,asset_class:'perps',module:'trade.perps',provider:'noether',network:'stellar-testnet',
 underlying:{symbol,name:symbol==='BTC'?'Bitcoin':symbol==='ETH'?'Ethereum':'Solana',display_decimals:8},reference_price:price,reference_price_atomic:price===null?null:price.replace('.',''),price_decimals:7,price_status:status,
 oracle_timestamp:price===null?null:new Date(Date.now()-(status==='stale'?600000:1000)).toISOString(),oracle_age_seconds:status==='stale'?600:status==='current'?1:null,observed_at:now,source_url:'https://example.invalid/isolated-public-reference',execution_status:'discovery_only',executable:false,reason:'REGION_RESTRICTED',reason_message:'Trading is unavailable for this account.',
 stats:{open_interest_long_atomic:'100000000',open_interest_short_atomic:'50000000',open_interest_net_atomic:'50000000',open_positions:3,volume_24h_atomic:'2000000000',capacity:null},
});
const markets=[market('BTC','74500.1234567','current'),market('ETH','2400.7500000','stale'),market('SOL',null,'unavailable')];
// Captured public SODAX catalog identities only; these are mainnet metadata,
// not Stellar Testnet routes, prices or execution fixtures.
const stocks=[['AAPL','Apple','CAZSFDNSSR2RKJ2LIIB2Y4G4WOSYYKC4646EUJ63PQLDDHOVQYZ4HDTK'],['NVDA','NVIDIA','CCQFCT4FHJURUQ4RQA4NHYW5GQRHCBDXF33ADXZRTDTDVGKOJO3ZPEMY']].map(([symbol,name,contract])=>({market_id:'sodax:catalog:mainnet:'+contract,label:symbol,asset_class:'stocks',module:'trade.stocks',provider:'sodax',network:'stellar-mainnet',underlying:{symbol,name,display_decimals:7},reference_price:null,price_status:'unavailable',executable:false,execution_status:'blocked',reason:'STOCKS_ROUTE_USES_MAINNET_ASSETS',informational_only:true,stats:null}));
async function selectMarket(page:Page,symbol:string){
 const option=page.getByTestId('market-option-'+symbol);
 if(!await option.isVisible()&&await page.getByTestId('market-browse-toggle').count())await page.getByTestId('market-browse-toggle').click();
 await option.click();
}

const history=(id:string,range:string)=>{
 const symbol=id.includes('BTC')?'BTC':id.includes('ETH')?'ETH':id.includes('CAZSFD')?'AAPL':'NVDA';
 const price=({BTC:'74500.1234567',ETH:'2400.7500000',AAPL:'190.12',NVDA:'150.34'} as Record<string,string>)[symbol];
 const span=({live:60000,'1d':86400000,'1w':604800000,'1m':2592000000,'1y':31536000000,all:63072000000} as Record<string,number>)[range]??60000;
 const stock=id.startsWith('sodax:catalog:');
 return {market_id:id,base_asset_id:id,base_symbol:symbol,quote_symbol:'USD',latest_price:price,as_of:now,price_basis:stock?'underlying_equity_reference':'oracle_reference',source_url:'https://example.invalid/isolated-price-history',interval:range,
 points:[{timestamp:new Date(Date.parse(now)-span).toISOString(),price:stock?'140':'2390'},{timestamp:new Date(Date.parse(now)-Math.round(span*0.73)).toISOString(),price:stock?'147.1234567':'2401.1234567'},{timestamp:now,price}],change_absolute:'10.34',change_percent:'0.67',
 ...(stock?{metrics:{day_high:'194.12',day_low:'140.5',day_volume:'20000',fifty_two_week_high:'230.5',fifty_two_week_low:'100.25',previous_close:'148.95',market_time:now}}:{})};
};
async function fixture(page:Page,{allCategories=false,historyFailure=false,holdBtc=false,stockCatalog=false,stockHistory=false}={}){
 const calls={writes:[] as string[],histories:[] as {market_id:string;range:string}[],categories:[] as string[]};
 let pendingBtc:Route|undefined;let marketFailure=false;
 await page.route(origin+'/api/**',async route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  if(route.request().method()!=='GET'){calls.writes.push(path);return route.fulfill({status:409,json:{error:{code:'EXECUTION_UNAVAILABLE',message:'No fixture execution exists'}}});}
  let data:unknown={};
  if(path.endsWith('/session'))data={customer_id:'isolated-ui-customer',wallet_id:'isolated-ui-wallet',stellar_address:'isolated-ui-address'};
  else if(path.endsWith('/status'))data={grapnel_configured:true,privy_configured:true,session_configured:true};
  else if(path.endsWith('/capabilities'))data={capabilities:[{module:'capital.wallets',enabled:true,execution_status:'testnet_verified'},{module:'trade.perps',enabled:true,execution_status:'discovery_only'},...['spot','stocks','commodities'].map(module=>({module:'trade.'+module,enabled:allCategories,execution_status:'blocked'}))]};
  else if(path.endsWith('/operations'))data={operations:[]};
  else if(path.endsWith('/markets')){const category=url.searchParams.get('asset_class')??'crypto_spot';calls.categories.push(category);if(category==='perps'&&marketFailure)return route.fulfill({status:503,json:{error:{code:'MARKET_UNAVAILABLE',message:'Current market read failed'}}});data=category==='perps'?markets:category==='stocks'&&stockCatalog?stocks.map(stock=>({...stock,history_available:stockHistory})):[];}
  else if(path.endsWith('/market-history')){
   const id=url.searchParams.get('market_id')!,range=url.searchParams.get('range')!;calls.histories.push({market_id:id,range});
   if(historyFailure)return route.fulfill({status:503,json:{error:{code:'HISTORY_UNAVAILABLE',message:'History is temporarily unavailable'}}});
   if(holdBtc&&id.includes('BTC')){pendingBtc=route;return;}
   data=history(id,range);
  }
  return route.fulfill({json:{data}});
 });
 await page.goto(origin+'/markets');
 await expect(page.getByTestId('markets-category-perps')).toBeVisible();
 if(!await page.getByTestId('markets-category-perps').evaluate(button=>button.classList.contains('selected')))await page.getByTestId('markets-category-perps').click();
 await expect(page.getByTestId('perps-market-detail')).toBeVisible();
 return {calls,setMarketFailure:(value:boolean)=>{marketFailure=value;},releaseBtc:async()=>{if(pendingBtc)await pendingBtc.fulfill({json:{data:history('stellar-testnet:noether:BTC-PERP','live')}});}};
}

test('entitlements hide unavailable categories while public perps remain view-only',async({page})=>{
 const {calls}=await fixture(page);
 await page.getByTestId('markets-category-perps').click();
 await expect(page.getByTestId('perps-market-detail')).toContainText('BTC');
 await expect(page.getByTestId('markets-category-crypto_spot')).toHaveCount(0);
 await expect(page.getByTestId('markets-category-stocks')).toHaveCount(0);
 await expect(page.getByTestId('markets-category-commodities')).toHaveCount(0);
 await selectMarket(page,'BTC');
 const detail=page.getByTestId('perps-market-detail');await expect(detail).toContainText('BTC');await expect(detail).toContainText('74,500');await expect(detail).toContainText('Current price');
 const order=page.getByTestId('market-order-card');await expect(order.getByRole('button',{name:'Trading unavailable',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Get quote',exact:true})).toHaveCount(0);
 await order.getByRole('button',{name:'Trading unavailable',exact:true}).evaluate((button:HTMLButtonElement)=>button.click());
 expect(calls.writes).toEqual([]);expect(calls.categories.every(category=>category==='perps')).toBe(true);
});

test('selection and history ranges stay bound to the chosen perpetual market',async({page})=>{
 const {calls}=await fixture(page);await selectMarket(page,'BTC');
 await page.getByRole('group',{name:'Price timeframe'}).getByRole('button',{name:'1D',exact:true}).click();
 await expect.poll(()=>calls.histories.some(h=>h.market_id==='stellar-testnet:noether:BTC-PERP'&&h.range==='1d')).toBe(true);
 await expect(page.getByRole('img',{name:'Price history',exact:true})).toBeVisible();
 await selectMarket(page,'ETH');
 await expect(page.getByTestId('perps-market-detail')).toContainText('ETH');await expect(page.getByTestId('perps-market-detail')).toContainText('Price delayed');
 await expect.poll(()=>calls.histories.some(h=>h.market_id==='stellar-testnet:noether:ETH-PERP')).toBe(true);
 if(!await page.getByTestId('market-search').isVisible())await page.getByTestId('market-browse-toggle').click();
 await page.getByTestId('market-search').fill('BTC');await expect(page.getByTestId('market-option-ETH')).toHaveCount(0);await expect(page.getByTestId('market-option-BTC')).toBeVisible();
 expect(calls.writes).toEqual([]);
});

test('missing public prices and failed history never fabricate a chart or execution',async({page})=>{
 const {calls}=await fixture(page,{historyFailure:true});await selectMarket(page,'SOL');
 await expect(page.getByTestId('perps-market-detail')).toContainText('Price unavailable');
 await expect(page.getByRole('img',{name:'Price history',exact:true})).toHaveCount(0);
 await expect(page.getByTestId('market-order-card').getByRole('button',{name:'Trading unavailable',exact:true})).toBeDisabled();
 expect(calls.writes).toEqual([]);
});

test('late history from a previous selection cannot overwrite the selected market',async({page})=>{
 const {calls,releaseBtc}=await fixture(page,{holdBtc:true});await selectMarket(page,'BTC');
 await expect.poll(()=>calls.histories.some(h=>h.market_id.includes('BTC'))).toBe(true);
 await selectMarket(page,'ETH');await expect(page.getByTestId('perps-market-detail')).toContainText('ETH');
 await releaseBtc();await expect(page.getByTestId('perps-market-detail')).toContainText('ETH');await expect(page.getByTestId('perps-market-detail')).not.toContainText('74,500');
 expect(calls.writes).toEqual([]);
});

test('enabled stock and commodity categories with no approved route stay empty',async({page})=>{
 const {calls}=await fixture(page,{allCategories:true});
 for(const category of ['stocks','commodities']){
  await page.getByTestId('markets-category-'+category).click();
  await expect(page.getByTestId('perps-market-detail')).toHaveCount(0);
  await expect(page.getByTestId('market-option-BTC')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Get quote',exact:true})).toHaveCount(0);
 }
 expect(calls.writes).toEqual([]);
});


test('visible polling preserves selection and hidden tabs pause public reads; failed reads clear the current price',async({page})=>{
 await page.clock.install({time:Date.now()});
 const {calls,setMarketFailure}=await fixture(page);await selectMarket(page,'ETH');
 const before=calls.categories.length;
 await page.evaluate(()=>Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'}));
 await page.clock.fastForward(15001);expect(calls.categories.length).toBe(before);
 setMarketFailure(true);
 await page.evaluate(()=>Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'}));
 await page.clock.fastForward(15001);
 await expect.poll(()=>calls.categories.length).toBeGreaterThan(before);
 const detail=page.getByTestId('perps-market-detail');await expect(detail).toContainText('ETH');await expect(detail).toContainText('Price unavailable');
 await expect(detail.locator('.market-price-heading strong')).toHaveText('—');
 await expect(detail).not.toContainText('200 USDC');expect(calls.writes).toEqual([]);
});

test('stock catalog search and selection update the detail and disabled trade context without Testnet history requests',async({page})=>{
 const {calls}=await fixture(page,{allCategories:true,stockCatalog:true});
 await page.getByTestId('markets-category-stocks').click();
 await expect(page.getByTestId('stocks-market-detail')).toContainText('Apple');
 await selectMarket(page,'NVDA');
 const detail=page.getByTestId('stocks-market-detail');await expect(detail).toContainText('NVIDIA');await expect(detail).toContainText('Price data unavailable');
 const order=page.getByTestId('market-order-card');await expect(order).toContainText('NVDA');await expect(order.getByRole('button',{name:'Trading unavailable',exact:true})).toBeDisabled();
 await expect(page.getByRole('img',{name:'Price history',exact:true})).toHaveCount(0);
 if(!await page.getByTestId('market-search').isVisible())await page.getByTestId('market-browse-toggle').click();
 await page.getByTestId('market-search').focus();await page.getByTestId('market-search').fill('AAPL');
 await expect(page.getByTestId('market-option-NVDA')).toHaveCount(0);await page.getByTestId('market-option-AAPL').click();
 await expect(detail).toContainText('Apple');await expect(order).toContainText('AAPL');
 expect(calls.histories.some(h=>h.market_id.startsWith('sodax:catalog:'))).toBe(false);expect(calls.writes).toEqual([]);
});


test('stock reference history requests each horizon and renders sourced price metrics and full dates',async({page})=>{
 const {calls}=await fixture(page,{allCategories:true,stockCatalog:true,stockHistory:true});
 await page.getByTestId('markets-category-stocks').click();
 await expect(page.getByTestId('stocks-market-detail')).toContainText('Apple');await selectMarket(page,'NVDA');
 const detail=page.getByTestId('stocks-market-detail');await expect(detail).toContainText('150.34');await expect(detail).toContainText('Stock reference price');
 const metrics=page.getByTestId('stock-market-metrics');await expect(metrics).toContainText('194.12 USD');await expect(metrics).toContainText('20,000 shares');await expect(metrics).toContainText('52-week high');
 for(const range of ['live','1d','1w','1m','1y','all']){
  await page.getByRole('group',{name:'Price timeframe'}).getByRole('button',{name:range.toUpperCase(),exact:true}).click();
  await expect.poll(()=>calls.histories.some(h=>h.market_id===stocks[1].market_id&&h.range===range)).toBe(true);
  await expect(detail.getByRole('img',{name:'Price history',exact:true})).toBeVisible();
 }
 await expect(detail.locator('.market-chart-dates')).toContainText(/Nov\. 11, 2026/);
 await expect(page.getByTestId('market-order-card')).toContainText('NVDA');
 expect(calls.writes).toEqual([]);
 await page.screenshot({path:test.info().outputPath('stock-reference-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:test.info().outputPath('stock-reference-mobile.png'),fullPage:true});
});

// These tests assert source samples, not an interpolated value from the drawn line.
async function expectChartSample(page:Page,point:{timestamp:string;price:string},unit='USD'){
 const tooltip=page.getByTestId('price-chart-tooltip');
 await expect(tooltip).toBeVisible();await expect(tooltip).toContainText(point.price);await expect(tooltip).toContainText(unit);
 await expect(tooltip.locator('time')).toHaveAttribute('datetime',point.timestamp);
 await expect(tooltip.locator('time')).toContainText(new Date(point.timestamp).getUTCFullYear().toString());
 await expect(tooltip.locator('time')).toContainText(/\d{1,2}:\d{2}:\d{2}/);
 await expect(page.getByTestId('price-chart-selected-point')).toBeVisible();const crosshair=page.getByTestId('price-chart-crosshair');await expect(crosshair).toHaveAttribute('y2','265');expect(await crosshair.evaluate(line=>getComputedStyle(line).stroke)).not.toBe('none');
}

test('stock chart pointer snaps to an exact irregular source sample and a new horizon replaces its timestamp',async({page})=>{
 const {calls}=await fixture(page,{allCategories:true,stockCatalog:true,stockHistory:true});
 await page.getByTestId('markets-category-stocks').click();await selectMarket(page,'NVDA');
 const chart=page.getByTestId('price-chart');
 await page.getByRole('group',{name:'Price timeframe'}).getByRole('button',{name:'1D',exact:true}).click();
 await expect.poll(()=>calls.histories.at(-1)?.range).toBe('1d');await expect(chart).toBeVisible();
 // The middle observation lies at27% of elapsed time; pointer50% must snap to it.
 const box=await chart.boundingBox();expect(box).not.toBeNull();
 await chart.hover({position:{x:box!.width/2,y:box!.height/2}});
 const oldPoint=history(stocks[1].market_id!,'1d').points[1]!;await expectChartSample(page,oldPoint);
 await page.getByRole('group',{name:'Price timeframe'}).getByRole('button',{name:'1Y',exact:true}).click();
 await expect.poll(()=>calls.histories.at(-1)?.range).toBe('1y');await expect(chart).toBeVisible();
 const yearBox=await chart.boundingBox();await chart.hover({position:{x:yearBox!.width/2,y:yearBox!.height/2}});
 const yearPoint=history(stocks[1].market_id!,'1y').points[1]!;await expectChartSample(page,yearPoint);
 expect(yearPoint.timestamp).not.toBe(oldPoint.timestamp);
 await page.getByRole('heading',{name:'Markets',exact:true}).hover();await expect(page.getByTestId('price-chart-tooltip')).toHaveCount(0);
 expect(calls.writes).toEqual([]);
});

test('perpetual chart keyboard traverses only exact samples including first and last',async({page})=>{
 const {calls}=await fixture(page);await selectMarket(page,'ETH');
 const chart=page.getByTestId('price-chart');await expect(chart).toBeVisible();await chart.focus();
 const samples=history('stellar-testnet:noether:ETH-PERP','live').points;
 await chart.press('Home');await expectChartSample(page,samples[0]!);
 await chart.press('ArrowRight');await expectChartSample(page,samples[1]!);
 await chart.press('End');await expectChartSample(page,samples[2]!);
 await chart.press('ArrowLeft');await expectChartSample(page,samples[1]!);
 await page.getByTestId('market-search').focus();await expect(page.getByTestId('price-chart-tooltip')).toHaveCount(0);
 expect(calls.writes).toEqual([]);
});

test.describe('touch chart interaction',()=>{
 test.use({hasTouch:true,viewport:{width:390,height:844}});
 test('a touch selects the exact stock observation without overflow or financial requests',async({page})=>{
  const {calls}=await fixture(page,{allCategories:true,stockCatalog:true,stockHistory:true});
  await page.getByTestId('markets-category-stocks').click();await selectMarket(page,'NVDA');
  const chart=page.getByTestId('price-chart');await expect(chart).toBeVisible();const box=await chart.boundingBox();
  await chart.tap({position:{x:box!.width/2,y:box!.height/2}});
  await expectChartSample(page,history(stocks[1].market_id!,'live').points[1]!);
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:test.info().outputPath('stock-chart-touch.png'),fullPage:true});expect(calls.writes).toEqual([]);
 });
});
