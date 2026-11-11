import {Address,Asset,StrKey,rpc,scValToNative,xdr} from '@stellar/stellar-sdk';
import {GrapnelError,NETWORK,NETWORK_PASSPHRASE,XLM,type AssetIdentity} from '@grapnel/contracts';
import {APPROVED_TOKEN_WASM,CORE_TESTNET_TOKENS} from './direct-assets.js';
export interface VerifiedTestnetToken {asset:AssetIdentity;wasmHash?:string;}
/** Explicit official Testnet registry only. No networkless/mainnet list, symbol aliases or random registry. */
export async function discoverVerifiedTestnetAssets(deps:{server?:Pick<rpc.Server,'getNetwork'|'getContractData'>;fetcher?:typeof fetch}={}):Promise<VerifiedTestnetToken[]>{
 const server=deps.server??new rpc.Server('https://soroban-testnet.stellar.org'),fetcher=deps.fetcher??fetch;
 if((await server.getNetwork()).passphrase!==NETWORK_PASSPHRASE)throw new GrapnelError(400,'NETWORK_MISMATCH','Token discovery requires explicit Testnet');
 const response=await fetcher(CORE_TESTNET_TOKENS,{signal:AbortSignal.timeout(12000)});if(!response.ok)throw new GrapnelError(503,'PROVIDER_UNAVAILABLE','Official Testnet token registry unavailable');
 const body=await response.json() as {network?:string;assets?:{contract:string;code:string;name:string;decimals:number}[]}[];
 if(!Array.isArray(body))throw new GrapnelError(502,'PROVIDER_INVALID_RESPONSE','Invalid official token registry');
 const candidates=body.find(b=>b.network==='testnet')?.assets;if(!Array.isArray(candidates)||candidates.length>100)throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Explicit bounded Testnet token registry required');
 const result:VerifiedTestnetToken[]=[];let cursor=0;
 await Promise.all(Array.from({length:4},async()=>{while(cursor<candidates.length){const c=candidates[cursor++]!;try{
  if(!StrKey.isValidContract(c.contract)||c.decimals!==7)continue;
  const entry=await server.getContractData(c.contract,xdr.ScVal.scvLedgerKeyContractInstance()),instance=entry.val.contractData().val().instance(),exe=instance.executable();
  const item=(instance.storage()??[]).find(e=>scValToNative(e.key())==='METADATA'),meta=item?scValToNative(item.val()) as {decimal?:unknown;name?:unknown;symbol?:unknown}:null;
  if(meta?.decimal!==c.decimals)continue;
  if(c.contract===Asset.native().contractId(NETWORK_PASSPHRASE)&&exe.switch().name==='contractExecutableStellarAsset'){result.push({asset:{...XLM,name:'Stellar Lumens',contractId:c.contract}});continue;}
  if(exe.switch().name==='contractExecutableWasm'&&exe.wasmHash().toString('hex')===APPROVED_TOKEN_WASM&&meta.symbol===c.code&&meta.name===c.name){result.push({asset:{id:`stellar-testnet:soroban:${c.contract}`,network:NETWORK,kind:'soroban',code:c.code,name:c.name,contractId:c.contract,decimals:c.decimals,verified:true,sourceUrl:CORE_TESTNET_TOKENS},wasmHash:APPROVED_TOKEN_WASM});continue;}
  if(exe.switch().name==='contractExecutableStellarAsset'&&typeof meta.name==='string'){
   const parsed=meta.name.match(/^([^:]+):(G[A-Z2-7]{55})$/);if(!parsed||parsed[1]!==c.code||meta.symbol!==c.code||!StrKey.isValidEd25519PublicKey(parsed[2]!)||new Asset(parsed[1]!,parsed[2]!).contractId(NETWORK_PASSPHRASE)!==c.contract)continue;
   result.push({asset:{id:`stellar-testnet:classic:${parsed[1]}:${parsed[2]}`,network:NETWORK,kind:'classic',code:c.code,name:meta.name,issuer:parsed[2],contractId:c.contract,decimals:c.decimals,verified:true,sourceUrl:CORE_TESTNET_TOKENS}});
  }
 }catch{/* Missing/unverified contracts never become offered executable assets. */}}}));
 return result.sort((a,b)=>a.asset.id.localeCompare(b.asset.id));
}
