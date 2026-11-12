/** Read-only canonical source, runtime link and QuoterV2 checks. Never broadcasts. */
import {encodeFunctionData,decodeFunctionResult,parseAbi,keccak256,toHex,toBytes} from 'viem';
import {readFile,writeFile} from 'node:fs/promises';
const RPC='https://rpc.testnet.chain.robinhood.com';let id=0;
async function rpc(method,params){const request={jsonrpc:'2.0',id:++id,method,params};const res=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request)});return {request,response:await res.json()};}
const chain=await rpc('eth_chainId',[]);if(chain.response.result!=='0xb626')throw Error('Wrong chain');
const block=(await rpc('eth_blockNumber',[])).response.result;
const abi=parseAbi(['function factory() view returns(address)','function WETH9() view returns(address)','function implementation() view returns(address)','function hasRole(bytes32 role,address account) view returns(bool)','function paused() view returns(bool)','function uiMultiplier() view returns(uint256)','function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns(uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)']);
async function call(address,name,args=[]){const data=encodeFunctionData({abi,functionName:name,args});const result=await rpc('eth_call',[{to:address,data},block]);try{result.decoded=decodeFunctionResult({abi,functionName:name,data:result.response.result});}catch{}return result;}
const addresses={factory:'0x911b4000D3422F482F4062a913885f7b035382Df',quoter:'0x231606c321A99DE81e28fE48B07a93F1ba49e713',swapRouter02:'0x3Ce954107b1A675826B33bF23060Dd655e3758fE',universalRouter:'0x6F308B834595312f734e65e273F2210f43Fc48F8'};
const result={captured_at:new Date().toISOString(),execution_status:'discovery_only',transactions_submitted:0,rpc:RPC,chain,block,addresses,contracts:{},quotes:[],stock_proxies:[],sources:{}};
for(const [name,address] of Object.entries(addresses)){
 const code=await rpc('eth_getCode',[address,block]);result.contracts[name]={code_hash:keccak256(code.response.result),code_bytes:(code.response.result.length-2)/2};
 if(name==='quoter'||name==='swapRouter02')result.contracts[name].links={factory:await call(address,'factory'),WETH9:await call(address,'WETH9')};
}
const baseline=JSON.parse(await readFile(new URL('./rpc-evidence.json',import.meta.url),'utf8'));
const usdg='0x7E955252E15c84f5768B83c41a71F9eba181802F';
const beaconSlot=toHex(BigInt(keccak256(toBytes('eip1967.proxy.beacon')))-1n,{size:32});
for(const stock of baseline.tokens.slice(0,5)){
 const storage=await rpc('eth_getStorageAt',[stock.address,beaconSlot,block]);const beacon='0x'+storage.response.result.slice(-40);
 result.stock_proxies.push({symbol:stock.label,address:stock.address,beacon_slot:storage,beacon,implementation:await call(beacon,'implementation'),creator_is_default_admin:await call(beacon,'hasRole',['0x'+'00'.repeat(32),'0x720538e8c1426F077ba6e2592a59d5176F602D88']),paused:await call(beacon,'paused'),ui_multiplier:await call(stock.address,'uiMultiplier')});
 for(const [direction,tokenIn,tokenOut,amountIn] of [['buy',usdg,stock.address,1000000n],['sell',stock.address,usdg,10000000000000000n]]){
  const quote=await call(addresses.quoter,'quoteExactInputSingle',[{tokenIn,tokenOut,amountIn,fee:3000,sqrtPriceLimitX96:0n}]);
  result.quotes.push({symbol:stock.label,direction,tokenIn,tokenOut,amount_in_base_units:amountIn.toString(),fee:3000,quote});
 }
}
for(const url of ['https://raw.githubusercontent.com/hummusonrails/robinhood-chain-dapp-example/main/contracts/script/Deploy.s.sol','https://blog.arbitrum.foundation/build-your-first-dapp-on-robinhood-chain/','https://blog.arbitrum.io/robinhood-chain-testnet/']){
 const r=await fetch(url);const text=await r.text();result.sources[url]={status:r.status,sha256:keccak256(toBytes(text)),relevant_lines:text.split('\n').filter(x=>url.endsWith('.sol') ? /TESTNET_|46630|faucet/.test(x) : /hummusonrails\/robinhood-chain-dapp-example|Tesla, Amazon, Palantir, Netflix, and AMD/.test(x)).map(x=>x.length>1000?x.slice(x.indexOf('hummusonrails/')-80,x.indexOf('hummusonrails/')+130):x)};
}
await writeFile(new URL('./venue-evidence.json',import.meta.url),JSON.stringify(result,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');
console.log(JSON.stringify(result.quotes.map(x=>({symbol:x.symbol,direction:x.direction,amount_in:x.amount_in_base_units,decoded:x.quote.decoded,error:x.quote.response.error})),(_,v)=>typeof v==='bigint'?v.toString():v,2));
