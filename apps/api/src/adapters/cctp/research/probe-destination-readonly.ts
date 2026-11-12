/** Published contracts/config/code only. No source burn hash, wallet, signing, or transaction submission. */
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {Contract,contract,rpc,xdr} from '@stellar/stellar-sdk';
import {readEvmRegistry} from '../reader.js';
import {CCTP_TESTNET as P} from '../registry.js';
const hyperEvm=await readEvmRegistry(),server=new rpc.Server(P.stellar.rpc,{timeout:15});
if((await server.getNetwork()).passphrase!==P.stellar.passphrase)throw Error('NETWORK_MISMATCH');
const entry=(await server.getLedgerEntries(new Contract(P.stellar.forwarder).getFootprint())).entries[0];if(!entry)throw Error('INSTANCE_ABSENT');
const hash=entry.val.contractData().val().instance().executable().wasmHash().toString('hex');
if(hash!=='caa4d100b5d102c07db3ff08d4c53f1f89562e8bbbf45e8bab593b1d99c1dec5')throw Error('FORWARDER_CODE_CHANGED');
const result=await server.getLedgerEntries(xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({hash:Buffer.from(hash,'hex')}))),wasm=result.entries[0]?.val.contractCode().code();
if(!wasm||createHash('sha256').update(wasm).digest('hex')!==hash)throw Error('WASM_HASH_MISMATCH');
const spec=await contract.Spec.fromWasm(wasm),fn=spec.funcs().find(fn=>fn.name().toString()==='mint_and_forward');if(!fn)throw Error('FORWARDER_ABI_ABSENT');
const urls=[
 'https://raw.githubusercontent.com/circlefin/evm-cctp-contracts/63ab1f0ac06ce0793c0bbfbb8d09816bc211386d/src/v2/TokenMessengerV2.sol',
 'https://raw.githubusercontent.com/circlefin/evm-cctp-contracts/63ab1f0ac06ce0793c0bbfbb8d09816bc211386d/src/v2/MessageTransmitterV2.sol',
 'https://raw.githubusercontent.com/circlefin/stellar-cctp/45746f2c803198bc6cd586475eb3c925f12bb488/contracts/cctp-forwarder/src/message.rs',
];
const sources=[];for(const url of urls){const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error(`SOURCE_READ_FAILED ${response.status}`);const content=await response.text();if(content.length>262144)throw Error('SOURCE_TOO_LARGE');sources.push({url,sha256:createHash('sha256').update(content).digest('hex')});}
const report={observed_at:new Date().toISOString(),mode:'public_contract_reads_only',hyperEvm,stellarForwarder:{contract:P.stellar.forwarder,ledger:result.latestLedger,wasm_hash:hash,function:{name:fn.name().toString(),xdr:fn.toXDR('base64'),inputs:fn.inputs().map(input=>({name:input.name().toString(),type:input.type().switch().name})),outputs:fn.outputs().map(output=>output.switch().name)}},sources,source_bytecode_reproducible_build_verified:false,financial_writes:0,source_burn_hash:null,destination_mint_hash:null,hypercore_credit_hash:null,return_hash:null,execution_status:'blocked',blockers:['ELIGIBLE_FUNDED_HYPERCORE_ACCOUNT_NOT_PROVIDED','ACTUAL_SOURCE_BURN_AND_IRIS_ATTESTATION_REQUIRED','MATCHING_HYPERCORE_LEDGER_CREDIT_REQUIRED','RETURN_ACTUAL_ATTESTATION_AND_SOROBAN_FOOTPRINT_REQUIRED']};
await writeFile(new URL('./destination-return-read.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({mode:report.mode,block:hyperEvm.block,ledger:result.latestLedger,function:fn.name().toString(),financial_writes:0,execution_status:'blocked'}));
