/** Actual public customer address; unsigned getter simulations only, no burn/approval/signature/broadcast. */
import {writeFile} from 'node:fs/promises';
import {Address,Contract,TransactionBuilder,rpc,scValToNative} from '@stellar/stellar-sdk';
import {CCTP_TESTNET} from '../registry.js';
const wallet='GB4PC65ZHBPVEZMAHY2K2KYMS3RFBIN2FQIE3LGTLEHT2DEWVMTD7JYQ',p=CCTP_TESTNET.stellar,server=new rpc.Server(p.rpc,{timeout:15});
if((await server.getNetwork()).passphrase!==p.passphrase)throw Error('NETWORK_MISMATCH');
const account=await server.getAccount(wallet),rows=[];
for(const [method,args]of [['balance',[new Address(wallet).toScVal()]],['allowance',[new Address(wallet).toScVal(),new Address(p.messenger).toScVal()]]] as const){
 const tx=new TransactionBuilder(account,{fee:'100',networkPassphrase:p.passphrase}).addOperation(new Contract(p.usdc).call(method,...args)).setTimeout(90).build();
 const sim=await server.simulateTransaction(tx,undefined,'record');
 if(!rpc.Api.isSimulationSuccess(sim)||!sim.result){rows.push({method,error:rpc.Api.isSimulationError(sim)?sim.error:'GETTER_SIMULATION_UNAVAILABLE',signatures:tx.signatures.length});continue;}
 const fp=sim.transactionData.build().resources().footprint();rows.push({method,result:String(scValToNative(sim.result.retval)),ledger:sim.latestLedger,signatures:tx.signatures.length,auth_entries:sim.result.auth.length,footprint:{read_only:fp.readOnly().map(key=>({xdr:key.toXDR('base64'),type:key.switch().name,key:key.switch().name==='contractData'?scValToNative(key.contractData().key()):null,durability:key.switch().name==='contractData'?key.contractData().durability().name:null})),read_write:fp.readWrite().map(key=>key.toXDR('base64'))}});
}
const horizon=await(await fetch('https://horizon-testnet.stellar.org/accounts/'+wallet,{signal:AbortSignal.timeout(15000)})).json() as {balances?:{asset_type:string;asset_code?:string;asset_issuer?:string;balance:string}[]};
const trustline=horizon.balances?.find(row=>row.asset_code==='USDC'&&row.asset_issuer===p.issuer)??null;
const report={canonical_trustline:trustline,observed_at:new Date().toISOString(),network:'stellar-testnet',wallet,asset:{issuer:p.issuer,contract:p.usdc},rows,can_prepare:false,reason:trustline===null?'CCTP_CIRCLE_USDC_TRUSTLINE_REQUIRED':trustline.balance==='0.0000000'?'CCTP_CIRCLE_USDC_BALANCE_REQUIRED':'CCTP_ALLOWANCE_REVIEW_REQUIRED',signatures_created:0,customer_approval:false,burn_prepared:false,tx_hash:null,broadcast:false};
await writeFile(new URL('./customer-burn-readiness.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
