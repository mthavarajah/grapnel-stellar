import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { requireOwner, success } from '../../lib/context.js';

/** Owner-only, tenant-scoped Stellar transaction metadata. Never expose signing payloads. */
export async function registerDashboardActivity(app: FastifyInstance, pool: Pool) {
 app.get('/v1/dashboard/activity', async request => {
  const owner = await requireOwner(request);
  const { before, before_id } = z.object({before:z.string().datetime().optional(),before_id:z.string().uuid().optional()})
   .strict().refine(q=>Boolean(q.before)===Boolean(q.before_id),'Both cursor fields are required').parse(request.query);
  const rows = (await pool.query(`SELECT o.id AS operation_id,o.customer_id,c.external_customer_id,
   w.stellar_address AS wallet_address,o.type AS action,o.state AS status,o.provider,o.tx_hash,
   o.created_at,o.updated_at,to_char(o.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at,o.request_json->>'amount' AS amount,o.request_json->>'asset_id' AS asset_id
   FROM operations o
   JOIN customers c ON c.business_id=o.business_id AND c.id=o.customer_id
   JOIN wallets w ON w.business_id=o.business_id AND w.customer_id=o.customer_id AND w.id=o.wallet_id
   WHERE o.business_id=$1 AND o.network='stellar-testnet' AND o.tx_hash ~ '^[0-9a-fA-F]{64}$'
   AND ($2::timestamptz IS NULL OR (o.created_at,o.id)<($2::timestamptz,$3::uuid))
   ORDER BY o.created_at DESC,o.id DESC LIMIT 51`,[owner.businessId,before??null,before_id??null])).rows;
  const page = rows.slice(0,50);
  const activities = page.map(({cursor_created_at,...row})=>row);
  const last = page.at(-1);
  return success(request,{activities,next_cursor:rows.length>50&&last?{before:last.cursor_created_at,before_id:last.operation_id}:null});
 });
}
