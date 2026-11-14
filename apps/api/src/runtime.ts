import {SPOT_TOKEN_PAIR_PINS} from '@grapnel/contracts';
import {ZenexTestnetAdapter} from './adapters/zenex/index.js';
import {ZenexMarketData} from './modules/zenex/market-data.js';
import {zenexReadiness} from './modules/zenex/readiness.js';
import {registerZenexRoutes} from './modules/zenex/routes.js';
import {registerGmxActivityRoute} from './modules/gmx/activity.js';
import {registerStockActivityRoute} from './modules/stocks/activity.js';
import {RobinhoodTreasury} from './modules/stocks/treasury.js';
import {registerRobinhoodTreasuryRoutes} from './modules/stocks/treasury-routes.js';
import fs from 'node:fs';
import {verifyRobinhoodRoundtrip} from './modules/stocks/acceptance.js';
import {createRobinhoodExecutionRuntime} from './modules/stocks/execution-runtime.js';
import {registerRobinhoodExecutionRoutes} from './modules/stocks/execution-routes.js';
import {registerNetworkAssetsRoute} from './modules/wallets/network-assets.js';
import {createGmxRuntime} from './modules/gmx/runtime.js';
import {registerGmxCustomerRoutes} from './modules/gmx/routes.js';
import {GmxMarketData} from './modules/gmx/market-data.js';
import {RobinhoodStockMarkets} from './modules/stocks/market-data.js';
import {registerRobinhoodFundingRoutes} from './modules/stocks/funding.js';
import {createCctpRuntime} from './modules/perpetuals/cctp-runtime.js';
import {registerCctpCustomerRoutes} from './modules/perpetuals/cctp-routes.js';
import type {CctpBurnExecutionBridge} from './modules/perpetuals/cctp-burn-execution.js';
import {CctpUsdcSetupPreparer} from './adapters/cctp/setup.js';
import {CircleSetupExecutionBridge,registerPerpetualFundingRoutes} from './modules/perpetuals/funding.js';
import {HyperliquidTestnetHttpTransport} from './adapters/hyperliquid/execution/index.js';
import {PgPerpetualWorkflowStore} from './modules/perpetuals/persistence.js';
import {PerpetualCustomerService} from './modules/perpetuals/service.js';
import {registerPerpetualCustomerRoutes} from './modules/perpetuals/routes.js';
import {CCTP_CIRCLE_ASSET_ID} from './adapters/cctp/inspector.js';
import {HyperliquidTestnetReader} from './adapters/hyperliquid/index.js';
import {perpetualMarketRows,perpetualHistory,stockPerpetualRows} from './modules/perpetuals/market-data.js';
import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { z } from 'zod';
import {xdr,scValToNative} from '@stellar/stellar-sdk';
import { GrapnelError, NETWORK, NETWORK_PASSPHRASE, WalletInputSchema, AmountSchema, XLM, toAtomic, fromAtomic, PreparedActionSchema, type CustomerContext, type PreparedAction, type WalletBalance, type AssetIdentity } from '@grapnel/contracts';
import { buildApp } from './app.js';
import { createPool } from './db/index.js';
import { loadConfig } from './lib/config.js';
import { requireBusiness, requireCustomer, success } from './lib/context.js';
import { createPrivyClient, PrivyIdentityVerifier, PrivyWalletSigner } from './adapters/privy/index.js';
import { parseTestnetTransaction, StellarTestnetExecutor, verifySignedAction } from './adapters/stellar/index.js';
import { TestnetFundingAdapter } from './adapters/testnet-funding/index.js';
import { BlendSorobanPreparer } from './adapters/stellar/blend-soroban.js';
import {BlendBorrowSorobanPreparer} from './adapters/stellar/blend-borrow-preparer.js';
import {BlendBorrowAdapter,BORROW_ASSETS} from './adapters/blend/borrow.js';
import {BORROW_POOL_ID,BorrowBaselineSchema,extractBorrowTransactionEvidence,inspectBorrowingDeltas,type BorrowingAction,type BorrowingAdapter} from './modules/lending/borrowing.js';
import { BlendAdapter, type BlendPosition } from './adapters/blend/index.js';
import { inspectBlendWithdrawDeltas } from './adapters/blend/withdraw-inspector.js';
import { BLEND_USDC_ASSET_ID, inspectBlendUsdcDeltas } from './adapters/blend/usdc-inspector.js';
import {registerUsdcTrustline} from './modules/wallets/usdc.js';
import {verifyPreparedUsdcTrustline,TESTNET_USDC_ISSUER} from './adapters/stellar/usdc-trustline.js';
import { registerLendingRoutes } from './modules/lending/routes.js';
import {LendingEarningsReader} from './modules/lending/earnings.js';
import { SoroswapSpotAdapter } from './adapters/soroswap/index.js';
import {SoroswapDirectInspector,NATIVE_SAC} from './adapters/soroswap/inspector.js';
import {SoroswapConfiguredInspector} from './adapters/soroswap/configured-inspector.js';
import {STANDALONE_NATIVE_ROUTES,STANDALONE_SPOT_ASSETS,APPROVED_TOKEN_WASM} from './adapters/soroswap/direct-assets.js';
import {SorobanTokenBalanceReader} from './adapters/stellar/token-balances.js';
import {MarketDataService,CryptoReferenceHistoryReader} from './modules/market-data/index.js';
import {registerMarketHistoryRoutes} from './modules/market-data/routes.js';
import {registerWalletValuationRoutes,registerAccountValuationRoutes} from './modules/wallets/valuation-routes.js';
import {AccountValuationService} from './modules/wallets/account-valuation.js';
import {MarketOverviewService,createYahooReferencePriceReader} from './modules/market-overview/index.js';
import {createSpotReservation,inspectSpotDeltas,SpotBaselineSchema,SPOT_USDC_ID} from './modules/spot/reservations.js';
import {SpotProofReadiness} from './modules/spot/proof.js';
import { SpotService } from './modules/spot/service.js';
import { registerSpotRoutes } from './modules/spot/routes.js';
import {StocksTestnetDiscovery} from './adapters/stocks/index.js';
import {PERIDOT_COLLATERAL,PERIDOT_TESTNET_PINS} from './adapters/peridot/index.js';
import { WalletService } from './modules/wallets/service.js';
import { hasFundingRoundTripProof, verifyNativeTransfer } from './modules/funding/readiness.js';
import { FundingService } from './modules/funding/service.js';
import { registerFundingRoutes } from './modules/funding/routes.js';
import { OperationService } from './modules/operations/service.js';
import { OperationWorker, type WorkerChain, type DeltaVerification } from './modules/operations/worker.js';
import {registerMarginRoutes,type MarginRoutesDependencies} from './modules/margin/routes.js';
import {MARGIN_STEP_ACTIONS} from './modules/margin/types.js';
import type {MarginExecutionBridge} from './modules/margin/execution.js';
import {registerMarginFundingRoutes,MARGIN_COLLATERAL_SWAP,type MarginFundingDependencies} from './modules/margin-funding/index.js';
import type {MarginFundingExecutionBridge} from './modules/margin-funding/execution.js';
import {createMarginFundingExecutionBridge} from './modules/margin-funding/execution.js';
import {createMarginExecutionBridge} from './modules/margin/execution.js';
import {MarginWorkflowService} from './modules/margin/service.js';
import {PeridotCustomerAdapter,PeridotCollateralFundingAdapter,PERIDOT_CUSTOMER_POLICY} from './adapters/peridot/customer/index.js';

