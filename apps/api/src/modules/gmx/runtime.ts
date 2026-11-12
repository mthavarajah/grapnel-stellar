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
 const adapter=createGmxTestnetAdapter(),read=createPublicClient({chain:arbitrumSepolia,transport:http(GMX_TESTNET.rpc,{timeout:15000})});
 const secret=process.env.GMX_TESTNET_GAS_TREASURY_SECRET,gas=secret&&/^0x[0-9a-f]{64}$/i.test(secret)?new GmxGasTreasury(d.pool,secret as Hex):null;
 async function customer(scope:GmxScope,client:PoolClient):Promise<CustomerContext>{const row=(await client.query("SELECT c.privy_user_id FROM customers c JOIN wallets w ON w.business_id=c.business_id AND w.customer_id=c.id WHERE c.business_id=$1 AND c.id=$2 AND w.id=$3 AND w.stellar_address=$4 AND w.status='active'",[scope.businessId,scope.customerId,scope.walletId,scope.stellarAddress])).rows[0];if(typeof row?.privy_user_id!=='string')return fail();return {...scope,walletAddress:scope.stellarAddress,privyUserId:row.privy_user_id};}
 const store=new PgGmxRequestStore(d.pool,{
  verifyAccount:async(scope,address,client)=>(await d.readWallets(await customer(scope,client))).some(w=>w.address.toLowerCase()===address),
  verifySigned:(r,raw)=>adapter.verifySigned(r.prepared,raw),
  verifyCreation:(r,p)=>adapter.confirmTransaction(r.prepared,'creationTxHash'in p?p.creationTxHash:p.txHash),
  verifySettlement:(r)=>{if(!r.creationProof||!('orderKey'in r.creationProof))return fail();return adapter.reconcileOrder(r.prepared,r.creationProof);},
 });
 let lastAt=0,last=false;
 const acceptance=async(symbol?:string)=>{
  if(symbol && symbol!=='ETH')return false;
  if(Date.now()-lastAt<30000)return last;
  lastAt=Date.now();last=false;
  try{const p=JSON.parse(fs.readFileSync(new URL('../../../../../evidence/gmx-own-roundtrip.json',import.meta.url),'utf8'));
   if(p.steps?.open?.prepared?.intent?.symbol!=='ETH')return false;
   last=await verifyGmxEventRoundtrip(p);return last;
  }catch{return false;}
 };
 const service=new GmxCustomerService({adapter,store,readWallets:d.readWallets,acceptance,gasStatus:gas?(c,a)=>gas.status(c,a):undefined,sendRaw:async raw=>{
  if(await read.getChainId()!==421614)throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Trading network mismatch');await adapter.verifyRegistry();return read.sendRawTransaction({serializedTransaction:raw});
 }});
 return {adapter,store,service,gas,acceptance};
}
