import fs from 'node:fs';
import type {Pool,PoolClient} from 'pg';
import {GrapnelError,type CustomerContext} from '@grapnel/contracts';
import {createPublicClient,http,type Hex} from 'viem';
import {arbitrumSepolia} from 'viem/chains';
import {createGmxTestnetAdapter,GMX_TESTNET} from '../../adapters/gmx/index.js';
import {PgGmxRequestStore} from './persistence.js';
import {GmxCustomerService} from './service.js';
import {GmxGasTreasury} from './gas.js';
import type {GmxScope} from './contracts.js';
import {verifyGmxEventRoundtrip} from './acceptance.js';
const fail=():never=>{throw new GrapnelError(403,'WALLET_OWNERSHIP_INVALID','Your current trading wallet could not be verified');};
export function createGmxRuntime(d:{pool:Pool;readWallets:(c:CustomerContext)=>Promise<{address:string}[]>}){
 const adapter=createGmxTestnetAdapter({tokenConfirmationMode:'events'}),read=createPublicClient({chain:arbitrumSepolia,transport:http(GMX_TESTNET.rpc,{timeout:15000})});
 const secret=process.env.GMX_TESTNET_GAS_TREASURY_SECRET,gas=secret&&/^0x[0-9a-f]{64}$/i.test(secret)?new GmxGasTreasury(d.pool,secret as Hex):null;
 async function customer(scope:GmxScope,client:PoolClient):Promise<CustomerContext>{const row=(await client.query("SELECT c.privy_user_id FROM customers c JOIN wallets w ON w.business_id=c.business_id AND w.customer_id=c.id WHERE c.business_id=$1 AND c.id=$2 AND w.id=$3 AND w.stellar_address=$4 AND w.status='active'",[scope.businessId,scope.customerId,scope.walletId,scope.stellarAddress])).rows[0];if(typeof row?.privy_user_id!=='string')return fail();return {...scope,walletAddress:scope.stellarAddress,privyUserId:row.privy_user_id};}
 const store=new PgGmxRequestStore(d.pool,{
  verifyAccount:async(scope,address,client)=>(await d.readWallets(await customer(scope,client))).some(w=>w.address.toLowerCase()===address),
  verifySigned:(r,raw)=>adapter.verifySigned(r.prepared,raw),
  verifyCreation:(r,p)=>adapter.confirmTransaction(r.prepared,'creationTxHash'in p?p.creationTxHash:p.txHash),
  verifySettlement:(r)=>{if(!r.creationProof||!('orderKey'in r.creationProof))return fail();return adapter.reconcileOrder(r.prepared,r.creationProof);},
 });
 const readiness=new Map<string,{at:number;value:boolean}>();
 const acceptance=async(symbol?:string)=>{
  const selected=symbol??'ETH';if(!Object.hasOwn(GMX_TESTNET.markets,selected))return false;
  const cached=readiness.get(selected);if(cached&&Date.now()-cached.at<30000)return cached.value;
  try{const file=selected==='ETH'?'gmx-own-roundtrip.json':`gmx-${selected.toLowerCase()}-roundtrip.json`;const p=JSON.parse(fs.readFileSync(new URL('../../../../../evidence/'+file,import.meta.url),'utf8'));
   if(p.steps?.open?.prepared?.intent?.symbol!==selected)return false;
   const value=await verifyGmxEventRoundtrip(p);readiness.set(selected,{at:Date.now(),value});return value;
  }catch{return false;}
 };
 const service=new GmxCustomerService({adapter,store,readWallets:d.readWallets,acceptance,gasStatus:gas?(c,a)=>gas.status(c,a):undefined,sendRaw:async raw=>{
  if(await read.getChainId()!==421614)throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Trading network mismatch');await adapter.verifyRegistry();return read.sendRawTransaction({serializedTransaction:raw});
 }});
 const reconcilePending=async()=>{
  const rows=(await d.pool.query(`SELECT r.id,r.business_id,r.customer_id,r.wallet_id,r.stellar_address,c.privy_user_id FROM gmx_customer_requests r JOIN customers c ON c.business_id=r.business_id AND c.id=r.customer_id JOIN wallets w ON w.business_id=r.business_id AND w.customer_id=r.customer_id AND w.id=r.wallet_id AND w.stellar_address=r.stellar_address AND w.status='active' WHERE r.tx_hash IS NOT NULL AND r.send_claimed_at IS NOT NULL AND r.state IN ('sending','confirming','unknown') ORDER BY r.created_at LIMIT 5`)).rows;
  await Promise.allSettled(rows.map(r=>service.get({businessId:r.business_id,customerId:r.customer_id,walletId:r.wallet_id,walletAddress:r.stellar_address,privyUserId:r.privy_user_id},r.id)));
 };
 return {adapter,store,service,gas,acceptance,reconcilePending};
}
