import {encodeFunctionData,decodeFunctionResult,parseAbi,keccak256,toBytes} from 'viem';
import {writeFile} from 'node:fs/promises';
const rpc='https://rpc.testnet.chain.robinhood.com';const router='0x3Ce954107b1A675826B33bF23060Dd655e3758fE';let id=0;
async function request(method,params){const request={jsonrpc:'2.0',id:++id,method,params};const response=await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request)});return {request,response:await response.json()};}
const abi=parseAbi(['function multicall(uint256 deadline,bytes[] data) payable returns(bytes[] results)','function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns(uint256 amountOut)']);
const chain=await request('eth_chainId',[]);if(chain.response.result!=='0xb626')throw Error('Wrong chain');
const code=await request('eth_getCode',[router,'latest']);
const valid=encodeFunctionData({abi,functionName:'multicall',args:[BigInt(Math.floor(Date.now()/1000)+120),[]]});
const expired=encodeFunctionData({abi,functionName:'multicall',args:[1n,[]]});
const result={captured_at:new Date().toISOString(),transactions_submitted:0,chain,router,code_hash:keccak256(code.response.result),selectors:{deadlineMulticall:valid.slice(0,10),exactInputSingle:keccak256(toBytes('exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))')).slice(0,10)},valid_deadline_empty_multicall:await request('eth_call',[{to:router,data:valid},'latest']),expired_deadline_empty_multicall:await request('eth_call',[{to:router,data:expired},'latest'])};
result.valid_deadline_empty_multicall.decoded=decodeFunctionResult({abi,functionName:'multicall',data:result.valid_deadline_empty_multicall.response.result});
await writeFile(new URL('./router-abi-evidence.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
