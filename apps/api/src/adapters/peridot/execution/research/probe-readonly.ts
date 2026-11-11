import{Account,Address,Contract,TransactionBuilder,rpc,scValToNative,nativeToScVal,xdr}from'@stellar/stellar-sdk';
import{NETWORK_PASSPHRASE}from'@grapnel/contracts';
import{PeridotMarginAdapter,PERIDOT_TESTNET_PINS as P}from'../../index.js';
const source='GA237QIWQI6TUI3DTTWQELRHCGNMB3WWMSKY7LLXW3B4FBQJN3TN6IP4';
const server=new rpc.Server('https://soroban-testnet.stellar.org');
const adapter=new PeridotMarginAdapter({readSourceAddress:source});
const market=(await adapter.markets())[0]!;
async function view(method:string,args:xdr.ScVal[]=[]){const tx=new TransactionBuilder(await server.getAccount(source),{networkPassphrase:NETWORK_PASSPHRASE,fee:'100'}).addOperation(new Contract(P.aquarius_pool.address).call(method,...args)).setTimeout(30).build();const sim=await server.simulateTransaction(tx);if(!rpc.Api.isSimulationSuccess(sim)||!sim.result||sim.result.auth.length)throw Error('Read-only simulation failed');return{ledger:sim.latestLedger,value:scValToNative(sim.result.retval)};}
const reserve=await view('get_reserves'),fee=await view('get_fee_fraction');
const quotes=[];for(const amount of [1n,24000n,26000n,28000n,30000n])quotes.push({input_xlm:amount.toString(),...(await view('estimate_swap',[nativeToScVal(0,{type:'u32'}),nativeToScVal(1,{type:'u32'}),nativeToScVal(amount*10000000n,{type:'u128'})]))});
console.log(JSON.stringify({observed_at:new Date().toISOString(),mode:'READ_ONLY_NO_SIGNATURE_NO_BROADCAST',market,reserve,fee,quotes},(_,v)=>typeof v==='bigint'?v.toString():v,2));
