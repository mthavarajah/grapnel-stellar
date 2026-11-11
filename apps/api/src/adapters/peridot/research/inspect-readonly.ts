/** Public contract/code/market/history reads only: no wallet signer, provider account, mint or submission. */
import{writeFile}from'node:fs/promises';import{PeridotMarginAdapter,PERIDOT_MARKET_ID}from'../index.js';
const source=process.env.DIAGNOSTIC_STELLAR_ACCOUNT;if(!source)throw Error('Explicit existing public Testnet read-source required');
const adapter=new PeridotMarginAdapter({readSourceAddress:source}),markets=await adapter.markets(),history=await adapter.history(PERIDOT_MARKET_ID,'1d');
const report={observed_at:new Date().toISOString(),network:'stellar-testnet',mode:'read_only_adapter_verification',broadcast:false,execution_proof:null,tx_hash:null,capabilities:adapter.capabilities(),markets,history_summary:{provider:history.provider,source:history.source,source_url:history.source_url,provider_range:history.provider_range,points:history.points.length,as_of:history.as_of,latest_price:history.latest_price}};
await writeFile(new URL('./latest-readonly-inspection.json',import.meta.url),JSON.stringify(report,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');console.log(JSON.stringify(report,(_,v)=>typeof v==='bigint'?v.toString():v,2));
