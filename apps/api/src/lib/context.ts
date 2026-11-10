import { GrapnelError, NETWORK, type CustomerContext, type IdentityVerifier, type ModuleId, type VerifiedIdentity } from '@grapnel/contracts';
import type { FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { ApiConfig } from './config.js';
import { constantEqual, csrfToken, digest } from './crypto.js';
export interface BusinessContext {businessId:string;apiKeyId:string;}
export interface OwnerContext {businessId:string;token:string;csrfToken:string;}
export interface RequestServices {pool:Pool;config:ApiConfig;identityVerifier:IdentityVerifier;}
declare module 'fastify' {interface FastifyRequest {businessContext?:BusinessContext;ownerContext?:OwnerContext;grapnel:RequestServices;}}
export const success=(request:FastifyRequest,data:unknown)=>({data,meta:{request_id:request.id,network:NETWORK,as_of:new Date().toISOString()}});
export async function requireBusiness(request:FastifyRequest,module?:ModuleId):Promise<BusinessContext>{
 if(!request.businessContext){
  const auth=request.headers.authorization;
  if(!auth?.startsWith('Bearer gr_test_'))throw new GrapnelError(401,'INVALID_API_KEY','A valid business API key is required');
  const result=await request.grapnel.pool.query('UPDATE api_keys SET last_used_at=now() WHERE key_hash=$1 AND revoked_at IS NULL RETURNING id,business_id',[digest(auth.slice(7))]);
  const key=result.rows[0]; if(!key)throw new GrapnelError(401,'INVALID_API_KEY','Invalid or revoked business API key');
  request.businessContext={businessId:key.business_id,apiKeyId:key.id};
 }
 if(module){
  const result=await request.grapnel.pool.query('SELECT enabled FROM business_modules WHERE business_id=$1 AND module_code=$2',[request.businessContext.businessId,module]);
  if(!result.rows[0]?.enabled)throw new GrapnelError(403,'MODULE_NOT_ENABLED',`Module ${module} is disabled`);
  if(module!=='capital.wallets'){
   const wallet=await request.grapnel.pool.query("SELECT enabled FROM business_modules WHERE business_id=$1 AND module_code='capital.wallets'",[request.businessContext.businessId]);
   if(!wallet.rows[0]?.enabled)throw new GrapnelError(403,'MODULE_DEPENDENCY_MISSING','Wallet infrastructure is required');
  }
 }
 return request.businessContext;
}
export async function requireOwner(request:FastifyRequest,mutation=false):Promise<OwnerContext>{
 const {pool,config}=request.grapnel;
 const token=request.cookies.grapnel_owner;
 if(!token)throw new GrapnelError(401,'OWNER_SESSION_REQUIRED','Business owner session required');
 const session=(await pool.query('SELECT business_id,csrf_hash FROM owner_sessions WHERE token_hash=$1 AND expires_at>now()',[digest(token)])).rows[0];
 if(!session)throw new GrapnelError(401,'OWNER_SESSION_REQUIRED','Owner session expired or invalid');
 const csrf=csrfToken(token,config.sessionSecret);
 if(mutation && (request.headers.origin!==config.dashboardOrigin || typeof request.headers['x-csrf-token']!=='string' || !constantEqual(request.headers['x-csrf-token'],csrf) || !constantEqual(session.csrf_hash,digest(csrf))))throw new GrapnelError(403,'CSRF_INVALID','Valid owner origin and CSRF token required');
 const owner={businessId:session.business_id,token,csrfToken:csrf};request.ownerContext=owner;return owner;
}
export async function verifyIdentity(request:FastifyRequest,proof?:string):Promise<VerifiedIdentity>{
 const token=proof??request.headers['x-customer-identity'];
 if(typeof token!=='string' || !token)throw new GrapnelError(403,'CUSTOMER_AUTH_REQUIRED','Verified customer identity required');
 try{return await request.grapnel.identityVerifier.verify(token);}catch(error){if(error instanceof GrapnelError)throw error;throw new GrapnelError(403,'CUSTOMER_AUTH_INVALID','Customer identity could not be verified');}
}
export async function requireCustomer(request:FastifyRequest,customerId:string,walletId?:string,proof?:string):Promise<CustomerContext>{
 const {businessId}=await requireBusiness(request);
 const customer=(await request.grapnel.pool.query('SELECT id,privy_user_id FROM customers WHERE business_id=$1 AND id=$2',[businessId,customerId])).rows[0];
 if(!customer)throw new GrapnelError(404,'NOT_FOUND','Customer not found');
 const identity=await verifyIdentity(request,proof);
 if(!customer.privy_user_id || customer.privy_user_id!==identity.userId)throw new GrapnelError(403,'CUSTOMER_AUTH_INVALID','Customer identity does not match this customer');
 const wallet=(await request.grapnel.pool.query(`SELECT * FROM wallets WHERE business_id=$1 AND customer_id=$2 ${walletId?'AND id=$3':''}`,[businessId,customerId,...walletId?[walletId]:[]])).rows[0];
 if(!wallet)throw new GrapnelError(404,'NOT_FOUND','Wallet not found');
 if(!identity.wallets.some(w=>w.id===wallet.privy_wallet_id && w.address===wallet.stellar_address))throw new GrapnelError(403,'WALLET_OWNERSHIP_INVALID','Verified identity does not own wallet');
 return {businessId,customerId,walletId:wallet.id,walletAddress:wallet.stellar_address,privyUserId:identity.userId};
}
export const unavailableIdentityVerifier:IdentityVerifier={async verify(){throw new GrapnelError(503,'PROVIDER_ACCESS_REQUIRED','Privy identity verification is not configured');}};
