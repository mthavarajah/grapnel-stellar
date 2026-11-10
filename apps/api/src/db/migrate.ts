import '../lib/env.js';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPool, lock, transaction } from './index.js';
import type { Pool } from 'pg';
export async function migrate(pool:Pool):Promise<void>{
 const dir=new URL('./migrations/',import.meta.url);
 await transaction(pool,async client=>{
  await lock(client,'grapnel:migrations');
  await client.query('CREATE TABLE IF NOT EXISTS grapnel_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  for(const name of (await readdir(dir)).filter(n=>n.endsWith('.sql')).sort()){
   if((await client.query('SELECT 1 FROM grapnel_migrations WHERE name=$1',[name])).rowCount)continue;
   await client.query(await readFile(new URL(name,dir),'utf8'));
   await client.query('INSERT INTO grapnel_migrations(name) VALUES($1)',[name]);
  }
 });
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
 const pool=createPool(process.env.DATABASE_URL);try{await migrate(pool);console.log('Database migrations applied');}finally{await pool.end();}
}
