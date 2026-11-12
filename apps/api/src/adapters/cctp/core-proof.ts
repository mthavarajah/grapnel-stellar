/** Read-only HyperCore prerequisites and actual deposit reconciliation. Never activates an account. */
import {z} from 'zod';
import type {Hex} from 'viem';
import {boundedCctpAmount,cctpStageFail,cctpQuantity,createCctpEvmReadTransport,normalizeEvm,type CctpEligibility,type CctpEvmRequest,type CctpCoreDepositTransferProof,type CctpEvmReadTransport} from './destination.js';
const TESTNET_INFO='https://api.hyperliquid-testnet.xyz/info',MAINNET_INFO='https://api.hyperliquid.xyz/info';
export interface CctpCoreProofDependencies {fetcher?:typeof fetch;now?:()=>number;transport?:CctpEvmReadTransport;}
export interface CctpCoreBaseline {accountAddress:`0x${string}`;rawUsdAtomic6:string;observedAt:string;}
export interface ConfirmedCctpCoreCredit {
 network:'hyperliquid-testnet';operationId:string;businessId:string;customerId:string;walletId:string;accountAddress:`0x${string}`;
 depositTxHash:Hex;amountAtomic6:string;ledgerHash:Hex;balanceBeforeAtomic6:string;balanceAfterAtomic6:string;confirmed:true;
}
async function info(endpoint:typeof TESTNET_INFO|typeof MAINNET_INFO,request:Record<string,unknown>,fetcher:typeof fetch){
 const response=await fetcher(endpoint,{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(15000)});
 if(!response.ok||!response.body)return cctpStageFail('CCTP_CORE_READ_UNAVAILABLE');const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>262144)return cctpStageFail('CCTP_CORE_READ_TOO_LARGE');chunks.push(next.value);}}finally{await reader.cancel();}return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
