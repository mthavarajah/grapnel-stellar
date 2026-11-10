import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { transaction } from '../../db/index.js';
import { OperationService, type ReconciliationResult } from './service.js';
export interface WorkerChain {
 lookup(txHash:string):Promise<ReconciliationResult&{found:boolean}>;
 broadcast(signedXdr:string):Promise<{txHash:string}>;
 verifyDeltas(operationId:string,txHash:string):Promise<boolean>;
}
export class OperationWorker {
 readonly owner=randomUUID();readonly operations:OperationService;
 constructor(readonly pool:Pool,readonly chain:WorkerChain){this.operations=new OperationService(pool);}
 async tick():Promise<boolean>{
  const job=await transaction(this.pool,async client=>{
   const row=(await client.query("SELECT j.* FROM worker_jobs j WHERE (j.state='pending' OR (j.state='in_progress' AND j.lease_until<now())) AND j.next_attempt_at<=now() ORDER BY j.next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];
   if(!row)return undefined;
   await client.query("UPDATE worker_jobs SET state='in_progress',lease_owner=$2,lease_until=now()+interval '60 seconds',attempts=attempts+1 WHERE id=$1",[row.id,this.owner]);return row;
  });
  if(!job)return false;
  try{
   const op=(await this.pool.query('SELECT * FROM operations WHERE id=$1',[job.operation_id])).rows[0];
   if(!op || ['completed','failed','rejected','expired'].includes(op.state)){await this.finish(job.id);return true;}
   if(!op.tx_hash){await this.recovery(job.id,op.id);return true;}
   const observed=await this.chain.lookup(op.tx_hash);
   if(observed.found){
    if(observed.state==='completed')observed.deltaVerified=await this.chain.verifyDeltas(op.id,op.tx_hash);
    await this.operations.recordReconciliation(op.business_id,op.id,observed);
    if(observed.state==='failed' || observed.state==='completed'&&observed.deltaVerified)await this.finish(job.id);else await this.requeue(job.id,job.attempts);
    return true;
   }
   const attempts=await this.pool.query('SELECT 1 FROM operation_attempts WHERE business_id=$1 AND operation_id=$2',[op.business_id,op.id]);
   // Unknown ledger status after a previous network attempt requires review; do not generate or broadcast a replacement.
   if(attempts.rowCount){
    // Ledger ingestion can lag a successful send. Poll the same hash without a second broadcast.
    if(Date.now()-new Date(op.updated_at).getTime()<180000){await this.requeue(job.id,job.attempts);return true;}
    await this.recovery(job.id,op.id);return true;
   }
   if(job.job_type!=='broadcast' || !op.signed_xdr){await this.recovery(job.id,op.id);return true;}
   await transaction(this.pool,async client=>{
    await client.query("UPDATE operations SET state='submitted',updated_at=now() WHERE id=$1",[op.id]);
    await client.query('INSERT INTO operation_attempts(operation_id,business_id,attempt_no,provider,tx_hash) VALUES($1,$2,1,$3,$4)',[op.id,op.business_id,op.provider,op.tx_hash]);
   });
   const sent=await this.chain.broadcast(op.signed_xdr);
   if(sent.txHash!==op.tx_hash){await this.recovery(job.id,op.id);return true;}
   await this.pool.query("UPDATE operations SET state='confirming',updated_at=now() WHERE id=$1",[op.id]);
   await this.requeue(job.id,job.attempts);
  }catch{
   // Preserve hash, envelope, reservation and attempt record for recovery by hash.
   await this.requeue(job.id,job.attempts);
  }
  return true;
 }
 private async finish(id:string){await this.pool.query("UPDATE worker_jobs SET state='completed',lease_owner=NULL,lease_until=NULL WHERE id=$1 AND lease_owner=$2",[id,this.owner]);}
 private async recovery(id:string,operationId:string){await transaction(this.pool,async client=>{await client.query("UPDATE operations SET state='recovery_required',error_code='SUBMISSION_UNCERTAIN',error_message='Reconcile the stored transaction hash before any further send',updated_at=now() WHERE id=$1",[operationId]);await client.query("UPDATE worker_jobs SET state='recovery_required',lease_owner=NULL,lease_until=NULL WHERE id=$1 AND lease_owner=$2",[id,this.owner]);});}
 private async requeue(id:string,attempt:number){await this.pool.query("UPDATE worker_jobs SET state='pending',lease_owner=NULL,lease_until=NULL,next_attempt_at=now()+($3 * interval '1 second') WHERE id=$1 AND lease_owner=$2",[id,this.owner,Math.min(60,2**Math.min(attempt+1,6))]);}
}
