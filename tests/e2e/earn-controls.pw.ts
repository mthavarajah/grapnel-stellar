import {test,expect} from '@playwright/test';
// Explicit interface fixtures; these do not attest protocol or chain execution.
const origin=process.env.E2E_FINTECH_URL??'http://localhost:3002';
const XLM='stellar-testnet:native:XLM';
const USDC='stellar-testnet:classic:USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56';
test('Earn uses one amount control per asset, preserves each action amount, and never invents earned values',async({page})=>{
 const requests:any[]=[];
 await page.route(origin+'/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;let data:unknown={};
  if(path.endsWith('/session'))data={customer_id:'customer',wallet_id:'wallet',stellar_address:'fixture-address'};
  else if(path.endsWith('/status'))data={grapnel_configured:true,privy_configured:true,session_configured:true};
  else if(path.endsWith('/capabilities'))data={capabilities:[{module:'capital.wallets',enabled:true,execution_status:'testnet_verified'},{module:'capital.lending',enabled:true,execution_status:'testnet_verified'}]};
  else if(path.endsWith('/operations'))data={operations:[]};
  else if(path.endsWith('/lending-markets'))data=[{market_id:'xlm-pool',asset_id:XLM,asset:{code:'XLM'},supply_apy_variable:0.05},{market_id:'usdc-pool',asset_id:USDC,asset:{code:'USDC'},supply_apy_variable:0.04}];
  else if(path.endsWith('/earn-balances'))data={balances:[{asset_id:XLM,spendable:'123.456789',in_earn:'10',earned:'0.0123456789',earned_since:'2026-11-11T10:00:00Z',trustline_required:false},{asset_id:USDC,spendable:'2',in_earn:'0',earned:null,earned_since:null,trustline_required:false}]};
  else if(path.endsWith('/lending/withdraw')||path.endsWith('/lending/supply')){requests.push({path,...route.request().postDataJSON()});return route.fulfill({status:503,json:{error:{code:'EXECUTION_UNAVAILABLE',message:'This action is unavailable right now.'}}});}
  return route.fulfill({json:{data}});
 });
 await page.goto(origin+'/earn');
 const xlm=page.locator('.pool').filter({has:page.getByRole('heading',{name:'XLM',exact:true})});
 const usdc=page.locator('.pool').filter({has:page.getByRole('heading',{name:'USDC',exact:true})});
 await expect(xlm.getByRole('textbox')).toHaveCount(1);await expect(usdc.getByRole('textbox')).toHaveCount(1);
 await expect(xlm.locator('dl')).toContainText('Available123.456');await expect(xlm.locator('dl')).toContainText('Earned0.0123456');
 await expect(usdc.locator('dl')).toContainText('Earned—');
 await xlm.getByRole('textbox').fill('1.2345678');
 await xlm.getByRole('group').getByRole('button',{name:'Withdraw',exact:true}).click();
 await expect(xlm.getByRole('textbox')).toHaveValue('');await xlm.getByRole('textbox').fill('0.1234567');
 await usdc.getByRole('textbox').fill('2');
 await xlm.getByRole('group').getByRole('button',{name:'Supply',exact:true}).click();
 await expect(xlm.getByRole('textbox')).toHaveValue('1.2345678');
 await xlm.getByRole('group').getByRole('button',{name:'Withdraw',exact:true}).click();
 await expect(xlm.getByRole('textbox')).toHaveValue('0.1234567');await expect(usdc.getByRole('textbox')).toHaveValue('2');
 await xlm.getByRole('button',{name:'Withdraw',exact:true}).last().click();
 await expect.poll(()=>requests.length).toBe(1);expect(requests[0]).toMatchObject({path:'/api/grapnel/lending/withdraw',market_id:'xlm-pool',asset_id:XLM,amount:'0.1234567'});
 await page.screenshot({path:test.info().outputPath('earn-compact-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:test.info().outputPath('earn-compact-mobile.png'),fullPage:true});
});
