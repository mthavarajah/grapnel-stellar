/** Read-only RPC probe. No accounts, secrets, signing or send methods. */
import { encodeFunctionData, decodeFunctionResult, parseAbi, keccak256 } from 'viem';
import { writeFile } from 'node:fs/promises';
const rpc = 'https://rpc.testnet.chain.robinhood.com';
let id = 0;
async function request(method, params) {
 const body = { jsonrpc:'2.0', id:++id, method, params };
 const response = await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 if (!response.ok) throw Error(`RPC HTTP ${response.status}`);
 return await response.json();
}
const abi = parseAbi(['function name() view returns (string)','function symbol() view returns (string)','function decimals() view returns (uint8)','function totalSupply() view returns (uint256)','function token0() view returns (address)','function token1() view returns (address)','function fee() view returns (uint24)','function liquidity() view returns (uint128)','function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)','function getPool(address,address,uint24) view returns (address)']);
const evidence = {captured_at:new Date().toISOString(),rpc,execution_status:'discovery_only',transactions_submitted:0,chain:await request('eth_chainId',[]),block:await request('eth_blockNumber',[]),tokens:[],pools:[],factory_routes:[]};
if(evidence.chain.result !== '0xb626') throw Error('Wrong network');
const block=evidence.block.result;
async function call(address,name,args=[]) {
 const data=encodeFunctionData({abi,functionName:name,args});
 const raw=await request('eth_call',[{to:address,data},block]);
 let decoded;
 try{decoded=decodeFunctionResult({abi,functionName:name,data:raw.result});}catch{}
 return {request:{method:'eth_call',params:[{to:address,data},block]},response:raw,decoded};
}
const tokens=[
 ['TSLA','0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E','project primary; official faucet provenance pending'],
 ['AMZN','0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02','project primary; official faucet provenance pending'],
 ['PLTR','0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0','project primary; official faucet provenance pending'],
 ['NFLX','0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93','project primary; official faucet provenance pending'],
 ['AMD','0x71178BAc73cBeb415514eB542a8995b82669778d','project primary; official faucet provenance pending'],
 ['USDG','0x7E955252E15c84f5768B83c41a71F9eba181802F','official faucet.paxos.com bundle configuration'],
 ['USDC claimed','0xbf4479C07Dc6fdc6dAa764A0ccA06969e894275F','project claim; canonical issuer unverified'],
 ['USDC stand-in','0xFF00eA84190AeD0B1AbEF4fbC45E51258f2799BA','rwa-index self-deployed mintable MockERC20']];
for(const [label,address,provenance] of tokens){
 const code=await request('eth_getCode',[address,block]);
 const record={label,address,provenance,code_bytes:code.result ? (code.result.length-2)/2:null,code_hash:code.result?keccak256(code.result):null,reads:{}};
 for(const name of ['name','symbol','decimals','totalSupply'])record.reads[name]=await call(address,name);
 evidence.tokens.push(record);
}
for(const address of ['0xfedC57791E6d17c484742C84174424243592E6a8','0x8A970d79CEEF300AF8a3bc040101455C8155295e','0x315F7A44299FfA359f36D09468D1E22F1bfE65db','0x8B903359fA8DEE42D4140Dfda10c96d8B4F5631E','0xB8033384ce15A1112bFd58Dc6d5619708a1be98e']){
 const reads={}; for(const name of ['token0','token1','fee','liquidity','slot0'])reads[name]=await call(address,name);
 evidence.pools.push({address,provenance:'rwa-index Testnet deployment; stand-in USDC pairs',reads});
}
for(const [,stock] of tokens.slice(0,5))for(const [settlement,asset] of tokens.slice(5,7))for(const fee of [100,500,3000,10000]){
 evidence.factory_routes.push({stock,settlement,fee,read:await call('0x911b4000D3422F482F4062a913885f7b035382Df','getPool',[stock,asset,fee])});
}
for(const route of evidence.factory_routes){
 const address=route.read.decoded;
 if(!address || address==='0x0000000000000000000000000000000000000000')continue;
 route.pool_reads={}; for(const name of ['token0','token1','fee','liquidity','slot0'])route.pool_reads[name]=await call(address,name);
}
await writeFile(new URL('./rpc-evidence.json',import.meta.url),JSON.stringify(evidence,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');
console.log(JSON.stringify({block,tokens:evidence.tokens.map(x=>({label:x.label,code_bytes:x.code_bytes,metadata:Object.fromEntries(Object.entries(x.reads).map(([k,v])=>[k,v.decoded]))})),pools:evidence.pools.map(x=>({address:x.address,reads:Object.fromEntries(Object.entries(x.reads).map(([k,v])=>[k,v.decoded]))})),routes:evidence.factory_routes.filter(x=>x.read.decoded&&x.read.decoded!=='0x0000000000000000000000000000000000000000')},(_,v)=>typeof v==='bigint'?v.toString():v,2));
