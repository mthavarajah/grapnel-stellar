import{z}from'zod';
import type{ApprovedPerpetualIntent}from'../../../modules/perpetuals/execution-contract.js';
import{HL_INFO,HL_RPC,type HyperliquidExecutionDependencies,type MarketIdentity,type PositionBaseline}from'./types.js';
import{decimal,signedDecimal,normalize,fail,freshReceipt}from'./guards.js';
const universe=z.object({name:z.string().min(1),szDecimals:z.number().int().min(0).max(6),maxLeverage:z.number().int().min(1).max(1000),isDelisted:z.boolean().optional()}).passthrough();
export async function network(d:HyperliquidExecutionDependencies){const request={jsonrpc:'2.0'as const,id:1 as const,method:'eth_chainId'as const,params:[]as[]},body=freshReceipt(await d.transport.rpc(HL_RPC,request),HL_RPC,request,d.now?.()??Date.now());const parsed=z.object({jsonrpc:z.literal('2.0'),id:z.literal(1),result:z.literal('0x3e6')}).strict().safeParse(body);if(!parsed.success)return fail('HYPEREVM_TESTNET_CHAIN_998_REQUIRED');}
export async function info(d:HyperliquidExecutionDependencies,request:Record<string,unknown>){const expected=structuredClone(request);return freshReceipt(await d.transport.info(HL_INFO,structuredClone(expected)),HL_INFO,expected,d.now?.()??Date.now());}
export async function market(d:HyperliquidExecutionDependencies,i:ApprovedPerpetualIntent):Promise<MarketIdentity>{
 if(!['','xyz'].includes(i.dex))return fail('UNREVIEWED_DEX');
 let dexIndex=0;if(i.dex){const rows=z.array(z.object({name:z.string().min(1)}).passthrough().nullable()).min(2).max(2048).parse(await info(d,{type:'perpDexs'}));if(rows[0]!==null||rows.slice(1).some(x=>x===null)||new Set(rows.slice(1).map(x=>x!.name)).size!==rows.length-1)return fail('DEX_REGISTRY_IDENTITY');dexIndex=rows.findIndex(r=>r?.name===i.dex);if(dexIndex<=0)return fail('DEX_REGISTRY_IDENTITY');}
 const result=z.tuple([z.object({universe:z.array(universe).min(1).max(10000),collateralToken:z.number().int().optional()}).passthrough(),z.array(z.unknown())]).parse(await info(d,{type:'metaAndAssetCtxs',...(i.dex?{dex:i.dex}:{})})),meta=result[0];if(result[1].length!==meta.universe.length||meta.collateralToken!==undefined&&meta.collateralToken!==0||i.dex&&meta.collateralToken!==0)return fail('EXACT_MARKET_CONTEXT_OR_USDC_COLLATERAL');
 const local=i.dex?i.assetIndex-100000-dexIndex*10000:i.assetIndex,row=meta.universe[local];if(!Number.isInteger(local)||local<0||local>=10000||!row||row.name!==i.providerSymbol||row.isDelisted||(i.dex?!row.name.startsWith(i.dex+':'):row.name.includes(':')))return fail('EXACT_GLOBAL_ASSET_DEX_PREFIX');
 const identity={symbol:row.name,assetIndex:i.assetIndex,localAssetIndex:local,dex:i.dex,dexIndex,szDecimals:row.szDecimals,maxLeverage:row.maxLeverage};
 if(i.leverage>row.maxLeverage)return fail('MARKET_ID_OR_MAX_LEVERAGE');
 if(i.marketId===`hyperliquid-testnet:stocks:${i.assetIndex}`){const raw=await d.verifyStockMarketCategory?.(structuredClone(identity)),category=z.object({network:z.literal('hyperliquid-testnet'),assetIndex:z.number().int(),providerSymbol:z.string(),dex:z.string(),category:z.enum(['equity','index']),observedAt:z.number().int().positive().safe()}).strict().safeParse(raw),now=d.now?.()??Date.now();if(!category.success||category.data.assetIndex!==i.assetIndex||category.data.providerSymbol!==i.providerSymbol||category.data.dex!==i.dex||category.data.observedAt>now+1000||now-category.data.observedAt>5000)return fail('FRESH_VERIFIED_STOCK_CATEGORY_REQUIRED');}
 else if(i.marketId!==`hyperliquid-testnet:perps:${i.assetIndex}`)return fail('MARKET_ID_OR_MAX_LEVERAGE');
 return identity;
}
const stateSchema=z.object({time:z.number().int().positive().safe(),assetPositions:z.array(z.object({type:z.literal('oneWay'),position:z.object({coin:z.string(),szi:signedDecimal,leverage:z.object({type:z.enum(['cross','isolated']),value:z.number().int().positive()}).passthrough()}).passthrough()}).passthrough()).max(10000)}).passthrough();
export async function position(d:HyperliquidExecutionDependencies,i:ApprovedPerpetualIntent):Promise<PositionBaseline>{
 const [state,active]=await Promise.all([info(d,{type:'clearinghouseState',user:i.accountAddress,...(i.dex?{dex:i.dex}:{})}),info(d,{type:'activeAssetData',user:i.accountAddress,coin:i.providerSymbol})]),parsed=stateSchema.parse(state),data=z.object({user:z.string(),coin:z.string(),leverage:z.object({type:z.enum(['cross','isolated']),value:z.number().int().positive()}).passthrough()}).passthrough().parse(active),now=d.now?.()??Date.now();
 if(data.user.toLowerCase()!==i.accountAddress.toLowerCase()||data.coin!==i.providerSymbol)return fail('ACTIVE_ASSET_ACCOUNT_OR_SYMBOL');
 if(parsed.time>now+1000||now-parsed.time>5000||data.leverage.value!==i.leverage)return fail('FRESH_CONFIGURED_LEVERAGE_REQUIRED');
 if(new Set(parsed.assetPositions.map(r=>r.position.coin)).size!==parsed.assetPositions.length)return fail('DUPLICATE_POSITION');const current=parsed.assetPositions.find(r=>r.position.coin===i.providerSymbol)?.position;
 if(current&&(current.leverage.value!==i.leverage||current.leverage.type!==data.leverage.type))return fail('POSITION_LEVERAGE_MISMATCH');
 return{size:current?normalize(current.szi):'0',leverageType:data.leverage.type,observedAt:parsed.time};
}
