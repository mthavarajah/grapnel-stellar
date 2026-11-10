import type { PoolClient } from 'pg';
import { GrapnelError, XLM, type CustomerContext, type Operation, type PreparedAction } from '@grapnel/contracts';
import { TestnetFundingAdapter } from '../../adapters/testnet-funding/index.js';

interface OperationCreateInput {
  businessId:string;customerId:string;walletId:string;module:'capital.testnet_funding';type:string;
  provider:string;route:string;idempotencyKey:string;request:Record<string,unknown>;
}
/** Implemented by the shared durable OperationService; never use an in-memory implementation in production. */
export interface FundingOperationStore {
  createIdempotent(input: OperationCreateInput, prepare: (client:PoolClient,operationId:string)=>Promise<void>):Promise<{operation:Operation;created:boolean}>;
  setPrepared(client:PoolClient,businessId:string,operationId:string,action:PreparedAction):Promise<void>;
}
export interface FundingRequest {customer_id:string;wallet_id:string;asset_id:string;amount:string;}
const lock = async (client:PoolClient,key:string):Promise<void> => {await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[key]);};

export class FundingService {
  constructor(readonly adapter:TestnetFundingAdapter, private readonly operations:FundingOperationStore) {}
  async create(direction:'fund'|'return', request:FundingRequest, customer:CustomerContext, idempotencyKey:string):Promise<{operation:Operation;created:boolean}> {
    if (request.customer_id !== customer.customerId || request.wallet_id !== customer.walletId) throw new GrapnelError(404,'NOT_FOUND','Customer wallet not found');
    this.adapter.assertExecutionReady();this.adapter.assertAsset(request.asset_id);
    const amount = this.adapter.parseAmount(request.amount);
    if (!idempotencyKey || idempotencyKey.length>200) throw new GrapnelError(400,'IDEMPOTENCY_KEY_REQUIRED','A bounded Idempotency-Key is required');
    return this.operations.createIdempotent({businessId:customer.businessId,customerId:customer.customerId,walletId:customer.walletId,module:'capital.testnet_funding',type:`testnet.${direction}`,provider:'stellar_testnet_treasury',route:`/v1/capital/testnet/${direction}`,idempotencyKey,request:{...request}},async (client,operationId)=>{
      // One global lock serializes cumulative quotas across API keys, tenants and assets.
      await lock(client,'funding:global');
      await lock(client,`treasury:${this.adapter.treasuryAddress}`);
      await lock(client,`wallet:${customer.businessId}:${customer.walletId}:${XLM.id}`);
      const ownership = await client.query('SELECT w.id FROM wallets w JOIN customers c ON c.business_id=w.business_id AND c.id=w.customer_id WHERE w.business_id=$1 AND w.customer_id=$2 AND w.id=$3 AND w.stellar_address=$4 AND c.privy_user_id=$5 FOR UPDATE OF w',[customer.businessId,customer.customerId,customer.walletId,customer.walletAddress,customer.privyUserId]);
      if (!ownership.rowCount) throw new GrapnelError(404,'NOT_FOUND','Customer wallet not found');
      if (direction === 'fund') {
        const totals = await client.query(`SELECT COALESCE(sum(t.amount_atomic),0)::text AS global,
          COALESCE(sum(t.amount_atomic) FILTER(WHERE t.business_id=$1),0)::text AS tenant,
          COALESCE(sum(t.amount_atomic) FILTER(WHERE c.privy_user_id=$2),0)::text AS customer
          FROM testnet_funding_transfers t JOIN customers c ON c.id=t.customer_id AND c.business_id=t.business_id
          WHERE t.direction='fund' AND t.asset_id=$3 AND t.status NOT IN ('failed','rejected')`,[customer.businessId,customer.privyUserId,XLM.id]);
        for (const scope of ['global','tenant','customer'] as const) {
          if (BigInt(totals.rows[0][scope])+amount>this.adapter.limits[scope]) throw new GrapnelError(429,'TESTNET_FUNDING_LIMIT',`Cumulative ${scope} Testnet grant cap exceeded`);
        }
        // Avoid constructing two envelopes with the same treasury sequence. Uncertain transfers keep this lockout until reconciliation.
        const pending = await client.query("SELECT t.id FROM testnet_funding_transfers t JOIN operations o ON o.id=t.operation_id WHERE t.treasury_address=$1 AND t.direction='fund' AND o.state NOT IN ('completed','failed','rejected') LIMIT 1",[this.adapter.treasuryAddress]);
        if (pending.rowCount) throw new GrapnelError(409,'TREASURY_BUSY','An earlier treasury transaction awaits reconciliation',true);
        const prepared = await this.adapter.prepareFund({assetId:request.asset_id,amount:request.amount,customer,reservedTreasuryAtomic:0n});
        await client.query("UPDATE operations SET state='preparing',signed_xdr=$3,tx_hash=$4,result_json=$5,updated_at=now() WHERE business_id=$1 AND id=$2",[customer.businessId,operationId,prepared.signedXdr,prepared.txHash,JSON.stringify({recipient:prepared.recipient,asset_id:XLM.id,amount_atomic:amount.toString(),before_recipient_atomic:prepared.beforeRecipientAtomic.toString(),expires_at:prepared.expiresAt})]);
        await client.query("INSERT INTO worker_jobs(operation_id,job_type) VALUES($1,'broadcast')",[operationId]);
      } else {
        const reservations = await client.query("SELECT COALESCE(sum(amount_atomic),0)::text AS amount FROM balance_reservations WHERE business_id=$1 AND wallet_id=$2 AND asset_id=$3 AND state='active'",[customer.businessId,customer.walletId,XLM.id]);
        const prepared = await this.adapter.prepareReturn({operationId,assetId:request.asset_id,amount:request.amount,customer,reservedCustomerAtomic:BigInt(reservations.rows[0].amount)});
        await this.operations.setPrepared(client,customer.businessId,operationId,prepared);
        // Include the maximum fee in reservations; native reserve/liabilities were excluded from the authoritative snapshot.
        await client.query("INSERT INTO balance_reservations(business_id,customer_id,wallet_id,asset_id,operation_id,amount_atomic,state,expires_at) VALUES($1,$2,$3,$4,$5,$6,'active',$7)",[customer.businessId,customer.customerId,customer.walletId,XLM.id,operationId,(amount+this.adapter.maxFee).toString(),prepared.summary.expiresAt]);
      }
      await client.query("INSERT INTO testnet_funding_transfers(business_id,customer_id,wallet_id,operation_id,direction,asset_id,amount_atomic,treasury_address,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",[customer.businessId,customer.customerId,customer.walletId,operationId,direction,XLM.id,amount.toString(),this.adapter.treasuryAddress,direction==='fund'?'preparing':'awaiting_customer_authorization']);
    });
  }
}