/** A flag or credentials alone cannot establish a passed signing gate. */
export async function hasGate1Proof(chain:StellarTestnetExecutor):Promise<boolean> {
 try {
  const evidence=JSON.parse(await readFile(new URL('../../../evidence/testnet.json',import.meta.url),'utf8'));
  const proof=evidence.gate1;
  if(proof?.signer!=='privy_stellar' || proof.auth_tests_passed!==true || proof.intent_verified!==true || !/^[a-f0-9]{64}$/.test(proof.tx_hash??''))return false;
  const tx=await chain.horizon.transactions().transaction(proof.tx_hash).call();
  return tx.successful===true && tx.source_account===proof.wallet_address;
 }catch{return false;}
}
/** Provider writes must check their own current entitlement, including Margin-only tenants. */
export function financialRouteModule(path:string):'capital.testnet_funding'|'capital.lending'|'trade.perps'|'trade.stocks'|'trade.spot'|null {
 const pathname=path.split('?')[0]!;
 if(pathname.startsWith('/v1/capital/testnet/'))return 'capital.testnet_funding';
 if(pathname.startsWith('/v1/capital/lending/'))return 'capital.lending';
 if(pathname.startsWith('/v1/trade/margin/'))return 'trade.perps';
 // The customer-signed perpetual routes resolve stocks/perps from the exact order
 // and enforce current signing proof themselves, without requiring Spot.
 if(pathname.startsWith('/v1/trade/zenex/'))return 'trade.perps';
 if(pathname.startsWith('/v1/trade/gmx/'))return 'trade.perps';
 if(pathname.startsWith('/v1/trade/stocks/'))return 'trade.stocks';
 if(pathname.startsWith('/v1/trade/perpetuals/'))return null;
 if(pathname.startsWith('/v1/trade/'))return 'trade.spot';
 return null;
}
export interface RuntimeMarginBindings extends MarginRoutesDependencies {
 execution?:MarginExecutionBridge;
 collateralFunding?:Omit<MarginFundingDependencies,'operations'>;
 fundingExecution?:MarginFundingExecutionBridge;
}
export async function verifyRuntimeMarginAction(action:PreparedAction,signed:string,bindings:Pick<RuntimeMarginBindings,'execution'|'fundingExecution'>):Promise<void>{
 const bridge=action.summary.action===MARGIN_COLLATERAL_SWAP?bindings.fundingExecution:Object.values(MARGIN_STEP_ACTIONS).includes(action.summary.action)?bindings.execution:undefined;
 if(!bridge)throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','No reviewed Margin signing path is configured');
 await bridge.verifyForSubmission(action,signed);
}
export async function createRuntime(pool?:Pool,marginRoutes:RuntimeMarginBindings={}) {
 const config=loadConfig();
 const db=pool??createPool(config.databaseUrl);
 const chain=new StellarTestnetExecutor({network:config.network,passphrase:config.networkPassphrase,rpcUrl:process.env.STELLAR_RPC_URL,horizonUrl:process.env.STELLAR_HORIZON_URL,maxFeeStroops:'10000'});
 const privy=createPrivyClient();
 const identity=new PrivyIdentityVerifier(privy);
 const readEthereumWallets=async(customer:CustomerContext)=>{
    if(!privy)throw new GrapnelError(503,'PROVIDER_UNAVAILABLE','Wallet sign-in is unavailable');
    const user=await privy.users()._get(customer.privyUserId);if(user.id!==customer.privyUserId)throw new GrapnelError(403,'WALLET_OWNERSHIP_INVALID','Wallet ownership could not be verified');
    const rows=[];for(const linked of user.linked_accounts){if(linked.type!=='wallet'||!('chain_type' in linked)||linked.chain_type!=='ethereum'||!('id' in linked)||typeof linked.id!=='string'||!('user_can_sign' in linked)||linked.user_can_sign!==true||!('wallet_client_type' in linked)||linked.wallet_client_type!=='privy')continue;
     const wallet=await privy.wallets().get(linked.id);if(wallet.chain_type==='ethereum'&&!wallet.archived_at&&wallet.address.toLowerCase()===linked.address.toLowerCase())rows.push({address:wallet.address});
    }return rows;

 };
 const signer=new PrivyWalletSigner(privy,async(customerId,userId)=>!!(await db.query('SELECT 1 FROM customers WHERE id=$1 AND privy_user_id=$2',[customerId,userId])).rowCount);
 let standaloneMarketAssets:()=>AssetIdentity[]=()=>[];
 const tokenBalances=new SorobanTokenBalanceReader('https://soroban-testnet.stellar.org',{...Object.fromEntries(STANDALONE_SPOT_ASSETS.map(route=>[route.contract,APPROVED_TOKEN_WASM])),[PERIDOT_TESTNET_PINS.mock_usdt.address]:PERIDOT_TESTNET_PINS.mock_usdt.wasmHash});
 // Margin collateral is a distinct pinned token, never the classic USDC or a presumed USD peg.
 const readStandaloneBalances=(address:string)=>tokenBalances.getBalances(address,[...new Map([...standaloneMarketAssets(),PERIDOT_COLLATERAL].map(asset=>[asset.id,asset])).values()]);
 const readSpotBalances=async(address:string)=>{const [classic,tokens]=await Promise.all([chain.getClassicBalances(address),readStandaloneBalances(address)]);return [...classic,...tokens];};
 const wallets=new WalletService(db,identity,chain,signer,readStandaloneBalances);
 const operations=new OperationService(db);
 const zenex=new ZenexTestnetAdapter(chain.server),zenexReady=zenexReadiness(zenex),zenexMarkets=new ZenexMarketData(zenex,zenexReady);
 const circleSetup=new CctpUsdcSetupPreparer({server:chain.server,readSpendableXlm:async(customer,operationId)=>{
  const row=(await chain.getClassicBalances(customer.walletAddress)).find(balance=>balance.asset_id===XLM.id);
  if(!row)throw new GrapnelError(503,'BALANCE_UNAVAILABLE','Current available XLM could not be verified');
  const held=await db.query("SELECT COALESCE(sum(amount_atomic),0)::text AS amount FROM balance_reservations WHERE business_id=$1 AND customer_id=$2 AND wallet_id=$3 AND asset_id=$4 AND state='active' AND operation_id<>$5",[customer.businessId,customer.customerId,customer.walletId,XLM.id,operationId]);
  const available=toAtomic(row.spendable,7)-BigInt(held.rows[0].amount);return available>0n?available:0n;
 }});
 const circleExecution=new CircleSetupExecutionBridge({operations,setup:circleSetup,verifyGate1:()=>hasGate1Proof(chain),chain});
 const customerMargin=new PeridotCustomerAdapter({server:chain.server,nativeBalance:async customer=>{
  const balance=(await chain.getClassicBalances(customer.walletAddress)).find(row=>row.asset_id===XLM.id);
  if(!balance)throw new GrapnelError(503,'BALANCE_UNAVAILABLE','A confirmed native balance is required');return balance;
 },horizonTransaction:hash=>chain.horizon.transactions().transaction(hash).call()});
 const marginFunding=new PeridotCollateralFundingAdapter(customerMargin.chain,()=>customerMargin.executionReady());
 const marginBindings:RuntimeMarginBindings={
  service:new MarginWorkflowService(operations,customerMargin,PERIDOT_CUSTOMER_POLICY),
  termsFor:customerMargin.termsFor.bind(customerMargin),creationReadyFor:async()=>false,readinessFor:customerMargin.readinessFor.bind(customerMargin),quoteFor:customerMargin.quoteFor.bind(customerMargin),
  execution:createMarginExecutionBridge(operations,customerMargin,PERIDOT_CUSTOMER_POLICY),
  collateralFunding:{adapter:marginFunding,ready:async()=>false},fundingExecution:createMarginFundingExecutionBridge(operations,marginFunding),...marginRoutes,
 };
 const robinhoodStocks=new RobinhoodStockMarkets(db);
 const stocks=new StocksTestnetDiscovery({network:config.network,networkPassphrase:NETWORK_PASSPHRASE});
 let stocksReason='STOCKS_ROUTE_USES_MAINNET_ASSETS',stocksProbeAt=0,stocksProbeRunning=false;
 const stocksReadiness=async()=>{
  if(!stocksProbeRunning&&Date.now()-stocksProbeAt>60000){stocksProbeRunning=true;void stocks.probe().then(result=>{stocksReason=result.reason;}).catch(()=>{stocksReason='STOCKS_DISCOVERY_UNAVAILABLE';}).finally(()=>{stocksProbeAt=Date.now();stocksProbeRunning=false;});}
  return {execution_status:'blocked' as const,reason:stocksReason,actions:[]};
 };
 const gate1Passed=await hasGate1Proof(chain);
 const funding=new TestnetFundingAdapter({network:config.network,networkPassphrase:NETWORK_PASSPHRASE,treasurySecret:process.env.DEMO_TREASURY_SECRET,enabled:process.env.TESTNET_FUNDING_ENABLED==='true',gate1Passed,maxPerCustomerAtomic:BigInt(process.env.TESTNET_FUNDING_MAX_PER_CUSTOMER_ATOMIC??'250000000'),maxPerTenantAtomic:BigInt(process.env.TESTNET_FUNDING_MAX_PER_TENANT_ATOMIC??'1000000000'),maxGlobalAtomic:BigInt(process.env.TESTNET_FUNDING_MAX_GLOBAL_ATOMIC??'2000000000')});
 const hyperliquid=new HyperliquidTestnetReader();
 type PerpsRows=ReturnType<typeof perpetualMarketRows>;
 let perpsRows:PerpsRows|undefined,perpsAt=0,perpsLoading:Promise<PerpsRows>|undefined;
 const venueCache=new Map<string,{at:number;rows:PerpsRows}>(),venueLoading=new Map<string,Promise<PerpsRows>>();
 const readPerpetualMarkets=async()=>{
  if(perpsRows&&Date.now()-perpsAt<15000)return perpsRows;
  perpsLoading??=(async()=>{
   const catalog=await hyperliquid.readCatalog();let rows=perpetualMarketRows(catalog.markets,catalog.source.receivedAt);
   try{const fast=await hyperliquid.readAllMarkets(),priced=perpetualMarketRows(fast.markets,fast.source.receivedAt),prices=new Map(priced.map(row=>[row.market_id,row]));
    rows=rows.map(row=>prices.has(row.market_id)?{...row,...prices.get(row.market_id),settlement_asset:row.settlement_asset,source_category:row.source_category,asset_category:row.asset_category}:row);
    for(const dex of ['', 'xyz'])venueCache.set(dex,{at:Date.now(),rows:priced.filter(row=>row.provider_dex===dex)});
   }catch{/* Catalog stays metadata-only; a selected venue loads independently. */}
   perpsRows=rows;perpsAt=Date.now();return rows;
  })().catch(error=>{perpsRows=undefined;throw error;}).finally(()=>{perpsLoading=undefined;});
  return perpsLoading;
 };
 const readDetailedPerpetualMarket=async(id:string)=>{
  const normalized=id.replace(':stocks:',':perps:'),row=(await readPerpetualMarkets()).find(entry=>entry.market_id===normalized);
  if(!row||id.includes(':stocks:')&&!['equity','index'].includes(row.asset_category))throw new GrapnelError(404,'NOT_FOUND','Market not found');
  let venue=venueCache.get(row.provider_dex);
  if(!venue||Date.now()-venue.at>=15000){
   let task=venueLoading.get(row.provider_dex);if(!task){task=hyperliquid.readDexMarkets(row.provider_dex).then(snapshot=>{const rows=perpetualMarketRows(snapshot.markets,snapshot.source.receivedAt);venueCache.set(row.provider_dex,{at:Date.now(),rows});return rows;}).finally(()=>{venueLoading.delete(row.provider_dex);});venueLoading.set(row.provider_dex,task);}
   venue={at:Date.now(),rows:await task};
  }
  const priced=venue.rows.find(entry=>entry.market_id===normalized);if(!priced)throw new GrapnelError(404,'NOT_FOUND','Market not found');
  const merged={...row,...priced,settlement_asset:row.settlement_asset,source_category:row.source_category,asset_category:row.asset_category};
  return id.includes(':stocks:')?{...merged,market_id:id,asset_class:'stocks' as const,module:'trade.stocks' as const}:merged;
 };
 void readPerpetualMarkets().catch(()=>{/* Unavailable discovery cannot block wallet flows. */});
 const spotInspector=new SoroswapConfiguredInspector({quoteReadSource:funding.treasuryAddress??undefined});
 let spotMarkets:Awaited<ReturnType<SoroswapConfiguredInspector['markets']>>=[];
 if(process.env.SOROSWAP_API_KEY){try{spotMarkets=await spotInspector.markets();}catch{/* Discovery failure leaves an empty market registry; never promote a guessed route. */}}
 const spot=new SoroswapSpotAdapter({network:config.network,networkPassphrase:NETWORK_PASSPHRASE,apiKey:process.env.SOROSWAP_API_KEY,gate1Passed,markets:spotMarkets},undefined,spotInspector.inspect,spotInspector.readExactQuote);
 standaloneMarketAssets=()=>[...new Map(spot.markets().flatMap(market=>[market.asset_in,market.asset_out]).filter(asset=>asset.kind==='soroban').map(asset=>[asset.id,asset])).values()];
 const spotReadiness=new SpotProofReadiness(db,spot,spotInspector,chain.server);
 const soroban=new BlendSorobanPreparer({network:config.network,passphrase:NETWORK_PASSPHRASE,rpcUrl:process.env.STELLAR_RPC_URL,gate1Passed});
 const blend=new BlendAdapter({network:config.network,passphrase:NETWORK_PASSPHRASE,rpcUrl:process.env.STELLAR_RPC_URL,gate1Passed},{prepareAndSimulate:input=>soroban.prepare(input)});
 const borrowPreparer=new BlendBorrowSorobanPreparer({network:config.network,passphrase:NETWORK_PASSPHRASE,rpcUrl:process.env.STELLAR_RPC_URL,gate1Passed});
 const readBorrowSpendable=async(assetId:string,customer:CustomerContext):Promise<bigint>=>{
  if(!BORROW_ASSETS.some(asset=>asset.id===assetId))throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Unsupported borrowing asset');
  const wallet=await wallets.get(customer.businessId,customer.walletId);
  if(wallet.customer_id!==customer.customerId||wallet.stellar_address!==customer.walletAddress)throw new GrapnelError(404,'NOT_FOUND','Wallet not found');
  const [balances,held]=await Promise.all([chain.getClassicBalances(customer.walletAddress),db.query("SELECT COALESCE(SUM(amount_atomic),0)::text AS reserved FROM balance_reservations WHERE business_id=$1 AND customer_id=$2 AND wallet_id=$3 AND asset_id=$4 AND state='active'",[customer.businessId,customer.customerId,customer.walletId,assetId])]);
  const rows=balances.filter(balance=>balance.asset_id===assetId),balance=rows[0],now=Date.now();
  if(rows.length!==1||!balance||balance.source!=='stellar_horizon_testnet'||!fresh(balance.as_of,15000,now))throw new GrapnelError(409,'BALANCE_UNAVAILABLE','A fresh confirmed spendable balance is required');
  const available=zeroAtomic(balance.spendable),reserved=BigInt(held.rows[0]?.reserved??'0');return available>reserved?available-reserved:0n;
 };
 const borrowing=new BlendBorrowAdapter({network:config.network,passphrase:NETWORK_PASSPHRASE,rpcUrl:process.env.STELLAR_RPC_URL,gate1Passed},{prepareAndSimulate:input=>borrowPreparer.prepare(input),readSpendableBalance:readBorrowSpendable});
 const earningsReader=new LendingEarningsReader({pool:db,positions:customer=>blend.positions(customer)});
 const referencePrices=createYahooReferencePriceReader();
 const marketOverview=new MarketOverviewService({referencePrice:async symbol=>{if(['TSLA','AMZN','PLTR','NFLX','AMD'].includes(symbol)){try{const row=await robinhoodStocks.detail('robinhood-testnet:stocks:'+symbol);return row.reference_price&&row.source_generated_at?{value:row.reference_price,as_of:row.source_generated_at}:null;}catch{return null;}}return referencePrices(symbol);},stockReferenceItems:[{symbol:'TSLA',name:'Tesla',maxAgeMs:60000},{symbol:'AMZN',name:'Amazon',maxAgeMs:60000},{symbol:'AMD',name:'Advanced Micro Devices',maxAgeMs:60000}],perps:()=>zenexMarkets.markets(),lending:()=>blend.markets()});
 const marketProfile=async(id:string)=>{
  const market=spot.market(id),pin=SPOT_TOKEN_PAIR_PINS.find(p=>id.startsWith(`stellar-testnet:soroswap:${p.pair}:`)),base=pin?[market.asset_in,market.asset_out].find(a=>a.contractId===pin.a.contract)!:market.asset_in.kind==='native'?market.asset_out:market.asset_in;
  const quoteAsset=pin?[market.asset_in,market.asset_out].find(a=>a.contractId===pin.b.contract)!:{...XLM,contractId:NATIVE_SAC};
  const canonical=spot.markets().find(entry=>entry.asset_in_id===quoteAsset.id&&entry.asset_out_id===base.id);
  return {base_asset_id:base.id,base_symbol:base.code,asset:base,quoteAsset,history_market_id:canonical?.market_id??id};
 };
 const marketData=new MarketDataService(db,async id=>{
  const profile=await marketProfile(id);
  const reg=await spotInspector.registryForMarket(id);
  const entry=await chain.server.getContractData(reg.pair,xdr.ScVal.scvLedgerKeyContractInstance());
  const storage=entry.val.contractData().val().instance().storage()??[];
  const field=(key:number)=>{const value=storage.find(item=>scValToNative(item.key())===key);return value?scValToNative(value.val()):undefined;};
  const t0=field(0),t1=field(1),r0=field(2),r1=field(3);
  if(!profile.asset||profile.asset.decimals!==7||typeof r0!=='bigint'||typeof r1!=='bigint'||r0<=0n||r1<=0n||!((t0===profile.quoteAsset.contractId&&t1===profile.asset.contractId)||(t1===profile.quoteAsset.contractId&&t0===profile.asset.contractId)))throw new GrapnelError(503,'PRICE_UNAVAILABLE','Verified market reserves are unavailable');
  const nativeReserve=t0===profile.quoteAsset.contractId?r0:r1,tokenReserve=t0===profile.quoteAsset.contractId?r1:r0;
  return {market_id:id,price:fromAtomic(nativeReserve*10n**18n/tokenReserve,18),quote_symbol:profile.quoteAsset.code,observed_at:new Date().toISOString(),source:`stellar-testnet:pool:${reg.pair}`};
 });
 const cryptoReferences=new Map<string,'XLM'|'BTC'|'XRP'|'USDC'>([[XLM.id,'XLM'],[SPOT_USDC_ID,'USDC'],
  ...STANDALONE_NATIVE_ROUTES.filter(route=>['BTC','XRP','USDC'].includes(route.code)).map(route=>[`stellar-testnet:soroban:${route.contract}`,route.code as 'BTC'|'XRP'|'USDC'] as [string,'BTC'|'XRP'|'USDC'])]);
 const cryptoHistory=new CryptoReferenceHistoryReader({resolveMarket:async id=>{
  const market=spot.market(id),profile=await marketProfile(id);
  // Stablecoin-quoted XLM charts show XLM; other direct pairs show the non-XLM asset.
  const assetId=[market.asset_in.id,market.asset_out.id].some(asset=>cryptoReferences.get(asset)==='USDC')?XLM.id:profile.base_asset_id;
  const symbol=cryptoReferences.get(assetId);return symbol?{asset_id:assetId,reference_symbol:symbol}:null;
 }});
 const priceForAsset=async(assetId:string)=>{
  const native=await referencePrices('XLM');if(!native)return null;
  if(assetId===XLM.id)return native;
  const market=spot.markets().find(row=>row.asset_in_id===XLM.id&&row.asset_out_id===assetId);
  if(!market)return null;
  const quote=await marketData.history(market.market_id,'live');
  if(quote.quote_symbol!=='XLM'||!quote.latest_price||!quote.as_of)return null;
  const product=toAtomic(quote.latest_price,18)*toAtomic(native.value,18)/10n**18n;
  if(product<=0n)return null;
  return {value:fromAtomic(product,18),as_of:new Date(Math.min(Date.parse(native.as_of),Date.parse(quote.as_of))).toISOString()};
 };
 const valuationAsset=(id:string)=>BORROW_ASSETS.find(asset=>asset.id===id)??spot.markets().flatMap(market=>[market.asset_in,market.asset_out]).find(asset=>asset.id===id);
 const accountValuation=new AccountValuationService({walletBalances:customer=>wallets.balances(customer.businessId,customer.walletId),earnPositions:customer=>blend.positions(customer),borrowPositions:customer=>borrowing.positionsForValuation(customer),additionalSourcesComplete:async customer=>(await readEthereumWallets(customer)).length===0&&(await db.query("SELECT 1 FROM margin_workflows WHERE business_id=$1 AND customer_id=$2 AND wallet_id=$3 AND phase<>'recovered' UNION ALL SELECT 1 FROM perpetual_accounts WHERE business_id=$1 AND customer_id=$2 AND wallet_id=$3 LIMIT 1",[customer.businessId,customer.customerId,customer.walletId])).rowCount===0,priceFor:priceForAsset,assetFor:valuationAsset});
 let fundingVerified=false;let fundingProofAt=0;let fundingProofRunning=false;
 const readFundingReadiness=async()=>{
  if(!await hasGate1Proof(chain))return {execution_status:'blocked' as const,reason:'GATE_1_SIGNING_PROOF_REQUIRED',actions:[]};
  const reason=funding.blockedReason();
  if(reason)return {execution_status:'blocked' as const,reason,actions:[]};
  if(!fundingProofRunning && Date.now()-fundingProofAt>30000){fundingProofRunning=true;void hasFundingRoundTripProof(db,funding.treasuryAddress!,proof=>verifyNativeTransfer(chain,proof)).then(value=>{fundingVerified=value;}).catch(()=>{fundingVerified=false;}).finally(()=>{fundingProofAt=Date.now();fundingProofRunning=false;});}
  return {execution_status:fundingVerified?'testnet_verified' as const:'blocked' as const,reason:fundingVerified?null:'Confirmed treasury grant and customer return evidence is required; initial acceptance runs through the restricted API',actions:fundingVerified?['fund','return']:[]};
 };
 let blendReadiness:{execution_status:'blocked'|'discovery_only';reason:string;actions:string[]}={execution_status:'blocked',reason:'Current Blend readiness probe is pending; financial execution remains gated',actions:[]};
 let blendProbeAt=0;let blendProbeRunning=false;
 const readBlendReadiness=async()=>{
  if(!blendProbeRunning && Date.now()-blendProbeAt>30000){
   blendProbeRunning=true;
   void blend.capabilities().then(value=>{blendReadiness=value;}).catch(()=>{blendReadiness={execution_status:'blocked',reason:'Current Blend Testnet reads are unavailable',actions:[]};}).finally(()=>{blendProbeAt=Date.now();blendProbeRunning=false;});
  }
  return blendReadiness;
 };
 const stockAcceptanceCache=new Map<string,{at:number;ready:boolean}>(),stockAcceptancePending=new Map<string,Promise<boolean>>();
 const stockAcceptance=async(symbol:import('./adapters/robinhood/registry.js').StockSymbol)=>{const cached=stockAcceptanceCache.get(symbol);if(cached&&Date.now()-cached.at<30000)return cached.ready;const pending=stockAcceptancePending.get(symbol);if(pending)return pending;const task=(async()=>{let ready=false;try{ready=await verifyRobinhoodRoundtrip(JSON.parse(fs.readFileSync(new URL(symbol==='TSLA'?'../../../evidence/robinhood-own-roundtrip.json':`../../../evidence/robinhood-${symbol.toLowerCase()}-roundtrip.json`,import.meta.url),'utf8')),symbol);}catch{}stockAcceptanceCache.set(symbol,{at:Date.now(),ready});return ready;})().finally(()=>stockAcceptancePending.delete(symbol));stockAcceptancePending.set(symbol,task);return task;};
 const rhTreasurySecret=process.env.ROBINHOOD_TESTNET_TREASURY_SECRET;
 const stockTreasury=rhTreasurySecret&&/^0x[0-9a-f]{64}$/i.test(rhTreasurySecret)?new RobinhoodTreasury({pool:db,secret:rhTreasurySecret as `0x${string}`,readWallets:readEthereumWallets}):null;
 const stockExecution=createRobinhoodExecutionRuntime({pool:db,readWallets:readEthereumWallets,acceptance:stockAcceptance});
 const readyStockMarket=async(row:Awaited<ReturnType<RobinhoodStockMarkets['detail']>>)=>{const ready=await stockAcceptance(row.provider_symbol as import('./adapters/robinhood/registry.js').StockSymbol);return {...row,execution_status:ready?'testnet_verified' as const:'discovery_only' as const,executable:ready,execution_available:ready,preparation_available:ready,actions:ready?['prepare_order']:[],reason:ready?null:'ROBINHOOD_OWN_EXECUTION_PROOF_REQUIRED'};};
 const readStockMarkets=async()=>Promise.all((await robinhoodStocks.markets()).map(readyStockMarket));
 const gmxRuntime=createGmxRuntime({pool:db,readWallets:readEthereumWallets});
 const gmxMarketData=new GmxMarketData(db,gmxRuntime.adapter);
 const readyGmxMarket=async(row:Awaited<ReturnType<typeof gmxMarketData.detail>>)=>{const ready=await gmxRuntime.acceptance(row.provider_symbol);return {...row,execution_status:ready?'testnet_verified' as const:'discovery_only' as const,executable:ready,execution_available:ready,preparation_available:ready,actions:ready?['prepare_order','close_position']:[],reason:ready?null:'GMX_OWN_EXECUTION_PROOF_REQUIRED'};};
 const readGmxMarkets=async()=>Promise.all((await gmxMarketData.markets()).map(readyGmxMarket));
 const cctpRuntime=createCctpRuntime({pool:db,operations,chain,setup:circleSetup,verifyGate1:()=>hasGate1Proof(chain),accessApproved:async()=>process.env.HYPERLIQUID_TESTNET_ACCESS_CONFIRMED==='true'&&!!process.env.HYPERLIQUID_TESTNET_ACCESS_REFERENCE?.trim()});
 const perpetualService=new PerpetualCustomerService({store:new PgPerpetualWorkflowStore(db),transport:new HyperliquidTestnetHttpTransport(),
  market:readDetailedPerpetualMarket,fundingStatus:cctpRuntime.fundingStatus,
  accessApproved:async()=>process.env.HYPERLIQUID_TESTNET_ACCESS_CONFIRMED==='true'&&!!process.env.HYPERLIQUID_TESTNET_ACCESS_REFERENCE?.trim(),

 });
 const app=await buildApp({pool:db,config,identityVerifier:identity,
  verifySignedAction:async(action,signed)=>{if(action.summary.action.startsWith('zenex.'))await zenex.verifyForSubmission(action,signed);else if(action.summary.action==='perps.fund_cctp')await cctpRuntime.execution.verifyForSubmission(action,signed);else if(['perps.usdc_trustline','perps.usdc_allowance'].includes(action.summary.action))await circleExecution.verifyForSubmission(action,signed);else if(action.summary.action.startsWith('margin.'))await verifyRuntimeMarginAction(action,signed,marginBindings);else if(action.summary.action==='wallet.usdc_trustline')verifyPreparedUsdcTrustline(action,signed);else if(action.summary.action==='spot.swap')await spotInspector.verifyForSubmission(action,signed);else if(borrowingAction(action.summary.action))await borrowPreparer.verifyForSubmission(action,signed);else if(action.summary.action==='blend.supply'||action.summary.action==='blend.withdraw')await soroban.verifyForSubmission(action,signed);else verifySignedAction(action,signed);return {txHash:parseTestnetTransaction(signed).hash().toString('hex')};},
  balanceReader:address=>chain.getClassicBalances(address),
  dashboardCustomerBalances:(businessId,walletId)=>wallets.balances(businessId,walletId),
  dashboardCustomerPositions:async customer=>{
   const [positions,markets,borrowPositions]=await Promise.all([blend.positions(customer),blend.markets(),borrowing.positions(customer)]);
   return [...positions.map(position=>({provider:'blend',network:NETWORK,asset:markets.find(market=>market.market_id===position.market_id)?.asset??null,...position})),...borrowPositions.map(position=>({provider:'blend',network:NETWORK,asset:valuationAsset(position.asset_id)??null,wallet_spendable:false,readiness:'discovery_only',...position}))];
  },
  capabilities:{
   'capital.lending':readBlendReadiness,
   'trade.spot':()=>spotReadiness.capability(),
   'trade.stocks':async()=>{const ready=await stockAcceptance('TSLA');return{execution_status:ready?'testnet_verified' as const:'discovery_only' as const,reason:ready?null:'ROBINHOOD_STOCK_EXECUTION_PROOF_REQUIRED',actions:ready?['read_markets','funding_status','prepare_order']:['read_markets','funding_status']};},
   'trade.perps':async()=>{const ready=await zenexReady();return {execution_status:ready?'testnet_verified' as const:'discovery_only' as const,reason:ready?null:'ZENEX_EXECUTION_PROOF_REQUIRED',actions:ready?['read_markets','fund','prepare_order','close_position']:['read_markets']};},
   'capital.wallets':async()=>{const current=await hasGate1Proof(chain);return {execution_status:current?'testnet_verified':'blocked',reason:current?null:privy?'Privy-signed Testnet payment proof is pending':'PRIVY_APP_ID and PRIVY_APP_SECRET are required',actions:current?['provision','balances','test_payment']:[]};},
   'capital.testnet_funding':readFundingReadiness
  },
  registerAdapters:async app=>{
   await registerNetworkAssetsRoute(app,{requireBusiness,requireCustomer,success,readWallets:readEthereumWallets});
   await registerWalletValuationRoutes(app,{requireBusiness,requireCustomer,success,balances:customer=>wallets.balances(customer.businessId,customer.walletId),priceFor:priceForAsset});
   await registerAccountValuationRoutes(app,{requireBusiness,requireCustomer,success,readAccount:customer=>accountValuation.read(customer)});
   app.get('/v1/market-overview',async request=>{
    const business=await requireBusiness(request,'capital.wallets');
    z.object({}).strict().parse(request.query);
    const modules=(await db.query('SELECT module_code FROM business_modules WHERE business_id=$1 AND enabled=true',[business.businessId])).rows.map(row=>row.module_code as string);
    return success(request,await marketOverview.read(modules));
   });
   await registerMarketHistoryRoutes(app,{requireBusiness,success,
    perps:(id,range)=>id.startsWith('zenex-testnet:perps:')?zenexMarkets.history(id,range):id.startsWith('gmx-testnet:perps:')?gmxMarketData.history(id,range):perpetualHistory(hyperliquid,readPerpetualMarkets,id,range),
    stocks:(id,range)=>robinhoodStocks.history(id,range),
    spot:async(id,range)=>{const profile=await marketProfile(id);
     try{const history=await cryptoHistory.history(id,range);return {...history,base_asset_id:history.related_asset_id,base_symbol:history.reference_symbol};}
     catch(error){if(!(error instanceof GrapnelError)||!['CRYPTO_REFERENCE_UNAVAILABLE','PROVIDER_RATE_LIMITED'].includes(error.code))throw error;
      const history=await marketData.history(profile.history_market_id??id,range);return {...history,market_id:id,base_asset_id:profile.base_asset_id,base_symbol:profile.base_symbol,requested_range:range,price_basis:'testnet_pool_observation',coverage:{kind:'observed_only',first_generated_at:history.points[0]?.timestamp??null,complete_requested_range:false}};}
    }
   });
   app.get('/v1/capital/lending/earnings',async request=>{
    await requireBusiness(request,'capital.lending');
    const query=z.object({customer_id:z.string().uuid(),wallet_id:z.string().uuid().optional()}).strict().parse(request.query);
    const customer=await requireCustomer(request,query.customer_id,query.wallet_id);
    return success(request,{earnings:await earningsReader.getEarnings(customer),as_of:new Date().toISOString()});
   });
   await registerPerpetualCustomerRoutes(app,perpetualService,()=>hasGate1Proof(chain));
   await registerPerpetualFundingRoutes(app,{operations,setup:circleSetup,verifyGate1:()=>hasGate1Proof(chain)});
   await registerCctpCustomerRoutes(app,cctpRuntime.coordinator,cctpRuntime.execution);
   let stockSettling=false;const settleStocks=async()=>{if(stockSettling)return;stockSettling=true;try{await stockExecution.reconcilePending();}finally{stockSettling=false;}};const stockTimer=setInterval(()=>{void settleStocks().catch(()=>{});},3000);stockTimer.unref();app.addHook('onClose',async()=>{clearInterval(stockTimer);});
   await registerZenexRoutes(app,{adapter:zenex,operations,chain,ready:zenexReady,gate:()=>hasGate1Proof(chain)});
   await registerGmxActivityRoute(app,{pool:db,readWallets:readEthereumWallets});
   await registerStockActivityRoute(app,{pool:db,readWallets:readEthereumWallets});
   await registerRobinhoodFundingRoutes(app,{readEthereumWallets});
   await registerRobinhoodTreasuryRoutes(app,{treasury:stockTreasury,readWallets:readEthereumWallets,verifyGate1:()=>hasGate1Proof(chain)});
   await registerRobinhoodExecutionRoutes(app,{service:stockExecution.service,verifyGate1:()=>hasGate1Proof(chain)});
   let gmxSettling=false;const gmxTimer=setInterval(()=>{if(gmxSettling)return;gmxSettling=true;void gmxRuntime.reconcilePending().catch(()=>{}).finally(()=>{gmxSettling=false;});},3000);gmxTimer.unref();app.addHook('onClose',async()=>{clearInterval(gmxTimer);});
   await registerGmxCustomerRoutes(app,{service:gmxRuntime.service,gas:gmxRuntime.gas,verifyGate1:()=>hasGate1Proof(chain)});
   await registerUsdcTrustline(app,{chain,operations,verifyGate1:()=>hasGate1Proof(chain)});
   // Revalidate the actual chain proof for every new provider intent. A
   // startup snapshot must not survive a Testnet reset or unavailable proof.
   app.addHook('preHandler',async request=>{
    if(request.method!=='POST')return;
    const path=request.url.split('?')[0]!;
    if(['/v1/trade/gmx/prepare','/v1/trade/gmx/gas'].includes(path))throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Use the current XLM perpetual market.');
    const module=financialRouteModule(path);
    if(!module)return;
    await requireBusiness(request,module);
    if(!await hasGate1Proof(chain))throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Current Gate 1 chain proof is required before financial provider execution');
   });
   app.post('/v1/capital/wallets',async request=>{const business=await requireBusiness(request,'capital.wallets');const body=WalletInputSchema.parse(request.body);return success(request,await wallets.provision(business.businessId,body.customer_id,body.privy_identity_proof));});
   app.get('/v1/capital/wallets/:id',async request=>{const b=await requireBusiness(request,'capital.wallets');return success(request,await wallets.get(b.businessId,(request.params as {id:string}).id));});
   app.get('/v1/capital/wallets/:id/balances',async request=>{const b=await requireBusiness(request,'capital.wallets');return success(request,await wallets.balances(b.businessId,(request.params as {id:string}).id));});
   // Restricted signing-gate payment: customer authorizes a maximum 1 XLM to the fixed Testnet treasury.
   app.post('/v1/capital/wallets/:id/test-payment',async(request,reply)=>{
    const b=await requireBusiness(request,'capital.wallets');
    const body=z.object({customer_id:z.string().uuid(),amount:AmountSchema}).strict().parse(request.body);
    const id=(request.params as {id:string}).id;
    const customer=await requireCustomer(request,body.customer_id,id);
    if(!funding.treasuryAddress)throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Testnet treasury recipient is not configured');
    let amount:bigint;try{amount=toAtomic(body.amount,7);}catch{throw new GrapnelError(422,'INVALID_AMOUNT','A positive amount with at most seven decimals is required');}
    if(amount>10000000n)throw new GrapnelError(422,'INVALID_AMOUNT','Signing-gate payment is limited to 1 Testnet XLM');
    const result=await operations.createIdempotent({businessId:b.businessId,customerId:customer.customerId,walletId:id,module:'capital.wallets',type:'wallet.test_payment',provider:'stellar_privy',route:'/v1/capital/wallets/:id/test-payment',idempotencyKey:String(request.headers['idempotency-key']??''),request:{wallet_id:id,...body}},async(client,operationId)=>{
     const balances=await chain.getClassicBalances(customer.walletAddress);const balance=balances.find(x=>x.asset_id===XLM.id);
     const prepared=await chain.preparePayment({operationId,customerId:customer.customerId,walletAddress:customer.walletAddress,recipient:funding.treasuryAddress!,asset:XLM,amount:body.amount,action:'wallet.test_payment'});
     await operations.reserve(client,{businessId:b.businessId,customerId:customer.customerId,walletId:id,operationId,assetId:XLM.id,amountAtomic:amount,spendableAtomic:balance&& !/^0(?:\.0+)?$/.test(balance.spendable)?toAtomic(balance.spendable,7):0n,observedAt:new Date(balance?.as_of??0),expiresAt:new Date(prepared.summary.expiresAt)});
     await operations.setPrepared(client,b.businessId,operationId,prepared);
    });
    return reply.code(202).send(success(request,result.operation));
   });
   // Register after the provider gate hook. Missing reviewed bindings stay unavailable.
   await registerMarginRoutes(app,marginBindings);
   await registerMarginFundingRoutes(app,{operations,...marginBindings.collateralFunding});
   await registerLendingRoutes(app,{adapter:blend,borrowing,operations,balanceReader:address=>chain.getClassicBalances(address)});
   await registerSpotRoutes(app,{service:new SpotService(spot,db,operations,createSpotReservation(operations,readSpotBalances)),refreshReadiness:()=>spotReadiness.refresh(),requireBusiness,requireCustomer,success,
    readDiscoveryMarkets:async category=>category==='perps'?zenexMarkets.markets():readStockMarkets(),
    readDiscoveryMarket:async id=>id.startsWith('zenex-testnet:perps:')?zenexMarkets.detail(id):id.startsWith('gmx-testnet:perps:')?readyGmxMarket(await gmxMarketData.detail(id)):id.startsWith('robinhood-testnet:stocks:')?readyStockMarket(await robinhoodStocks.detail(id)):readDetailedPerpetualMarket(id),
    readPositions:async customer=>({wallet_holdings:await wallets.balances(customer.businessId,customer.walletId),venue_positions:[]})});
   await registerFundingRoutes(app,{service:new FundingService(funding,operations),requireBusiness,requireCustomer,success});
  }
 });
 app.addHook('onClose',async()=>{if(!pool)await db.end();});
 const workerChain=createRuntimeWorkerChain({pool:db,zenex,chain,blend,soroban,borrowing,borrowPreparer,gate1Passed,verifyGate1:()=>hasGate1Proof(chain),spot:spotInspector,readSpotBalances,margin:marginBindings.execution,marginFunding:marginBindings.fundingExecution,circleSetup:circleExecution,cctpFunding:cctpRuntime.execution});
 const tickPerpetuals=async()=>{
  const rows=(await db.query("WITH picked AS (SELECT o.id FROM perpetual_orders o JOIN wallets w ON w.business_id=o.business_id AND w.customer_id=o.customer_id AND w.id=o.wallet_id AND w.stellar_address=o.stellar_address WHERE o.state IN ('approved','sending','unknown') AND o.signed_action IS NOT NULL AND o.updated_at<now()-interval '5 seconds' ORDER BY o.updated_at FOR UPDATE OF o SKIP LOCKED LIMIT 3) UPDATE perpetual_orders o SET updated_at=now() FROM picked WHERE o.id=picked.id RETURNING o.*")).rows;
  for(const row of rows){
   try{const scope={businessId:row.business_id,customerId:row.customer_id,walletId:row.wallet_id,stellarAddress:row.stellar_address};
    if(row.state==='approved'){
     const module=row.intent.marketId.startsWith('hyperliquid-testnet:stocks:')?'trade.stocks':'trade.perps';
     const allowed=await db.query("SELECT count(*)::int AS n FROM business_modules WHERE business_id=$1 AND enabled AND module_code IN ('capital.wallets',$2)",[row.business_id,module]);
     if(allowed.rows[0]?.n!==2||!await hasGate1Proof(chain))continue;
     await perpetualService.resume(scope,row.id);
    }else await perpetualService.reconcile(scope,row.id);
   }catch{/* Pending/unknown remains durable; a fresh intent is never generated here. */}
  }
  return false; // Poll on the normal worker interval, including provider errors.
 };
 return {app,config,pool:db,chain,wallets,operations,funding,gate1Passed,perpetualService,tickPerpetuals,worker:new OperationWorker(db,workerChain)};
}


