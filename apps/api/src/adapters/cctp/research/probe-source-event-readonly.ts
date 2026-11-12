/** Public Testnet contract code only. No wallet, simulation, signature or write. */
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {Contract,contract,rpc,xdr} from '@stellar/stellar-sdk';
import {CCTP_TESTNET as P} from '../registry.js';
const server=new rpc.Server(P.stellar.rpc,{timeout:15});if((await server.getNetwork()).passphrase!==P.stellar.passphrase)throw Error('WRONG_NETWORK');
const instance=(await server.getLedgerEntries(new Contract(P.stellar.transmitter).getFootprint())).entries[0];if(!instance)throw Error('INSTANCE_ABSENT');
const hash=instance.val.contractData().val().instance().executable().wasmHash().toString('hex');if(hash!=='8927f7389410044b35b1d3d0d7d42ea4ed0677dea18cb1bd89be4a980566c614')throw Error('TRANSMITTER_CODE_CHANGED');
const result=await server.getLedgerEntries(xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({hash:Buffer.from(hash,'hex')}))),wasm=result.entries[0]?.val.contractCode().code();if(!wasm||createHash('sha256').update(wasm).digest('hex')!==hash)throw Error('WASM_MISMATCH');
const spec=await contract.Spec.fromWasm(wasm),events=spec.entries.filter(e=>e.switch().name==='scSpecEntryEventV0').filter(e=>e.eventV0().name().toString()==='MessageSent').map(e=>({name:e.eventV0().name().toString(),dataFormat:e.eventV0().dataFormat().name,prefixTopics:e.eventV0().prefixTopics().map(t=>t.toString()),params:e.eventV0().params().map(p=>({name:p.name().toString(),type:p.type().switch().name,location:p.location().name})),xdr:e.toXDR('base64')}));
const urls=['https://raw.githubusercontent.com/circlefin/stellar-cctp/45746f2c803198bc6cd586475eb3c925f12bb488/contracts/message-transmitter-v2/src/lib.rs','https://raw.githubusercontent.com/circlefin/stellar-cctp/45746f2c803198bc6cd586475eb3c925f12bb488/packages/cctp-utils/src/message/mod.rs'];
const sources=[];for(const url of urls){const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('SOURCE_READ_FAILED');const content=await response.text();if(content.length>262144)throw Error('SOURCE_TOO_LARGE');sources.push({url,sha256:createHash('sha256').update(content).digest('hex')});}
const report={observedAt:new Date().toISOString(),network:'stellar-testnet',contract:P.stellar.transmitter,ledger:result.latestLedger,wasmHash:hash,events,sources,sourceToBytecodeBuildVerified:false,onchainWrites:0,sourceBurnHash:null,execution_status:'discovery_only'};
await writeFile(new URL('./source-event-read.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ledger:result.latestLedger,events:events.map(e=>e.name),onchainWrites:0}));
