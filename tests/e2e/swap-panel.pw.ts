import { test, expect, type Page } from '@playwright/test';

// Explicit browser fixtures only. These do not attest provider or chain execution.
const origin = process.env.E2E_FINTECH_URL ?? 'http://localhost:3002';
// Fully mocked sessions must never consume real authentication/provider quotas.
// Run against an isolated app build with NEXT_PUBLIC_PRIVY_APP_ID empty.
// A real-SDK build intentionally cannot initialize under this network policy.
// This is local to these fixture files; public login smoke keeps its real SDK.
test.use({serviceWorkers:'block'});
test.beforeEach(async({context})=>{
 const allowedOrigin=new URL(origin).origin;
 await context.route('**/*',route=>{
  const target=new URL(route.request().url());
  return target.origin===allowedOrigin ? route.continue() : route.abort('blockedbyclient');
 });
});
const XLM = 'stellar-testnet:native:XLM';
const USDC = 'stellar-testnet:classic:USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56';
const EURC = 'stellar-testnet:soroban:fixture-eurc';
const id = '00000000-0000-4000-8000-000000000003';
const identity = (assetId:string,code:string,decimals:number,name?:string) => ({id:assetId,code,decimals,name,verified:true});
const markets = [
  {market_id:'xlm-usdc',asset_in_id:XLM,asset_out_id:USDC,asset_in:identity(XLM,'XLM',7),asset_out:identity(USDC,'USDC',7,'USD Coin'),preparation_available:true},
  {market_id:'usdc-xlm',asset_in_id:USDC,asset_out_id:XLM,asset_in:identity(USDC,'USDC',7,'USD Coin'),asset_out:identity(XLM,'XLM',7),preparation_available:true},
  {market_id:'eurc-usdc',asset_in_id:EURC,asset_out_id:USDC,asset_in:identity(EURC,'EURC',6),asset_out:identity(USDC,'USDC',7,'USD Coin'),preparation_available:true},
];
async function fixture(page:Page,{expired=false,blockExtra=false,duplicateUsdc=false,portfolioAssets=false,historyMode="empty"}={} as {expired?:boolean;blockExtra?:boolean;duplicateUsdc?:boolean;portfolioAssets?:boolean;historyMode?:"empty"|"single"|"multiple"}) {
  const calls:{quote:any[];order:any[];sign:number;history:string[]}={quote:[],order:[],sign:0,history:[]};
  let operation:any;
  const alternate='stellar-testnet:soroban:standalone-usdc-fixture-a1b2c3d';
  const unnamed='stellar-testnet:soroban:unnamed-usdc-fixture-e4f5g6h';
  const availableMarkets=duplicateUsdc?[...markets,
    {market_id:'xlm-standalone',asset_in_id:XLM,asset_out_id:alternate,asset_in:identity(XLM,'XLM',7),asset_out:identity(alternate,'USDC',7,'USDCoin'),preparation_available:true},
    {market_id:'xlm-unnamed',asset_in_id:XLM,asset_out_id:unnamed,asset_in:identity(XLM,'XLM',7),asset_out:identity(unnamed,'USDC',7),preparation_available:true},
  ]:markets;

  await page.route(origin+'/api/**', async route => {
    const path=new URL(route.request().url()).pathname;
    let data:unknown={};
    if(path.endsWith('/session'))data={customer_id:'customer',wallet_id:'wallet',stellar_address:'fixture-address'};
    else if(path.endsWith('/capabilities'))data={capabilities:[{module:'capital.wallets',enabled:true,execution_status:'testnet_verified'},{module:'trade.spot',enabled:true,execution_status:'blocked'},{module:'trade.stocks',enabled:false},{module:'trade.perps',enabled:false},{module:'trade.commodities',enabled:false}]};
    else if(path.endsWith('/markets'))data=availableMarkets.map(item=>blockExtra&&item.market_id==='eurc-usdc'?{...item,preparation_available:false}:item);
    else if(path.endsWith('/market-history')){
      const url=new URL(route.request().url());calls.history.push(url.searchParams.get('range')!);
      const points=historyMode==='empty'?[]:historyMode==='single'?[{timestamp:'2026-11-11T10:00:00Z',price:'6.123456789'}]:[{timestamp:'2026-11-11T10:00:00Z',price:'6.0000000'},{timestamp:'2026-11-11T10:05:00Z',price:'6.123456789'},{timestamp:'2026-11-11T10:10:00Z',price:'6.0500000'}];
      data={market_id:url.searchParams.get('market_id'),base_asset_id:USDC,base_symbol:'USDC',quote_symbol:'XLM',latest_price:points.at(-1)?.price??null,as_of:points.at(-1)?.timestamp??null,points,change_absolute:historyMode==='multiple'?'0.05':null,change_percent:historyMode==='multiple'?'0.833333':null};
    }
    else if(path.endsWith('/usdc-status'))data={enabled:true,spendable:'12.3456789',wallet_amount:'12.3456789'};
    else if(path.endsWith('/balances'))data=portfolioAssets?[
      {asset_id:XLM,asset:{...identity(XLM,'XLM',7),kind:'native'},spendable:'0',wallet_amount:'0',reserved:'0'},
      {asset_id:USDC,asset:{...identity(USDC,'USDC',7,'USD Coin'),kind:'classic'},spendable:'0',wallet_amount:'0',reserved:'0'},
      {asset_id:'stellar-testnet:soroban:btc-fixture',asset:{...identity('stellar-testnet:soroban:btc-fixture','BTC',7,'Bitcoin'),kind:'soroban'},spendable:'0.123456789',wallet_amount:'0.123456789',reserved:'0'},
      {asset_id:'stellar-testnet:soroban:xrp-fixture',asset:{...identity('stellar-testnet:soroban:xrp-fixture','XRP',7,'XRP'),kind:'soroban'},spendable:'0.0000000',wallet_amount:'0.0000000',reserved:'0'},
      {asset_id:alternate,asset:{...identity(alternate,'USDC',7,'USDCoin'),kind:'soroban'},spendable:'1',wallet_amount:'1',reserved:'0'},
    ]:[{asset_id:XLM,spendable:'123.456789',wallet_amount:'124.456789'},{asset_id:USDC,spendable:'12.3456789',wallet_amount:'12.3456789'},{asset_id:EURC,spendable:'20.123456',wallet_amount:'20.123456'}];
    else if(path.endsWith('/operations'))data={operations:[]};
    else if(path.endsWith('/quote')){
      const input=route.request().postDataJSON();calls.quote.push(input);
      const market=availableMarkets.find(item=>item.market_id===input.market_id)!;
      data={quote_id:id,market_id:market.market_id,asset_in_id:market.asset_in_id,asset_out_id:market.asset_out_id,amount_in:input.amount,expected_out:'0.2500000',min_receive:'0.2487500',slippage_bps:input.slippage_bps,expires_at:new Date(Date.now()+(expired?-1000:60000)).toISOString()};
    }else if(path.endsWith('/order')){
      calls.order.push(route.request().postDataJSON());const last=calls.quote.at(-1),market=availableMarkets.find(item=>item.market_id===last.market_id)!;
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

test('same-code assets use verified names or exact-ID suffixes in dropdowns and approval',async({page})=>{
  const calls=await fixture(page,{duplicateUsdc:true});
  const buy=page.getByRole('combobox',{name:'Buy asset',exact:true});
  await expect(buy.locator('option',{hasText:'USDC — USD Coin'})).toHaveCount(1);
  await expect(buy.locator('option',{hasText:'USDC — USDCoin'})).toHaveCount(1);
  await expect(buy.locator('option',{hasText:'e4f5g6h'})).toHaveCount(1);
  const exact='stellar-testnet:soroban:standalone-usdc-fixture-a1b2c3d';
  await buy.selectOption(exact);await expect(buy).toHaveValue(exact);
  await expect(buy).toHaveAttribute('title','USDC — USDCoin');
  await page.getByRole('textbox',{name:'Sell amount',exact:true}).fill('2');
  await page.getByRole('button',{name:'Get quote',exact:true}).click();
  expect(calls.quote.at(-1).market_id).toBe('xlm-standalone');
  await page.getByRole('button',{name:'Review swap',exact:true}).click();
  await expect(page.getByRole('dialog').getByText('0.2487500 USDC — USDCoin',{exact:true})).toBeVisible();
});

test('portfolio uses asset metadata, keeps native/classic zero balances, and hides zero standalone rows',async({page})=>{
  await fixture(page,{portfolioAssets:true});await page.goto(origin+'/home');
  await expect(page.getByRole('cell').filter({has:page.getByText('Bitcoin',{exact:true})})).toBeVisible();
  await expect(page.getByRole('cell',{name:'USDC — USD Coin',exact:true})).toBeVisible();
  await expect(page.getByRole('cell').filter({has:page.getByText('USDC — USDCoin',{exact:true})})).toBeVisible();
  await expect(page.getByRole('cell',{name:'XLM',exact:true})).toBeVisible();
  await expect(page.getByText('XRP',{exact:true})).toHaveCount(0);
  await expect(page.locator('tbody tr')).toHaveCount(4);
  await expect(page.getByRole('cell',{name:'0.123456',exact:true})).toHaveCount(2);
});


test('market detail shows selected asset and honest empty history beside the swap',async({page})=>{
  await fixture(page);
  const profile=page.getByRole('region',{name:'Asset price',exact:true});
  await expect(profile.getByRole('heading',{name:'USD Coin',exact:true})).toBeVisible();
  await expect(profile.getByText('Price history is not available yet.',{exact:true})).toBeVisible();
  await expect(profile.getByRole('button',{name:'LIVE',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('navigation',{name:'Breadcrumb'})).toContainText('Home/Markets/USDC');
  await expect(page.locator('.market-detail-layout svg[aria-label="Price history"]')).toHaveCount(0);
  await page.getByRole('button',{name:'Flip assets',exact:true}).click();
  await expect(profile.getByRole('heading',{name:'USD Coin',exact:true})).toBeVisible();
  await page.screenshot({path:test.info().outputPath('market-detail-empty-desktop.png'),fullPage:true});
});


test('single actual price renders only a dot with its explicit unit and no invented change',async({page})=>{
  const calls=await fixture(page,{historyMode:'single'});
  const profile=page.getByRole('region',{name:'Asset price',exact:true});
  await expect(profile.getByText('6.12345',{exact:true})).toBeVisible();
  await expect(profile.getByText('XLM per USDC',{exact:true})).toBeVisible();
  await expect(profile.locator('svg circle')).toHaveCount(1);await expect(profile.locator('svg polyline')).toHaveCount(0);
  await expect(profile.getByLabel('Price change')).toHaveText('—(—)');
  await profile.getByRole('button',{name:'1D',exact:true}).click();
  await expect.poll(()=>calls.history.at(-1)).toBe('1d');
  await expect(profile.getByRole('button',{name:'1D',exact:true})).toHaveAttribute('aria-pressed','true');
});

test('actual multi-point history draws price observations and keeps the trading widget beside it',async({page})=>{
  await fixture(page,{historyMode:'multiple'});
  const profile=page.getByRole('region',{name:'Asset price',exact:true});
  await expect(profile.locator('svg polyline')).toHaveCount(1);
  await expect(profile.getByLabel('Price change')).toContainText('+0.05XLM(+0.833333%)');
  await expect(profile.getByText('6.05',{exact:true})).toBeVisible();
  await page.screenshot({path:test.info().outputPath('market-detail-history-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.getByRole('navigation',{name:'Breadcrumb'})).toHaveCSS('flex-direction','row');
  await page.screenshot({path:test.info().outputPath('market-detail-history-mobile.png'),fullPage:true});
});


test('fully mocked fixture context blocks third-party HTTP before it leaves the browser',async({page})=>{
 await fixture(page);
 const target='https://grapnel-fixture-third-party.invalid/provider-probe';
 const failed=page.waitForEvent('requestfailed',request=>request.url()===target);
 const result=await page.evaluate(url=>fetch(url).then(()=>false,()=>true),target);
 expect(result).toBe(true);expect((await failed).failure()?.errorText).toContain('ERR_BLOCKED_BY_CLIENT');
});
