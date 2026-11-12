import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { GrapnelError, fromAtomic, type CustomerContext } from '@grapnel/contracts';
import { encodeFunctionData, decodeFunctionResult, getAddress, isAddress, keccak256, parseAbi, type Hex } from 'viem';
import { requireBusiness, requireCustomer, success } from '../../lib/context.js';
import { robinhoodRpcRequest } from '../../adapters/robinhood/index.js';
import { RH_TESTNET } from '../../adapters/robinhood/registry.js';
import { ROBINHOOD_FUNDING } from '../../adapters/robinhood/transactions.js';
const ABI=parseAbi(['function decimals() view returns(uint8)','function balanceOf(address owner) view returns(uint256)']);
export interface RobinhoodFundingDependencies {readEthereumWallets:(customer:CustomerContext)=>Promise<{address:string}[]>;}
export async function registerRobinhoodFundingRoutes(app:FastifyInstance,deps:RobinhoodFundingDependencies){
 app.get('/v1/trade/stocks/funding',async(request,reply)=>{
  const q=z.object({customer_id:z.string().uuid(),wallet_id:z.string().uuid(),account_address:z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional()}).strict().parse(request.query);
  await requireBusiness(request,'trade.stocks');await requireBusiness(request,'capital.wallets');
  const customer=await requireCustomer(request,q.customer_id,q.wallet_id);
  const wallets=await deps.readEthereumWallets(customer);
  if(wallets.some(w=>!isAddress(w.address,{strict:false})||/^0x0{40}$/i.test(w.address)))throw new GrapnelError(503,'EXECUTION_UNAVAILABLE','Your stock wallet could not be verified');
  const accounts=[...new Set(wallets.map(w=>getAddress(w.address).toLowerCase()))].map(address=>({address}));
  if(q.account_address&&!accounts.some(a=>a.address===q.account_address!.toLowerCase()))throw new GrapnelError(403,'WALLET_OWNERSHIP_INVALID','Choose a wallet connected to your account');
  const selectedAddress=q.account_address?.toLowerCase()??accounts[0]?.address??null;
  let balances:{USDG:string|null;ETH:string|null}={USDG:null,ETH:null};let balanceStatus:'ready'|'unavailable'|'no_account'=selectedAddress?'unavailable':'no_account';let observedAt:string|null=null;
  if(selectedAddress){try{
   if(await robinhoodRpcRequest('eth_chainId',[])!=='0xb626')throw Error('Network mismatch');
   const block=await robinhoodRpcRequest('eth_blockNumber',[]);if(typeof block!=='string'||!/^0x[0-9a-f]+$/i.test(block))throw Error('Invalid block');
   const code=await robinhoodRpcRequest('eth_getCode',[RH_TESTNET.settlement.address,block]);if(typeof code!=='string'||keccak256(code as Hex)!==RH_TESTNET.settlement.codeHash)throw Error('Asset code mismatch');
   const call=async(name:'decimals'|'balanceOf',args:readonly unknown[])=>{
    const data=encodeFunctionData({abi:ABI,functionName:name,args:args as never});const raw=await robinhoodRpcRequest('eth_call',[{to:RH_TESTNET.settlement.address,data},block]);if(typeof raw!=='string')throw Error('Invalid asset read');return decodeFunctionResult({abi:ABI,functionName:name as never,data:raw as Hex}) as unknown;
   };
   if(await call('decimals',[])!==6)throw Error('USDG decimals mismatch');
   const usd=await call('balanceOf',[selectedAddress]);const eth=await robinhoodRpcRequest('eth_getBalance',[selectedAddress,block]);
   if(typeof usd!=='bigint'||usd<0n||typeof eth!=='string'||!/^0x[0-9a-f]+$/i.test(eth))throw Error('Invalid balance');
   balances={USDG:fromAtomic(usd,6),ETH:fromAtomic(BigInt(eth),18)};balanceStatus='ready';observedAt=new Date().toISOString();
  }catch{/* An unavailable read is unknown, never a fabricated zero balance. */}}
  reply.header('Cache-Control','private, no-store');
  return success(request,{scope:{business_id:customer.businessId,customer_id:customer.customerId,wallet_id:customer.walletId},funding:ROBINHOOD_FUNDING,accounts,selectedAddress,balances,balanceStatus,observedAt});
 });
}
