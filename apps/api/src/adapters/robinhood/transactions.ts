import { decodeEventLog, encodeFunctionData, getAddress, isAddress, keccak256, parseAbi, decodeFunctionResult, type Hex } from 'viem';
import { createRobinhoodReader, robinhoodRpcRequest, RobinhoodReadError, type RpcRequest, type RobinhoodQuoteInput } from './index.js';
import { RH_TESTNET, STOCKS, type StockSymbol } from './registry.js';
const ABI = parseAbi([
 'function approve(address spender,uint256 amount) returns(bool)',
 'function allowance(address owner,address spender) view returns(uint256)',
 'function balanceOf(address owner) view returns(uint256)',
 'function decimals() view returns(uint8)',
 'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns(uint256 amountOut)',
 'function multicall(uint256 deadline,bytes[] data) payable returns(bytes[] results)',
 'event Transfer(address indexed from,address indexed to,uint256 value)',
 'event Approval(address indexed owner,address indexed spender,uint256 value)',
]);
function fail(message:string):never { throw new RobinhoodReadError(message); }
function address(value:string):Hex { if(!isAddress(value,{strict:false}) || /^0x0{40}$/i.test(value)) fail('Invalid customer address');return getAddress(value); }
function units(value:string):bigint {if(!/^[1-9][0-9]{0,77}$/.test(value)||BigInt(value)>=2n**256n)fail('Amount must be positive uint256 base units');return BigInt(value);}
function same(a:unknown,b:string){return typeof a==='string'&&a.toLowerCase()===b.toLowerCase();}
function integerHex(value:unknown):bigint {if(typeof value!=='string'||!/^0x[0-9a-f]+$/i.test(value))fail('Malformed RPC integer');return BigInt(value);}
export type StockPreparedTransaction = {
 kind:'approval'|'swap'; chainId:46630; from:Hex; to:string; value:'0'; data:Hex;
 tokenIn:string; tokenOut:string|null; amountInBaseUnits:string; minimumOutBaseUnits:string|null;
 symbol:StockSymbol|'USDG'; observedAt:string; expiresAt:string; deadlineSeconds:string|null;
 executionStatus:'discovery_only'; price_basis:'testnet_pool_quote'|null;
};
export type PrepareStockSwapInput = RobinhoodQuoteInput & {customerAddress:string};
export const ROBINHOOD_FUNDING = Object.freeze({chainId:46630,asset:Object.freeze({symbol:'USDG',address:RH_TESTNET.settlement.address,decimals:6}),faucetUrl:'https://faucet.paxos.com/?token=USDG&network=ROBINHOOD',faucetAmount:'100',faucetClaimsPerWalletPerDay:1,faucetWalletLimit:'1 request per wallet per day',gasSymbol:'ETH',gasFaucetUrl:'https://faucet.testnet.chain.robinhood.com/',source:'https://docs.paxos.com/guides/stablecoin/usdg/testnet'});

