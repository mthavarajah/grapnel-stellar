/** Controlled QA only. Default is read-only. Never uses a customer wallet or a mainnet RPC. */
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {createRobinhoodReader,robinhoodRpcRequest} from '../apps/api/src/adapters/robinhood/index.js';
import {createRobinhoodTransactionAdapter,type StockPreparedTransaction} from '../apps/api/src/adapters/robinhood/transactions.js';
import {RH_TESTNET,STOCKS} from '../apps/api/src/adapters/robinhood/registry.js';
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));
const {createPublicClient,http,defineChain,encodeFunctionData,decodeFunctionResult,decodeEventLog,parseAbi,keccak256}=require('viem');
const {privateKeyToAccount}=require('viem/accounts');
const QA='0x80bd216c39869cec85e37ee37c020530d144799a';
const L1_RPC='https://ethereum-sepolia-rpc.publicnode.com';
const INBOX='0xF2939afA86F6f933A3CE17fCAB007907B6b0B7a4';
const BRIDGE='0x96295BDad104eaD97cC08797b3dC68efF59CcF30';
const ROLLUP='0xdc5F8E399DBd8a9F5F87AeC4C23Beb12431b386D';
const INBOX_CODE='0x69a469ef198a7f785b09fb0783fe42576faef7635e2d56426ec8746bad638e64';
const INBOX_IMPL='0x8d3b93dffff4842e7b61fb553b383db2c6bc91c6';
const INBOX_IMPL_CODE='0xfb23336c542bccb67fdc522ef210ed21082aa19c658c9ccb182f78f9ca4c6ae8';
const abi=parseAbi(['function balanceOf(address) view returns(uint256)','function bridge() view returns(address)','function rollup() view returns(address)','function chainId() view returns(uint256)','function depositEth() payable returns(uint256)','event Transfer(address indexed from,address indexed to,uint256 value)']);
const root=resolve(process.env.GRAPNEL_QA_ROOT??process.cwd());
const stateFile=resolve(root,'.codex/robinhood-own-roundtrip.state.json');
const evidenceFile=new URL('../evidence/robinhood-own-roundtrip.json',import.meta.url);
const args=new Set(process.argv.slice(2));const execute=args.has('--execute')||args.has('--gas-deposit');
if(execute&&process.env.GRAPNEL_ROBINHOOD_QA_EXECUTE!=='46630')throw Error('Explicit GRAPNEL_ROBINHOOD_QA_EXECUTE=46630 is required');
const chain=(id:number,rpc:string)=>defineChain({id,name:`Controlled QA Testnet ${id}`,nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[rpc]}}});
const rh=createPublicClient({chain:chain(46630,RH_TESTNET.rpc),transport:http(RH_TESTNET.rpc,{timeout:8000,retryCount:0})});
const l1=createPublicClient({chain:chain(11155111,L1_RPC),transport:http(L1_RPC,{timeout:8000,retryCount:0})});
const adapter=createRobinhoodTransactionAdapter();
let state:any={version:1,qa:QA,network:'robinhood-testnet',chainId:46630,createdAt:new Date().toISOString(),gas:null,steps:[],before:null,after:null,completed:false};
try{state=JSON.parse(await readFile(stateFile,'utf8'));}catch(error:any){if(error.code!=='ENOENT')throw Error('QA checkpoint could not be read');}
if(state.qa!==QA||state.chainId!==46630||state.version!==1)throw Error('QA checkpoint scope mismatch');
async function save(){await mkdir(dirname(stateFile),{recursive:true});const tmp=stateFile+'.tmp';await writeFile(tmp,JSON.stringify(state,(_k,v)=>typeof v==='bigint'?v.toString():v,2)+'\n',{mode:0o600});await rename(tmp,stateFile);}
async function publish(){const safe={...state,steps:state.steps.map(({rawSigned,...s}:any)=>s),gas:state.gas?(({rawSigned,...g}:any)=>g)(state.gas):null};await mkdir(new URL('../evidence/',import.meta.url),{recursive:true});await writeFile(evidenceFile,JSON.stringify(safe,(_k,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');}
async function balances(){if(await rh.getChainId()!==46630)throw Error('Wrong Robinhood network');const assets:any={ETH:(await rh.getBalance({address:QA})).toString()};for(const token of [RH_TESTNET.settlement,...STOCKS])assets[token.symbol]=(await rh.readContract({address:token.address,abi,functionName:'balanceOf',args:[QA]})).toString();return {observedAt:new Date().toISOString(),baseUnits:assets,decimals:{ETH:18,USDG:6,TSLA:18,AMZN:18,PLTR:18,NFLX:18,AMD:18}};}
async function key(){const value=JSON.parse(await readFile(resolve(root,'.codex/qa-hypercore-wallet.json'),'utf8'));const account=privateKeyToAccount(value.privateKey);if(value.address.toLowerCase()!==QA||account.address.toLowerCase()!==QA)throw Error('Only the authorized owned QA signer is permitted');return account;}
function cleanError(){console.error('QA step stopped. Durable transaction hash/checkpoint retained; use read-only recovery. No automatic resend.');process.exitCode=1;}
async function signPersistRelay(client:any,chainId:number,to:string,data:string,value:bigint,record:any,feeCap:bigint,deadline?:string){
 if(await client.getChainId()!==chainId||![46630,11155111].includes(chainId))throw Error('Wrong signing network');
 const account=await key();const nonce=await client.getTransactionCount({address:QA,blockTag:'pending'});
 const estimate=await client.estimateGas({account:QA,to,data,value});const gas=estimate*12n/10n+1000n;
 const gasPrice=await client.getGasPrice();const maxFeePerGas=gasPrice*2n,maxPriorityFeePerGas=gasPrice/10n;
 if(gas>2000000n||maxFeePerGas*gas>feeCap||await client.getBalance({address:QA})<value+maxFeePerGas*gas)throw Error('Gas budget not available');
 if(deadline&&Date.now()+2000>=Date.parse(deadline))throw Error('Exact transaction intent expired');
 const rawSigned=await account.signTransaction({chainId,type:'eip1559',nonce,to,data,value,gas,maxFeePerGas,maxPriorityFeePerGas});
 const hash=keccak256(rawSigned);Object.assign(record,{hash,nonce,rawSigned,gas:gas.toString(),maxFeePerGas:maxFeePerGas.toString(),state:'uncertain',signedAt:new Date().toISOString()});await save();await publish();
 // Hash and immutable signed bytes are durable BEFORE the only relay attempt.
 const sent=await client.sendRawTransaction({serializedTransaction:rawSigned});if(sent.toLowerCase()!==hash)throw Error('Relay hash mismatch');
 record.state='submitted';await save();await publish();return hash;
}
async function verifyGas(){
 if(await l1.getChainId()!==11155111||await rh.getChainId()!==46630)throw Error('Gas route chain mismatch');
 if(await l1.getBytecode({address:QA}))throw Error('Gas recipient must remain an owned EOA without aliasing');
 if(keccak256(await l1.getBytecode({address:INBOX}))!==INBOX_CODE)throw Error('Canonical inbox code mismatch');
 const slot=await l1.getStorageAt({address:INBOX,slot:'0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'});
 if(('0x'+slot.slice(-40)).toLowerCase()!==INBOX_IMPL||keccak256(await l1.getBytecode({address:INBOX_IMPL}))!==INBOX_IMPL_CODE)throw Error('Canonical inbox implementation mismatch');
 if((await l1.readContract({address:INBOX,abi,functionName:'bridge'})).toLowerCase()!==BRIDGE.toLowerCase()||(await l1.readContract({address:BRIDGE,abi,functionName:'rollup'})).toLowerCase()!==ROLLUP.toLowerCase()||await l1.readContract({address:ROLLUP,abi,functionName:'chainId'})!==46630n)throw Error('Canonical destination mismatch');
}
async function gasDeposit(){
 await verifyGas();
 if(state.gas?.state==='credited'){console.log('Previously verified Robinhood gas credit',state.gas.hash);return;}
 if(!state.gas){const before=(await rh.getBalance({address:QA})).toString();state.gas={kind:'canonical-testnet-ETH-deposit',sourceChainId:11155111,destinationChainId:46630,inbox:INBOX,valueWei:'3000000000000000',destinationBalanceBefore:before,state:'prepared'};await save();}
 const g=state.gas;
 if(!g.hash){if(!args.has('--gas-deposit')){console.log('Prepared gas deposit has no hash; recovery never sends');return;}await signPersistRelay(l1,11155111,INBOX,encodeFunctionData({abi,functionName:'depositEth'}),3000000000000000n,g,5000000000000000n);}
 const receipt=await l1.getTransactionReceipt({hash:g.hash}).catch(()=>null);if(!receipt){console.log('Gas deposit pending; retained hash',g.hash);return;}
 const tx=await l1.getTransaction({hash:g.hash});if(receipt.status!=='success'||tx.from.toLowerCase()!==QA||tx.to?.toLowerCase()!==INBOX.toLowerCase()||tx.value!==3000000000000000n||tx.input!==encodeFunctionData({abi,functionName:'depositEth'}))throw Error('Gas deposit receipt/intent invalid');
 const canonical=await l1.getBlock({blockNumber:receipt.blockNumber});if(canonical.hash!==receipt.blockHash||tx.chainId!==11155111)throw Error('Gas receipt is not canonical Sepolia');
 g.sourceReceipt={hash:g.hash,blockNumber:receipt.blockNumber.toString(),blockHash:receipt.blockHash,status:receipt.status,amountWei:tx.value.toString()};
 if((await l1.getBlockNumber())<receipt.blockNumber+1n){g.state='source_waiting_confirmations';await save();await publish();console.log('Existing gas hash awaiting confirmations',g.hash);return;}
 const after=await rh.getBalance({address:QA});g.destinationBalanceAfter=after.toString();g.state=after-BigInt(g.destinationBalanceBefore)>=3000000000000000n?'credited':'source_confirmed_destination_pending';await save();await publish();console.log('Gas route',g.state,g.hash);
}
async function reconcile(step:any){
 const proof=await adapter.reconcileTransaction({txHash:step.hash,expectedPrepared:step.prepared});step.proof=proof;if(proof.state==='confirmed')step.state='confirmed';await save();await publish();return proof.state;
}
async function stage(kind:string,prepare:()=>Promise<any>){
 let s=state.steps.find((x:any)=>x.kind===kind);
 if(s?.state==='confirmed')return s;
 if(s?.hash){if(await reconcile(s)!=='confirmed')throw Error('Retained transaction is unresolved; no replacement allowed');return s;}
 const result=await prepare();if(result.approvalRequired||result.simulation!=='passed')throw Error('Exact transaction simulation did not pass');
 if(!s){s={kind};state.steps.push(s);}Object.assign(s,{prepared:result.prepared,state:'prepared'});await save();
 await signPersistRelay(rh,46630,s.prepared.to,s.prepared.data,0n,s,1000000000000000n,s.prepared.expiresAt);
 // Poll only the existing hash. Never sign or relay a replacement after uncertainty.
 for(let i=0;i<15;i++){await new Promise(r=>setTimeout(r,1200));const status=await reconcile(s);if(status==='confirmed')return s;if(status==='reverted')throw Error('Stock transaction reverted');}
 throw Error('Stock confirmation pending; recovery reads only');
}
async function roundtrip(){
 await createRobinhoodReader().verifyDeployment();
 if(!state.fundingProof){
  const hash='0xe60d996879ee777621aff307bfdcddad4e033a690b20a2936324728868e32797';const receipt=await rh.getTransactionReceipt({hash});if(receipt.status!=='success')throw Error('Official USDG faucet receipt is not successful');
  const transfer=receipt.logs.filter((log:any)=>log.address.toLowerCase()===RH_TESTNET.settlement.address.toLowerCase()).map((log:any)=>{try{return decodeEventLog({abi,data:log.data,topics:log.topics,eventName:'Transfer'});}catch{return null;}}).find((event:any)=>event?.args.to.toLowerCase()===QA&&event.args.value===100000000n);
  if(!transfer)throw Error('Official faucet asset/amount/recipient proof is missing');state.fundingProof={source:'https://faucet.paxos.com/?token=USDG&network=ROBINHOOD',txHash:hash,asset:RH_TESTNET.settlement.address,decimals:6,amountBaseUnits:'100000000',blockNumber:receipt.blockNumber.toString(),from:transfer.args.from,to:QA};await save();
 }
 if(!state.before){state.before=await balances();await save();}
 if(BigInt((await balances()).baseUnits.USDG)<1000000n||BigInt((await balances()).baseUnits.ETH)===0n)throw Error('Actual canonical USDG and Robinhood ETH are required');
 await stage('approve-USDG',()=>adapter.prepareApproval({customerAddress:QA,asset:'USDG',amountBaseUnits:'1000000'}));
 const buy=await stage('buy-TSLA',()=>adapter.prepareSwap({customerAddress:QA,symbol:'TSLA',side:'buy',amountInBaseUnits:'1000000',slippageBps:100}));
 const bought=buy.proof.amountOutBaseUnits;if(!bought||BigInt(bought)<=0n)throw Error('No verified stock fill');
 await stage('approve-TSLA',()=>adapter.prepareApproval({customerAddress:QA,asset:'TSLA',amountBaseUnits:bought}));
 await stage('sell-TSLA',()=>adapter.prepareSwap({customerAddress:QA,symbol:'TSLA',side:'sell',amountInBaseUnits:bought,slippageBps:100}));
 state.after=await balances();if(BigInt(state.after.baseUnits.TSLA)!==BigInt(state.before.baseUnits.TSLA))throw Error('Roundtrip stock delta did not return to original balance');state.completed=true;state.completedAt=new Date().toISOString();await save();await publish();console.log('Actual TSLA buy/sell roundtrip verified',state.steps.map((x:any)=>({kind:x.kind,hash:x.hash,state:x.state})));
}
try{
 if(args.has('--gas-deposit'))await gasDeposit();else if(args.has('--execute'))await roundtrip();else if(args.has('--recover')){if(state.gas)await gasDeposit();for(const s of state.steps)if(s.hash&&s.state!=='confirmed')await reconcile(s);console.log('Existing hashes reconciled; no relay performed');}else console.log(JSON.stringify({qa:QA,deployment:await createRobinhoodReader().verifyDeployment(),balances:await balances(),checkpoint:{gasState:state.gas?.state??null,steps:state.steps.map((s:any)=>({kind:s.kind,hash:s.hash,state:s.state})),completed:state.completed}},null,2));
}catch{cleanError();}
