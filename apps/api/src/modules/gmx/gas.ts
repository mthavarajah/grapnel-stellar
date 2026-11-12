import type {Pool,PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {GrapnelError,type CustomerContext} from '@grapnel/contracts';
import {createPublicClient,createWalletClient,http,keccak256,parseTransaction,recoverTransactionAddress,type Hex} from 'viem';
import {arbitrumSepolia} from 'viem/chains';
import {privateKeyToAccount} from 'viem/accounts';
import {transaction,lock} from '../../db/index.js';
const RPC='https://sepolia-rollup.arbitrum.io/rpc',AMOUNT=2_000_000_000_000_000n,GLOBAL_CAP=6_000_000_000_000_000n;
const unavailable=(reason:string):never=>{throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Trading gas is unavailable right now',false,{reason});};
/** A real, capped Testnet gas gift. It never signs for a customer or touches mainnet. */
export class GmxGasTreasury {
 private account;private read;private wallet;
 constructor(private pool:Pool,secret:Hex){this.account=privateKeyToAccount(secret);this.read=createPublicClient({chain:arbitrumSepolia,transport:http(RPC,{timeout:15000})});this.wallet=createWalletClient({account:this.account,chain:arbitrumSepolia,transport:http(RPC,{timeout:15000})});}
 private async load(c:CustomerContext,address:Hex,client:Pick<PoolClient,'query'>=this.pool){return (await client.query('SELECT * FROM gmx_gas_grants WHERE business_id=$1 AND customer_id=$2 AND wallet_id=$3 AND account_address=$4',[c.businessId,c.customerId,c.walletId,address.toLowerCase()])).rows[0]??null;}
 async status(c:CustomerContext,address:Hex){const row=await this.load(c,address);if(!row)return null;
  if(['prepared','sending','unknown'].includes(row.state)){try{
   if(await this.read.getChainId()!==421614)return unavailable('GMX_NETWORK_MISMATCH');
   const receipt=await this.read.getTransactionReceipt({hash:row.tx_hash}),tx=await this.read.getTransaction({hash:row.tx_hash}),block=await this.read.getBlock({blockNumber:receipt.blockNumber}),head=await this.read.getBlockNumber();
   if(head<receipt.blockNumber+1n||block.hash!==receipt.blockHash||tx.hash!==row.tx_hash||tx.from.toLowerCase()!==row.treasury_address||tx.to?.toLowerCase()!==row.account_address||tx.value!==BigInt(row.amount_wei)||tx.input!=='0x'||tx.chainId!==421614||tx.nonce!==Number(row.nonce))return unavailable('GMX_GAS_PROOF_INVALID');
   const proof={network:'arbitrum-sepolia',chain_id:421614,tx_hash:row.tx_hash,treasury:row.treasury_address,recipient:row.account_address,amount_wei:row.amount_wei.toString(),block_number:receipt.blockNumber.toString(),confirmed:receipt.status==='success'};
   await this.pool.query('UPDATE gmx_gas_grants SET state=$2,proof=$3,updated_at=now() WHERE id=$1',[row.id,receipt.status==='success'?'confirmed':'reverted',JSON.stringify(proof)]);row.state=receipt.status==='success'?'confirmed':'reverted';row.proof=proof;
  }catch{/* A timeout is not a new grant or proof of success. */}}
  return {state:row.state,tx_hash:row.tx_hash,proof:row.proof};
 }
 async grant(c:CustomerContext,address:Hex){
  if(!/^0x[0-9a-f]{40}$/i.test(address)||/^0x0{40}$/i.test(address))return unavailable('GMX_GAS_RECIPIENT_INVALID');
  if(await this.read.getChainId()!==421614)return unavailable('GMX_NETWORK_MISMATCH');
  const row=await transaction(this.pool,async client=>{
   await lock(client,'gmx:gas:global');await lock(client,`gmx:gas:${this.account.address.toLowerCase()}`);
   const current=await this.load(c,address,client);if(current)return current;
   if((await client.query('SELECT 1 FROM gmx_gas_grants WHERE account_address=$1',[address.toLowerCase()])).rowCount)return unavailable('GMX_GAS_ALREADY_GRANTED');
   const owned=(await client.query("SELECT id FROM wallets WHERE business_id=$1 AND customer_id=$2 AND id=$3 AND stellar_address=$4 AND status='active'",[c.businessId,c.customerId,c.walletId,c.walletAddress])).rowCount;if(owned!==1)return unavailable('GMX_GAS_WALLET_MISMATCH');
   const reserved=BigInt((await client.query("SELECT COALESCE(sum(amount_wei),0)::text AS amount FROM gmx_gas_grants WHERE state<>'reverted'")).rows[0].amount);
   if(reserved+AMOUNT>GLOBAL_CAP)return unavailable('GMX_GAS_DISTRIBUTION_LIMIT');
   const [balance,target,nonce,fees]=await Promise.all([this.read.getBalance({address:this.account.address}),this.read.getBalance({address}),this.read.getTransactionCount({address:this.account.address,blockTag:'pending'}),this.read.estimateFeesPerGas()]);
   if(target>=1_500_000_000_000_000n)return unavailable('GMX_GAS_ALREADY_SUFFICIENT');
   const estimate=await this.read.estimateGas({account:this.account.address,to:address,value:AMOUNT}),gas=(estimate*120n+99n)/100n,maxFeePerGas=fees.maxFeePerGas,maxPriorityFeePerGas=fees.maxPriorityFeePerGas;
   if(gas>100000n||maxFeePerGas>1000000000n||balance<AMOUNT+gas*maxFeePerGas)return unavailable('GMX_GAS_TREASURY_LOW');
   const request={chainId:421614,type:'eip1559' as const,to:address,value:AMOUNT,nonce,gas,maxFeePerGas,maxPriorityFeePerGas};
   const raw=await this.wallet.signTransaction(request),hash=keccak256(raw),signer=await recoverTransactionAddress({serializedTransaction:raw}),parsed=parseTransaction(raw);
   if(signer.toLowerCase()!==this.account.address.toLowerCase()||parsed.chainId!==421614||parsed.to?.toLowerCase()!==address.toLowerCase()||parsed.value!==AMOUNT||parsed.data&&parsed.data!=='0x')return unavailable('GMX_GAS_SIGNATURE_INVALID');
   const id=randomUUID();await client.query("INSERT INTO gmx_gas_grants(id,business_id,customer_id,wallet_id,account_address,treasury_address,nonce,amount_wei,signed_transaction,tx_hash,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'prepared')",[id,c.businessId,c.customerId,c.walletId,address.toLowerCase(),this.account.address.toLowerCase(),nonce,AMOUNT.toString(),raw,hash]);return await this.load(c,address,client);
  });
  const claim=await this.pool.query("UPDATE gmx_gas_grants SET state='sending',send_claimed_at=now(),updated_at=now() WHERE id=$1 AND send_claimed_at IS NULL AND state='prepared' RETURNING id",[row.id]);
  if(claim.rowCount===1){try{const sent=await this.wallet.sendRawTransaction({serializedTransaction:row.signed_transaction});if(sent!==row.tx_hash)return unavailable('GMX_GAS_HASH_MISMATCH');}finally{await this.pool.query("UPDATE gmx_gas_grants SET state='unknown',updated_at=now() WHERE id=$1 AND state='sending'",[row.id]);}}
  return this.status(c,address);
 }
}
