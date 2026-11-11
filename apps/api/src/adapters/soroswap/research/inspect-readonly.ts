import {STANDALONE_NATIVE_ROUTES} from '../direct-assets.js';
/** READ ONLY: quote/build, ledger reads and simulations. No signer or sender. */
import '../../../lib/env.js';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {Transaction,TransactionBuilder,rpc,StrKey} from '@stellar/stellar-sdk';
import {NETWORK_PASSPHRASE} from '@grapnel/contracts';
import {SoroswapSpotAdapter} from '../index.js';
import {SoroswapDirectInspector,USDC_ISSUER} from '../inspector.js';
const standalone=process.env.DIAGNOSTIC_TOKEN_CONTRACT?STANDALONE_NATIVE_ROUTES.find(r=>r.contract===process.env.DIAGNOSTIC_TOKEN_CONTRACT):undefined;
if(process.env.DIAGNOSTIC_TOKEN_CONTRACT&&!standalone)throw Error('Diagnostic token is not a finite verified direct route');
const pair=standalone?.pair??'CBR76WMT6J733CCVBP23M2EL5QGP5HXLPEFNFZGZ7IB6QHOJAHP7YM3V';
const reverse=process.env.DIAGNOSTIC_REVERSE==='true';
const source=process.env.DIAGNOSTIC_STELLAR_ACCOUNT??(reverse?(standalone?.code==='BTC'?'GC53JCXZHW3SVNRE4CT6XFP46WX4ACFQU32P4PR3CU43OB7AKKMFXZ6Y':'GA23KVZGO3TOVGAKGFAMTC7EXOSHHWUICHK6WTOV7ZRJZVSINELWVZ7K'):'GA237QIWQI6TUI3DTTWQELRHCGNMB3WWMSKY7LLXW3B4FBQJN3TN6IP4');
if(!StrKey.isValidEd25519PublicKey(source)||!process.env.SOROSWAP_API_KEY)throw Error('Existing diagnostic address and server-only Soroswap credentials required');
const accountResponse=await fetch(`https://horizon-testnet.stellar.org/accounts/${source}`,{signal:AbortSignal.timeout(12000)});if(!accountResponse.ok)throw Error('Diagnostic source must already exist');
const account=await accountResponse.json() as {balances:{asset_code?:string;asset_issuer?:string;is_authorized?:boolean}[]};
if(!standalone&&!account.balances.some(b=>b.asset_code==='USDC'&&b.asset_issuer===USDC_ISSUER&&b.is_authorized===true))throw Error('Diagnostic source must already have the exact authorized USDC trustline');
const server=new rpc.Server('https://soroban-testnet.stellar.org');const simulations:unknown[]=[];
const inspector=new SoroswapDirectInspector(pair,{server:{getNetwork:()=>server.getNetwork(),getAccount:a=>server.getAccount(a),getContractData:(...a)=>server.getContractData(...a),simulateTransaction:async(...a)=>{const sim=await server.simulateTransaction(...a);simulations.push({ledger:sim.latestLedger,success:rpc.Api.isSimulationSuccess(sim),...(rpc.Api.isSimulationSuccess(sim)?{minimum_resource_fee:sim.minResourceFee,instructions:sim.transactionData.build().resources().instructions()}:{})});return sim;}}});
const market=(await inspector.markets())[reverse?1:0]!;
// Diagnostic quote does not unlock the adapter's gated financial prepare method.
const adapter=new SoroswapSpotAdapter({network:'testnet',networkPassphrase:NETWORK_PASSPHRASE,apiKey:process.env.SOROSWAP_API_KEY,gate1Passed:false,markets:[market]});
const quote=await adapter.quote({quoteId:randomUUID(),marketId:market.id,assetId:market.asset_in.id,amount:process.env.DIAGNOSTIC_AMOUNT??(reverse&&standalone?.code==='BTC'?'0.0001000':'1.0000000'),slippageBps:50});
await new Promise(resolve=>setTimeout(resolve,1500));
const response=await fetch('https://api.soroswap.finance/quote/build?network=testnet',{method:'POST',headers:{Authorization:`Bearer ${process.env.SOROSWAP_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({quote:quote.provider_quote,from:source,to:source}),signal:AbortSignal.timeout(20000)});
if(!response.ok)throw Error(`Read-only build unavailable:HTTP${response.status}`);const built=await response.json() as {xdr:string};
if(standalone&&process.env.DIAGNOSTIC_CAPTURE_UNSIGNED==='true')await writeFile(new URL(`./latest-${standalone.code}-${reverse?'reverse':'forward'}-unsigned-build.json`,import.meta.url),JSON.stringify({observed_at:new Date().toISOString(),network:'testnet',broadcast:false,rows:[{direction:reverse?`${standalone.code}-XLM`:`XLM-${standalone.code}`,assetIn:market.asset_in.contractId,assetOut:market.asset_out.contractId,amount:quote.amount_in_atomic,source,quote:quote.provider_quote,build:built}]},null,2)+'\n');
const action=await inspector.inspect({unsignedXdr:built.xdr,quote,market,customer:{businessId:randomUUID(),customerId:randomUUID(),walletId:randomUUID(),walletAddress:source,privyUserId:'diagnostic-no-signing-authority'},operationId:randomUUID()});
function metrics(xdr:string){const tx=TransactionBuilder.fromXDR(xdr,NETWORK_PASSPHRASE) as Transaction,data=tx.toEnvelope().v1().tx().ext().sorobanData(),r=data.resources();return {extension_version:data.ext().switch(),archived_rw_indices:data.ext().switch()===1?data.ext().resourceExt().archivedSorobanEntries():[],instructions:r.instructions(),read_bytes:r.diskReadBytes(),write_bytes:r.writeBytes(),resource_fee:data.resourceFee().toString(),total_fee:tx.fee,expires_at:new Date(Number(tx.timeBounds!.maxTime)*1000).toISOString(),read_only_keys:r.footprint().readOnly().length,read_write_keys:r.footprint().readWrite().length,signatures:tx.signatures.length};}
const report={observed_at:new Date().toISOString(),network:'stellar-testnet',mode:'read_only_inspection',broadcast:false,signable:false,source,source_owned_by_grapnel:false,quote:{asset_in_id:quote.asset_in_id,asset_out_id:quote.asset_out_id,amount_in:quote.amount_in,expected_out:quote.expected_out,min_receive:quote.min_receive},original:metrics(built.xdr),canonical:metrics(action.unsignedXdr),simulations,tx_hash:null,operation_id:null,customer_id:null};
await writeFile(new URL(standalone?`./latest-${standalone.code}-${reverse?'reverse':'forward'}-readonly-inspection.json`:reverse?'./latest-reverse-readonly-inspection.json':'./latest-readonly-inspection.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