/** Explicitly authorized mainnet public READ only. Missing/agent/vault/HTTP200 never imply recipient eligibility. */
export async function readHyperCoreEligibility(account:string,d:CctpCoreProofDependencies={}):Promise<CctpEligibility>{
 const normalized=normalizeEvm(account),now=d.now?.()??Date.now();
 try{const body=z.object({role:z.enum(['user','agent','vault','missing'])}).passthrough().parse(await info(MAINNET_INFO,{type:'userRole',user:normalized},d.fetcher??fetch));return{account:normalized,network:'hyperliquid-testnet',preexistingMainnetState:body.role==='user'?'verified':body.role==='missing'?'absent':'unknown',verifiedAt:new Date(now).toISOString()};}catch{return{account:normalized,network:'hyperliquid-testnet',preexistingMainnetState:'unknown',verifiedAt:new Date(now).toISOString()};}
}
const rawUsd=z.string().regex(/^-?(?:0|[1-9]\d{0,24})(?:\.\d{1,18})?$/);
const stateSchema=z.object({time:z.number().int().positive().safe(),marginSummary:z.object({totalRawUsd:rawUsd}).passthrough()}).passthrough();
function atomic6(value:string):bigint{const negative=value.startsWith('-'),[integer,fraction='']=(negative?value.slice(1):value).split('.');if(fraction.slice(6).replace(/0/g,''))return cctpStageFail('CCTP_CORE_CASH_PRECISION_UNSUPPORTED');return(BigInt(integer!)*1000000n+BigInt(fraction.slice(0,6).padEnd(6,'0')))*(negative?-1n:1n);}
/** Capture and durably persist BEFORE signing the CoreDepositWallet transaction. */
export async function readHyperCoreBaseline(r:CctpEvmRequest,d:CctpCoreProofDependencies={}):Promise<CctpCoreBaseline>{
 const account=normalizeEvm(r.evmAccount),now=d.now?.()??Date.now(),body=stateSchema.parse(await info(TESTNET_INFO,{type:'clearinghouseState',user:account},d.fetcher??fetch));
 if(body.time>now+1000||now-body.time>5000)return cctpStageFail('CCTP_CORE_FRESH_BASELINE_REQUIRED');return{accountAddress:account,rawUsdAtomic6:atomic6(body.marginSummary.totalRawUsd).toString(),observedAt:new Date(body.time).toISOString()};
}
/** Actual matching ledger hash is mandatory; a time/amount coincidence plus balance change cannot settle a deposit. */
export async function confirmHyperCoreCredit(r:CctpEvmRequest,p:CctpCoreDepositTransferProof,before:CctpCoreBaseline,d:CctpCoreProofDependencies={}):Promise<ConfirmedCctpCoreCredit>{
 const account=normalizeEvm(r.evmAccount),amount=boundedCctpAmount(r.amountCctpAtomic),now=d.now?.()??Date.now(),stamp=Date.parse(before.observedAt);
 if(p.network!=='hyperevm-testnet'||p.chainId!==998||p.operationId!==r.operationId||p.businessId!==r.customer.businessId||p.customerId!==r.customer.customerId||p.walletId!==r.customer.walletId||normalizeEvm(p.evmAccount)!==account||p.amountCctpAtomic!==r.amountCctpAtomic||p.evmDepositConfirmed!==true||!/^0x[a-f0-9]{64}$/i.test(p.depositTxHash)||!/^0x[a-f0-9]{64}$/i.test(p.blockHash)||before.accountAddress!==account||!/^-?(?:0|[1-9]\d{0,30})$/.test(before.rawUsdAtomic6)||!Number.isFinite(stamp)||stamp>now)return cctpStageFail('CCTP_CORE_SCOPED_DEPOSIT_BASELINE_REQUIRED');
 const transport=d.transport??createCctpEvmReadTransport(d.fetcher);if(await transport.request('eth_chainId',[])!=='0x3e6')return cctpStageFail('CCTP_HYPEREVM_NETWORK_MISMATCH');
 if(!/^[1-9]\d*$/.test(p.blockNumber))return cctpStageFail('CCTP_CORE_DEPOSIT_BLOCK_REQUIRED');const block=await transport.request('eth_getBlockByNumber',[`0x${BigInt(p.blockNumber).toString(16)}`,false]) as {hash?:unknown;timestamp?:unknown},depositedAt=Number(cctpQuantity(block.timestamp))*1000;
 if(typeof block.hash!=='string'||block.hash.toLowerCase()!==p.blockHash.toLowerCase()||!Number.isSafeInteger(depositedAt)||depositedAt>now+1000||stamp>depositedAt||depositedAt-stamp>120000)return cctpStageFail('CCTP_CORE_DEPOSIT_BLOCK_BASELINE_MISMATCH');
 const fetcher=d.fetcher??fetch,[raw,after]=await Promise.all([info(TESTNET_INFO,{type:'userNonFundingLedgerUpdates',user:account,startTime:stamp,endTime:now},fetcher),readHyperCoreBaseline(r,d)]);
 const rows=z.array(z.object({time:z.number().int().positive().safe(),hash:z.string().regex(/^0x[a-f0-9]{64}$/i),delta:z.object({type:z.string(),usdc:rawUsd.optional()}).passthrough()}).passthrough()).max(499).parse(raw);
 const matching=rows.filter(row=>row.hash.toLowerCase()===p.depositTxHash.toLowerCase()&&row.delta.type==='deposit'&&row.delta.usdc!==undefined&&atomic6(row.delta.usdc)===amount&&row.time>=depositedAt&&row.time<=now+1000);
 if(matching.length!==1||rows.length!==1||after.accountAddress!==account||Date.parse(after.observedAt)<matching[0]!.time||BigInt(after.rawUsdAtomic6)-BigInt(before.rawUsdAtomic6)!==amount)return cctpStageFail('CCTP_MATCHING_HYPERCORE_LEDGER_CREDIT_REQUIRED');
 return{network:'hyperliquid-testnet',operationId:r.operationId,businessId:r.customer.businessId,customerId:r.customer.customerId,walletId:r.customer.walletId,accountAddress:account,depositTxHash:p.depositTxHash,amountAtomic6:amount.toString(),ledgerHash:matching[0]!.hash.toLowerCase() as Hex,balanceBeforeAtomic6:before.rawUsdAtomic6,balanceAfterAtomic6:after.rawUsdAtomic6,confirmed:true};
}
