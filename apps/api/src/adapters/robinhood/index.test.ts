import { describe, expect, it } from 'vitest';
import { decodeFunctionData, encodeFunctionResult, keccak256, parseAbi, type Hex } from 'viem';
import { createRobinhoodReader, type RpcRequest } from './index.js';
import { RH_TESTNET, STOCKS } from './registry.js';
import evidence from './research/venue-evidence.json' with { type: 'json' };
import baseline from './research/rpc-evidence.json' with { type: 'json' };
// Replay captured successful Testnet reads; alter individual responses for negative cases.
function fixture(overrides: {chain?:string; pool?:string; decimals?:number; out?:bigint} = {}): RpcRequest {
 const captured = new Map<string,unknown>();
 function visit(value:unknown) {
  if (!value || typeof value !== 'object') return;
  const x=value as Record<string,unknown>;
  if (x.request && x.response) {
   const req=x.request as {method:string;params:unknown[]}; const res=x.response as {result?:unknown};
   if(req.method==='eth_call') captured.set(JSON.stringify(req.params[0]).toLowerCase(),res.result);
  }
  for(const child of Object.values(x))if(typeof child==='object')visit(child);
 }
 visit(evidence); visit(baseline);
 const abi=parseAbi(['function getPool(address,address,uint24) view returns(address)','function decimals() view returns(uint8)','function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns(uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)']);
 return async (method,params) => {
  if(method==='eth_chainId')return overrides.chain??'0xb626';
  if(method==='eth_blockNumber')return '0x91510f8';
  if(method==='eth_getCode') {
   const address=String(params[0]).toLowerCase();
   // Runtime bytes are not stored in evidence, so code verification needs actual bytecode fixtures.
   const value=(codeFixtures as Record<string, string>)[address];if(!value)throw Error(`Missing runtime ${address}`);return value;
  }
  const tx=params[0] as {to:string;data:Hex};
  try {
   const decoded=decodeFunctionData({abi,data:tx.data});
   if(decoded.functionName==='getPool' && overrides.pool)return encodeFunctionResult({abi,functionName:'getPool',result:overrides.pool as Hex});
   if(decoded.functionName==='decimals' && overrides.decimals!==undefined)return encodeFunctionResult({abi,functionName:'decimals',result:overrides.decimals});
   if(decoded.functionName==='quoteExactInputSingle')return encodeFunctionResult({abi,functionName:'quoteExactInputSingle',result:[overrides.out??1816226460641750698n,0n,0,150000n]});
  }catch{}
  const response=captured.get(JSON.stringify(tx).toLowerCase());
  if(response===undefined)throw Error(`Uncaptured RPC ${tx.to} ${tx.data}`);
  return response;
 };
}
import codeFixtures from './research/runtime-code.json' with {type:'json'};
describe('Robinhood Testnet reader',()=>{
 it('retains separate USDG identity and immutable provenance',()=>{
  expect(RH_TESTNET.settlement.decimals).toBe(6);expect(Object.isFrozen(STOCKS)).toBe(true);
  expect(STOCKS.find(x=>x.symbol==='PLTR')?.addressConfidence).toBe('shared_beacon_corroboration');
 });
 it('quotes exact integer amounts and rounds minimum output down',async()=>{
  const q=await createRobinhoodReader({rpcRequest:fixture(),now:()=>1000000}).quoteExactInput({symbol:'TSLA',side:'buy',amountInBaseUnits:'1000000',slippageBps:37});
  expect(q.minimumOutBaseUnits).toBe((1816226460641750698n*9963n/10000n).toString());
  expect(q.price_basis).toBe('testnet_pool_quote');expect(q.executionStatus).toBe('discovery_only');
  expect(Date.parse(q.expiresAt)-Date.parse(q.observedAt)).toBe(30000);
 });
 it('rejects wrong chain before reading contracts',async()=>{
  await expect(createRobinhoodReader({rpcRequest:fixture({chain:'0x1237'})}).verifyDeployment()).rejects.toThrow('chain mismatch');
 });
 it.each([{pool:'0x0000000000000000000000000000000000000001'}, {decimals:18}, {out:0n}])('fails closed on pool, decimals or zero quote',async bad=>{
  await expect(createRobinhoodReader({rpcRequest:fixture(bad)}).quoteExactInput({symbol:'TSLA',side:'buy',amountInBaseUnits:'1',slippageBps:10})).rejects.toThrow();
 });
 it.each(['0','0.1','-1','1e18','01'])('rejects noninteger or zero amount %s before RPC',async amount=>{
  await expect(createRobinhoodReader({rpcRequest:async()=>{throw Error('Must not call RPC');}}).quoteExactInput({symbol:'TSLA',side:'buy',amountInBaseUnits:amount,slippageBps:10})).rejects.toThrow('positive integer');
 });
 it('rejects stale quotes',async()=>{
  let calls=0;await expect(createRobinhoodReader({rpcRequest:fixture(),now:()=>calls++?31001:0}).quoteExactInput({symbol:'TSLA',side:'buy',amountInBaseUnits:'1000000',slippageBps:10})).rejects.toThrow('expired');
 });
 it('rejects changed contract runtime',async()=>{
  const original=fixture(); const rpc:RpcRequest=(method,params)=>method==='eth_getCode'?Promise.resolve('0x00'):original(method,params);
  await expect(createRobinhoodReader({rpcRequest:rpc}).verifyDeployment()).rejects.toThrow('runtime differs');
 });
 it('reads the actual Testnet stock multiplier',async()=>{
  const value=await createRobinhoodReader({rpcRequest:fixture()}).readStockMultiplier('PLTR');
  expect(value.multiplierBaseUnits).toBe('1000000000000000000');expect(value.multiplierDecimals).toBe(18);
 });
 it('pins actual bytecode hashes',()=>{for(const [address,code] of Object.entries(codeFixtures)){expect(code.length).toBeGreaterThan(2);expect(keccak256(code as Hex)).toMatch(/^0x[0-9a-f]{64}$/);expect(address).toBe(address.toLowerCase());}});
});
