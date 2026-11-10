import '../apps/api/src/lib/env.js';
import { createPool,transaction } from '../apps/api/src/db/index.js';
import { MODULE_IDS } from '../packages/contracts/src/index.js';
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required');
if(process.env.STELLAR_NETWORK!=='testnet')throw new Error('Testnet configuration required');
const pool=createPool(process.env.DATABASE_URL);
const id='00000000-0000-4000-8000-000000000001';
try{
 await transaction(pool,async client=>{
  await client.query("INSERT INTO businesses(id,name,environment) VALUES($1,'Demo Fintech','stellar-testnet') ON CONFLICT(id) DO NOTHING",[id]);
  for(const module of MODULE_IDS)await client.query('INSERT INTO business_modules(business_id,module_code,enabled) VALUES($1,$2,false) ON CONFLICT(business_id,module_code) DO NOTHING',[id,module]);
 });
 console.log('Demo tenant ensured. Existing entitlements retained; no keys, balances or operations generated.');
}finally{await pool.end();}
