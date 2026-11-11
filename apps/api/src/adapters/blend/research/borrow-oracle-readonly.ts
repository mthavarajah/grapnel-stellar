import {writeFile} from 'node:fs/promises';
import {Account,Address,Contract,TransactionBuilder,rpc,scValToNative,xdr} from '@stellar/stellar-sdk';
import {NETWORK_PASSPHRASE} from '@grapnel/contracts';
const oracle='CAZOKR2Y5E2OSWSIBRVZMJ47RUTQPIGVWSAQ2UISGAVC46XKPGDG5PKI';
const assets=['CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC','CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU'];
const server=new rpc.Server('https://soroban-testnet.stellar.org');
const entry=await server.getContractData(oracle,xdr.ScVal.scvLedgerKeyContractInstance());
const result:any={observed_at:new Date().toISOString(),network:'stellar-testnet',mode:'read_only',broadcast:false,oracle,wasm_hash:entry.val.contractData().val().instance().executable().wasmHash().toString('hex'),calls:[]};
for(const asset of [null,...assets]){
 const fn=asset?'lastprice':'decimals';const args=asset?[xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Stellar'),Address.fromString(asset).toScVal()])]:[];
 const tx=new TransactionBuilder(new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF','0'),{fee:'100',networkPassphrase:NETWORK_PASSPHRASE}).addOperation(new Contract(oracle).call(fn,...args)).setTimeout(30).build();
 const sim=await server.simulateTransaction(tx);result.calls.push({fn,asset,ledger:sim.latestLedger,success:rpc.Api.isSimulationSuccess(sim),...(rpc.Api.isSimulationSuccess(sim)?{auth:sim.result?.auth.length,value:sim.result?scValToNative(sim.result.retval):null,retval:sim.result?.retval.toXDR('base64')}:{error:sim.error})});
}
const str=JSON.stringify(result,(_k,v)=>typeof v==='bigint'?v.toString():v,2);await writeFile(new URL('./borrow-oracle-read.json',import.meta.url),str+'\n');console.log(str);
