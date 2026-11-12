/** Public Testnet reads only. No signatures, accounts, simulation, burns, mints or submission. */
import {writeFile} from 'node:fs/promises';
import {checkCctpTestnetRegistry} from '../reader.js';
import {CCTP_SOURCES} from '../registry.js';
const report=await checkCctpTestnetRegistry();
await writeFile(new URL('./testnet-registry-read.json',import.meta.url),JSON.stringify({...report,sources:CCTP_SOURCES},(_,value)=>typeof value==='bigint'?value.toString():value,2)+'\n');
console.log(JSON.stringify({observed_at:report.observed_at,stellar_ledger:report.stellar.ledger,hyperevm_block:report.hyperEvm.block,registry_verified:report.registry_verified,execution_status:report.execution_status,tx_hash:report.tx_hash}));
