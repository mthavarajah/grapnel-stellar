import {readStockCatalog,type StockCatalogMarket} from './catalog.js';
import {readUnderlyingStockHistory,type StockHistoryRange} from './history.js';
export type {StockHistoryDTO,StockHistoryRange} from './history.js';
export {readStockCatalog,projectStockCatalog,type StockCatalogMarket} from './catalog.js';
import {Asset} from '@stellar/stellar-sdk';
import {GrapnelError,NETWORK,NETWORK_PASSPHRASE} from '@grapnel/contracts';
export const SODAX_PUBLIC_BASE='https://api.sodax.com';
export const TESTNET_NATIVE_SAC=Asset.native().contractId(NETWORK_PASSPHRASE);
const PUBLIC_NATIVE_SAC=Asset.native().contractId('Public Global Stellar Network ; September 2015');
type ObjectValue=Record<string,unknown>;
const object=(v:unknown):v is ObjectValue=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function assessStockNetwork(tokens:unknown,chains:unknown){
 if(!object(tokens)||!Array.isArray(chains)||chains.some(c=>typeof c!=='string')||!Array.isArray(tokens.stellar))throw new GrapnelError(502,'PROVIDER_INVALID_RESPONSE','Stock discovery response cannot establish a supported network');
 const stellar=tokens.stellar.filter(object),native=stellar.find(t=>t.symbol==='XLM');
 const matchesTestnet=native?.address===TESTNET_NATIVE_SAC;
 const reason=native?.address===PUBLIC_NATIVE_SAC?'STOCKS_ROUTE_USES_MAINNET_ASSETS':matchesTestnet?'TESTNET_STOCK_SOLVER_LIQUIDITY_AND_SIGNING_UNVERIFIED':'STOCKS_NETWORK_UNVERIFIED';
 return {module:'trade.stocks' as const,provider:'sodax',network:NETWORK,execution_status:'blocked' as const,reason,actions:[] as string[],markets:[],evidence:{observed_at:new Date().toISOString(),published_chain_keys:chains,stellar_token_count:stellar.length,reported_stock_token_count:stellar.filter(t=>t.isRwa===true).length,published_native_sac:typeof native?.address==='string'?native.address:null,required_testnet_native_sac:TESTNET_NATIVE_SAC,native_matches_testnet:matchesTestnet,eligible_testnet_route:false,execution_proof:null}};
}
/** Read-only provider capability probe. Contains no signing, intent creation or broadcast method. */
export class StocksTestnetDiscovery {
 private catalogSnapshot:{rows:StockCatalogMarket[];at:number}|undefined;
 private catalogRead:Promise<StockCatalogMarket[]>|undefined;
 private historyCache=new Map<string,{value:Awaited<ReturnType<typeof readUnderlyingStockHistory>>;at:number}>();
 constructor(config:{network:string;networkPassphrase:string},private fetcher:typeof fetch=fetch){if(config.network!=='testnet'||config.networkPassphrase!==NETWORK_PASSPHRASE)throw new GrapnelError(400,'NETWORK_MISMATCH','Stocks integration requires explicit Stellar Testnet');}
 private async get(path:string):Promise<unknown>{
  let r:Response;try{r=await this.fetcher(SODAX_PUBLIC_BASE+path,{method:'GET',signal:AbortSignal.timeout(12000)});}catch{throw new GrapnelError(503,'PROVIDER_UNAVAILABLE','SODAX discovery is unavailable',true);}
  if(r.status===401||r.status===403)throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','SODAX discovery access is required',false,{reason:'SODAX_DISCOVERY_ACCESS_REQUIRED'});
  if(!r.ok)throw new GrapnelError(503,'PROVIDER_UNAVAILABLE','SODAX discovery failed',true);
  try{return await r.json();}catch{throw new GrapnelError(502,'PROVIDER_INVALID_RESPONSE','SODAX returned an invalid discovery response');}
 }
 async catalog():Promise<StockCatalogMarket[]> {
  if(this.catalogSnapshot&&Date.now()-this.catalogSnapshot.at<60_000)return structuredClone(this.catalogSnapshot.rows);
  if(!this.catalogRead)this.catalogRead=readStockCatalog({fetch:this.fetcher}).then(rows=>{this.catalogSnapshot={rows,at:Date.now()};return rows;}).catch(()=>{throw new GrapnelError(503,'PROVIDER_UNAVAILABLE','Stock catalog is unavailable',true,{provider:'sodax'});}).finally(()=>{this.catalogRead=undefined;});
  return structuredClone(await this.catalogRead);
 }
 async history(marketId:string,range:StockHistoryRange){
  if(typeof marketId!=='string'||marketId.length>160||!['live','1d','1w','1m','1y','all'].includes(range))throw new GrapnelError(422,'VALIDATION_ERROR','Invalid stock history request');
  const candidate=(await this.catalog()).find(row=>row.market_id===marketId);
  if(!candidate)throw new GrapnelError(404,'NOT_FOUND','Stock catalog item not found');
  const key=marketId+':'+range,cached=this.historyCache.get(key);
  if(cached&&Date.now()-cached.at<15_000)return structuredClone(cached.value);
  const value=await readUnderlyingStockHistory(candidate,range,{fetch:this.fetcher});
  if(this.historyCache.size>=256)this.historyCache.delete(this.historyCache.keys().next().value!);
  this.historyCache.set(key,{value,at:Date.now()});return structuredClone(value);
 }
 async probe(){const [tokens,chains]=await Promise.all([this.get('/v1/swaps/tokens'),this.get('/v1/be/config/spoke/chains')]);return assessStockNetwork(tokens,chains);}
 async prepare():Promise<never>{const result=await this.probe();throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','No independently verified Stellar Testnet stock execution route',false,{module:'trade.stocks',execution_status:result.execution_status,reason:result.reason});}
}
