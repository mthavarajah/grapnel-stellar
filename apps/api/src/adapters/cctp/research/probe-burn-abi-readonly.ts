/** Published deployed-code ABI reads only, no accounts or transactions. */
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {Contract,contract,rpc,xdr} from '@stellar/stellar-sdk';
import {CCTP_TESTNET,CCTP_SOURCES} from '../registry.js';
const server=new rpc.Server(CCTP_TESTNET.stellar.rpc,{timeout:15});
if((await server.getNetwork()).passphrase!==CCTP_TESTNET.stellar.passphrase)throw Error('NETWORK_MISMATCH');
const entry=(await server.getLedgerEntries(new Contract(CCTP_TESTNET.stellar.messenger).getFootprint())).entries[0];
if(!entry)throw Error('INSTANCE_ABSENT');const hash=entry.val.contractData().val().instance().executable().wasmHash().toString('hex');
const result=await server.getLedgerEntries(xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({hash:Buffer.from(hash,'hex')})));
const wasm=result.entries[0]?.val.contractCode().code();if(!wasm||createHash('sha256').update(wasm).digest('hex')!==hash)throw Error('WASM_HASH_MISMATCH');
const spec=await contract.Spec.fromWasm(wasm),functions=spec.funcs().filter(fn=>['deposit_for_burn','deposit_for_burn_with_hook','local_message_transmitter','message_body_version'].includes(fn.name().toString())).map(fn=>({name:fn.name().toString(),xdr:fn.toXDR('base64'),inputs:fn.inputs().map(input=>({name:input.name().toString(),type:input.type().switch().name,type_xdr:input.type().toXDR('base64')})),outputs:fn.outputs().map(output=>({type:output.switch().name,type_xdr:output.toXDR('base64')}))}));
const report={observed_at:new Date().toISOString(),network:'stellar-testnet',source:CCTP_SOURCES.stellarContracts,contract:CCTP_TESTNET.stellar.messenger,ledger:result.latestLedger,wasm_hash:hash,wasm_bytes:wasm.length,functions,mode:'public_deployed_code_read_only',tx_hash:null};
await writeFile(new URL('./burn-abi-read.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
