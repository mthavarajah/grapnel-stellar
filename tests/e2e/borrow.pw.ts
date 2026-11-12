import{test,expect,type Page}from'@playwright/test';
// Fully mocked customer fixtures only; never attest actual chain execution or call authentication providers.
const origin=process.env.E2E_FINTECH_URL??'http://localhost:3002';
const XLM='stellar-testnet:native:XLM',USDC='stellar-testnet:classic:USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56';
test.use({serviceWorkers:'block'});
async function fixture(page:Page,{blocked=false,disabled=false,unavailable=false,preparationError=null,operationState='awaiting_customer_authorization'}={} as {blocked?:boolean;disabled?:boolean;unavailable?:boolean;preparationError?:{status:number;code:string;message:string}|null;operationState?:string}){
 await page.context().route('**/*',route=>new URL(route.request().url()).origin===new URL(origin).origin?route.continue():route.abort('blockedbyclient'));
 const writes:{path:string;body:any}[]=[];const idempotencyKeys:string[]=[];let operation:any;
 const assets=[XLM,USDC].map((id,index)=>({market_id:`verified-borrowing-${index}`,asset:{id,network:'stellar-testnet',verified:true,code:index?'USDC':'XLM',decimals:7},borrow_apr:'0.12',borrow_apy:'0.1275',borrowed:blocked?'0.0000000':'1.2345678',repayable:blocked?'0.0000000':'1.2345678',available_liquidity:'12345.6789',available_to_borrow:blocked?null:'12.3456789',collateral:blocked?'0.0000000':'20.0000000',collateral_value:blocked?'0':'40',borrow_limit:blocked?null:'30',health_factor:blocked?null:'2.12345678',can_prepare_borrow:!blocked,can_prepare_repay:!blocked,can_prepare_collateral_supply:true,can_prepare_collateral_withdraw:!blocked,reason:blocked?'COLLATERAL_REQUIRED':null}));
 await page.route(origin+'/api/**',async route=>{const path=new URL(route.request().url()).pathname;let data:unknown={};
  if(path.endsWith('/session'))data={customer_id:'customer',wallet_id:'wallet',stellar_address:'fixture'};
  else if(path.endsWith('/status'))data={grapnel_configured:true,privy_configured:true,session_configured:true};
  else if(path.endsWith('/capabilities'))data={capabilities:[{module:'capital.wallets',enabled:true,execution_status:'testnet_verified'},{module:'capital.lending',enabled:!disabled,execution_status:'discovery_only'}]};
  else if(path.endsWith('/operations'))data={operations:[]};
  else if(path.endsWith('/borrowing')){if(unavailable)return route.fulfill({status:503,json:{error:{code:'EXECUTION_UNAVAILABLE',message:'Current loan information is unavailable.'}}});data={pool_id:'verified-new-pool',as_of:'2026-11-11T12:00:00Z',assets};}
  else if(route.request().method()==='POST'){
   const body=route.request().postDataJSON();writes.push({path,body});idempotencyKeys.push(route.request().headers()['idempotency-key']??'');if(preparationError&&writes.length===1)return route.fulfill({status:preparationError.status,json:{error:{code:preparationError.code,message:preparationError.message}}});const item=assets.find(row=>row.market_id===body.market_id)!;
   const action=path.endsWith('/lending/borrow')?'borrow':path.endsWith('/lending/repay')?'repay':path.endsWith('collateral-supply')?'borrow_collateral_supply':'borrow_collateral_withdraw';
   operation={operation_id:'00000000-0000-4000-8000-000000000003',customer_id:'customer',wallet_id:'wallet',type:`blend.${action}`,status:operationState,tx_hash:null,customer_action_token:'fixture',prepared_action:{summary:{action:`blend.${action}`,amount:body.amount,fromAssetId:item.asset.id,maxFeeStroops:'100000',expiresAt:new Date(Date.now()+60000).toISOString()}}};data=operation;
  }else if(path.includes('/operations/'))data=operation;
  return route.fulfill({json:{data}});
 });
 await page.goto(origin+'/borrow');return {writes,idempotencyKeys};
}
test('loan data shows ratios as rates, actual debt/capacity/health and independent borrow/repay amounts',async({page})=>{
 const {writes}=await fixture(page);const xlm=page.getByTestId('loan-xlm'),usdc=page.getByTestId('loan-usdc');
 await expect(page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Borrow',exact:true})).toBeVisible();
 await expect(xlm.getByText('12%',{exact:true})).toBeVisible();await expect(xlm.getByText('APY 12.75%',{exact:true})).toBeVisible();
 await expect(xlm.locator('dl')).toContainText('Your debt1.23456 XLM');await expect(xlm.locator('dl')).toContainText('Available to borrow12.3456 XLM');await expect(xlm.locator('dl')).toContainText('Health factor2.12345');await page.screenshot({path:test.info().outputPath('borrow-desktop.png'),fullPage:true});
 await xlm.getByRole('textbox').fill('0.1234567');await xlm.getByRole('group').getByRole('button',{name:'Repay',exact:true}).click();await expect(xlm.getByRole('textbox')).toHaveValue('');await xlm.getByRole('textbox').fill('0.0765432');await usdc.getByRole('textbox').fill('2');
 await xlm.getByRole('group').getByRole('button',{name:'Borrow',exact:true}).click();await expect(xlm.getByRole('textbox')).toHaveValue('0.1234567');
 await xlm.getByRole('button',{name:'Review borrow',exact:true}).click();await expect(page.getByRole('dialog').getByText('0.1234567 XLM',{exact:true})).toBeVisible();expect(writes).toEqual([{path:'/api/grapnel/lending/borrow',body:{market_id:'verified-borrowing-0',amount:'0.1234567'}}]);
 await expect(page.getByRole('dialog').getByRole('button',{name:'Approve transaction',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Close operation'}).click();
 await xlm.getByRole('group').getByRole('button',{name:'Repay',exact:true}).click();await expect(xlm.getByRole('textbox')).toHaveValue('0.0765432');await expect(usdc.getByRole('textbox')).toHaveValue('2');
 await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:test.info().outputPath('borrow-mobile.png'),fullPage:true});
});
test('zero collateral does not borrow from other Earn balances and only enables actual collateral setup',async({page})=>{
 const {writes}=await fixture(page,{blocked:true});const xlm=page.getByTestId('loan-xlm');await expect(xlm.getByText('Add collateral to this borrowing pool to enable borrowing. Your other Earn balances are separate.')).toBeVisible();
 await expect(xlm.locator('dl')).toContainText('Available to borrow—');await expect(xlm.locator('dl')).toContainText('Health factor—');await expect(xlm.getByRole('group').getByRole('button',{name:'Add collateral',exact:true})).toHaveAttribute('aria-pressed','true');await expect(xlm.getByRole('button',{name:'Review collateral deposit',exact:true})).toBeDisabled();await expect(xlm.getByText('Enter an amount to review your collateral deposit.')).toBeVisible();await xlm.getByRole('textbox').fill('1');await expect(xlm.getByRole('button',{name:'Review collateral deposit',exact:true})).toBeEnabled();await xlm.getByRole('group').getByRole('button',{name:'Borrow',exact:true}).click();await expect(xlm.getByRole('button',{name:'Review borrow',exact:true})).toBeDisabled();
 await xlm.getByRole('group').getByRole('button',{name:'Add collateral',exact:true}).click();await xlm.getByRole('textbox').fill('0.1234567');await xlm.getByRole('button',{name:'Review collateral deposit',exact:true}).click();await expect(page.getByRole('dialog').getByText('0.1234567 XLM',{exact:true})).toBeVisible();await expect(page.getByRole('dialog').getByText('You add as collateral',{exact:true})).toBeVisible();expect(writes).toEqual([{path:'/api/grapnel/borrow-collateral-supply',body:{market_id:'verified-borrowing-0',amount:'0.1234567'}}]);
});
test('disabled lending hides Borrow navigation and unavailable reads never manufacture figures',async({page})=>{
 await fixture(page,{disabled:true});await expect(page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Borrow',exact:true})).toHaveCount(0);await expect(page.getByTestId('loan-xlm')).toHaveCount(0);
});
test('failed live reads show an honest error with no fake loan balance',async({page})=>{
 await fixture(page,{unavailable:true});await expect(page.getByTestId('borrowing').getByRole('alert')).toBeVisible();await expect(page.getByTestId('loan-xlm')).toHaveCount(0);await expect(page.getByRole('button',{name:'Refresh loans',exact:true})).toBeEnabled();
});
for(const entry of [{label:'Repay',button:'Review repayment',path:'/api/grapnel/lending/repay',summary:'You repay'},{label:'Remove collateral',button:'Review collateral removal',path:'/api/grapnel/borrow-collateral-withdraw',summary:'You remove'}]){
 test(`USDC ${entry.label.toLowerCase()} reviews the exact amount and selected market without signing`,async({page})=>{
  const {writes}=await fixture(page);const usdc=page.getByTestId('loan-usdc');await usdc.getByRole('group').getByRole('button',{name:entry.label,exact:true}).click();await usdc.getByRole('textbox').fill('0.7654321');await usdc.getByRole('button',{name:entry.button,exact:true}).click();
  await expect(page.getByRole('dialog').getByText('0.7654321 USDC',{exact:true})).toBeVisible();await expect(page.getByRole('dialog').getByText(entry.summary,{exact:true})).toBeVisible();expect(writes).toEqual([{path:entry.path,body:{market_id:'verified-borrowing-1',amount:'0.7654321'}}]);await expect(page.getByRole('dialog').getByRole('button',{name:'Approve transaction',exact:true})).toBeDisabled();
 });
}

// Error responses are explicit isolated server fixtures. They verify consumer behavior,
// not the production validator or a successful protocol execution.
for(const entry of [{amount:'0',code:'INVALID_AMOUNT'},{amount:'-1',code:'INVALID_AMOUNT'},{amount:'1.00000001',code:'INVALID_AMOUNT'},{amount:'1e2',code:'INVALID_AMOUNT'},{amount:'99',code:'BORROW_CAPACITY_EXCEEDED'}]){
 test(`rejected borrow amount ${entry.amount} stays editable and never opens signing`,async({page})=>{
  const {writes}=await fixture(page,{preparationError:{status:422,code:entry.code,message:'The requested amount is unavailable.'}});const xlm=page.getByTestId('loan-xlm');
  await xlm.getByRole('textbox').fill(entry.amount);await xlm.getByRole('button',{name:'Review borrow',exact:true}).click();
  await expect(page.locator('.notice.error[role=alert]')).toContainText('The requested amount is unavailable.');await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(xlm.getByRole('textbox')).toHaveValue(entry.amount);await expect(xlm.getByRole('button',{name:'Review borrow',exact:true})).toBeEnabled();expect(writes).toHaveLength(1);expect(writes[0]!.body.amount).toBe(entry.amount);
 });
}
test('ambiguous preparation retry preserves its exact amount and idempotency key until the review is recovered',async({page})=>{
 const {writes,idempotencyKeys}=await fixture(page,{preparationError:{status:503,code:'PROVIDER_UNAVAILABLE',message:'Preparation is temporarily unavailable.'}});const xlm=page.getByTestId('loan-xlm');
 await xlm.getByRole('textbox').fill('0.1234567');await xlm.getByRole('button',{name:'Review borrow',exact:true}).click();await expect(page.locator('.notice.error[role=alert]')).toContainText('This market is temporarily unavailable. Please try again shortly.');await expect(page.getByRole('dialog')).toHaveCount(0);
 await xlm.getByRole('button',{name:'Review borrow',exact:true}).click();await expect(page.getByRole('dialog').getByText('0.1234567 XLM',{exact:true})).toBeVisible();expect(writes).toHaveLength(2);expect(writes[0]).toEqual(writes[1]);expect(idempotencyKeys[0]).toBeTruthy();expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);await expect(page.getByRole('dialog').getByRole('button',{name:'Approve transaction',exact:true})).toBeDisabled();
});
test('a pending borrowing operation stays in progress without a completed balance or approval action',async({page})=>{
 const {writes}=await fixture(page,{operationState:'confirming'});const xlm=page.getByTestId('loan-xlm');await xlm.getByRole('textbox').fill('0.1234567');await xlm.getByRole('button',{name:'Review borrow',exact:true}).click();
 const dialog=page.getByRole('dialog');await expect(dialog.getByRole('heading',{name:'Your operation is in progress.',exact:true})).toBeVisible();await expect(dialog.locator('.status-pill')).toHaveText('Confirming');await expect(dialog.getByRole('button',{name:'Approve transaction',exact:true})).toHaveCount(0);await expect(dialog).not.toContainText('Completed');await expect(xlm.locator('dl')).toContainText('Your debt1.23456 XLM');expect(writes).toHaveLength(1);
});
