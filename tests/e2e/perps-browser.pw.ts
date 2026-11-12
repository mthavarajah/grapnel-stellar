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
const indices:Record<string,number>={BTC:0,ETH:1,SOL:2,AAPL:750009,NVDA:750010};
const perpsId=(symbol:string)=>`hyperliquid-testnet:perps:${indices[symbol]}`;
const stocksId=(symbol:string)=>`hyperliquid-testnet:stocks:${indices[symbol]}`;
const market=(symbol:string,price:string|null,status:'current'|'stale'|'unavailable',stock=false)=>({
 market_id:stock?stocksId(symbol):perpsId(symbol),label:`${stock?'xyz:':''}${symbol} / ${stock?'USDH':'USDC'}`,asset_class:stock?'stocks':'perps',module:stock?'trade.stocks':'trade.perps',provider:'hyperliquid',network:'hyperliquid-testnet',instrument_type:'perpetual_futures',
 provider_symbol:stock?'xyz:'+symbol:symbol,provider_dex:stock?'xyz':'',asset_category:stock?'equity':'crypto',source_category:stock?'equity':'crypto',
 underlying:{symbol,name:({BTC:'Bitcoin',ETH:'Ethereum',SOL:'Solana',AAPL:'Apple',NVDA:'NVIDIA'} as Record<string,string>)[symbol],display_decimals:stock?2:8},reference_price:price,reference_price_atomic:null,price_status:status,
 oracle_timestamp:price===null?null:new Date(Date.now()-(status==='stale'?600000:1000)).toISOString(),oracle_age_seconds:status==='stale'?600:status==='current'?1:null,observed_at:now,price_timestamp_basis:'provider_response_received_at',source_url:'https://api.hyperliquid-testnet.xyz/info',execution_status:'discovery_only',executable:false,reason:stock?'UNSUPPORTED_PERPETUAL_COLLATERAL':'HYPERLIQUID_FUNDING_AND_EXECUTION_PROOF_REQUIRED',reason_message:stock?'This market uses a different collateral asset.':'Trading setup is being verified.',history_available:true,
 min_leverage:1,max_leverage:stock?10:40,only_isolated:false,quote_symbol:stock?'USDH':'USDC',settlement_asset:{code:stock?'USDH':'USDC',decimals:8,transfer_decimals:stock?null:6,network:'hyperliquid-testnet',token_id:stock?'fixture-source-usdh':'fixture-source-usdc',compatibility:stock?'other':'usdc'},perpetuals_stats:{mark_price:price,oracle_price:price,mid_price:price,previous_day_price:stock?'148.95':'74000',funding_rate:'0.0000125',open_interest:'25.5',day_notional_volume:'20000',day_base_volume:'250',premium:'0.0001'},
});
const markets=[market('BTC','74500.1234567','current'),market('ETH','2400.7500000','stale'),market('SOL',null,'unavailable')];
// Source-qualified Hyperliquid Testnet stock perpetual aliases. These fixtures
// establish neither Stellar stock tokens nor ownership of company shares.
const stocks=[market('AAPL','190.12','current',true),market('NVDA','150.34','current',true)];
const catalogRow=(row:ReturnType<typeof market>)=>({...row,reference_price:null,reference_price_atomic:null,price_status:'unavailable',oracle_timestamp:null,oracle_age_seconds:null,observed_at:now,perpetuals_stats:null});
async function selectMarket(page:Page,symbol:string){
 const option=page.getByTestId('market-option-'+symbol);
 if(!await option.isVisible()&&await page.getByTestId('market-browse-toggle').count())await page.getByTestId('market-browse-toggle').click();
 await option.click();
}

