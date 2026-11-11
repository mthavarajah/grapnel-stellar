import { test, expect, type Page } from '@playwright/test';

// Explicit browser fixtures only. These do not attest provider or chain execution.
const origin = process.env.E2E_FINTECH_URL ?? 'http://localhost:3002';
const XLM = 'stellar-testnet:native:XLM';
const USDC = 'stellar-testnet:classic:USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56';
const EURC = 'stellar-testnet:soroban:fixture-eurc';
const id = '00000000-0000-4000-8000-000000000003';
const identity = (assetId:string,code:string,decimals:number) => ({id:assetId,code,decimals});
const markets = [
  {market_id:'xlm-usdc',asset_in_id:XLM,asset_out_id:USDC,asset_in:identity(XLM,'XLM',7),asset_out:identity(USDC,'USDC',7),preparation_available:true},
  {market_id:'usdc-xlm',asset_in_id:USDC,asset_out_id:XLM,asset_in:identity(USDC,'USDC',7),asset_out:identity(XLM,'XLM',7),preparation_available:true},
  {market_id:'eurc-usdc',asset_in_id:EURC,asset_out_id:USDC,asset_in:identity(EURC,'EURC',6),asset_out:identity(USDC,'USDC',7),preparation_available:true},
];
async function fixture(page:Page,{expired=false,blockExtra=false}={}) {
  const calls:{quote:any[];order:any[];sign:number}={quote:[],order:[],sign:0};
  let operation:any;
  await page.route(origin+'/api/**', async route => {
    const path=new URL(route.request().url()).pathname;
    let data:unknown={};
    if(path.endsWith('/session'))data={customer_id:'customer',wallet_id:'wallet',stellar_address:'fixture-address'};
    else if(path.endsWith('/capabilities'))data={capabilities:[{module:'capital.wallets',enabled:true,execution_status:'testnet_verified'},{module:'trade.spot',enabled:true,execution_status:'blocked'},{module:'trade.stocks',enabled:false},{module:'trade.perps',enabled:false},{module:'trade.commodities',enabled:false}]};
    else if(path.endsWith('/markets'))data=markets.map(item=>blockExtra&&item.market_id==='eurc-usdc'?{...item,preparation_available:false}:item);
    else if(path.endsWith('/usdc-status'))data={enabled:true,spendable:'12.3456789',wallet_amount:'12.3456789'};
    else if(path.endsWith('/balances'))data=[{asset_id:XLM,spendable:'123.456789',wallet_amount:'124.456789'},{asset_id:USDC,spendable:'12.3456789',wallet_amount:'12.3456789'},{asset_id:EURC,spendable:'20.123456',wallet_amount:'20.123456'}];
    else if(path.endsWith('/operations'))data={operations:[]};
    else if(path.endsWith('/quote')){
      const input=route.request().postDataJSON();calls.quote.push(input);
      const market=markets.find(item=>item.market_id===input.market_id)!;
      data={quote_id:id,market_id:market.market_id,asset_in_id:market.asset_in_id,asset_out_id:market.asset_out_id,amount_in:input.amount,expected_out:'0.2500000',min_receive:'0.2487500',slippage_bps:input.slippage_bps,expires_at:new Date(Date.now()+(expired?-1000:60000)).toISOString()};
    }else if(path.endsWith('/order')){
      calls.order.push(route.request().postDataJSON());const last=calls.quote.at(-1),market=markets.find(item=>item.market_id===last.market_id)!;
      operation={operation_id:id,customer_id:'customer',wallet_id:'wallet',type:'spot.swap',status:'awaiting_customer_authorization',tx_hash:null,prepared_action:{summary:{action:'spot.swap',amount:last.amount,fromAssetId:market.asset_in_id,toAssetId:market.asset_out_id,minReceive:'0.2487500',maxFeeStroops:'50000',expiresAt:new Date(Date.now()+60000).toISOString()}},customer_action_token:'fixture'};data=operation;
    }else if(path.includes('/operations/'))data=operation;
    else if(path.endsWith('/status'))data={grapnel_configured:true,privy_configured:true,session_configured:true};
    return route.fulfill({json:{data}});
  });
  await page.goto(origin+'/markets');
  await expect(page.getByRole('combobox',{name:'Sell asset',exact:true})).toBeVisible();
  return calls;
}

