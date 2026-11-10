import type { Pool } from 'pg';
import { XLM } from '@grapnel/contracts';
import type { StellarTestnetExecutor } from '../../adapters/stellar/index.js';

export interface TransferProof {txHash:string;source:string;recipient:string;amountAtomic:bigint;}
/** Successful transaction inclusion alone does not establish the direction, asset or amount. */
export async function verifyNativeTransfer(chain:StellarTestnetExecutor,proof:TransferProof):Promise<boolean> {
 if(!/^[a-f0-9]{64}$/.test(proof.txHash)||proof.amountAtomic<=0n)return false;
 try{
  await chain.verifyLiveNetwork();
  const tx=await chain.horizon.transactions().transaction(proof.txHash).call();
  if(!tx.successful||tx.source_account!==proof.source)return false;
  const effects=await chain.horizon.effects().forTransaction(proof.txHash).limit(200).call();
  const amount=(value:string)=>{const [whole,fraction='']=value.split('.');return /^\d+$/.test(whole!)&&/^\d{0,7}$/.test(fraction)?BigInt(whole!)*10000000n+BigInt(fraction.padEnd(7,'0')||'0'):-1n;};
  const credited=effects.records.some(e=>e.type==='account_credited'&&e.account===proof.recipient&&e.asset_type==='native'&&amount(e.amount)===proof.amountAtomic);
  const debited=effects.records.some(e=>e.type==='account_debited'&&e.account===proof.source&&e.asset_type==='native'&&amount(e.amount)===proof.amountAtomic);
  return credited&&debited;
 }catch{return false;}
}
export async function hasFundingRoundTripProof(pool:Pool,treasuryAddress:string,verify:(proof:TransferProof)=>Promise<boolean>):Promise<boolean>{
 const rows=(await pool.query(`SELECT DISTINCT ON(t.direction) t.direction,t.tx_hash,t.amount_atomic::text,w.stellar_address
  FROM testnet_funding_transfers t
  JOIN operations o ON o.business_id=t.business_id AND o.id=t.operation_id
  JOIN wallets w ON w.business_id=t.business_id AND w.customer_id=t.customer_id AND w.id=t.wallet_id
  WHERE t.treasury_address=$1 AND t.asset_id=$2 AND t.status='completed' AND o.state='completed'
   AND t.tx_hash=o.tx_hash AND o.network='stellar-testnet'
  ORDER BY t.direction,t.created_at DESC`,[treasuryAddress,XLM.id])).rows;
 if(!['fund','return'].every(direction=>rows.some(r=>r.direction===direction)))return false;
 const checks=await Promise.allSettled(rows.map(row=>verify({txHash:row.tx_hash,source:row.direction==='fund'?treasuryAddress:row.stellar_address,recipient:row.direction==='fund'?row.stellar_address:treasuryAddress,amountAtomic:BigInt(row.amount_atomic)})));
 return checks.every(result=>result.status==='fulfilled'&&result.value===true);
}
