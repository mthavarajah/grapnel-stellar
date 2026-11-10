import {test,expect} from '@playwright/test';
const dashboard=process.env.E2E_DASHBOARD_URL??'http://localhost:3000';
const fintech=process.env.E2E_FINTECH_URL??'http://localhost:3002';
test('dashboard and independent fintech load with explicit Testnet scope',async({page})=>{
 for(const url of [dashboard,fintech]){
  const response=await page.goto(url);expect(response?.status()).toBeLessThan(400);
  await expect(page.getByText(/testnet/i).first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/application error|internal server error/i);
 }
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
