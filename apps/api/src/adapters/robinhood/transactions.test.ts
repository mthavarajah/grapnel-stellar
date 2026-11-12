import {describe,it,expect} from 'vitest';
import {encodeFunctionData,decodeFunctionData,encodeFunctionResult,encodeEventTopics,encodeAbiParameters,parseAbi,type Hex} from 'viem';
import {createRobinhoodTransactionAdapter,type StockPreparedTransaction} from './transactions.js';
import {RH_TESTNET,STOCKS} from './registry.js';
import type {RpcRequest} from './index.js';
import evidence from './research/venue-evidence.json' with {type:'json'};
import baseline from './research/rpc-evidence.json' with {type:'json'};
import code from './research/runtime-code.json' with {type:'json'};
const who='0x1111111111111111111111111111111111111111';
const abi=parseAbi(['function approve(address spender,uint256 amount) returns(bool)','function allowance(address owner,address spender) view returns(uint256)','function balanceOf(address owner) view returns(uint256)','function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns(uint256 amountOut)','function multicall(uint256 deadline,bytes[] data) payable returns(bytes[] results)','event Transfer(address indexed from,address indexed to,uint256 value)']);
function fixture(allowance=1000000n):RpcRequest{
 const reads=new Map<string,unknown>();function visit(x:unknown){if(!x||typeof x!=='object')return;const v=x as Record<string,unknown>;if(v.request&&v.response){const req=v.request as {method:string;params:unknown[]};if(req.method==='eth_call')reads.set(JSON.stringify(req.params[0]).toLowerCase(),(v.response as {result:unknown}).result);}for(const a of Object.values(v))if(typeof a==='object')visit(a);}
 visit(evidence);visit(baseline);
 return async(method,params)=>{
  if(method==='eth_chainId')return '0xb626';if(method==='eth_blockNumber')return '0x91510f8';if(method==='eth_getBalance')return '0xde0b6b3a7640000';if(method==='eth_estimateGas')return '0x30000';
  if(method==='eth_getCode')return (code as Record<string,string>)[String(params[0]).toLowerCase()];
  const tx=params[0] as {to:string;data:Hex;from?:string};
  try{const decoded=decodeFunctionData({abi,data:tx.data});
   if(decoded.functionName==='balanceOf')return encodeFunctionResult({abi,functionName:'balanceOf',result:100000000000000000000n});
   if(decoded.functionName==='allowance')return encodeFunctionResult({abi,functionName:'allowance',result:allowance});
   if(decoded.functionName==='approve')return encodeFunctionResult({abi,functionName:'approve',result:true});
   if(decoded.functionName==='multicall')return encodeFunctionResult({abi,functionName:'multicall',result:['0x']});
  }catch{}
  const raw=reads.get(JSON.stringify({to:tx.to,data:tx.data}).toLowerCase());if(raw===undefined)throw Error('Uncaptured read '+tx.data);return raw;
 };
}
describe('Robinhood exact transaction intents',()=>{
 it('prepares only exact reviewed router allowance, never unlimited',async()=>{
  const p=await createRobinhoodTransactionAdapter({rpcRequest:fixture(),now:()=>1000000}).prepareApproval({customerAddress:who,asset:'USDG',amountBaseUnits:'1000000'});
  const decoded=decodeFunctionData({abi,data:p.prepared.data});expect(decoded.args).toEqual([RH_TESTNET.swapRouter02,1000000n]);expect(p.prepared.to).toBe(RH_TESTNET.settlement.address);expect(p.simulation).toBe('passed');
 });
 it('wraps a single exact swap with finite deadline and customer recipient',async()=>{
  const p=await createRobinhoodTransactionAdapter({rpcRequest:fixture(),now:()=>1000000}).prepareSwap({customerAddress:who,symbol:'TSLA',side:'buy',amountInBaseUnits:'1000000',slippageBps:50});
  const outer=decodeFunctionData({abi,data:p.prepared.data});expect(outer.functionName).toBe('multicall');
  if(outer.functionName!=='multicall')throw Error('Wrong call');expect(outer.args[0]).toBe(1030n);expect(outer.args[1]).toHaveLength(1);
  const inner=decodeFunctionData({abi,data:outer.args[1][0]!});expect(inner.functionName).toBe('exactInputSingle');
  if(inner.functionName!=='exactInputSingle')throw Error('Wrong call');expect(inner.args[0].recipient).toBe(who);expect(inner.args[0].amountIn).toBe(1000000n);expect(p.approvalRequired).toBe(false);
 });
 it('reports missing approval without pretending simulation or execution succeeded',async()=>{
  const p=await createRobinhoodTransactionAdapter({rpcRequest:fixture(0n),now:()=>1000000}).prepareSwap({customerAddress:who,symbol:'TSLA',side:'buy',amountInBaseUnits:'1000000',slippageBps:50});expect(p.approvalRequired).toBe(true);expect(p.simulation).toBe('approval_required');
 });
 it('rejects arbitrary prepared calldata before reconciliation',async()=>{
  const prepared={kind:'approval',chainId:46630,from:who,to:RH_TESTNET.settlement.address,value:'0',data:'0xdeadbeef',tokenIn:RH_TESTNET.settlement.address,tokenOut:null,amountInBaseUnits:'1',minimumOutBaseUnits:null,symbol:'USDG',observedAt:new Date(1000000).toISOString(),expiresAt:new Date(1030000).toISOString(),deadlineSeconds:null,executionStatus:'discovery_only',price_basis:null} as StockPreparedTransaction;
  await expect(createRobinhoodTransactionAdapter({rpcRequest:fixture()}).reconcileTransaction({txHash:'0x'+'12'.repeat(32),expectedPrepared:prepared})).rejects.toThrow('calldata');
 });
 it.each(['0','-1','0.1','1e7','9'.repeat(80)])('rejects invalid approval amount %s',async amount=>{await expect(createRobinhoodTransactionAdapter({rpcRequest:fixture()}).prepareApproval({customerAddress:who,asset:'USDG',amountBaseUnits:amount})).rejects.toThrow();});
 it.each(['confirmed','pending','reverted','wrong-recipient','reorg'] as const)('reconciles approval state %s',async scenario=>{
  const base=fixture();const adapter=createRobinhoodTransactionAdapter({rpcRequest:base,now:()=>1000000});
  const {prepared}=await adapter.prepareApproval({customerAddress:who,asset:'USDG',amountBaseUnits:'1000000'});
  const hash='0x'+'12'.repeat(32);const blockHash='0x'+'ab'.repeat(32);
  const rpc:RpcRequest=async(method,params)=>{
   if(method==='eth_getTransactionByHash')return {hash,from:scenario==='wrong-recipient'?'0x2222222222222222222222222222222222222222':who,to:prepared.to,input:prepared.data,value:'0x0',chainId:'0xb626',blockHash};
   if(method==='eth_getTransactionReceipt')return scenario==='pending'?null:{transactionHash:hash,from:who,to:prepared.to,blockNumber:'0x91510f6',blockHash,status:scenario==='reverted'?'0x0':'0x1',logs:[]};
   if(method==='eth_getBlockByNumber')return {hash:scenario==='reorg'?'0x'+'cd'.repeat(32):blockHash,timestamp:'0x3ed'};
   return base(method,params);
  };
  const promise=createRobinhoodTransactionAdapter({rpcRequest:rpc,now:()=>1006000}).reconcileTransaction({txHash:hash,expectedPrepared:prepared});
  if(scenario==='wrong-recipient'||scenario==='reorg')await expect(promise).rejects.toThrow();
  else expect((await promise).state).toBe(scenario);
 });
 it.each([false,true])('requires receipt and independent exact balances for a swap (tamper=%s)',async tamper=>{
  const base=fixture();const {prepared}=await createRobinhoodTransactionAdapter({rpcRequest:base,now:()=>1000000}).prepareSwap({customerAddress:who,symbol:'TSLA',side:'buy',amountInBaseUnits:'1000000',slippageBps:50});
  const hash='0x'+'13'.repeat(32);const blockHash='0x'+'ab'.repeat(32);const pool=STOCKS[0]!.poolAddress;const received=1816226460641750698n;
  const log=(token:string,from:string,to:string,value:bigint)=>({address:token,topics:encodeEventTopics({abi,eventName:'Transfer',args:{from:from as Hex,to:to as Hex}}),data:encodeAbiParameters([{type:'uint256'}],[value])});
  const rpc:RpcRequest=async(method,params)=>{
   if(method==='eth_getTransactionByHash')return {hash,from:who,to:prepared.to,input:prepared.data,value:'0x0',chainId:'0xb626',blockHash};
   if(method==='eth_getTransactionReceipt')return {transactionHash:hash,from:who,to:prepared.to,blockNumber:'0x91510f6',blockHash,status:'0x1',logs:[log(prepared.tokenIn,who,pool,1000000n),log(prepared.tokenOut!,pool,who,received)]};
   if(method==='eth_getBlockByNumber')return {hash:blockHash,timestamp:'0x3ed'};
   if(method==='eth_call'){
    const tx=params[0] as {to:string;data:Hex};
    try{const decoded=decodeFunctionData({abi,data:tx.data});if(decoded.functionName==='balanceOf'){
     const before=params[1]==='0x91510f5';const input=tx.to.toLowerCase()===prepared.tokenIn.toLowerCase();const amount=input?(before?100000000n:99000000n):(before?0n:received+(tamper?1n:0n));
     return encodeFunctionResult({abi,functionName:'balanceOf',result:amount});
    }}catch{}
   }
   return base(method,params);
  };
  const result=createRobinhoodTransactionAdapter({rpcRequest:rpc,now:()=>1006000}).reconcileTransaction({txHash:hash,expectedPrepared:prepared});
  if(tamper)await expect(result).rejects.toThrow('balances differ');else {const verified=await result;expect(verified.state).toBe('confirmed');if('amountOutBaseUnits' in verified)expect(verified.amountOutBaseUnits).toBe(received.toString());}
 });
 it('rejects unlimited approval amounts',async()=>{await expect(createRobinhoodTransactionAdapter({rpcRequest:fixture()}).prepareApproval({customerAddress:who,asset:'USDG',amountBaseUnits:(2n**256n-1n).toString()})).rejects.toThrow('reviewed Testnet limit');});
 it('publishes actual distinct USDG faucet configuration',()=>{const f=createRobinhoodTransactionAdapter().funding;expect(f.chainId).toBe(46630);expect(f.asset.symbol).toBe('USDG');expect(f.faucetAmount).toBe('100');});
});
