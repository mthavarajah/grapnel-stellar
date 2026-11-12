import {createHash} from 'node:crypto';
import {createPublicClient,http,parseAbi,type Hex,keccak256} from 'viem';
import {fromAtomic,type CustomerContext,type ModuleId} from '@grapnel/contracts';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {CCTP_TESTNET} from '../../adapters/cctp/registry.js';
import {RH_TESTNET} from '../../adapters/robinhood/registry.js';
import {GMX_TESTNET} from '../../adapters/gmx/registry.js';
const ABI=parseAbi(['function balanceOf(address owner) view returns(uint256)','function decimals() view returns(uint8)']);
const SOURCES=[
 {id:'hyperevm-testnet',label:'HyperEVM',chain:998,rpc:CCTP_TESTNET.hyperEvm.rpc,token:CCTP_TESTNET.hyperEvm.usdc,code:'USDC',hash:'b6ee454dc91cd5643f7b221c8606b9d060aaa574db7e3fcc6d8f8a7b25572790',algorithm:'sha256'},
 {id:'robinhood-testnet',label:'Robinhood',chain:46630,rpc:RH_TESTNET.rpc,token:RH_TESTNET.settlement.address,code:'USDG',hash:RH_TESTNET.settlement.codeHash,algorithm:'keccak256'},
 {id:'arbitrum-sepolia',label:'Arbitrum Sepolia',chain:421614,rpc:GMX_TESTNET.rpc,token:GMX_TESTNET.pins.collateral.address,code:'USDC.SG',hash:GMX_TESTNET.pins.collateral.codeHash,algorithm:'keccak256'},
] as const;
export interface NetworkAssetsDependencies {
 requireBusiness:(r:FastifyRequest,m:ModuleId)=>Promise<unknown>;
 requireCustomer:(r:FastifyRequest,c:string,w:string)=>Promise<CustomerContext>;
 success:(r:FastifyRequest,data:unknown)=>unknown;
 readWallets:(c:CustomerContext)=>Promise<{address:string}[]>;
}
/** Read-only holdings: ownership and asset identity are checked independently on each network. */
export async function readNetworkAssets(c:CustomerContext,readWallets:NetworkAssetsDependencies['readWallets']){
 const wallets=await readWallets(c),addresses=[...new Set(wallets.map(w=>w.address.toLowerCase()))];
 if(addresses.some(a=>!/^0x[0-9a-f]{40}$/.test(a)))throw Error('Invalid wallet ownership response');
 const balances=await Promise.all(SOURCES.map(async source=>{
  const asset_id=`${source.id}:erc20:${source.token.toLowerCase()}`;
  let amount:string|null=null,observed_at:string|null=null,verified=false;
  if(addresses.length){try{
   const client=createPublicClient({transport:http(source.rpc,{timeout:10000,retryCount:0})});
   if(await client.getChainId()!==source.chain)throw Error('Network mismatch');
   const block=await client.getBlock(),code=await client.getCode({address:source.token as Hex,blockNumber:block.number});
   if(!code||Date.now()-Number(block.timestamp)*1000>120000||Number(block.timestamp)*1000>Date.now()+10000)throw Error('Asset observation unavailable');
   const hash=source.algorithm==='sha256'?createHash('sha256').update(Buffer.from(code.slice(2),'hex')).digest('hex'):keccak256(code);
   if(hash!==source.hash)throw Error('Asset identity mismatch');
   const decimals=await client.readContract({address:source.token as Hex,abi:ABI,functionName:'decimals',blockNumber:block.number});if(decimals!==6)throw Error('Asset decimals mismatch');
   const values=await Promise.all(addresses.map(address=>client.readContract({address:source.token as Hex,abi:ABI,functionName:'balanceOf',args:[address as Hex],blockNumber:block.number})));
   amount=fromAtomic(values.reduce((sum,v)=>sum+v,0n),6);observed_at=new Date(Number(block.timestamp)*1000).toISOString();verified=true;
  }catch{/* Missing observations remain unknown. */}}
  return {asset_id,asset:{id:asset_id,code:source.code,name:source.code,kind:'erc20',network:source.id,decimals:6,verified:true},balance_verified:verified,wallet_amount:amount,reserved:null,spendable:null,network_label:source.label,feature_label:'Wallet',observed_at};
 }));
 return {scope:{business_id:c.businessId,customer_id:c.customerId,wallet_id:c.walletId},balances};
}
export async function registerNetworkAssetsRoute(app:FastifyInstance,d:NetworkAssetsDependencies){
 app.get('/v1/capital/wallets/:id/network-assets',async(request,reply)=>{
  await d.requireBusiness(request,'capital.wallets');const{id}=z.object({id:z.string().uuid()}).parse(request.params),{customer_id}=z.object({customer_id:z.string().uuid()}).strict().parse(request.query);
  const customer=await d.requireCustomer(request,customer_id,id);reply.header('Cache-Control','private, no-store');return d.success(request,await readNetworkAssets(customer,d.readWallets));
 });
}
