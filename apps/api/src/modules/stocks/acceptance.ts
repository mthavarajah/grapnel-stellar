/** Canonical receipt/state-transition acceptance; no dependency on pruned historical RPC state. */
import {z} from 'zod';
import {encodeFunctionData,decodeFunctionResult,decodeEventLog,parseAbi,type Hex} from 'viem';
import {createRobinhoodReader,robinhoodRpcRequest,type RpcRequest} from '../../adapters/robinhood/index.js';
import {RH_TESTNET as P,STOCKS,type StockSymbol} from '../../adapters/robinhood/registry.js';
import type {StockPreparedTransaction} from '../../adapters/robinhood/transactions.js';
const ABI=parseAbi(['function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns(uint256)','function multicall(uint256 deadline,bytes[] data) payable returns(bytes[] results)','function balanceOf(address) view returns(uint256)','event Transfer(address indexed from,address indexed to,uint256 value)']);
const address=z.string().regex(/^0x[a-f0-9]{40}$/),hash=z.string().regex(/^0x[a-f0-9]{64}$/),step=z.object({prepared:z.unknown(),tx_hash:hash}).passthrough(),schema=z.object({network:z.literal('robinhood-testnet'),chain_id:z.literal(46630),account:address,symbol:z.enum(['TSLA','AMZN','PLTR','NFLX','AMD']),steps:z.object({buy:step,sell:step})}).passthrough();
const need=(v:unknown)=>{if(!v)throw Error('ROBINHOOD_ROUNDTRIP_UNVERIFIED');};
const qty=(v:unknown)=>{need(typeof v==='string'&&/^0x[a-f0-9]{1,64}$/i.test(v as string));return BigInt(v as string);};
const units=(v:unknown)=>{need(typeof v==='string'&&/^[1-9]\d{0,77}$/.test(v as string));return BigInt(v as string);};
const eq=(a:unknown,b:string)=>typeof a==='string'&&a.toLowerCase()===b.toLowerCase();
export function createRobinhoodRoundtripVerifier(d:{rpc?:RpcRequest;reader?:Pick<ReturnType<typeof createRobinhoodReader>,'verifyDeployment'|'readStockMultiplier'>}={}){
 const rpc=d.rpc??robinhoodRpcRequest,reader=d.reader??createRobinhoodReader({rpcRequest:rpc});
 return async(input:unknown,expectedSymbol:StockSymbol):Promise<boolean>=>{try{
  const m=schema.parse(input),stock=STOCKS.find(s=>s.symbol===m.symbol)!;need(m.symbol===expectedSymbol&&await rpc('eth_chainId',[])==='0xb626');const deployment=await reader.verifyDeployment(),multiplier=await reader.readStockMultiplier(m.symbol);need(multiplier.multiplierBaseUnits==='1000000000000000000'&&multiplier.chainId===46630);
  const phase=async(side:'buy'|'sell')=>{const s=m.steps[side],p=s.prepared as StockPreparedTransaction,buy=side==='buy',tokenIn=buy?P.settlement.address:stock.address,tokenOut=buy?stock.address:P.settlement.address,n=units(p?.amountInBaseUnits),minimum=units(p?.minimumOutBaseUnits),deadline=units(p?.deadlineSeconds),observed=Date.parse(p?.observedAt),expiry=Date.parse(p?.expiresAt);
   need(p.kind==='swap'&&p.chainId===46630&&p.value==='0'&&eq(p.from,m.account)&&eq(p.to,P.swapRouter02)&&eq(p.tokenIn,tokenIn)&&eq(p.tokenOut,tokenOut)&&p.symbol===m.symbol&&p.price_basis==='testnet_pool_quote'&&Number.isFinite(observed)&&Number.isFinite(expiry)&&expiry>observed&&expiry-observed<=30000&&deadline===BigInt(Math.floor(expiry/1000))&&n<=(buy?20000000n:10n*10n**18n));
   const inner=encodeFunctionData({abi:ABI,functionName:'exactInputSingle',args:[{tokenIn:tokenIn as Hex,tokenOut:tokenOut as Hex,fee:3000,recipient:m.account as Hex,amountIn:n,amountOutMinimum:minimum,sqrtPriceLimitX96:0n}]}),data=encodeFunctionData({abi:ABI,functionName:'multicall',args:[deadline,[inner]]});need(eq(p.data,data));
   const [tx,receipt]=await Promise.all([rpc('eth_getTransactionByHash',[s.tx_hash]),rpc('eth_getTransactionReceipt',[s.tx_hash])]) as any[];need(tx&&receipt&&eq(tx.hash,s.tx_hash)&&eq(tx.from,m.account)&&eq(tx.to,P.swapRouter02)&&eq(tx.input,data)&&qty(tx.value)===0n&&qty(tx.chainId)===46630n&&eq(receipt.transactionHash,s.tx_hash)&&eq(receipt.from,m.account)&&eq(receipt.to,P.swapRouter02)&&qty(receipt.status)===1n&&eq(tx.blockHash,receipt.blockHash)&&Array.isArray(receipt.logs)&&receipt.logs.length<=200);
   const height=qty(receipt.blockNumber),block=await rpc('eth_getBlockByNumber',[receipt.blockNumber,false]) as any;need(height>0n&&eq(block?.hash,receipt.blockHash)&&qty(block.number)===height&&qty(block.timestamp)*1000n<=BigInt(expiry)&&BigInt(deployment.blockNumber)>=height+1n);
   let spent=0n,received=0n;for(const log of receipt.logs){if(!eq(log.address,tokenIn)&&!eq(log.address,tokenOut))continue;need(!log.removed&&eq(log.transactionHash,s.tx_hash)&&eq(log.blockHash,receipt.blockHash)&&qty(log.blockNumber)===height);let event;try{event=decodeEventLog({abi:ABI,eventName:'Transfer',topics:log.topics,data:log.data});}catch{continue;}let delta=0n;if(eq(event.args.from,m.account))delta-=event.args.value;if(eq(event.args.to,m.account))delta+=event.args.value;if(eq(log.address,tokenIn))spent-=delta;else received+=delta;}
   need(spent===n&&received>=minimum);return{height,spent,received,hash:s.tx_hash};
  };
  const buy=await phase('buy'),sell=await phase('sell');need(buy.height<sell.height&&buy.hash!==sell.hash&&sell.spent===buy.received);
  const raw=await rpc('eth_call',[{to:stock.address,data:encodeFunctionData({abi:ABI,functionName:'balanceOf',args:[m.account as Hex]})},deployment.blockTag]);need(typeof raw==='string'&&decodeFunctionResult({abi:ABI,functionName:'balanceOf',data:raw as Hex})===0n);return true;
 }catch{return false;}};
}
export const verifyRobinhoodRoundtrip=createRobinhoodRoundtripVerifier();
