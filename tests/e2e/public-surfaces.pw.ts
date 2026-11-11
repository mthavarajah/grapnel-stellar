import {test,expect} from '@playwright/test';
const dashboard=process.env.E2E_DASHBOARD_URL??'http://localhost:3000';
const fintech=process.env.E2E_FINTECH_URL??'http://localhost:3002';
test('business dashboard and consumer login load with the configured backend network',async({page})=>{
 const admin=await page.goto(dashboard);expect(admin?.status()).toBeLessThan(400);
 await expect(page.getByText(/testnet/i).first()).toBeVisible();
 await expect(page.locator('body')).not.toContainText(/application error|internal server error/i);
 const consumer=await page.goto(fintech);expect(consumer?.status()).toBeLessThan(400);
 await expect(page.getByText('local finance',{exact:true}).first()).toBeVisible();
 await expect(page.getByRole('heading',{name:/Welcome to Local Finance|Overview/i}).first()).toBeVisible();
 await expect(page.locator('body')).not.toContainText(/application error|internal server error/i);
 const status=await page.request.get(fintech+'/api/status');expect(status.ok()).toBe(true);
 expect((await status.json()).data.network).toBe('stellar-testnet');
});
test('browser output does not expose configured business or treasury secrets',async({page})=>{
 const secrets=[process.env.GRAPNEL_API_KEY,process.env.DEMO_TREASURY_SECRET,process.env.PRIVY_APP_SECRET].filter((v):v is string=>!!v);
 for(const url of [dashboard,fintech]){
  const bodies:string[]=[];page.on('response',async response=>{if(response.url().startsWith(url)){try{bodies.push(await response.text());}catch{}}});
  await page.goto(url);await page.waitForLoadState('networkidle');
  bodies.push(await page.content());
  for(const secret of secrets)expect(bodies.join('\n')).not.toContain(secret);
 }
});
