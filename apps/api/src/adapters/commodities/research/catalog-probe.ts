/** Read-only commodity catalog/network/liveness probe. No signing or submission. */
import {createHash} from 'node:crypto';
import {Address,Asset,rpc,xdr} from '@stellar/stellar-sdk';
import {NETWORK_PASSPHRASE} from '@grapnel/contracts';
import {screenCommodityCatalog} from '../catalog.js';
const sources={core:'https://raw.githubusercontent.com/soroswap/core/main/public/tokens.json',sodax:'https://docs.sodax.com/llms.txt',directory:'https://www.sodax.com/partners/asset-directory'};
const xaum='CC2RBGYNCFBCVENIDL5BFBWPH4OUZM2UA3OD2K2N54GLMWCC4KWPVAGO';
async function read(url:string,init?:RequestInit){const r=await fetch(url,{...init,signal:AbortSignal.timeout(15000)});return {status:r.status,text:await r.text()};}
async function main(){
 const server=new rpc.Server('https://soroban-testnet.stellar.org');
 if((await server.getNetwork()).passphrase!==NETWORK_PASSPHRASE)throw Error('Testnet network mismatch');
 const [core,sodax,directory]=await Promise.all([read(sources.core),read(sources.sodax),read(sources.directory)]);
 if(core.status!==200||sodax.status!==200||directory.status!==200)throw Error('Official source read failed');
 const testnet=JSON.parse(core.text).find((network:{network:string})=>network.network==='testnet');
 if(!testnet||!Array.isArray(testnet.assets))throw Error('Official core has no explicit Testnet catalog');
 const key=xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({contract:Address.fromString(xaum).toScAddress(),key:xdr.ScVal.scvLedgerKeyContractInstance(),durability:xdr.ContractDataDurability.persistent()}));
 const live=await server.getLedgerEntries(key);
 let provider:Record<string,unknown>={status:'not_requested_missing_server_key'};
 if(process.env.SOROSWAP_API_KEY){
  const headers={Authorization:'Bearer '+process.env.SOROSWAP_API_KEY,'content-type':'application/json'};
  const [catalog,protocols,quote]=await Promise.all([read('https://api.soroswap.finance/asset-list?name=soroswap',{headers}),read('https://api.soroswap.finance/protocols?network=testnet',{headers}),read('https://api.soroswap.finance/quote?network=testnet',{method:'POST',headers,body:JSON.stringify({assetIn:Asset.native().contractId(NETWORK_PASSPHRASE),assetOut:xaum,amount:'10000000',tradeType:'EXACT_IN',protocols:['soroswap','sdex'],slippageBps:49})})]);
  const q=JSON.parse(quote.text);provider={catalog_http_status:catalog.status,commodity_catalog_observations:catalog.status===200?screenCommodityCatalog(JSON.parse(catalog.text)):[],protocols_http_status:protocols.status,protocols:JSON.parse(protocols.text),exact_xlm_to_catalog_xaum_testnet_quote_http_status:quote.status,exact_quote_route_count:Array.isArray(q.routePlan)?q.routePlan.length:0};
 }
 console.log(JSON.stringify({observed_at:new Date().toISOString(),network:'stellar-testnet',mode:'read_only',signed:false,broadcast:false,sources,core_catalog:{http_status:core.status,sha256:createHash('sha256').update(core.text).digest('hex'),testnet_asset_count:testnet.assets.length,testnet_codes:testnet.assets.map((a:{code:string})=>a.code),commodity_observations:screenCommodityCatalog(testnet)},sodax:{http_status:sodax.status,sha256:createHash('sha256').update(sodax.text).digest('hex'),explicit_mainnet_only_statement_present:sodax.text.includes('SODAX is mainnet-only (no testnet chains or RPC endpoints exist)'),directory_mentions:['PAXG','XAUt','GLD','SLV','USO'].filter(code=>directory.text.includes(code)),inference:'Directory listings do not establish a Stellar Testnet network or route'},mainnet_catalog_xaum_on_testnet:{contract_id:xaum,latest_ledger:live.latestLedger,live_contract_instance_entries:live.entries.length,interpretation:'No live instance returned is not proof of nonexistence across every archive or future deployment'},provider,dependency:{needed:'Issuer-authorized Stellar Testnet commodity deployment plus seeded Testnet route and exact asset metadata',provider_request:'Ask Matrixdock/Soroswap for an explicitly Testnet XAUM (or other commodity) contract, decimals, issuer provenance, transfer eligibility and a liquid XLM/USDC route. SODAX would need an actual Testnet environment, not a production API key.'}},null,2));
}
main().catch(()=>{console.error('Commodity catalog probe failed; no write was requested');process.exitCode=1;});
