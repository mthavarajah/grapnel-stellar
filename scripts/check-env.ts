import '../apps/api/src/lib/env.js';
import { NETWORK_PASSPHRASE } from '../packages/contracts/src/index.js';
export function validateEnvironment(env:Record<string,string|undefined>,production=env.NODE_ENV==='production'):string[]{
 const errors:string[]=[];
 if(env.STELLAR_NETWORK!=='testnet'||env.STELLAR_NETWORK_PASSPHRASE!==NETWORK_PASSPHRASE)errors.push('Explicit Stellar Testnet network/passphrase required');
 for(const [name,expected] of [['STELLAR_HORIZON_URL','https://horizon-testnet.stellar.org'],['STELLAR_RPC_URL','https://soroban-testnet.stellar.org']])if(env[name] && env[name]!==expected)errors.push(`${name} must use the reviewed official Testnet endpoint`);
 if(!env.DATABASE_URL)errors.push('DATABASE_URL required');
 if((env.ADMIN_LOGIN_SECRET?.length??0)<16)errors.push('ADMIN_LOGIN_SECRET must contain at least 16 characters');
 if((env.SESSION_SECRET?.length??0)<32)errors.push('SESSION_SECRET must contain at least 32 characters');
 for(const name of Object.keys(env))if(name.startsWith('NEXT_PUBLIC_')&&/(SECRET|API_KEY|DATABASE|TOKEN|PASSWORD)/.test(name))errors.push(`${name} must never be public`);
 if(production)for(const name of ['DASHBOARD_ORIGIN','FINTECH_ORIGIN']){
  try{if(new URL(env[name]??'').protocol!=='https:')errors.push(`${name} must use HTTPS`);}catch{errors.push(`${name} required`);}
 }
 return errors;
}
if(import.meta.url===new URL(process.argv[1]??'', 'file:').href){const errors=validateEnvironment(process.env);if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}else console.log('Server environment validation passed; values withheld.');}
