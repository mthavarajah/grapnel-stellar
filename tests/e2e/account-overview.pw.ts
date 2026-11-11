import{test,expect,type Page}from'@playwright/test';
// Explicit read-only aggregate fixtures, not blockchain proof. Authentication providers are never contacted.
const origin=process.env.E2E_FINTECH_URL??'http://localhost:3002';test.use({serviceWorkers:'block'});
async function fixture(page:Page,{partial=false,failed=false}={}){
 const calls={account:0,wallet:0};await page.context().route('**/*',route=>new URL(route.request().url()).origin===new URL(origin).origin?route.continue():route.abort('blockedbyclient'));
 await page.route(origin+'/api/**',async route=>{const path=new URL(route.request().url()).pathname;let data:unknown={};
  if(path.endsWith('/session'))data={customer_id:'customer',wallet_id:'wallet',stellar_address:'fixture'};
  else if(path.endsWith('/capabilities'))data={capabilities:[{module:'capital.wallets',enabled:true,execution_status:'testnet_verified'}]};
  else if(path.endsWith('/status'))data={grapnel_configured:true,privy_configured:true,session_configured:true};
  else if(path.endsWith('/balances'))data=[];else if(path.endsWith('/operations'))data={operations:[]};
  else if(path.endsWith('/account-valuation')){calls.account++;if(failed)return route.fulfill({status:503,json:{error:{code:'EXECUTION_UNAVAILABLE',message:'Value unavailable'}}});data={wallet_id:'wallet',total_usd:partial?null:'12345.6789',priced_subtotal_usd:partial?'4321.98765':'12345.6789',unpriced_asset_count:partial?2:0,as_of:'2026-11-11T12:00:00Z'};}
  else if(path.endsWith('/wallet-valuation')){calls.wallet++;data={wallet_id:'wallet',total_usd:'7.25',priced_subtotal_usd:'7.25',unpriced_asset_count:0,as_of:'2026-11-11T12:00:00Z'};}
  return route.fulfill({json:{data}});
 });await page.goto(origin+'/home');return calls;
}
test('Overview shows the sourced gross account total separately from wallet-only profile value with a clear local brand',async({page})=>{
 const calls=await fixture(page);const total=page.getByTestId('account-assets-total');await expect(total.getByText('Total Assets',{exact:true})).toBeVisible();await expect(total.locator('strong')).toHaveText('$12,345.6');expect(calls.account).toBe(1);expect(calls.wallet).toBe(0);await expect(page.getByRole('img',{name:'Local Finance',exact:true}).first()).toBeVisible();await expect(page.getByRole('link',{name:'Local Finance home'})).toBeVisible();
 await page.getByTestId('profile-button').click();await expect(page.getByTestId('profile-wallet-value')).toHaveText('7.25 USD');await expect(total.locator('strong')).toHaveText('$12,345.6');await page.keyboard.press('Escape');
 await page.locator('img').evaluateAll(images=>images.forEach(image=>{if(image instanceof HTMLImageElement)image.loading='eager';}));await expect.poll(()=>page.getByRole('link',{name:'Local Finance home'}).locator('img').evaluateAll(images=>images.every(image=>image instanceof HTMLImageElement&&image.complete&&image.naturalWidth>0))).toBe(true);await page.screenshot({path:test.info().outputPath('account-overview-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(page.getByRole('link',{name:'Local Finance home'}).locator('.local-finance-compact-mark')).toBeVisible();await page.screenshot({path:test.info().outputPath('account-overview-mobile.png'),fullPage:true});
});
test('partial account values never present a false full Total Assets figure',async({page})=>{
 await fixture(page,{partial:true});const total=page.getByTestId('account-assets-total');await expect(total.getByText('Estimated priced assets',{exact:true})).toBeVisible();await expect(total.locator('strong')).toHaveText('$4,321.98');await expect(total.getByText('2 assets not priced',{exact:true})).toBeVisible();await expect(total.getByText('Total Assets',{exact:true})).toHaveCount(0);
});
test('failed account valuation renders a dash instead of invented zero assets',async({page})=>{
 await fixture(page,{failed:true});const total=page.getByTestId('account-assets-total');await expect(total.getByText('Value unavailable',{exact:true})).toBeVisible();await expect(total.locator('strong')).toHaveText('—');await expect(total).not.toContainText('$0');
});
