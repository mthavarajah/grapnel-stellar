import pg, { type Pool, type PoolClient } from 'pg';
export const createPool=(connectionString:string)=>new pg.Pool({connectionString,max:10,connectionTimeoutMillis:5000,idleTimeoutMillis:30000});
export async function transaction<T>(pool:Pool,work:(client:PoolClient)=>Promise<T>):Promise<T>{
 const client=await pool.connect();
 try{await client.query('BEGIN');const result=await work(client);await client.query('COMMIT');return result;}
 catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export async function lock(client:PoolClient,key:string):Promise<void>{await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[key]);}