test('swap panels bind Sell/Buy/flip and exact approval to the published direction',async({page})=>{
  const calls=await fixture(page);
  await expect(page.getByText('Available:')).toContainText('123.456');
  await page.getByRole('textbox',{name:'Sell amount',exact:true}).fill('2');
  await page.getByRole('button',{name:'Get quote',exact:true}).click();
  await expect(page.getByRole('status',{name:'Estimated buy amount',exact:true})).toHaveText('0.25');
  await expect(page.getByText('1 XLM = 0.125 USDC',{exact:true})).toBeVisible();
  await page.getByText('1 XLM = 0.125 USDC',{exact:true}).click();
  await expect(page.getByText('0.2487500 USDC',{exact:true})).toBeVisible();
  await page.screenshot({path:test.info().outputPath("swap-panel-desktop.png"),fullPage:true});
  await page.getByRole('button',{name:'Flip assets',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Sell asset',exact:true})).toHaveValue(USDC);
  await expect(page.getByRole('combobox',{name:'Buy asset',exact:true})).toHaveValue(XLM);
  await expect(page.getByRole('textbox',{name:'Sell amount',exact:true})).toHaveValue('');
  await expect(page.getByRole('button',{name:'Review swap',exact:true})).toHaveCount(0);
  await page.getByRole('textbox',{name:'Sell amount',exact:true}).fill('1.234567');
  await page.getByRole('button',{name:'Get quote',exact:true}).click();
  expect(calls.quote.at(-1).asset_id).toBe(USDC);
  expect(calls.quote.at(-1).market_id).toBe('usdc-xlm');
  await page.getByRole('button',{name:'Review swap',exact:true}).click();
  await expect(page.getByRole('dialog').getByText('1.234567 USDC',{exact:true})).toBeVisible();
  await expect(page.getByRole('dialog').getByText('0.0050000 XLM',{exact:true})).toBeVisible();
  expect(calls.order).toHaveLength(1);
  await expect(page.locator('body')).not.toContainText(/Privy|Testnet|Soroswap|Blend|Grapnel|GATALT/);
});

test('dropdowns derive additional assets and decimal-aware rate from API metadata',async({page})=>{
  const calls=await fixture(page);
  await page.getByRole('combobox',{name:'Sell asset',exact:true}).selectOption(EURC);
  await expect(page.getByRole('combobox',{name:'Buy asset',exact:true})).toHaveValue(USDC);
  await expect(page.getByRole('button',{name:'Flip assets',exact:true})).toBeDisabled();
  await page.getByRole('textbox',{name:'Sell amount',exact:true}).fill('2');
  await page.getByRole('button',{name:'Get quote',exact:true}).click();
  expect(calls.quote.at(-1).asset_id).toBe(EURC);
  await expect(page.getByText('1 EURC = 0.125 USDC',{exact:true})).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/\$\d|USD estimate/);
  expect(calls.order).toHaveLength(0);
});

test('expired quote cannot prepare an order and is not refreshed automatically',async({page})=>{
  const calls=await fixture(page,{expired:true});
  await page.getByRole('textbox',{name:'Sell amount',exact:true}).fill('1');
  await page.getByRole('button',{name:'Get quote',exact:true}).click();
  await expect(page.getByText('This quote expired. Request a new quote before reviewing a swap.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Review swap',exact:true})).toHaveCount(0);
  expect(calls.quote).toHaveLength(1);expect(calls.order).toHaveLength(0);
});

test('swap panel fits a narrow viewport without horizontal overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await fixture(page);
  await page.getByRole('textbox',{name:'Sell amount',exact:true}).fill('1000000.1234567');
  await page.getByRole('button',{name:'Get quote',exact:true}).click();
  await expect(page.getByRole('status',{name:'Estimated buy amount',exact:true})).toHaveText('0.25');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:test.info().outputPath('swap-panel-mobile.png'),fullPage:true});
});

test('published assets without a preparation path stay visible without a quote action',async({page})=>{
  const calls=await fixture(page,{blockExtra:true});
  await page.getByRole('combobox',{name:'Sell asset',exact:true}).selectOption(EURC);
  await page.getByRole('textbox',{name:'Sell amount',exact:true}).fill('1');
  await expect(page.getByRole('button',{name:'Get quote',exact:true})).toBeDisabled();
  await expect(page.getByText('This pair is currently unavailable.',{exact:true})).toBeVisible();
  expect(calls.quote).toHaveLength(0);expect(calls.order).toHaveLength(0);
});
