/** Read-only Testnet rate audit. Never prepares a new customer action, signs, submits, or inserts an operation.
 * Run: pnpm exec tsx scripts/verify-blend-rates-readonly.ts [--customer-history]
 * Optional GRAPNEL_ENV_FILE can load a local .env without printing its contents.
 */
import '../apps/api/src/lib/env.js';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { LendingEarningsReader } from '../apps/api/src/modules/lending/earnings.js';
import { fromAtomic, NETWORK_PASSPHRASE, type CustomerContext } from '../packages/contracts/src/index.js';
import type { BlendPosition } from '../apps/api/src/adapters/blend/index.js';
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { PoolV2, ReserveV2, ReserveData, ReserveConfigV2, TokenMetadata } = require('@blend-capital/blend-sdk');
const { rpc, Asset } = require('@stellar/stellar-sdk');
const pg = require('pg');
if (process.env.GRAPNEL_ENV_FILE && existsSync(process.env.GRAPNEL_ENV_FILE)) process.loadEnvFile(process.env.GRAPNEL_ENV_FILE);
const network = { rpc: 'https://soroban-testnet.stellar.org', passphrase: NETWORK_PASSPHRASE };
const wallet = 'GB4PC65ZHBPVEZMAHY2K2KYMS3RFBIN2FQIE3LGTLEHT2DEWVMTD7JYQ';
const expectedUsdc = 'GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56';
const customer: CustomerContext = {businessId:'00000000-0000-4000-8000-000000000001',customerId:'2a007496-0afb-41a4-af3f-b61eb05f3398',walletId:'781c84a3-8d33-4eef-ab82-10f9bbd2071c',walletAddress:wallet,privyUserId:''};
const scalar = 10_000_000n;
const floor = (a:bigint,b:bigint,s:bigint) => a*b/s;
const ceil = (a:bigint,b:bigint,s:bigint) => (a*b+s-1n)/s;
/** Independent integer replay of SDK setRates, avoiding decimal token arithmetic. */
function independentRates(reserve:any,take:bigint) {
 const util:bigint=reserve.getUtilization(), target=BigInt(reserve.config.util), modScalar=10n**BigInt(reserve.irmodDecimals);
 const config=reserve.config, modifier:bigint=reserve.data.interestRateModifier;
 let ir:bigint;
 if(util<=target) ir=ceil(ceil(target===0n?0n:ceil(util,scalar,target),BigInt(config.r_one),scalar)+BigInt(config.r_base),modifier,modScalar);
 else if(util<=9_500_000n) ir=ceil(ceil(ceil(util-target,scalar,9_500_000n-target),BigInt(config.r_two),scalar)+BigInt(config.r_one)+BigInt(config.r_base),modifier,modScalar);
 else ir=ceil(ceil(util-9_500_000n,scalar,500_000n),BigInt(config.r_three),scalar)+ceil(modifier,BigInt(config.r_two)+BigInt(config.r_one)+BigInt(config.r_base),modScalar);
 const supply=floor(ir,floor(scalar-take,util,scalar),scalar);
 return {borrow_apr_atomic:ir,supply_apr_atomic:supply,borrow_apr:Number(ir)/1e7,supply_apr:Number(supply)/1e7,apy:(1+Number(supply)/1e7/52)**52-1};
}
let stage="init";
async function main(){
 if(JSON.parse(require('node:fs').readFileSync(require('node:path').resolve(require('node:path').dirname(require.resolve('@blend-capital/blend-sdk')),'../../package.json'),'utf8')).version!=='4.0.0') throw new Error('SDK_VERSION_MISMATCH');
 const server=new rpc.Server(network.rpc);
 if((await server.getNetwork()).passphrase!==NETWORK_PASSPHRASE)throw new Error('NETWORK_MISMATCH');
 const registryResponse=await fetch('https://raw.githubusercontent.com/blend-capital/blend-utils/main/testnet.contracts.json',{signal:AbortSignal.timeout(15000)});
 if(!registryResponse.ok)throw new Error('OFFICIAL_REGISTRY_UNAVAILABLE');
 const registry=await registryResponse.json() as {ids:Record<string,string>};
 if(registry.ids.XLM!==Asset.native().contractId(NETWORK_PASSPHRASE))throw new Error('REGISTRY_NATIVE_MISMATCH');
 stage="pool";const pool=await PoolV2.load(network,registry.ids.TestnetV2);
 stage="user";const user=await pool.loadUser(wallet);
 const take=BigInt(pool.metadata.backstopRate);
 const positions:BlendPosition[]=[];const output:any[]=[];
 for(const reserve of pool.reserves.values()){
  stage="token";const token=await TokenMetadata.load(network,reserve.assetId);
  const native=token.asset?.isNative(),usdc=token.asset?.getCode()==='USDC'&&token.asset?.getIssuer()===expectedUsdc;
  if(!native&&!usdc)continue;
  if(token.asset.contractId(NETWORK_PASSPHRASE)!==reserve.assetId)throw new Error('ASSET_IDENTITY_MISMATCH');
  stage="raw";const entries=await server.getLedgerEntries(ReserveConfigV2.ledgerKey(pool.id,reserve.assetId),ReserveData.ledgerKey(pool.id,reserve.assetId));
  if(entries.entries.length!==2)throw new Error('RAW_RESERVE_MISSING');
  const configEntry=await server.getLedgerEntries(ReserveConfigV2.ledgerKey(pool.id,reserve.assetId));
  const dataEntry=await server.getLedgerEntries(ReserveData.ledgerKey(pool.id,reserve.assetId));
  const config=ReserveConfigV2.fromLedgerEntryData(configEntry.entries[0].val.toXDR('base64')),data=ReserveData.fromLedgerEntryData(dataEntry.entries[0].val.toXDR('base64'));
  stage="decode";const raw=new ReserveV2(pool.id,reserve.assetId,config,data,undefined,undefined,0,0,0,0,entries.latestLedger);
  const rawData={...data};const independent=independentRates(raw,take);raw.setRates(take);
  if(independent.borrow_apr!==raw.borrowApr||independent.supply_apr!==raw.supplyApr||Math.abs(independent.apy-raw.estSupplyApy)>1e-12)throw new Error('INDEPENDENT_RATE_MISMATCH');
  const bTokens:bigint=user.getSupplyBTokens(reserve)+user.getCollateralBTokens(reserve);
  stage="amount";const rawAmount:bigint=raw.toAssetFromBToken(bTokens);
  const projected=new ReserveV2(pool.id,reserve.assetId,config,Object.assign(Object.create(Object.getPrototypeOf(data)),rawData),undefined,undefined,0,0,0,0,entries.latestLedger);
  const dailyProjectionTime=data.lastTime+86400;projected.accrue(take,dailyProjectionTime);
  const dailyAmount:bigint=projected.toAssetFromBToken(bTokens);
  const assetId=native?'stellar-testnet:native:XLM':`stellar-testnet:classic:USDC:${expectedUsdc}`;
  const position:BlendPosition={market_id:`stellar-testnet:blend:${pool.id}:${reserve.assetId}`,pool_contract_id:pool.id,reserve_contract_id:reserve.assetId,asset_id:assetId,supplied:fromAtomic(user.getSupply(reserve)+user.getCollateral(reserve),config.decimals),collateral:fromAtomic(user.getCollateral(reserve),config.decimals),borrowed:fromAtomic(user.getLiabilities(reserve),config.decimals),wallet_spendable:false,supply_apy_variable:reserve.estSupplyApy,health_factor:null,as_of_ledger:pool.metadata.latestLedger,as_of:new Date().toISOString(),readiness:'discovery_only'};
  positions.push(position);
  output.push({symbol:native?'XLM':'USDC',asset_id:assetId,reserve_contract_id:reserve.assetId,raw_ledger:entries.latestLedger,raw_reserve_last_time:new Date(rawData.lastTime*1000).toISOString(),raw_data:rawData,raw_config:config,utilization_atomic:raw.getUtilization(),backstop_take_rate_atomic:take,independent,raw_sdk:{borrow_apr:raw.borrowApr,supply_apr:raw.supplyApr,estimated_supply_apy:raw.estSupplyApy,ui_percent:raw.estSupplyApy*100},current_sdk_projection:{type:'SDK_projection_to_read_time_not_committed_raw_bRate',borrow_apr:reserve.borrowApr,supply_apr:reserve.supplyApr,estimated_supply_apy:reserve.estSupplyApy,ui_percent:reserve.estSupplyApy*100,b_rate:reserve.data.bRate,as_of:new Date(pool.timestamp*1000).toISOString()},position,b_tokens:bTokens,user_share_of_b_supply:{numerator:bTokens,denominator:data.bSupply},daily_constant_state_projection:{type:'estimate_not_observed_interest',from:new Date(data.lastTime*1000).toISOString(),to:new Date(dailyProjectionTime*1000).toISOString(),b_rate_before:rawData.bRate,b_rate_after:projected.data.bRate,per_one_underlying_apr_fraction:raw.supplyApr/365,user_underlying_before:fromAtomic(rawAmount,config.decimals),user_underlying_after:fromAtomic(dailyAmount,config.decimals),user_interest:fromAtomic(dailyAmount-rawAmount,config.decimals)}});
 }
 if(output.length!==2)throw new Error('EXPECTED_XLM_USDC_RESERVES_MISSING');
 let history:unknown={status:'not_requested',reason:'Run --customer-history with authorized local DATABASE_URL for verified earnings.'};
 stage='history';if(process.argv.includes('--customer-history')){
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL_REQUIRED');
  const db=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000});const client=await db.connect();
  try{
   await client.query('BEGIN READ ONLY');
   await client.query("SET LOCAL statement_timeout='15000ms'");
   const bound=await client.query('SELECT id FROM wallets WHERE id=$1 AND business_id=$2 AND customer_id=$3 AND stellar_address=$4',[customer.walletId,customer.businessId,customer.customerId,wallet]);
   if(bound.rows.length!==1)throw new Error('CUSTOMER_WALLET_BINDING_MISMATCH');
   const reader=new LendingEarningsReader({pool:client,positions:async()=>positions});
   const earned=await reader.getEarnings(customer);
   const flows=await client.query("SELECT type,state,tx_hash,request_json->>'asset_id' AS asset_id,request_json->>'amount' AS amount,created_at FROM operations WHERE business_id=$1 AND customer_id=$2 AND wallet_id=$3 AND module_code='capital.lending' AND provider='blend' ORDER BY created_at",[customer.businessId,customer.customerId,customer.walletId]);
   history={status:'read_only_verified_reader',earned,flows:flows.rows.map((r:any)=>({...r,explorer_url:r.tx_hash?`https://stellar.expert/explorer/testnet/tx/${r.tx_hash}`:null}))};
  }finally{await client.query('ROLLBACK');client.release();await db.end();}
 }
 console.log(JSON.stringify({observed_at:new Date().toISOString(),mode:'read_only_no_signing_no_broadcast',network:'stellar-testnet',sdk_version:'4.0.0',pool_contract_id:pool.id,wallet_address:wallet,rates:output,history,realized_annual_apy:null,realized_annual_apy_reason:'Short observation window and mixed deposits/withdrawals do not establish a realized annual return. Daily values are explicit constant-state projections; earned amounts are token-denominated verified flow accounting, not annualized rates.'},(_,value)=>typeof value==='bigint'?value.toString():value,2));
}
main().catch(error=>{const safe=typeof error?.message==='string'&&/^[A-Z_]+$/.test(error.message)?error.message:'PROVIDER_OR_DATABASE_READ_FAILED';console.error(`Blend read-only verification failed at ${stage}: ${safe}. No secret-bearing error details are printed.`);process.exitCode=1;});