const zeroAtomic=(value:string):bigint=>/^0(?:\.0+)?$/.test(value)?0n:toAtomic(value,7);
const fresh=(date:string,maximumAge:number,now:number):boolean=>Number.isFinite(Date.parse(date))&&now-Date.parse(date)<=maximumAge&&Date.parse(date)<=now+1000;
export interface SupplyBaseline {asset_id:string;market_id:string;pool_contract_id:string;reserve_contract_id:string;wallet_address:string;wallet_amount:string;collateral:string;as_of:string;position_as_of:string;position_ledger:number;}
const baselineSchema=z.object({asset_id:z.literal(XLM.id),market_id:z.string(),pool_contract_id:z.string(),reserve_contract_id:z.string(),wallet_address:z.string(),wallet_amount:AmountSchema,collateral:AmountSchema,as_of:z.string().datetime(),position_as_of:z.string().datetime(),position_ledger:z.number().int().positive()}).strict();
/** RPC success plus the exact inspected invocation is required before these observations are used. */
export function inspectSupplyDeltas(input:{baseline:unknown;request:{asset_id?:unknown;market_id?:unknown;amount?:unknown};walletAddress:string;positions:BlendPosition[];balances:WalletBalance[];confirmedLedger:number;now?:number}):DeltaVerification {
 const unverified=(reason:string):DeltaVerification=>({verified:false,result:{blend_supply_verification:{verified:false,reason,observed_at:new Date(input.now??Date.now()).toISOString()}}});
 try{
  const parsed=baselineSchema.safeParse(input.baseline);if(!parsed.success)return unverified('MISSING_VERIFIED_BASELINE');
  const baseline=parsed.data;const now=input.now??Date.now();
  if(input.request.asset_id!==XLM.id || input.request.market_id!==baseline.market_id || input.walletAddress!==baseline.wallet_address || typeof input.request.amount!=='string')return unverified('SUPPLY_BASELINE_MISMATCH');
  if(!Number.isSafeInteger(input.confirmedLedger)||input.confirmedLedger<=0)return unverified('CONFIRMED_LEDGER_REQUIRED');
  const position=input.positions.find(position=>position.market_id===baseline.market_id&&position.asset_id===XLM.id&&position.pool_contract_id===baseline.pool_contract_id&&position.reserve_contract_id===baseline.reserve_contract_id);
  const balance=input.balances.find(balance=>balance.asset_id===XLM.id&&balance.source==='stellar_horizon_testnet');
  if(!position||!balance)return unverified('MISSING_POST_CHAIN_OBSERVATION');
  if(!Number.isSafeInteger(position.as_of_ledger)||position.as_of_ledger<=0||!fresh(position.as_of,30000,now)||!fresh(balance.as_of,15000,now)||Date.parse(position.as_of)<Date.parse(baseline.position_as_of)||Date.parse(balance.as_of)<Date.parse(baseline.as_of)||position.as_of_ledger<input.confirmedLedger||position.as_of_ledger<baseline.position_ledger)return unverified('POST_CHAIN_OBSERVATION_STALE');
  const amount=toAtomic(input.request.amount,7);
  const beforeCollateral=zeroAtomic(baseline.collateral),afterCollateral=zeroAtomic(position.collateral);
  const beforeWallet=zeroAtomic(baseline.wallet_amount),afterWallet=zeroAtomic(balance.wallet_amount);
  const collateralDelta=afterCollateral-beforeCollateral,walletDebit=beforeWallet-afterWallet;
  // Blend b-token conversion may round supplied units. Confirm actual collateral growth,
  // the exact atomic invocation, and a real wallet debit covering the requested asset.
  if(collateralDelta<=0n||walletDebit<amount)return unverified('SUPPLY_POSITION_OR_WALLET_DELTA_MISSING');
  return {verified:true,result:{blend_supply_verification:{verified:true,asset_id:XLM.id,market_id:baseline.market_id,pool_contract_id:baseline.pool_contract_id,reserve_contract_id:baseline.reserve_contract_id,requested_atomic:amount.toString(),collateral_before:baseline.collateral,collateral_after:position.collateral,collateral_delta:fromAtomic(collateralDelta,7),wallet_before:baseline.wallet_amount,wallet_after:balance.wallet_amount,wallet_debit:fromAtomic(walletDebit,7),confirmed_ledger:input.confirmedLedger,observed_ledger:position.as_of_ledger,position_as_of:position.as_of,wallet_as_of:balance.as_of,observed_at:new Date(now).toISOString()}}};
 }catch{return unverified('INVALID_SUPPLY_OBSERVATION');}
}
/** Bind worker execution to the tenant/customer's durable quote, order and pre-sign baseline. */
async function storedSpotAction(pool:Pool,operation:Record<string,any>):Promise<PreparedAction>{
 const action=PreparedActionSchema.parse(operation.prepared_action),baseline=SpotBaselineSchema.parse(operation.result_json?.spot_swap_baseline);
 const quote=(await pool.query('SELECT q.* FROM orders o JOIN trade_quotes q ON q.business_id=o.business_id AND q.customer_id=o.customer_id AND q.id=o.quote_id WHERE o.business_id=$1 AND o.customer_id=$2 AND o.operation_id=$3 AND o.quote_id=$4',[operation.business_id,operation.customer_id,operation.id,operation.request_json?.quote_id])).rows[0];
 if(!quote||quote.provider!=='soroswap'||quote.exact_in_asset_id!==baseline.asset_in_id||quote.market_id!==baseline.market_id||quote.amount_in_atomic!==baseline.amount_in_atomic||quote.min_out_atomic!==baseline.min_out_atomic||action.operationId!==operation.id||action.customerId!==operation.customer_id||action.walletAddress!==operation.stellar_address||baseline.wallet_address!==operation.stellar_address||action.signingHashHex!==baseline.signing_hash_hex||action.summary.action!=='spot.swap'||action.summary.fromAssetId!==baseline.asset_in_id||action.summary.toAssetId!==baseline.asset_out_id||toAtomic(action.summary.amount??'',7)!==BigInt(baseline.amount_in_atomic)||toAtomic(action.summary.minReceive??'',7)!==BigInt(baseline.min_out_atomic)||action.summary.maxFeeStroops!==baseline.max_fee_stroops)throw new GrapnelError(403,'INTENT_MISMATCH','Durable quote/order, observed baseline and exact customer swap approval differ');
 return action;
}
const borrowingActions:Readonly<Record<string,BorrowingAction>>={
 'blend.borrow':'borrow','blend.repay':'repay',
 'blend.borrow_collateral_supply':'collateral_supply','blend.borrow_collateral_withdraw':'collateral_withdraw'
};
function borrowingAction(type:string):BorrowingAction|undefined{return Object.hasOwn(borrowingActions,type)?borrowingActions[type]:undefined;}
/** Bind the exact signed borrowing envelope to its durable tenant/customer intent and pre-sign baseline. */
function storedBorrowingAction(operation:Record<string,any>,hash:string):PreparedAction{
 const action=PreparedActionSchema.parse(operation.prepared_action),baseline=BorrowBaselineSchema.parse(operation.result_json?.blend_borrowing_baseline);
 const request=operation.request_json;
 if(!borrowingAction(operation.type)||operation.module_code!=='capital.lending'||operation.provider!=='blend'||typeof operation.privy_user_id!=='string'||!operation.privy_user_id.startsWith('did:privy:')
  ||!['preparing','submitted','confirming','recovery_required'].includes(operation.state)
  ||!request||request.customer_id!==operation.customer_id||request.wallet_id!==operation.wallet_id
  ||action.operationId!==operation.id||action.customerId!==operation.customer_id||action.walletAddress!==operation.stellar_address
  ||action.signingHashHex!==hash||operation.tx_hash!==hash||action.summary.action!==operation.type
  ||action.summary.contractId!==BORROW_POOL_ID||action.summary.recipient!==operation.stellar_address
  ||action.summary.fromAssetId!==request.asset_id||baseline.asset_id!==request.asset_id||baseline.market_id!==request.market_id||baseline.wallet_address!==operation.stellar_address
  ||![XLM.id,BLEND_USDC_ASSET_ID].includes(request.asset_id)||typeof request.amount!=='string'||zeroAtomic(action.summary.amount??'')!==toAtomic(request.amount,7))
  throw new GrapnelError(403,'INTENT_MISMATCH','Durable borrowing request, customer approval and position baseline differ');
 return action;
}
export interface RuntimeWorkerDependencies {zenex?:ZenexTestnetAdapter;cctpFunding?:CctpBurnExecutionBridge;circleSetup?:CircleSetupExecutionBridge;margin?:MarginExecutionBridge;marginFunding?:MarginFundingExecutionBridge;borrowing?:Pick<BorrowingAdapter,'positions'>;borrowPreparer?:Pick<BlendBorrowSorobanPreparer,'verifyForSubmission'>;pool:Pool;chain:StellarTestnetExecutor;blend:Pick<BlendAdapter,'positions'>;soroban:Pick<BlendSorobanPreparer,'verifyForSubmission'>;gate1Passed:boolean;verifyGate1?:()=>Promise<boolean>;spot?:Pick<SoroswapDirectInspector,'verifyForSubmission'>;readSpotBalances?:(address:string)=>Promise<WalletBalance[]>;}
/** No network send exists outside the durable worker's recorded hash/envelope path. */
export function createRuntimeWorkerChain(deps:RuntimeWorkerDependencies):WorkerChain {
 const {pool,chain,blend,soroban,gate1Passed}=deps;
 return {
  async lookup(hash){const state=await chain.reconcile(hash);return {state,found:state!=='pending'};},
  async broadcast(envelope){
   const parsed=parseTestnetTransaction(envelope);const hash=parsed.hash().toString('hex');
   const operation=(await pool.query('SELECT o.*,w.stellar_address,c.privy_user_id FROM operations o JOIN wallets w ON w.business_id=o.business_id AND w.customer_id=o.customer_id AND w.id=o.wallet_id JOIN customers c ON c.business_id=o.business_id AND c.id=o.customer_id WHERE o.tx_hash=$1 AND o.signed_xdr=$2',[hash,envelope])).rows[0];
   if(!operation || (operation.type!=='wallet.test_payment' && (!gate1Passed || !await (deps.verifyGate1?.()??Promise.resolve(false)))))throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Gate 1 proof is required before financial provider execution');
   if(operation.type.startsWith('zenex.')){if(!deps.zenex||operation.provider!=='zenex'||operation.module_code!=='trade.perps'||operation.type==='zenex.faucet'||operation.state!=='submitted')throw new GrapnelError(403,'INTENT_MISMATCH','Recorded customer Perpetual authorization required');const action=PreparedActionSchema.parse(operation.prepared_action);if(action.operationId!==operation.id||action.customerId!==operation.customer_id||action.walletAddress!==operation.stellar_address||action.summary.action!==operation.type||action.signingHashHex!==hash)throw new GrapnelError(403,'INTENT_MISMATCH','Stored customer and transaction differ');await deps.zenex.verifyForSubmission(action,envelope);const sent=await chain.server.sendTransaction(parsed);if(sent.hash!==hash||sent.status==='ERROR')throw new GrapnelError(409,'CHAIN_REJECTED','The inspected order was rejected');return{txHash:hash};}
   if(operation.type==='perps.fund_cctp'){if(!deps.cctpFunding)throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','CCTP funding is unavailable');return deps.cctpFunding.broadcast(PreparedActionSchema.parse(operation.prepared_action),envelope);}
   if(['perps.usdc_trustline','perps.usdc_allowance'].includes(operation.type)){if(!deps.circleSetup)throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Trading USDC setup is unavailable');return deps.circleSetup.broadcast(PreparedActionSchema.parse(operation.prepared_action),envelope);}
   if(operation.type.startsWith('margin.')){
    if(operation.module_code!=='trade.perps'||operation.provider!=='peridot'||operation.state!=='submitted'||typeof operation.privy_user_id!=='string'||!operation.privy_user_id.startsWith('did:privy:'))throw new GrapnelError(403,'INTENT_MISMATCH','Margin requires its recorded customer-approved first send');
    const action=PreparedActionSchema.parse(operation.prepared_action);
    if(action.operationId!==operation.id||action.customerId!==operation.customer_id||action.walletAddress!==operation.stellar_address||action.summary.action!==operation.type||action.signingHashHex!==hash)throw new GrapnelError(403,'INTENT_MISMATCH','Stored Margin operation and exact approval differ');
    await verifyRuntimeMarginAction(action,envelope,{execution:deps.margin,fundingExecution:deps.marginFunding});await chain.verifyLiveNetwork();
    try{const sent=await chain.server.sendTransaction(parsed);if(sent.hash!==hash)throw new GrapnelError(502,'PROVIDER_INVALID','RPC transaction hash mismatch');if(sent.status==='ERROR')throw new GrapnelError(409,'CHAIN_REJECTED','Stellar rejected the inspected Margin transaction');if(!['PENDING','DUPLICATE'].includes(sent.status))throw new GrapnelError(503,'SUBMISSION_UNCERTAIN','Reconcile the stored Margin hash before retry',true,{tx_hash:hash});return{txHash:hash};}catch(error){if(error instanceof GrapnelError)throw error;throw new GrapnelError(503,'SUBMISSION_UNCERTAIN','Reconcile the stored Margin hash before retry',true,{tx_hash:hash});}
   }
   if(operation.type==='spot.swap'){
    if(operation.module_code!=='trade.spot'||operation.provider!=='soroswap'||typeof operation.privy_user_id!=='string'||!operation.privy_user_id.startsWith('did:privy:')||!deps.spot)throw new GrapnelError(403,'INTENT_MISMATCH','Stored operation is not an inspected customer spot swap');
    const action=await storedSpotAction(pool,operation);
    await deps.spot.verifyForSubmission(action,envelope);await chain.verifyLiveNetwork();
    try{const sent=await chain.server.sendTransaction(parsed);if(sent.hash!==hash)throw new GrapnelError(502,'PROVIDER_INVALID','RPC transaction hash mismatch');if(sent.status==='ERROR')throw new GrapnelError(409,'CHAIN_REJECTED','Stellar rejected the inspected spot transaction');if(!['PENDING','DUPLICATE'].includes(sent.status))throw new GrapnelError(503,'SUBMISSION_UNCERTAIN','Reconcile stored spot hash before any retry',true,{tx_hash:hash});return {txHash:hash};}catch(error){if(error instanceof GrapnelError)throw error;throw new GrapnelError(503,'SUBMISSION_UNCERTAIN','Reconcile stored spot hash before any retry',true,{tx_hash:hash});}
   }
   if(operation.type==='wallet.usdc_trustline'){
    const action=PreparedActionSchema.parse(operation.prepared_action);
    if(operation.module_code!=='capital.wallets'||operation.provider!=='stellar'||action.operationId!==operation.id||action.customerId!==operation.customer_id||action.walletAddress!==operation.stellar_address||action.summary.amount!==operation.request_json.limit)throw new GrapnelError(403,'INTENT_MISMATCH','Stored trustline and approval differ');
    verifyPreparedUsdcTrustline(action,envelope);
    await chain.verifyLiveNetwork();
    const latest=(await chain.horizon.ledgers().order('desc').limit(1).call()).records[0]!;
    if(BigInt(latest.base_reserve_in_stroops)!==5000000n)throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Trustline reserve changed; new approval is required');
    const account=await chain.horizon.loadAccount(action.walletAddress);
    if(BigInt(account.sequence)+1n!==BigInt(parsed.sequence))throw new GrapnelError(409,'SEQUENCE_CHANGED','Prepare a fresh trustline transaction');
    const sent=await chain.server.sendTransaction(parsed).catch(()=>{throw new GrapnelError(503,'SUBMISSION_UNCERTAIN','Reconcile stored trustline hash before retry',true,{tx_hash:hash});});
    if(sent.hash!==hash)throw new GrapnelError(502,'PROVIDER_INVALID','RPC transaction hash mismatch');
    if(sent.status==='ERROR')throw new GrapnelError(409,'CHAIN_REJECTED','Stellar rejected trustline creation');
    if(!['PENDING','DUPLICATE'].includes(sent.status))throw new GrapnelError(503,'SUBMISSION_UNCERTAIN','Reconcile stored trustline hash before retry',true,{tx_hash:hash});
    return {txHash:hash};
   }
   if(borrowingAction(operation.type)){
    if(!deps.borrowing||!deps.borrowPreparer)throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','No reviewed borrowing submission path is configured');
    if(operation.state!=='submitted')throw new GrapnelError(409,'OPERATION_STATE_INVALID',"Only the durable worker's recorded first borrowing send may broadcast");
    const action=storedBorrowingAction(operation,hash);
    await deps.borrowPreparer.verifyForSubmission(action,envelope);
    await chain.verifyLiveNetwork();
    try{
     const sent=await chain.server.sendTransaction(parsed);
     if(sent.hash!==hash)throw new GrapnelError(502,'PROVIDER_INVALID','RPC transaction hash mismatch');
     if(sent.status==='ERROR')throw new GrapnelError(409,'CHAIN_REJECTED','Stellar rejected the inspected borrowing transaction');
     if(!['PENDING','DUPLICATE'].includes(sent.status))throw new GrapnelError(503,'SUBMISSION_UNCERTAIN','Reconcile the persisted borrowing hash before any retry',true,{tx_hash:hash});
     return {txHash:hash};
    }catch(error){if(error instanceof GrapnelError)throw error;throw new GrapnelError(503,'SUBMISSION_UNCERTAIN','Reconcile the persisted borrowing hash before any retry',true,{tx_hash:hash});}
   }
   if(operation.type==='blend.supply'||operation.type==='blend.withdraw'){
    if(operation.module_code!=='capital.lending'||operation.provider!=='blend'||typeof operation.privy_user_id!=='string'||!operation.privy_user_id.startsWith('did:privy:'))throw new GrapnelError(403,'INTENT_MISMATCH','Stored operation is not an approved Blend supply');
    const action=PreparedActionSchema.parse(operation.prepared_action);
    if(action.operationId!==operation.id||action.customerId!==operation.customer_id||action.walletAddress!==operation.stellar_address||![XLM.id,BLEND_USDC_ASSET_ID].includes(operation.request_json.asset_id)||action.summary.action!==operation.type||action.summary.fromAssetId!==operation.request_json.asset_id||zeroAtomic(action.summary.amount??'')!==toAtomic(operation.request_json.amount,7))throw new GrapnelError(403,'INTENT_MISMATCH','Stored supply and customer approval do not match');
    await soroban.verifyForSubmission(action,envelope);
    await chain.verifyLiveNetwork();
    try{
     const sent=await chain.server.sendTransaction(parsed);
     if(sent.hash!==hash)throw new GrapnelError(502,'PROVIDER_INVALID','RPC transaction hash mismatch');
     if(sent.status==='ERROR')throw new GrapnelError(409,'CHAIN_REJECTED','Stellar rejected the inspected supply transaction');
     if(sent.status==='TRY_AGAIN_LATER')throw new GrapnelError(503,'SUBMISSION_UNCERTAIN','Reconcile the persisted transaction hash before any retry',true,{tx_hash:hash});
     if(!['PENDING','DUPLICATE'].includes(sent.status))throw new GrapnelError(503,'SUBMISSION_UNCERTAIN','Unexpected RPC submission state; reconcile the stored hash',true,{tx_hash:hash});
     return {txHash:hash};
    }catch(error){if(error instanceof GrapnelError)throw error;throw new GrapnelError(503,'SUBMISSION_UNCERTAIN','Reconcile the persisted transaction hash before any retry',true,{tx_hash:hash});}
   }
   if(!['wallet.test_payment','testnet.fund','testnet.return'].includes(operation.type))throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','No reviewed submission path exists for this operation');
   return chain.submit(envelope,operation.id);
  },
  async verifyDeltas(id,hash){
   const op=(await pool.query('SELECT o.*,w.stellar_address,c.privy_user_id FROM operations o JOIN wallets w ON w.business_id=o.business_id AND w.customer_id=o.customer_id AND w.id=o.wallet_id JOIN customers c ON c.business_id=o.business_id AND c.id=o.customer_id WHERE o.id=$1 AND o.tx_hash=$2',[id,hash])).rows[0];
   if(!op)return false;
   if(op.type.startsWith('zenex.')){if(!deps.zenex||op.provider!=='zenex'||op.module_code!=='trade.perps'||!op.result_json?.zenex_baseline||op.result_json.zenex_baseline.wallet_address!==op.stellar_address)return false;if(op.type==='zenex.faucet')return deps.zenex.verifyFaucet(op.stellar_address,hash,op.result_json.zenex_baseline.balance);const action=PreparedActionSchema.parse(op.prepared_action);if(action.operationId!==op.id||action.customerId!==op.customer_id||action.walletAddress!==op.stellar_address||action.summary.action!==op.type||action.signingHashHex!==hash)return false;return deps.zenex.reconcile(action,hash,op.result_json.zenex_baseline);}
   if(op.type==='perps.fund_cctp'){if(!deps.cctpFunding)return false;return deps.cctpFunding.verifyDeltas(id,hash);}
   if(['perps.usdc_trustline','perps.usdc_allowance'].includes(op.type)){if(!deps.circleSetup)return false;return deps.circleSetup.verifyDeltas(id,hash);}
   if(op.type.startsWith('margin.')){
    if(op.module_code!=='trade.perps'||op.provider!=='peridot')return false;
    const bridge=op.type===MARGIN_COLLATERAL_SWAP?deps.marginFunding:Object.values(MARGIN_STEP_ACTIONS).includes(op.type)?deps.margin:undefined;
    if(!bridge)return{verified:false,result:{reason:'MARGIN_EXECUTION_PROOF_REQUIRED'}};
    return bridge.verifyDeltas(id,hash);
   }
   if(op.type==='spot.swap'){
    if(op.module_code!=='trade.spot'||op.provider!=='soroswap'||typeof op.privy_user_id!=='string'||!op.privy_user_id.startsWith('did:privy:'))return false;
    try{
     const action=await storedSpotAction(pool,op),parsed=parseTestnetTransaction(op.signed_xdr);if(parsed.hash().toString('hex')!==hash||action.signingHashHex!==hash)return false;
     const confirmed=await chain.server.getTransaction(hash);if(confirmed.status!=='SUCCESS')return false;
     const tx=await chain.horizon.transactions().transaction(hash).call();if(!tx.successful||tx.hash!==hash||tx.source_account!==op.stellar_address||tx.ledger_attr!==confirmed.ledger)return false;
     const result=inspectSpotDeltas({baseline:op.result_json?.spot_swap_baseline,walletAddress:op.stellar_address,signingHash:hash,balances:await (deps.readSpotBalances?.(op.stellar_address)??chain.getClassicBalances(op.stellar_address)),feeStroops:String(tx.fee_charged),confirmedLedger:confirmed.ledger});
     if(result.verified){const observation=result.result.spot_swap_verification as {actual_in_atomic:string;actual_out_atomic:string};await pool.query("UPDATE orders SET actual_in_atomic=$3,actual_out_atomic=$4,status='confirming' WHERE business_id=$1 AND operation_id=$2",[op.business_id,op.id,observation.actual_in_atomic,observation.actual_out_atomic]);}
     return result;
    }catch{return {verified:false,result:{spot_swap_verification:{verified:false,reason:'LIVE_SWAP_RECONCILIATION_UNAVAILABLE'}}};}
   }
   if(op.type==='wallet.usdc_trustline'){
    if(op.module_code!=='capital.wallets'||op.provider!=='stellar')return false;
    const tx=await chain.horizon.transactions().transaction(hash).call();
    if(!tx.successful||tx.source_account!==op.stellar_address)return false;
    const parsed=parseTestnetTransaction(op.signed_xdr);const trust=parsed.operations[0];
    if(parsed.hash().toString('hex')!==hash||trust?.type!=='changeTrust'||!('getCode' in trust.line)||trust.line.getCode()!=='USDC'||trust.line.getIssuer()!==TESTNET_USDC_ISSUER||trust.limit!==op.request_json.limit&&toAtomic(trust.limit,7)!==toAtomic(op.request_json.limit,7))return false;
    const effects=await chain.horizon.effects().forTransaction(hash).limit(100).call();
    const created=effects.records.some(e=>e.type==='trustline_created'&&e.account===op.stellar_address&&'asset_code'in e&&e.asset_code==='USDC'&&e.asset_issuer===TESTNET_USDC_ISSUER);
    return {verified:created,result:{usdc_trustline_verification:{verified:created,issuer:TESTNET_USDC_ISSUER,limit:trust.limit,ledger:tx.ledger_attr,observed_at:new Date().toISOString()}}};
   }
   const borrowingType=borrowingAction(op.type);
   if(borrowingType){
    const unavailable=():DeltaVerification=>({verified:false,result:{blend_borrowing_verification:{verified:false,reason:'LIVE_BORROWING_RECONCILIATION_UNAVAILABLE'}}});
    if(!deps.borrowing)return unavailable();
    try{
     const action=storedBorrowingAction(op,hash),parsed=parseTestnetTransaction(op.signed_xdr);
     if(parsed.hash().toString('hex')!==hash||parsed.source!==action.walletAddress)return unavailable();
     const confirmed=await chain.server.getTransaction(hash);
     if(confirmed.status!=='SUCCESS')return unavailable();
     const tx=await chain.horizon.transactions().transaction(hash).call();
     if(!tx.successful||tx.hash!==hash||tx.source_account!==op.stellar_address||tx.ledger_attr!==confirmed.ledger)return unavailable();
     const meta=typeof confirmed.resultMetaXdr==='string'?xdr.TransactionMeta.fromXDR(confirmed.resultMetaXdr,'base64'):confirmed.resultMetaXdr;
     if(!meta)return unavailable();
     const baseline=op.result_json?.blend_borrowing_baseline;
     const evidence=extractBorrowTransactionEvidence({meta,txHash:hash,confirmedLedger:confirmed.ledger,baseline,action:borrowingType});
     if(!evidence)return unavailable();
     const customer:CustomerContext={businessId:op.business_id,customerId:op.customer_id,walletId:op.wallet_id,walletAddress:op.stellar_address,privyUserId:op.privy_user_id};
     const [positions,balances]=await Promise.all([deps.borrowing.positions(customer),chain.getClassicBalances(customer.walletAddress)]);
     return inspectBorrowingDeltas({action:borrowingType,baseline,request:op.request_json,walletAddress:customer.walletAddress,positions,balances,confirmedLedger:confirmed.ledger,txHash:hash,feeStroops:String(tx.fee_charged),transactionEvidence:evidence});
    }catch{return unavailable();}
   }
   if(op.type==='blend.supply'||op.type==='blend.withdraw'){
    if(op.module_code!=='capital.lending'||op.provider!=='blend'||typeof op.privy_user_id!=='string'||!op.privy_user_id.startsWith('did:privy:'))return false;
    const confirmed=await chain.server.getTransaction(hash);
    if(confirmed.status!=='SUCCESS')return false;
    const action=PreparedActionSchema.parse(op.prepared_action);
    if(action.operationId!==op.id||action.customerId!==op.customer_id||action.walletAddress!==op.stellar_address||action.summary.action!==op.type||![XLM.id,BLEND_USDC_ASSET_ID].includes(op.request_json.asset_id)||action.summary.fromAssetId!==op.request_json.asset_id||zeroAtomic(action.summary.amount??'')!==toAtomic(op.request_json.amount,7))return false;
    const customer:CustomerContext={businessId:op.business_id,customerId:op.customer_id,walletId:op.wallet_id,walletAddress:op.stellar_address,privyUserId:op.privy_user_id};
    try{
     const [positions,balances]=await Promise.all([blend.positions(customer),chain.getClassicBalances(customer.walletAddress)]);
     if(action.summary.fromAssetId===BLEND_USDC_ASSET_ID)return inspectBlendUsdcDeltas({operation:op.type==='blend.supply'?'supply':'withdraw',baseline:op.result_json?.[op.type==='blend.supply'?'blend_supply_baseline':'blend_withdraw_baseline'],request:{asset_id:op.request_json.asset_id,market_id:op.request_json.market_id,amount:op.request_json.amount},walletAddress:customer.walletAddress,positions,balances,confirmedLedger:confirmed.ledger});
     if(op.type==='blend.withdraw'){
      const tx=await chain.horizon.transactions().transaction(hash).call();
      if(!tx.successful)return false;
      return inspectBlendWithdrawDeltas({baseline:op.result_json?.blend_withdraw_baseline,request:op.request_json,walletAddress:customer.walletAddress,positions,balances,confirmedLedger:confirmed.ledger,feeStroops:String(tx.fee_charged)});
     }
     return inspectSupplyDeltas({baseline:op.result_json?.blend_supply_baseline,request:op.request_json,walletAddress:customer.walletAddress,positions,balances,confirmedLedger:confirmed.ledger});
    }catch{return {verified:false,result:{blend_supply_verification:{verified:false,reason:'LIVE_SUPPLY_RECONCILIATION_UNAVAILABLE'}}};}
   }
   const tx=await chain.horizon.transactions().transaction(hash).call();if(!tx.successful)return false;
   const parsed=parseTestnetTransaction(op.signed_xdr);const payment=parsed.operations[0];
   if(payment?.type!=='payment'||!payment.asset.isNative())return false;
   const amount=op.request_json.amount;
   if(payment.amount!==amount&&toAtomic(payment.amount,7)!==toAtomic(amount,7))return false;
   const effects=await chain.horizon.effects().forTransaction(hash).limit(200).call();
   const credited=effects.records.some(e=>e.type==='account_credited'&&e.account===payment.destination&&e.asset_type==='native'&&toAtomic(e.amount,7)===toAtomic(amount,7));
   const debited=effects.records.some(e=>e.type==='account_debited'&&e.account===parsed.source&&e.asset_type==='native'&&toAtomic(e.amount,7)===toAtomic(amount,7));
   return credited&&debited;
  }
 };
}
