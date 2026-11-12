import {z} from 'zod';
import {HL_INFO,HL_RPC} from '../execution/types.js';
import {freshReceipt,units,normalize,decimal,signedDecimal} from '../execution/guards.js';
import {network,market,position} from '../execution/reads.js';
import type {HyperliquidExecutionDependencies} from '../execution/types.js';
import type {ApprovedPerpetualIntent} from '../../../modules/perpetuals/execution-contract.js';
import {fail,subaccountName} from './guards.js';
import type {HyperliquidSolverDependencies,SolverSnapshot,SolverWallet} from './types.js';
export function readPort(d:HyperliquidSolverDependencies,wallet:SolverWallet):HyperliquidExecutionDependencies{
 return {scope:{businessId:wallet.businessId,customerId:wallet.customerId,walletId:wallet.identityWalletId,stellarAddress:wallet.freighterAddress,accountAddress:wallet.subAccountAddress??wallet.masterAddress,signingKeyRef:'solver-read-only'},transport:d.transport,now:d.now,durability:{reserveIntent:async()=>false,loadPrepared:async()=>null,claimSend:async()=>false}};
}
export async function verifyNetwork(d:HyperliquidSolverDependencies){await network(readPort(d,d.scope));}
export async function info(d:HyperliquidSolverDependencies,request:Record<string,unknown>){
 const q=structuredClone(request);return freshReceipt(await d.transport.info(HL_INFO,structuredClone(q)),HL_INFO,q,d.now?.()??Date.now());
}
const accounts=z.array(z.object({name:z.string().min(1).max(16),subAccountUser:z.string().regex(/^0x[a-fA-F0-9]{40}$/),master:z.string().regex(/^0x[a-fA-F0-9]{40}$/)}).passthrough()).max(10000).nullable();
export async function subaccounts(d:HyperliquidSolverDependencies,wallet:SolverWallet){
 const result=accounts.parse(await info(d,{type:'subAccounts',user:wallet.masterAddress}))??[];
 if(result.some(row=>row.master.toLowerCase()!==wallet.masterAddress)||new Set(result.map(row=>row.subAccountUser.toLowerCase())).size!==result.length||new Set(result.map(row=>row.name)).size!==result.length)return fail('EXACT_MASTER_SUBACCOUNT_LIST_REQUIRED');return result;
}
export async function ownership(d:HyperliquidSolverDependencies,wallet:SolverWallet){
 if(!wallet.subAccountAddress)return fail('VERIFIED_CUSTOMER_SUBACCOUNT_REQUIRED');
 const rows=await subaccounts(d,wallet),owned=rows.find(row=>row.subAccountUser.toLowerCase()===wallet.subAccountAddress);
 if(!owned||owned.name!==subaccountName(wallet))return fail('SUBACCOUNT_OWNERSHIP_OR_SCOPED_NAME');return owned;
}
const state=z.object({time:z.number().int().positive().safe(),withdrawable:decimal,marginSummary:z.object({accountValue:signedDecimal,totalRawUsd:signedDecimal}).passthrough(),assetPositions:z.array(z.object({type:z.literal('oneWay'),position:z.object({coin:z.string(),szi:signedDecimal,leverage:z.object({type:z.enum(['cross','isolated']),value:z.number().int().positive()}).passthrough()}).passthrough()}).passthrough()).max(10000)}).passthrough();
export async function snapshot(d:HyperliquidSolverDependencies,user:`0x${string}`,dex='' ):Promise<SolverSnapshot>{
 const result=state.parse(await info(d,{type:'clearinghouseState',user,...dex?{dex}:{}})),now=d.now?.()??Date.now();
 if(result.time>now+1000||now-result.time>5000||new Set(result.assetPositions.map(row=>row.position.coin)).size!==result.assetPositions.length)return fail('FRESH_UNIQUE_ACCOUNT_POSITIONS_REQUIRED');
 return{accountValue:normalize(result.marginSummary.accountValue),cashBalance:normalize(result.marginSummary.totalRawUsd),withdrawable:normalize(result.withdrawable),time:result.time,positions:result.assetPositions.map(row=>({coin:row.position.coin,size:normalize(row.position.szi),leverage:row.position.leverage.value,leverageType:row.position.leverage.type}))};
}
export async function masterLiquidity(d:HyperliquidSolverDependencies,wallet:SolverWallet){
 const role=z.object({role:z.literal('user')}).passthrough().safeParse(await info(d,{type:'userRole',user:wallet.masterAddress}));
 if(!role.success)return fail('ACTUAL_MASTER_USER_ACCOUNT_REQUIRED');return snapshot(d,wallet.masterAddress);
}
export function readOrderContext(d:HyperliquidSolverDependencies,wallet:SolverWallet,i:ApprovedPerpetualIntent){return Promise.all([market(readPort(d,wallet),i),position(readPort(d,wallet),i)]);}
export const cash=(value:string)=>units(value,18,true);
