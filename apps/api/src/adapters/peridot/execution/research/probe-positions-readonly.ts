import{writeFileSync}from'node:fs';
import{Contract,TransactionBuilder,rpc,scValToNative,nativeToScVal,xdr}from'@stellar/stellar-sdk';
import{NETWORK_PASSPHRASE}from'@grapnel/contracts';
import{PERIDOT_TESTNET_PINS as P}from'../../config.js';
const source='GA237QIWQI6TUI3DTTWQELRHCGNMB3WWMSKY7LLXW3B4FBQJN3TN6IP4',server=new rpc.Server('https://soroban-testnet.stellar.org');
if((await server.getNetwork()).passphrase!==NETWORK_PASSPHRASE)throw Error('Wrong network');
async function view(method:string,id?:bigint){const tx=new TransactionBuilder(await server.getAccount(source),{fee:'100',networkPassphrase:NETWORK_PASSPHRASE}).addOperation(new Contract(P.margin.address).call(method,...(id===undefined?[]:[nativeToScVal(id,{type:'u64'})]))).setTimeout(30).build(),sim=await server.simulateTransaction(tx);if(!rpc.Api.isSimulationSuccess(sim)||rpc.Api.isSimulationRestore(sim)||!sim.result||sim.result.auth.length)throw Error('Readonly view unavailable');return{ledger:sim.latestLedger,value:scValToNative(sim.result.retval),xdr:sim.result.retval.toXDR('base64')};}
const counter=await view('get_position_counter'),max=counter.value as bigint,rows=[];
for(let id=max;id>max-10n&&id>=0n;id--){const position=await view('get_position',id);if(position.value)rows.push({id,position,perps:await view('get_perps_position',id),pendingOpen:await view('get_pending_perps_open',id),openExecution:await view('get_pending_perps_open_execution',id),pendingClose:await view('get_pending_perps_close',id)});}
const body={observed_at:new Date().toISOString(),mode:'PUBLIC_EXISTING_PROVIDER_POSITION_READS_NOT_GRAPNEL_POSITIONS',broadcast:false,signatures:0,tx_hash:null,counter,rows};writeFileSync(new URL('./positions-readonly.json',import.meta.url),JSON.stringify(body,(_,v)=>typeof v==='bigint'?v.toString():v,2));console.log(JSON.stringify(body,(_,v)=>typeof v==='bigint'?v.toString():v,2));
