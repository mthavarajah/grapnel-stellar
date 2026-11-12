import{test,expect}from'@playwright/test';
// Retained chart/units coverage adapted to Hyperliquid. Explicit isolated, SDK-free
// fixtures only: no authentication provider, signing, broadcasting, or chain proof.
const origin=process.env.E2E_FINTECH_URL??'http://localhost:3002',id='hyperliquid-testnet:perps:0';
test.use({serviceWorkers:'block'});
test('Perpetuals shows exact source units and interactive Testnet prices while execution remains blocked',async({page})=>{
 const calls={writes:0,history:[] as string[]};await page.context().route('**/*',route=>new URL(route.request().url()).origin===new URL(origin).origin?route.continue():route.abort('blockedbyclient'));
 await page.route(origin+'/api/**',async route=>{const url=new URL(route.request().url()),path=url.pathname;let data:unknown={};if(route.request().method()!=='GET')calls.writes++;
  if(path.endsWith('/session'))data={customer_id:'customer',wallet_id:'wallet',stellar_address:'fixture'};
  else if(path.endsWith('/status'))data={grapnel_configured:true,privy_configured:true,session_configured:true};
  else if(path.endsWith('/capabilities'))data={capabilities:[{module:'capital.wallets',enabled:true,execution_status:'testnet_verified'},{module:'trade.perps',enabled:true,execution_status:'discovery_only'}]};
  else if(path.endsWith('/operations'))data={operations:[]};else if(path.endsWith('/balances'))data=[];
  else if(path.endsWith('/markets'))data=[{market_id:id,provider:'hyperliquid',network:'hyperliquid-testnet',underlying:{symbol:'BTC',name:'Bitcoin'},asset_class:'perps',reference_price:'74500.12',price_status:'current',observed_at:'2026-11-11T12:01:00Z',min_leverage:1,max_leverage:40,executable:false,settlement_asset:{code:'USDC',decimals:6,network:'hyperliquid-testnet'},perpetuals_stats:{mark_price:'74500.12',oracle_price:'74501',open_interest:'25.5',day_notional_volume:'20000',funding_rate:'0.0000125'}}];
  else if(path.endsWith('/market-history')){calls.history.push(url.searchParams.get('market_id')!);data={market_id:id,base_asset_id:id,base_symbol:'BTC',quote_symbol:'USDC',latest_price:'74500.12',as_of:'2026-11-11T12:00:00Z',points:[{timestamp:'2026-11-10T12:00:00Z',price:'74000'},{timestamp:'2026-11-11T12:00:00Z',price:'74500.12'}],change_absolute:'500.12',change_percent:'0.6758'};}
  return route.fulfill({json:{data}});
 });
 await page.goto(origin+'/markets?category=perps');await expect(page.getByTestId('markets-category-perps')).toHaveText('Perpetuals');const detail=page.getByTestId('perps-market-detail');await expect(detail).toContainText('BTC perpetual');
 const metrics=detail.getByTestId('perps-market-metrics');await expect(metrics).toContainText('Maximum leverage40×');await expect(metrics).toContainText('SettlementUSDC');await expect(metrics).toContainText('20,000 USDC');await expect(metrics).toContainText('25.5 BTC');await expect(metrics).toContainText('Funding rate (fraction)0.0000125');await expect(metrics).not.toContainText('%');
 const order=page.getByTestId('market-order-card');await expect(order.getByRole('button',{name:'Review BTC perpetual order'})).toBeDisabled();await expect(order).toContainText('Available trading balance: — USDC');await expect(detail.getByTestId('market-price-freshness').locator('time')).toHaveCount(0);await expect(page.locator('.market-price-observed')).toHaveCount(0);
 const chart=detail.getByTestId('price-chart');await chart.focus();await expect(detail.getByRole('tooltip')).toContainText('74500.12 USDC');await expect(detail.getByRole('tooltip').locator('time')).toHaveAttribute('datetime','2026-11-11T12:00:00Z');await expect(detail.getByRole('tooltip')).toContainText('Nov. 11, 2026');await expect(detail.locator('.market-chart-dates')).toContainText('Nov.');expect(calls.history).toEqual([id]);expect(calls.writes).toBe(0);await expect(page.locator('body')).not.toContainText(/Noether|Peridot|Mock USDT|Margin setup/);
});
