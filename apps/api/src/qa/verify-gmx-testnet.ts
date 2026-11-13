/** Controlled zero-value Testnet QA. No customer keys, mainnet path or automatic retries. */
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createWalletClient,createPublicClient,http,keccak256,type Hex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {arbitrumSepolia} from 'viem/chains';
import {createGmxTestnetAdapter} from '../adapters/gmx/index.js';
const symbol=process.argv[3]??'ETH';if(symbol!=='ETH'&&symbol!=='BTC')throw Error('Unsupported QA market');
const ROOT=new URL('../../../../',import.meta.url),walletPath=new URL('.codex/qa-hypercore-wallet.json',ROOT),statePath=new URL(symbol==='ETH'?'.codex/qa-gmx-state.json':'.codex/qa-gmx-btc-state.json',ROOT);
const serialize=(v:unknown)=>JSON.stringify(v,(_k,x)=>typeof x==='bigint'?{$bigint:x.toString()}:x,2)+'\n';
const parse=(s:string)=>JSON.parse(s,(_k,x)=>x&&typeof x==='object'&&Object.keys(x).length===1&&typeof x.$bigint==='string'?BigInt(x.$bigint):x);
const local=JSON.parse(fs.readFileSync(walletPath,'utf8'));
if(local.purpose!=='Grapnel controlled Testnet QA only'||local.chainId!==998)throw Error('Missing controlled QA wallet');
const account=privateKeyToAccount(local.privateKey as Hex);
if(account.address!==local.address)throw Error('Controlled QA signer mismatch');
const rpc='https://sepolia-rollup.arbitrum.io/rpc';
const read=createPublicClient({chain:arbitrumSepolia,transport:http(rpc,{timeout:15000})});
const sign=createWalletClient({account,chain:arbitrumSepolia,transport:http(rpc,{timeout:15000})});
if(await read.getChainId()!==421614)throw Error('Testnet network mismatch');
const adapter=createGmxTestnetAdapter();
await adapter.verifyRegistry();
const state=fs.existsSync(statePath)?parse(fs.readFileSync(statePath,'utf8')):{version:1,chainId:421614,account:account.address,phases:{}};
if(state.chainId!==421614||state.account!==account.address||state.version!==1)throw Error('QA state scope mismatch');
const save=()=>{fs.writeFileSync(new URL(symbol==='ETH'?'.codex/qa-gmx-state.next.json':'.codex/qa-gmx-btc-state.next.json',ROOT),serialize(state),{mode:0o600});fs.renameSync(new URL(symbol==='ETH'?'.codex/qa-gmx-state.next.json':'.codex/qa-gmx-btc-state.next.json',ROOT),statePath);};
const stage=process.argv[2]??'status';
if(stage==='status'){
 console.log(serialize({network:'arbitrum-sepolia',account:account.address,status:await adapter.readStatus(account.address),positions:await adapter.readPositions(account.address),phases:Object.fromEntries(Object.entries(state.phases).map(([name,v]:[string,any])=>[name,{txHash:v.txHash,claimedAt:v.claimedAt,proof:v.proof,settlement:v.settlement}]))}));
}else if(['mint','approve','open','close','close-2','reconcile-open','reconcile-close','reconcile-close-2'].includes(stage)){
 const phase=stage.replace('reconcile-','');
 if(stage.startsWith('reconcile-')){
  const saved=state.phases[phase];if(!saved?.proof)throw Error('The exact order creation receipt is required');
  const result=await adapter.reconcileOrder(saved.prepared,saved.proof);saved.settlement=result;save();console.log(serialize({stage,result}));
 }else{
  if(!state.phases[phase]){
   if(phase==='close-2'&&state.phases.close?.settlement?.state!=='cancelled')throw Error('A verified prior cancellation is required before a new close');
   const common={id:randomUUID(),account:account.address,expiresAt:new Date(Date.now()+90000).toISOString()};
   let prepared;
   if(phase==='mint')prepared=await adapter.prepareMint({...common,amountAtomic6:'100000000'});
   else if(phase==='approve')prepared=await adapter.prepareApproval({...common,amountAtomic6:'20000000'});
   else if(phase==='open')prepared=await adapter.prepareOpen({...common,symbol,isLong:true,collateralAtomic6:'10000000',sizeUsd30:(20n*10n**30n).toString(),executionFeeWei:'500000000000000',slippageBps:50});
   else prepared=await adapter.prepareClose({...common,symbol,isLong:true,executionFeeWei:'500000000000000',slippageBps:50});
   if(prepared.transaction.chainId!==421614)throw Error('Wrong signing chain');
   let spent=0n;for(const prior of Object.values(state.phases) as any[]){if(!prior.txHash)continue;const receipt=await read.getTransactionReceipt({hash:prior.txHash}).catch(()=>null);if(receipt)spent+=receipt.gasUsed*receipt.effectiveGasPrice+BigInt(prior.prepared.transaction.value);}
   const t=prepared.transaction;if(spent+t.gas*t.maxFeePerGas+t.value>5000000000000000n)throw Error('QA total native budget exceeded');
   const raw=await sign.signTransaction(t),hash=await adapter.verifySigned(prepared,raw);
   if(hash!==keccak256(raw))throw Error('Signed transaction hash mismatch');
   state.phases[phase]={prepared,raw,txHash:hash,claimedAt:null,proof:null,settlement:null};save();
  }
  const saved=state.phases[phase];if(keccak256(saved.raw)!==saved.txHash)throw Error('Retained QA transaction changed');if(!saved.claimedAt)await adapter.verifySigned(saved.prepared,saved.raw);
  if(!saved.claimedAt){saved.claimedAt=new Date().toISOString();save();const sent=await sign.sendRawTransaction({serializedTransaction:saved.raw});if(sent!==saved.txHash)throw Error('Submission hash mismatch');}
  // Once claimed, rerunning only reads the retained hash. It never regenerates or resends.
  const receipt=await read.getTransactionReceipt({hash:saved.txHash}).catch(()=>null);
  if(receipt){saved.proof=await adapter.confirmTransaction(saved.prepared,saved.txHash);save();}
  console.log(serialize({stage,txHash:saved.txHash,receipt:receipt?{status:receipt.status,blockNumber:receipt.blockNumber}:null,proof:saved.proof}));
 }
}else throw Error('Use status, mint, approve, open, close, reconcile-open or reconcile-close');
