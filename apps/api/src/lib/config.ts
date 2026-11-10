import { NETWORK_PASSPHRASE, GrapnelError } from '@grapnel/contracts';
export interface ApiConfig {
 databaseUrl:string; network:'testnet'; networkPassphrase:typeof NETWORK_PASSPHRASE;
 dashboardOrigin:string; fintechOrigin:string; adminLoginSecret:string; sessionSecret:string;
 production:boolean; port:number; demoBusinessId:string;
}
export function loadConfig(env:NodeJS.ProcessEnv=process.env):ApiConfig {
 if(env.STELLAR_NETWORK!=='testnet' || env.STELLAR_NETWORK_PASSPHRASE!==NETWORK_PASSPHRASE) throw new GrapnelError(400,'NETWORK_MISMATCH','Explicit Stellar Testnet configuration is required');
 if(!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
 if(!env.SESSION_SECRET || env.SESSION_SECRET.length<32) throw new Error('SESSION_SECRET must contain at least 32 characters');
 if(!env.ADMIN_LOGIN_SECRET || env.ADMIN_LOGIN_SECRET.length<16) throw new Error('ADMIN_LOGIN_SECRET must contain at least 16 characters');
 const dashboardOrigin = new URL(env.DASHBOARD_ORIGIN??'http://localhost:3000').origin;
 const fintechOrigin = new URL(env.FINTECH_ORIGIN??'http://localhost:3002').origin;
 return {databaseUrl:env.DATABASE_URL,network:'testnet',networkPassphrase:NETWORK_PASSPHRASE,dashboardOrigin,fintechOrigin,adminLoginSecret:env.ADMIN_LOGIN_SECRET,sessionSecret:env.SESSION_SECRET,production:env.NODE_ENV==='production',port:Number(env.PORT??3001),demoBusinessId:env.DEMO_BUSINESS_ID??'00000000-0000-4000-8000-000000000001'};
}
