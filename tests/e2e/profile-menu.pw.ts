import{test,expect,type Page}from'@playwright/test';
// Fully mocked UI/session fixtures. Run SDK-free; external provider calls are blocked.
const origin=process.env.E2E_FINTECH_URL??'http://localhost:3002';
test.use({serviceWorkers:'block'});
async function fixture(page:Page,{partial=false,failure=false,foreign=false,deferred=false}={}){
 await page.context().route('**/*',route=>new URL(route.request().url()).origin===new URL(origin).origin?route.continue():route.abort('blockedbyclient'));
 const calls={values:0,logout:0,release:()=>{}};let signedIn=true;const valuationWait=deferred?new Promise<void>(resolve=>{calls.release=resolve;}):Promise.resolve();
 await page.route(origin+'/api/**',async route=>{const path=new URL(route.request().url()).pathname;let data:unknown={};
  if(path.endsWith('/session')){if(route.request().method()==='DELETE'){calls.logout++;signedIn=false;data={};}else data=signedIn?{customer_id:'customer',wallet_id:'wallet',stellar_address:'fixture'}:null;}
  else if(path.endsWith('/status'))data={grapnel_configured:true,privy_configured:true,session_configured:true};
  else if(path.endsWith('/capabilities'))data={capabilities:[{module:'capital.wallets',enabled:true,execution_status:'testnet_verified'}]};
  else if(path.endsWith('/operations'))data={operations:[]};else if(path.endsWith('/balances'))data=[];
  else if(path.endsWith('/wallet-valuation')){calls.values++;await valuationWait;if(failure)return route.fulfill({status:503,json:{error:{code:'EXECUTION_UNAVAILABLE',message:'Value cannot be read'}}});data={wallet_id:foreign?'other-wallet':'wallet',total_usd:partial?null:'1234.56789',priced_subtotal_usd:partial?'99.9876543':'1234.56789',unpriced_asset_count:partial?2:0,as_of:'2026-11-11T12:34:56Z'};}
  return route.fulfill({json:{data}});
 });
 await page.goto(origin+'/home');await expect(page.getByTestId('profile-button')).toBeVisible();return calls;
}
test('account click reads estimated wallet value, never logs out, and supports Escape/outside/fresh reopen',async({page})=>{
 const calls=await fixture(page);const trigger=page.getByTestId('profile-button');expect(calls.values).toBe(0);
 await trigger.click();const panel=page.getByRole('dialog',{name:'Your account'});await expect(panel).toBeVisible();await expect(panel).toBeFocused();await expect(panel.getByText('Wallet connected',{exact:true})).toBeVisible();await expect(panel.getByTestId('profile-wallet-value')).toHaveText('1,234.56 USD');await expect(panel.locator('time')).toContainText('Nov. 11, 2026');expect(calls.values).toBe(1);expect(calls.logout).toBe(0);
 await page.keyboard.press('Tab');await expect(panel.getByRole('button',{name:'Logout',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(panel).toHaveCount(0);await expect(trigger).toBeFocused();
 await trigger.click();await expect.poll(()=>calls.values).toBe(2);await page.getByRole('heading',{name:'Overview',exact:true}).click();await expect(panel).toHaveCount(0);expect(calls.logout).toBe(0);
});
test('partial valuation is labelled priced assets with unknown assets counted, not a full wallet total',async({page})=>{
 await fixture(page,{partial:true});await page.getByTestId('profile-button').click();const panel=page.getByRole('dialog',{name:'Your account'});
 await expect(panel.getByText('Priced assets',{exact:true})).toBeVisible();await expect(panel.getByTestId('profile-wallet-value')).toHaveText('99.9876 USD');await expect(panel.getByText('2 assets not priced',{exact:true})).toBeVisible();
 await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(panel).toBeInViewport();await page.screenshot({path:test.info().outputPath('profile-menu-mobile.png')});
});
for(const mode of ['failure','foreign'] as const){test(`${mode} valuation never displays a fake zero or another wallet value`,async({page})=>{
 await fixture(page,{[mode]:true});await page.getByTestId('profile-button').click();const panel=page.getByRole('dialog',{name:'Your account'});await expect(panel.getByText('Value unavailable',{exact:true})).toBeVisible();await expect(panel.getByTestId('profile-wallet-value')).toHaveCount(0);await expect(panel).not.toContainText('0 USD');await expect(panel).not.toContainText('1,234.56');
});}
test('only the explicit nested Logout button ends the session',async({page})=>{
 const calls=await fixture(page);await page.getByTestId('profile-button').click();await expect(page.getByRole('dialog',{name:'Your account'})).toBeVisible();expect(calls.logout).toBe(0);await page.getByRole('dialog',{name:'Your account'}).getByRole('button',{name:'Logout',exact:true}).click();await expect.poll(()=>calls.logout).toBe(1);await expect(page.getByRole('dialog',{name:'Your account'})).toHaveCount(0);await expect(page.getByRole('heading',{name:'Welcome to Local Finance.',exact:true})).toBeVisible();
});


test('rapid close and reopen shares one in-flight valuation read',async({page})=>{
 const calls=await fixture(page,{deferred:true});const trigger=page.getByTestId('profile-button');await trigger.click();await expect.poll(()=>calls.values).toBe(1);await page.keyboard.press('Escape');await trigger.click();await expect(page.getByRole('dialog',{name:'Your account'})).toBeVisible();expect(calls.values).toBe(1);calls.release();await expect(page.getByTestId('profile-wallet-value')).toHaveText('1,234.56 USD');expect(calls.values).toBe(1);expect(calls.logout).toBe(0);
});
