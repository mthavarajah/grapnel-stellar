import {createHash} from 'node:crypto';
import {Address,Contract,rpc,scValToNative} from '@stellar/stellar-sdk';
import {CCTP_TESTNET} from './registry.js';
const STELLAR_CODE=Object.freeze({messenger:'a04c09f4bf064cfafb7e4e931752de15a216af1d59373bdd9d53908e7d29a9fe',transmitter:'8927f7389410044b35b1d3d0d7d42ea4ed0677dea18cb1bd89be4a980566c614',forwarder:'caa4d100b5d102c07db3ff08d4c53f1f89562e8bbbf45e8bab593b1d99c1dec5'});
const EVM_CODE=Object.freeze({
 usdc:{sha256:'b6ee454dc91cd5643f7b221c8606b9d060aaa574db7e3fcc6d8f8a7b25572790',implementation:null,implementationSha256:null},
 messenger:{sha256:'501b4a60e24ea82032b7442d75995dee3bdbfc17b25caffc3c955eadc8c2a418',implementation:'0xf07c0ad13178a9ef5c3ffa0be69e0becd452bf6d',implementationSha256:'a4cee8ec932bf532c98711a80b2ff0d5fe8e8701c179ec45e86dea2ca619be0b'},
 transmitter:{sha256:'501b4a60e24ea82032b7442d75995dee3bdbfc17b25caffc3c955eadc8c2a418',implementation:'0x1110d9af71fab7e4d05d80c26f98ff0ca125470c',implementationSha256:'e9423da6e41a7a11455980721a885b8150babbe1628871d8e5d7316fd3299ddf'},
 forwarder:{sha256:'de90f6f079e69f34453c490764eb27d059a8021782555d62cf10a1bd10518bc8',implementation:'0xd1ff0f53bd651448bced218fd875323486274c26',implementationSha256:'eba80efd392dbf4213e0c3de29ad1f6634b5dec6148f29d805cb95d81149588a'},
 coreDepositWallet:{sha256:'de90f6f079e69f34453c490764eb27d059a8021782555d62cf10a1bd10518bc8',implementation:'0x49808bcf68fc2e26fa2986aa9b08615181ae19d3',implementationSha256:'eda4165563cabe7cea32134f9af0e710b92e5b57ee591580adaae9cba7cea7ae'},
});
const SLOT='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
export interface StellarRegistryRead {passphrase:string;ledger:number;contracts:Record<string,{address:string;codeHash:string|null;executable:string;storage:Record<string,unknown>}>}
export interface EvmRegistryRead {chainId:string;block:string;blockTimestamp:number;decimals:string;domain:string;messengerTransmitter:string;contracts:Record<string,{address:string;sha256:string;implementation:string|null;implementationSha256:string|null}>}
const fail=(code:string):never=>{throw Error(code);};
/** Only registry identity/configuration; no claim that burns, attestations, trades or returns work. */
export function validateStellarRegistry(s:StellarRegistryRead):void {
 const p=CCTP_TESTNET.stellar;if(s.passphrase!==p.passphrase||!Number.isSafeInteger(s.ledger)||s.ledger<=0)fail('CCTP_STELLAR_NETWORK_MISMATCH');
 for(const role of ['messenger','transmitter','forwarder'] as const){const c=s.contracts[role];if(c?.address!==p[role]||c.executable!=='contractExecutableWasm'||c.codeHash!==STELLAR_CODE[role])fail('CCTP_STELLAR_CODE_MISMATCH');}
 if(s.contracts.transmitter!.storage.LocalDomain!==27||s.contracts.messenger!.storage.LocalMessageTransmitter!==p.transmitter||s.contracts.forwarder!.storage.MessageTransmitter!==p.transmitter||s.contracts.forwarder!.storage.TokenMessengerMinter!==p.messenger)fail('CCTP_STELLAR_CONFIGURATION_MISMATCH');
 const c=s.contracts.usdc,meta=c?.storage.METADATA as Record<string,unknown>|undefined;
 if(c?.address!==p.usdc||c.executable!=='contractExecutableStellarAsset'||meta?.decimal!==7||meta?.symbol!=='USDC'||meta?.name!==`USDC:${p.issuer}`)fail('CCTP_STELLAR_USDC_MISMATCH');
}
export function validateEvmRegistry(s:EvmRegistryRead,now=Date.now()):void {
 if(s.chainId!=='0x3e6')fail('CCTP_HYPEREVM_NETWORK_MISMATCH');
 if(!/^0x[0-9a-f]+$/i.test(s.block)||!Number.isSafeInteger(s.blockTimestamp)||s.blockTimestamp*1000>now+10_000||now-s.blockTimestamp*1000>120_000)fail('CCTP_HYPEREVM_STALE_READ');
 if(!/^0x[0-9a-f]{64}$/i.test(s.decimals)||BigInt(s.decimals)!==6n||!/^0x[0-9a-f]{64}$/i.test(s.domain)||BigInt(s.domain)!==19n||s.messengerTransmitter.toLowerCase()!==`0x${'0'.repeat(24)}${CCTP_TESTNET.hyperEvm.transmitter.slice(2).toLowerCase()}`)fail('CCTP_HYPEREVM_CONFIGURATION_MISMATCH');
 for(const role of Object.keys(EVM_CODE) as (keyof typeof EVM_CODE)[]){const c=s.contracts[role],p=EVM_CODE[role];if(c?.address!==CCTP_TESTNET.hyperEvm[role]||c.sha256!==p.sha256||c.implementation!==p.implementation||c.implementationSha256!==p.implementationSha256)fail('CCTP_HYPEREVM_CODE_MISMATCH');}
}
export async function readStellarRegistry():Promise<StellarRegistryRead>{
 const server=new rpc.Server(CCTP_TESTNET.stellar.rpc,{timeout:15}),network=await server.getNetwork();
 if(network.passphrase!==CCTP_TESTNET.stellar.passphrase)fail('CCTP_STELLAR_NETWORK_MISMATCH');
 const roles=['messenger','transmitter','forwarder','usdc'] as const;
 const result=await server.getLedgerEntries(...roles.map(role=>new Contract(CCTP_TESTNET.stellar[role]).getFootprint()));
 const contracts:StellarRegistryRead['contracts']={};
 for(const role of roles){const address=CCTP_TESTNET.stellar[role],entry=result.entries.find(entry=>Address.fromScAddress(entry.key.contractData().contract()).toString()===address);
  if(!entry||entry.liveUntilLedgerSeq===undefined||entry.liveUntilLedgerSeq<=result.latestLedger)fail('CCTP_STELLAR_ENTRY_MISSING');
  const instance=entry!.val.contractData().val().instance(),storage:Record<string,unknown>=Object.create(null);
  for(const item of instance.storage()??[]){const key:unknown=scValToNative(item.key());if(typeof key==='string')storage[key]=scValToNative(item.val());else if(Array.isArray(key)&&key.length===1&&typeof key[0]==='string')storage[key[0]]=scValToNative(item.val());}
  contracts[role]={address,executable:instance.executable().switch().name,codeHash:instance.executable().switch().name==='contractExecutableWasm'?instance.executable().wasmHash().toString('hex'):null,storage};
 }
 const out={passphrase:network.passphrase,ledger:result.latestLedger,contracts};validateStellarRegistry(out);return out;
}
async function boundedJson(response:Response):Promise<unknown>{
 if(!response.ok||!response.body)fail('CCTP_RPC_UNAVAILABLE');const reader=response.body!.getReader();let size=0;const chunks:Uint8Array[]=[];
 try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>262144)fail('CCTP_RPC_RESPONSE_TOO_LARGE');chunks.push(chunk.value);}}finally{await reader.cancel();}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function readEvmRegistry(fetcher:typeof fetch=fetch):Promise<EvmRegistryRead>{
 let id=0;const call=async(method:string,params:unknown[]):Promise<unknown>=>{
  const requestId=++id,response=await fetcher(CCTP_TESTNET.hyperEvm.rpc,{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:requestId,method,params}),signal:AbortSignal.timeout(15000)});
  const value=await boundedJson(response) as {jsonrpc?:unknown;id?:unknown;result?:unknown;error?:unknown};if(value.jsonrpc!=='2.0'||value.id!==requestId||value.error||value.result===undefined)fail('CCTP_RPC_INVALID_RESPONSE');return value.result;
 };
 const chainId=await call('eth_chainId',[]);if(chainId!=='0x3e6')fail('CCTP_HYPEREVM_NETWORK_MISMATCH');
 const head=await call('eth_getBlockByNumber',['latest',false]) as {number?:unknown;timestamp?:unknown};if(typeof head?.number!=='string'||!/^0x[0-9a-f]+$/i.test(head.number)||typeof head.timestamp!=='string'||!/^0x[0-9a-f]+$/i.test(head.timestamp))fail('CCTP_HYPEREVM_INVALID_BLOCK');
 const block=head.number as string,blockTimestamp=Number(BigInt(head.timestamp as string)),contracts:EvmRegistryRead['contracts']={};
 const codeHash=async(address:string):Promise<string>=>{const code=await call('eth_getCode',[address,block]);if(typeof code!=='string'||!/^0x(?:[0-9a-f]{2}){1,100000}$/i.test(code))return fail('CCTP_HYPEREVM_CODE_MISSING');return createHash('sha256').update(Buffer.from(code.slice(2),'hex')).digest('hex');};
 for(const role of Object.keys(EVM_CODE) as (keyof typeof EVM_CODE)[]){const address=CCTP_TESTNET.hyperEvm[role],sha256=await codeHash(address),slot=await call('eth_getStorageAt',[address,SLOT,block]);if(typeof slot!=='string'||!/^0x0{24}[0-9a-f]{40}$/i.test(slot))fail('CCTP_HYPEREVM_IMPLEMENTATION_INVALID');
  const raw=(slot as string).slice(-40).toLowerCase(),implementation=/^0{40}$/.test(raw)?null:`0x${raw}`,implementationSha256=implementation?await codeHash(implementation):null;contracts[role]={address,sha256,implementation,implementationSha256};
 }
 const read=async(to:string,data:string)=>{const r=await call('eth_call',[{to,data},block]);if(typeof r!=='string')return fail('CCTP_HYPEREVM_GETTER_INVALID');return r;};
 const out={chainId:chainId as string,block,blockTimestamp,contracts,decimals:await read(CCTP_TESTNET.hyperEvm.usdc,'0x313ce567'),domain:await read(CCTP_TESTNET.hyperEvm.transmitter,'0x8d3638f4'),messengerTransmitter:await read(CCTP_TESTNET.hyperEvm.messenger,'0x2c121921')};validateEvmRegistry(out);return out;
}
export async function checkCctpTestnetRegistry(){
 const started=Date.now(),[stellar,hyperEvm]=await Promise.all([readStellarRegistry(),readEvmRegistry()]);
 if(Date.now()-started>60_000)fail('CCTP_REGISTRY_READ_EXPIRED');
 return {observed_at:new Date().toISOString(),execution_status:'discovery_only' as const,registry_verified:true,bridge_execution_verified:false,customer_assets_moved:false,tx_hash:null,stellar,hyperEvm};
}