const history=(id:string,range:string)=>{
 const symbol=Object.keys(indices).find(symbol=>id===perpsId(symbol)||id===stocksId(symbol))!;
 const price=({BTC:'74500.1234567',ETH:'2400.7500000',AAPL:'190.12',NVDA:'150.34'} as Record<string,string>)[symbol];
 const span=({live:60000,'1d':86400000,'1w':604800000,'1m':2592000000,'1y':31536000000,all:63072000000} as Record<string,number>)[range]??60000;
 const stock=id.startsWith('hyperliquid-testnet:stocks:');
 return {market_id:id,base_asset_id:`hyperliquid-testnet:underlying:${symbol}`,base_symbol:symbol,quote_symbol:stock?'USDH':'USDC',latest_price:price,as_of:now,price_basis:'source_candle_close_at_bar_open_time',source_url:'https://example.invalid/isolated-price-history',interval:({live:'1m','1d':'15m','1w':'1h','1m':'4h','1y':'1d',all:'1d'} as Record<string,string>)[range],requested_range:range,history_limit:'most_recent_5000_source_candles',
 points:[{timestamp:new Date(Date.parse(now)-span).toISOString(),price:stock?'140':'2390'},{timestamp:new Date(Date.parse(now)-Math.round(span*0.73)).toISOString(),price:stock?'147.1234567':'2401.1234567'},{timestamp:now,price}],change_absolute:'10.34',change_percent:'0.67',
 source_network:'hyperliquid-testnet'};
};
async function fixture(page:Page,{allCategories=false,historyFailure=false,holdBtc=false,holdBtcDetail=false,stockCatalog=false,stockHistory=false,retiredVenues=false}={}){
 const calls={writes:[] as string[],histories:[] as {market_id:string;range:string}[],categories:[] as string[],details:[] as string[]};
 let pendingBtc:Route|undefined;let pendingBtcDetail:Route|undefined;let marketFailure=false;
 await page.route(origin+'/api/**',async route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  if(route.request().method()!=='GET'){calls.writes.push(path);return route.fulfill({status:409,json:{error:{code:'EXECUTION_UNAVAILABLE',message:'No fixture execution exists'}}});}
  let data:unknown={};
  if(path.endsWith('/session'))data={customer_id:'isolated-ui-customer',wallet_id:'isolated-ui-wallet',stellar_address:'isolated-ui-address'};
  else if(path.endsWith('/status'))data={grapnel_configured:true,privy_configured:true,session_configured:true};
  else if(path.endsWith('/capabilities'))data={capabilities:[{module:'capital.wallets',enabled:true,execution_status:'testnet_verified'},{module:'trade.perps',enabled:true,execution_status:'discovery_only'},...['spot','stocks'].map(module=>({module:'trade.'+module,enabled:allCategories,execution_status:'blocked'}))]};
  else if(path.endsWith('/operations'))data={operations:[]};
  else if(path.endsWith('/balances'))data=[{asset_id:'stellar-testnet:classic:USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56',wallet_amount:'999',spendable:'998'},{asset_id:'stellar-testnet:soroban:retired-mock-usdt',wallet_amount:'888',spendable:'887'}];
  else if(path.endsWith('/markets')){const category=url.searchParams.get('asset_class')??'crypto_spot';calls.categories.push(category);if(category==='perps'&&marketFailure)return route.fulfill({status:503,json:{error:{code:'MARKET_UNAVAILABLE',message:'Current market read failed'}}});data=category==='perps'?[...markets.map(catalogRow),...retiredVenues?[{...market('SOL','0.15','current'),market_id:'stellar-testnet:peridot:XLM-USDT-MARGIN',provider:'peridot',network:'stellar-testnet',underlying:{symbol:'XLM',name:'Stellar Lumens'},executable:true},{...market('SOL','1','current'),market_id:'stellar-testnet:noether:DOGE-PERP',provider:'noether',network:'stellar-testnet',underlying:{symbol:'DOGE',name:'Dogecoin'},executable:true}]:[]]:category==='stocks'&&stockCatalog?stocks.map(catalogRow):[];}
  else if(path.endsWith('/market-detail')){
   const id=url.searchParams.get('market_id')!;calls.details.push(id);
   if(marketFailure)return route.fulfill({status:503,json:{error:{code:'MARKET_UNAVAILABLE',message:'Current selected market read failed'}}});
   if(holdBtcDetail&&id===perpsId('BTC')){pendingBtcDetail=route;return;}
   const selected=[...markets,...stocks].find(row=>row.market_id===id);
   if(!selected)return route.fulfill({status:404,json:{error:{code:'NOT_FOUND',message:'Fixture selected market not found'}}});
   data=selected;
  }
  else if(path.endsWith('/market-history')){
   const id=url.searchParams.get('market_id')!,range=url.searchParams.get('range')!;calls.histories.push({market_id:id,range});
   if(historyFailure||(id.startsWith('hyperliquid-testnet:stocks:')&&!stockHistory))return route.fulfill({status:503,json:{error:{code:'HISTORY_UNAVAILABLE',message:'History is temporarily unavailable'}}});
   if(holdBtc&&id===perpsId('BTC')){pendingBtc=route;return;}
   data=history(id,range);
  }
  return route.fulfill({json:{data}});
 });
 await page.goto(origin+'/markets');
 await expect(page.getByTestId('markets-category-perps')).toHaveText('Perpetuals');
 if(!await page.getByTestId('markets-category-perps').evaluate(button=>button.classList.contains('selected')))await page.getByTestId('markets-category-perps').click();
 await expect(page.getByTestId('perps-market-detail')).toBeVisible();
 return {calls,setMarketFailure:(value:boolean)=>{marketFailure=value;},releaseBtc:async()=>{if(pendingBtc)await pendingBtc.fulfill({json:{data:history(perpsId('BTC'),'live')}});},releaseBtcDetail:async()=>{if(pendingBtcDetail)await pendingBtcDetail.fulfill({json:{data:markets[0]}});}};
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
 const order=page.getByTestId('market-order-card');await expect(order.getByRole('button',{name:'Review BTC perpetual order',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Get quote',exact:true})).toHaveCount(0);
 await order.getByRole('button',{name:'Review BTC perpetual order',exact:true}).evaluate((button:HTMLButtonElement)=>button.click());
 expect(calls.writes).toEqual([]);expect(calls.categories.every(category=>category==='perps')).toBe(true);
});

test('catalog loading reads only the exact selected Hyperliquid detail and keeps source settlement units',async({page})=>{
 const {calls}=await fixture(page,{allCategories:true,stockCatalog:true,stockHistory:true});
 await expect.poll(()=>calls.details.length).toBeGreaterThan(0);
 expect(calls.details.every(id=>id===perpsId('BTC'))).toBe(true);
 await expect(page.getByTestId('perps-market-metrics')).toContainText('74,500.1 USDC');
 const before=calls.details.length;await selectMarket(page,'ETH');
 await expect.poll(()=>calls.details.slice(before).includes(perpsId('ETH'))).toBe(true);
 expect(calls.details).not.toContain(perpsId('SOL'));
 await page.getByTestId('markets-category-stocks').click();
 await expect(page.getByTestId('stocks-market-detail')).toContainText('Apple');
 await expect.poll(()=>calls.details.includes(stocksId('AAPL'))).toBe(true);
 expect(calls.details).not.toContain(stocksId('NVDA'));
 await expect(page.getByTestId('stocks-market-detail')).toContainText('stock perpetual');
 await expect(page.getByTestId('perps-market-metrics')).toContainText('190.12 USDH');
 await expect(page.getByTestId('perps-market-metrics')).not.toContainText('USDC');
 const order=page.getByTestId('market-order-card');await expect(order).toContainText('Available trading balance: — USDH');
 await expect(order).toContainText('Funding this market with USDH is not supported.');await expect(order).not.toContainText('shares');
 await expect(order.getByRole('button',{name:'Review AAPL stock perpetual order',exact:true})).toBeDisabled();expect(calls.writes).toEqual([]);
});

test('selection and history ranges stay bound to the chosen perpetual market',async({page})=>{
 const {calls}=await fixture(page);await selectMarket(page,'BTC');
 await page.getByRole('group',{name:'Price timeframe'}).getByRole('button',{name:'1D',exact:true}).click();
 await expect.poll(()=>calls.histories.some(h=>h.market_id===perpsId('BTC')&&h.range==='1d')).toBe(true);
 await expect(page.getByRole('img',{name:'Price history',exact:true})).toBeVisible();
 await selectMarket(page,'ETH');
 await expect(page.getByTestId('perps-market-detail')).toContainText('ETH');await expect(page.getByTestId('perps-market-detail')).toContainText('Price delayed');
 await expect.poll(()=>calls.histories.some(h=>h.market_id===perpsId('ETH'))).toBe(true);
 if(!await page.getByTestId('market-search').isVisible())await page.getByTestId('market-browse-toggle').click();
 await page.getByTestId('market-search').fill('BTC');await expect(page.getByTestId('market-option-ETH')).toHaveCount(0);await expect(page.getByTestId('market-option-BTC')).toBeVisible();
 expect(calls.writes).toEqual([]);
});

test('missing public prices and failed history never fabricate a chart or execution',async({page})=>{
 const {calls}=await fixture(page,{historyFailure:true});await selectMarket(page,'SOL');
 await expect(page.getByTestId('perps-market-detail').locator('.market-price-heading strong')).toHaveText('—');
 await expect(page.getByRole('img',{name:'Price history',exact:true})).toHaveCount(0);
 await expect(page.getByTestId('market-order-card').getByRole('button',{name:'Review SOL perpetual order',exact:true})).toBeDisabled();
 expect(calls.writes).toEqual([]);
});

test('late history from a previous selection cannot overwrite the selected market',async({page})=>{
 const {calls,releaseBtc}=await fixture(page,{holdBtc:true});await selectMarket(page,'BTC');
 await expect.poll(()=>calls.histories.some(h=>h.market_id===perpsId('BTC'))).toBe(true);
 await selectMarket(page,'ETH');await expect(page.getByTestId('perps-market-detail')).toContainText('ETH');
 await releaseBtc();await expect(page.getByTestId('perps-market-detail')).toContainText('ETH');await expect(page.getByTestId('perps-market-detail')).not.toContainText('74,500');
 expect(calls.writes).toEqual([]);
});

test('late selected-market detail cannot overwrite a newer exact market selection',async({page})=>{
 const {calls,releaseBtcDetail}=await fixture(page,{holdBtcDetail:true});
 await expect.poll(()=>calls.details.includes(perpsId('BTC'))).toBe(true);
 await selectMarket(page,'ETH');
 const detail=page.getByTestId('perps-market-detail');await expect(detail).toContainText('ETH');await expect(detail).toContainText('2,400.75');
 await releaseBtcDetail();await expect(detail).toContainText('ETH');await expect(detail).not.toContainText('74,500');
 await expect(page.getByTestId('market-order-card')).toContainText('Trade ETH');expect(calls.writes).toEqual([]);
});

test('enabled stock category with no approved route stay empty',async({page})=>{
 const {calls}=await fixture(page,{allCategories:true});
 for(const category of ['stocks']){
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
 const detail=page.getByTestId('perps-market-detail');await expect(detail).toContainText('ETH');await expect(page.getByTestId('market-order-card').getByRole('alert')).toContainText('Current market data could not be loaded.');
 await expect(detail.locator('.market-price-heading strong')).toHaveText('—');
 await expect(detail).not.toContainText('200 USDC');expect(calls.writes).toEqual([]);
});

test('stock perpetual alias search and selection bind exact Testnet detail while missing history stays empty',async({page})=>{
 const {calls}=await fixture(page,{allCategories:true,stockCatalog:true});
 await page.getByTestId('markets-category-stocks').click();
 await expect(page.getByTestId('stocks-market-detail')).toContainText('Apple');
 await selectMarket(page,'NVDA');
 const detail=page.getByTestId('stocks-market-detail');await expect(detail).toContainText('NVIDIA');await expect(detail).toContainText('stock perpetual');await expect(detail).toContainText('150.34');
 const order=page.getByTestId('market-order-card');await expect(order).toContainText('NVDA');await expect(order.getByRole('button',{name:'Review NVDA stock perpetual order',exact:true})).toBeDisabled();
 await expect(page.getByRole('img',{name:'Price history',exact:true})).toHaveCount(0);
 if(!await page.getByTestId('market-search').isVisible())await page.getByTestId('market-browse-toggle').click();
 await page.getByTestId('market-search').focus();await page.getByTestId('market-search').fill('AAPL');
 await expect(page.getByTestId('market-option-NVDA')).toHaveCount(0);await page.getByTestId('market-option-AAPL').click();
 await expect(detail).toContainText('Apple');await expect(order).toContainText('AAPL');
 expect(calls.histories.some(h=>h.market_id===stocksId('NVDA'))).toBe(true);expect(calls.histories.every(h=>h.market_id.startsWith('hyperliquid-testnet:'))).toBe(true);expect(calls.details).toContain(stocksId('NVDA'));await expect(order).toContainText('Funding this market with USDH is not supported.');await expect(order).not.toContainText('shares');expect(calls.writes).toEqual([]);
});


test('stock perpetual history requests each horizon with source settlement metrics and full dates',async({page})=>{
 const {calls}=await fixture(page,{allCategories:true,stockCatalog:true,stockHistory:true});
 await page.getByTestId('markets-category-stocks').click();
 await expect(page.getByTestId('stocks-market-detail')).toContainText('Apple');await selectMarket(page,'NVDA');
 const detail=page.getByTestId('stocks-market-detail');await expect(detail).toContainText('150.34');await expect(detail).toContainText('Current price');await expect(detail).toContainText('stock perpetual');
 const metrics=page.getByTestId('perps-market-metrics');await expect(metrics).toContainText('150.34 USDH');await expect(metrics).toContainText('20,000 USDH');await expect(metrics).toContainText('25.5 NVDA');await expect(metrics).toContainText('Funding rate (fraction)');await expect(metrics).toContainText('0.0000125');await expect(page.getByTestId('stock-market-metrics')).toHaveCount(0);await expect(metrics).not.toContainText('shares');
 for(const range of ['live','1d','1w','1m','1y','all']){
  await page.getByRole('group',{name:'Price timeframe'}).getByRole('button',{name:range.toUpperCase(),exact:true}).click();
  await expect.poll(()=>calls.histories.some(h=>h.market_id===stocks[1].market_id&&h.range===range)).toBe(true);
  await expect(detail.getByRole('img',{name:'Price history',exact:true})).toBeVisible();
 }
 await expect(detail.locator('.market-chart-dates')).toContainText(new Date(now).getUTCFullYear().toString());
 await expect(page.getByTestId('market-order-card')).toContainText('NVDA');
 expect(calls.writes).toEqual([]);
 await page.screenshot({path:test.info().outputPath('stock-reference-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:test.info().outputPath('stock-reference-mobile.png'),fullPage:true});
});

// These tests assert source samples, not an interpolated value from the drawn line.
async function expectChartSample(page:Page,point:{timestamp:string;price:string},unit='USDH'){
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
 const samples=history(perpsId('ETH'),'live').points;
 await chart.press('Home');await expectChartSample(page,samples[0]!,'USDC');
 await chart.press('ArrowRight');await expectChartSample(page,samples[1]!,'USDC');
 await chart.press('End');await expectChartSample(page,samples[2]!,'USDC');
 await chart.press('ArrowLeft');await expectChartSample(page,samples[1]!,'USDC');
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

// Retirement regression replaces the removed Peridot setup/funding page fixtures.
test('retired margin venues cannot render new setups or reuse Stellar token balances',async({page})=>{
 const {calls}=await fixture(page,{retiredVenues:true});await page.getByTestId('market-browse-toggle').click();
 await expect(page.getByTestId('market-option-BTC')).toBeVisible();await expect(page.getByTestId('market-option-XLM')).toHaveCount(0);await expect(page.getByTestId('market-option-DOGE')).toHaveCount(0);
 await expect(page.getByTestId('margin-workflow-card')).toHaveCount(0);await expect(page.getByTestId('margin-collateral-wallet')).toHaveCount(0);
 const order=page.getByTestId('market-order-card');await expect(order).toContainText('Available trading balance: — USDC');await expect(order).not.toContainText('999');await expect(order).not.toContainText('888');await expect(order.getByRole('textbox',{name:'Order amount'})).toBeDisabled();
 const review=order.getByRole('button',{name:'Review BTC perpetual order'});await expect(review).toHaveText('Review');await expect(review).toBeDisabled();await review.evaluate((button:HTMLButtonElement)=>button.click());
 await expect(page.getByRole('dialog')).toHaveCount(0);expect(calls.writes).toEqual([]);expect(calls.histories.every(call=>call.market_id.startsWith('hyperliquid-testnet:perps:'))).toBe(true);await expect(page.locator('body')).not.toContainText(/Mock USDT|Peridot|Noether|Margin setup/);
});