/** Prepares exact unsigned intents and reads reconciliation. No private key or broadcast API. */
export function createRobinhoodTransactionAdapter(options:{rpcRequest?:RpcRequest;now?:()=>number;confirmationMode?:'historical'|'events'}={}){
 const rpc=options.rpcRequest??robinhoodRpcRequest;const now=options.now??Date.now;
 const reader=createRobinhoodReader({rpcRequest:rpc,now});
 function validatePrepared(p:StockPreparedTransaction){
  if(p.chainId!==46630||p.value!=='0'||!Number.isFinite(Date.parse(p.observedAt))||!Number.isFinite(Date.parse(p.expiresAt))||Date.parse(p.expiresAt)-Date.parse(p.observedAt)>90000||Date.parse(p.expiresAt)<=Date.parse(p.observedAt))fail('Unexpected transaction intent');
  const from=address(p.from);const amount=units(p.amountInBaseUnits);let data:Hex;
  if(p.kind==='approval'){
   const asset=p.symbol==='USDG'?RH_TESTNET.settlement:STOCKS.find(x=>x.symbol===p.symbol);if(!asset||!same(asset.address,p.to)||!same(p.tokenIn,asset.address)||p.tokenOut!==null)fail('Approval asset mismatch');
   if(amount>1000000n*10n**BigInt(asset.decimals))fail('Approval amount exceeds reviewed Testnet limit');
   data=encodeFunctionData({abi:ABI,functionName:'approve',args:[RH_TESTNET.swapRouter02,amount]});
  }else if(p.kind==='swap'){
   const market=STOCKS.find(x=>x.symbol===p.symbol);if(!market||!same(p.to,RH_TESTNET.swapRouter02)||!p.tokenOut||!p.minimumOutBaseUnits||!p.deadlineSeconds)fail('Swap asset mismatch');
   if(!(same(p.tokenIn,market.address)&&same(p.tokenOut,RH_TESTNET.settlement.address)||same(p.tokenOut,market.address)&&same(p.tokenIn,RH_TESTNET.settlement.address)))fail('Swap asset mismatch');
   const decimals=same(p.tokenIn,RH_TESTNET.settlement.address)?6:18;if(amount>1000000n*10n**BigInt(decimals))fail('Swap amount exceeds reviewed Testnet limit');
   const deadline=units(p.deadlineSeconds);if(deadline!==BigInt(Math.floor(Date.parse(p.expiresAt)/1000)))fail('Swap deadline mismatch');
   const inner=encodeFunctionData({abi:ABI,functionName:'exactInputSingle',args:[{tokenIn:p.tokenIn as Hex,tokenOut:p.tokenOut as Hex,fee:3000,recipient:from,amountIn:amount,amountOutMinimum:units(p.minimumOutBaseUnits),sqrtPriceLimitX96:0n}]});
   data=encodeFunctionData({abi:ABI,functionName:'multicall',args:[deadline,[inner]]});
  }else return fail('Unknown transaction kind');
  if(!same(data,p.data))fail('Transaction calldata differs from exact intent');
 }

 async function call(token:string,name:'balanceOf'|'allowance'|'decimals',args:readonly unknown[],block:string):Promise<unknown>{
  const data=encodeFunctionData({abi:ABI,functionName:name,args:args as never});
  const raw=await rpc('eth_call',[{to:token,data},block]);if(typeof raw!=='string')fail('Malformed token read');
  return decodeFunctionResult({abi:ABI,functionName:name,data:raw as Hex});
 }
 function fresh(prepared:StockPreparedTransaction){if(!Number.isFinite(Date.parse(prepared.expiresAt))||Date.parse(prepared.expiresAt)-Date.parse(prepared.observedAt)>90000||now()>=Date.parse(prepared.expiresAt))fail('Prepared transaction expired');}
 async function simulate(prepared:StockPreparedTransaction){
  validatePrepared(prepared);fresh(prepared);const result=await rpc('eth_call',[{from:prepared.from,to:prepared.to,value:'0x0',data:prepared.data},'latest']);
  if(typeof result!=='string'||!/^0x[0-9a-f]*$/i.test(result))fail('Transaction simulation unavailable');
  if(prepared.kind==='approval' && decodeFunctionResult({abi:ABI,functionName:'approve',data:result as Hex})!==true)fail('Token approval simulation returned false');
  const gas=integerHex(await rpc('eth_estimateGas',[{from:prepared.from,to:prepared.to,value:'0x0',data:prepared.data}]));
  if(gas<=0n||gas>2000000n)fail('Transaction gas estimate outside reviewed bound');
  fresh(prepared);return {simulation:'passed' as const,estimatedGas:gas.toString()};
 }
 return {
  funding:ROBINHOOD_FUNDING,
  async prepareApproval(input:{customerAddress:string;asset:'USDG'|StockSymbol;amountBaseUnits:string}){
   const from=address(input.customerAddress);const amount=units(input.amountBaseUnits);
   const asset=input.asset==='USDG'?RH_TESTNET.settlement:STOCKS.find(x=>x.symbol===input.asset);if(!asset)fail('Unsupported approval asset');
   if(amount>1000000n*10n**BigInt(asset.decimals))fail('Approval amount exceeds reviewed Testnet limit');
   const deployment=await reader.verifyDeployment();
   const code=await rpc('eth_getCode',[asset.address,deployment.blockTag]);if(typeof code!=='string'||keccak256(code as Hex)!==asset.codeHash)fail('Approval asset runtime mismatch');
   if(await call(asset.address,'decimals',[],deployment.blockTag)!==asset.decimals)fail('Approval asset decimals mismatch');
   const observedAt=new Date(now()).toISOString();
   const prepared:StockPreparedTransaction={kind:'approval',chainId:46630,from,to:asset.address,value:'0',data:encodeFunctionData({abi:ABI,functionName:'approve',args:[RH_TESTNET.swapRouter02,amount]}),tokenIn:asset.address,tokenOut:null,amountInBaseUnits:amount.toString(),minimumOutBaseUnits:null,symbol:input.asset,observedAt,expiresAt:new Date(Date.parse(observedAt)+90000).toISOString(),deadlineSeconds:null,executionStatus:'discovery_only',price_basis:null};
   return {prepared,...await simulate(prepared)};
  },
  async prepareSwap(input:PrepareStockSwapInput){
   const from=address(input.customerAddress);const amount=units(input.amountInBaseUnits);
   const decimals=input.side==='buy'?6:18;if(amount>1000000n*10n**BigInt(decimals))fail('Swap amount exceeds reviewed Testnet limit');
   const quote=await reader.quoteExactInput(input);
   const block='0x'+BigInt(quote.blockNumber).toString(16);
   const balance=await call(quote.tokenIn,'balanceOf',[from],block) as bigint;
   if(balance<amount)fail('Available asset balance is too low');
   const allowance=await call(quote.tokenIn,'allowance',[from,RH_TESTNET.swapRouter02],block) as bigint;
   const nativeBalance=integerHex(await rpc('eth_getBalance',[from,block]));
   if(nativeBalance===0n)fail('Robinhood Testnet ETH is required for transaction fees');
   const deadline=BigInt(Math.floor(Date.parse(quote.expiresAt)/1000));
   const inner=encodeFunctionData({abi:ABI,functionName:'exactInputSingle',args:[{tokenIn:quote.tokenIn,tokenOut:quote.tokenOut,fee:3000,recipient:from,amountIn:amount,amountOutMinimum:BigInt(quote.minimumOutBaseUnits),sqrtPriceLimitX96:0n}]});
   const prepared:StockPreparedTransaction={kind:'swap',chainId:46630,from,to:RH_TESTNET.swapRouter02,value:'0',data:encodeFunctionData({abi:ABI,functionName:'multicall',args:[deadline,[inner]]}),tokenIn:quote.tokenIn,tokenOut:quote.tokenOut,amountInBaseUnits:amount.toString(),minimumOutBaseUnits:quote.minimumOutBaseUnits,symbol:input.symbol,observedAt:quote.observedAt,expiresAt:quote.expiresAt,deadlineSeconds:deadline.toString(),executionStatus:'discovery_only',price_basis:'testnet_pool_quote'};
   fresh(prepared);
   if(allowance<amount)return {prepared,quote,approvalRequired:true,simulation:'approval_required' as const,estimatedGas:null,assetBalanceBaseUnits:balance.toString(),allowanceBaseUnits:allowance.toString()};
   return {prepared,quote,approvalRequired:false,...await simulate(prepared),assetBalanceBaseUnits:balance.toString(),allowanceBaseUnits:allowance.toString()};
  },
  async reconcileTransaction(input:{txHash:string;expectedPrepared:StockPreparedTransaction}){
   if(!/^0x[0-9a-f]{64}$/i.test(input.txHash))fail('Invalid transaction hash');
   const expected=input.expectedPrepared; validatePrepared(expected);const eventProof=options.confirmationMode==='events';
   const deployment=await reader.verifyDeployment();
   if(eventProof){if(expected.symbol!=='USDG'){const multiplier=await reader.readStockMultiplier(expected.symbol);if(multiplier.multiplierBaseUnits!=='1000000000000000000')fail('Stock multiplier changed');}const code=await rpc('eth_getCode',[RH_TESTNET.settlement.address,deployment.blockTag]);if(typeof code!=='string'||keccak256(code as Hex)!==RH_TESTNET.settlement.codeHash||await call(RH_TESTNET.settlement.address,'decimals',[],deployment.blockTag)!==6)fail('Settlement asset identity changed');}
   const tx=await rpc('eth_getTransactionByHash',[input.txHash]) as Record<string,unknown>|null;
   if(!tx)return {state:'pending' as const,txHash:input.txHash};
   if(!same(tx.hash,input.txHash)||!same(tx.from,expected.from)||!same(tx.to,expected.to)||!same(tx.input,expected.data)||integerHex(tx.value)!==0n||integerHex(tx.chainId)!==46630n)fail('Submitted transaction does not match approved intent');
   const receipt=await rpc('eth_getTransactionReceipt',[input.txHash]) as Record<string,unknown>|null;
   if(!receipt)return {state:'pending' as const,txHash:input.txHash};
   if(!same(receipt.transactionHash,input.txHash)||!same(receipt.from,expected.from)||!same(receipt.to,expected.to))fail('Receipt does not match transaction');
   const height=integerHex(receipt.blockNumber);const block=await rpc('eth_getBlockByNumber',[receipt.blockNumber,false]) as Record<string,unknown>|null;
   if(!block||!same(block.hash,String(receipt.blockHash))||!same(tx.blockHash,String(receipt.blockHash)))fail('Transaction receipt is not on canonical block');
   if(integerHex(block.timestamp)*1000n>BigInt(Date.parse(expected.expiresAt)))fail('Transaction included after intent expiry');
   const confirmations=BigInt(deployment.blockNumber)-height+1n;
   if(confirmations<2n)return {state:'pending' as const,txHash:input.txHash,confirmations:confirmations.toString()};
   if(integerHex(receipt.status)===0n)return {state:'reverted' as const,txHash:input.txHash,blockNumber:height.toString()};
   if(integerHex(receipt.status)!==1n)fail('Unknown receipt status');
   if(expected.kind==='approval'){
    if(eventProof){if(!Array.isArray(receipt.logs)||receipt.logs.length>200)fail('Approval logs missing');let matches=0;for(const raw of receipt.logs){const log=raw as any;if(!same(log.address,expected.tokenIn))continue;if(log.removed||!same(log.transactionHash,input.txHash)||!same(log.blockHash,String(receipt.blockHash))||integerHex(log.blockNumber)!==height)fail('Approval log is not canonical');try{const e=decodeEventLog({abi:ABI,eventName:'Approval',data:log.data,topics:log.topics});if(same(e.args.owner,expected.from)&&same(e.args.spender,RH_TESTNET.swapRouter02)&&e.args.value===BigInt(expected.amountInBaseUnits))matches++;}catch{}}
     if(matches!==1)fail('Exact approval event missing');return{state:'confirmed' as const,txHash:input.txHash,blockNumber:height.toString(),confirmations:confirmations.toString(),allowanceBaseUnits:expected.amountInBaseUnits,allowance_basis:'canonical_approval_event' as const};}
    const allowance=await call(expected.tokenIn,'allowance',[expected.from,RH_TESTNET.swapRouter02],receipt.blockNumber as string) as bigint;
    if(allowance!==BigInt(expected.amountInBaseUnits))fail('Approval allowance differs from exact requested amount');
    return {state:'confirmed' as const,txHash:input.txHash,blockNumber:height.toString(),confirmations:confirmations.toString(),allowanceBaseUnits:allowance.toString()};
   }
   const deltas=new Map<string,bigint>([[expected.tokenIn.toLowerCase(),0n],[expected.tokenOut!.toLowerCase(),0n]]);
   if(!Array.isArray(receipt.logs)||receipt.logs.length>200)fail('Receipt logs missing');
   for(const raw of receipt.logs){
    const log=raw as {address:string;data:Hex;topics:readonly Hex[]};const token=log.address.toLowerCase();if(!deltas.has(token))continue;
    if(eventProof){const l=raw as any;if(l.removed||!same(l.transactionHash,input.txHash)||!same(l.blockHash,String(receipt.blockHash))||integerHex(l.blockNumber)!==height)fail('Token log is not canonical');}
    try{const event=decodeEventLog({abi:ABI,data:log.data,topics:log.topics as [Hex,...Hex[]],eventName:'Transfer'});let d=deltas.get(token)!;if(same(event.args.from,expected.from))d-=event.args.value;if(same(event.args.to,expected.from))d+=event.args.value;deltas.set(token,d);}catch{/* unrelated event on allowlisted token */}
   }
   const spent=-deltas.get(expected.tokenIn.toLowerCase())!;const received=deltas.get(expected.tokenOut!.toLowerCase())!;
   if(spent!==BigInt(expected.amountInBaseUnits)||received<BigInt(expected.minimumOutBaseUnits!))fail('Receipt asset deltas do not match approved swap');
   if(eventProof)return{state:'confirmed' as const,txHash:input.txHash,blockNumber:height.toString(),confirmations:confirmations.toString(),amountInBaseUnits:spent.toString(),amountOutBaseUnits:received.toString(),balance_basis:'canonical_transfer_events' as const,balanceDeltas:[{token:expected.tokenIn,deltaBaseUnits:(-spent).toString()},{token:expected.tokenOut!,deltaBaseUnits:received.toString()}],price_basis:'testnet_pool_quote' as const};
   const snapshots=[];
   for(const token of [expected.tokenIn,expected.tokenOut!]){
    const before=await call(token,'balanceOf',[expected.from],'0x'+(height-1n).toString(16)) as bigint;const after=await call(token,'balanceOf',[expected.from],receipt.blockNumber as string) as bigint;
    if(after-before!==deltas.get(token.toLowerCase()))fail('Block asset balances differ from transaction deltas; independent reconciliation required');
    snapshots.push({token,beforeBaseUnits:before.toString(),afterBaseUnits:after.toString(),deltaBaseUnits:(after-before).toString()});
   }
   return {state:'confirmed' as const,txHash:input.txHash,blockNumber:height.toString(),confirmations:confirmations.toString(),amountInBaseUnits:spent.toString(),amountOutBaseUnits:received.toString(),balances:snapshots,price_basis:'testnet_pool_quote' as const};
  },
 };
}
