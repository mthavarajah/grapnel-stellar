import '../apps/api/src/lib/env.js';
import { readFile } from 'node:fs/promises';
import { NETWORK_PASSPHRASE } from '../packages/contracts/src/index.js';
const timeout=15000;
async function json(url:string,headers:Record<string,string>={}) {
 const response=await fetch(url,{headers,signal:AbortSignal.timeout(timeout)});
 if(!response.ok)throw new Error(`Read failed (${response.status}) at ${new URL(url).origin}${new URL(url).pathname}`);
 return response.json();
}
const horizon='https://horizon-testnet.stellar.org';
const root=await json(horizon);
if(root.network_passphrase!==NETWORK_PASSPHRASE)throw new Error('NETWORK_MISMATCH');
const evidence=JSON.parse(await readFile(new URL('../evidence/testnet.json',import.meta.url),'utf8'));
if(evidence.network!=='stellar-testnet'||evidence.network_passphrase!==NETWORK_PASSPHRASE)throw new Error('Evidence network mismatch');
const records=['treasury_activation','gate1','funding','return','soroswap','blend_supply','blend_withdraw'];
const verified:Record<string,unknown>={};
for(const name of records){
 const entry=evidence[name];
 if(!entry?.tx_hash){verified[name]={chain_status:'missing',delta_status:'not_verified'};continue;}
 if(!/^[a-f0-9]{64}$/.test(entry.tx_hash))throw new Error(`Malformed hash for ${name}`);
 const tx=await json(`${horizon}/transactions/${entry.tx_hash}`);
 if(tx.hash!==entry.tx_hash||tx.successful!==true)throw new Error(`Unconfirmed transaction for ${name}`);
 if(entry.wallet_address && name==='gate1' && tx.source_account!==entry.wallet_address)throw new Error('Gate 1 source mismatch');
 verified[name]={chain_status:'confirmed_success',tx_hash:tx.hash,ledger:tx.ledger,source:tx.source_account,explorer_url:`https://stellar.expert/explorer/testnet/tx/${tx.hash}`,delta_status:'not_independently_rechecked'};
}
const account=evidence.treasury_activation?.treasury_address??evidence.wallet_address;
const balances=account?await json(`${horizon}/accounts/${encodeURIComponent(account)}`):null;
const apiUrl=process.env.SMOKE_API_URL??process.env.GRAPNEL_API_URL;
let api:unknown=null;
if(apiUrl){
 const url=new URL(apiUrl);if(url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname))throw new Error('Public smoke API must use HTTPS');
 const health=await json(new URL('/health',url).href);
 if(health.status!=='ok'||health.network!=='stellar-testnet'||health.db!=='ok')throw new Error('API health check failed');
 const spec=await json(new URL('/openapi.json',url).href);if(spec.openapi!=='3.1.0')throw new Error('OpenAPI unavailable');
 api={url:url.origin,health,openapi_version:spec.info.version};
}
console.log(JSON.stringify({observed_at:new Date().toISOString(),mode:'read_only_no_signing_no_broadcast',network:'stellar-testnet',api,account:account?{address:account,balances:balances.balances}:null,transactions:verified,acceptance_gate_passed:false,reason:'Transaction inclusion is rechecked independently; customer signer attribution and historical balance/position deltas still require specific acceptance evidence.'},null,2));
if(process.argv.includes('--require-full')){
 const missing=records.filter(n=>n!=='treasury_activation'&&!evidence[n]?.tx_hash);
 if(missing.length)throw new Error(`Full MVP evidence missing: ${missing.join(', ')}`);
 throw new Error('Full acceptance requires explicit provider delta and customer consent verification; this read-only smoke command does not certify that gate.');
}
