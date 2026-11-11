import{readFileSync,writeFileSync}from'node:fs';
import{Contract,TransactionBuilder,rpc,scValToNative,xdr}from'@stellar/stellar-sdk';
import{NETWORK_PASSPHRASE}from'@grapnel/contracts';
import{buildPeridotStepOperation}from'../intents.js';
import{PERIDOT_TESTNET_PINS as P}from'../../config.js';
const positions=JSON.parse(readFileSync(new URL('./positions-readonly.json',import.meta.url),'utf8')),server=new rpc.Server('https://soroban-testnet.stellar.org'),rows=[];
if((await server.getNetwork()).passphrase!==NETWORK_PASSPHRASE)throw Error('Wrong network');
for(const row of positions.rows.slice(0,2)){
 const owner=row.position.value.owner,id=row.id;
 for(const intent of [{step:'open_begin' as const,walletAddress:owner,marginReceiptAtomic:'10000000',leverage:2 as const,direction:'long' as const,minimumOutputAtomic:'150000000'}, {step:'close_prepare' as const,walletAddress:owner,positionId:id},{step:'vault_deposit' as const,walletAddress:owner,underlyingAtomic:'10000000'},{step:'margin_transfer' as const,walletAddress:owner,receiptAtomic:'10000000'}]){
  const tx=new TransactionBuilder(await server.getAccount(owner),{fee:'100',networkPassphrase:NETWORK_PASSPHRASE}).addOperation(xdr.Operation.fromXDR(buildPeridotStepOperation(intent),'base64')).setTimeout(30).build();
  const sim=await server.simulateTransaction(tx,undefined,'record');
  rows.push({intent,ledger:sim.latestLedger,success:rpc.Api.isSimulationSuccess(sim),...(rpc.Api.isSimulationSuccess(sim)&&sim.result?{retval:scValToNative(sim.result.retval),auth:sim.result.auth.map(a=>a.toXDR('base64')),resource:sim.transactionData.build().toXDR('base64'),min_resource_fee:sim.minResourceFee}:{error:'error'in sim?sim.error:'no success'})});
 }
}
const out={observed_at:new Date().toISOString(),mode:'UNSIGNED_PUBLIC_EXISTING_OWNER_SIMULATION_NOT_AUTHORIZATION_OR_EXECUTION',broadcast:false,signatures:0,tx_hash:null,rows};writeFileSync(new URL('./v3-preflight-readonly.json',import.meta.url),JSON.stringify(out,(_,v)=>typeof v==='bigint'?v.toString():v,2));console.log(JSON.stringify(out,(_,v)=>typeof v==='bigint'?v.toString():v,2));
