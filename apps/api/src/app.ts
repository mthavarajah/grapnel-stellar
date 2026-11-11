import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z, ZodError } from 'zod';
import type { Pool } from 'pg';
import { AuthorizeInputSchema, CustomerInputSchema, GrapnelError, MODULE_IDS, ModulesInputSchema, NETWORK, type Capability, type CustomerContext, type IdentityVerifier, type ModuleId, type PreparedAction, type WalletBalance } from '@grapnel/contracts';
import { createPool, transaction } from './db/index.js';
import { loadConfig, type ApiConfig } from './lib/config.js';
import { constantEqual, csrfToken, digest, secretToken } from './lib/crypto.js';
import { requireBusiness, requireCustomer, requireOwner, success, unavailableIdentityVerifier } from './lib/context.js';
import { OperationService } from './modules/operations/service.js';
export interface AppOptions {
 pool?:Pool;config?:ApiConfig;identityVerifier?:IdentityVerifier;
 verifySignedAction?:(action:PreparedAction,signedXdr:string,customerIdentity:string)=>Promise<{txHash:string}>;
 balanceReader?:(address:string)=>Promise<WalletBalance[]>;
 dashboardCustomerBalances?:(businessId:string,walletId:string)=>Promise<WalletBalance[]>;
 dashboardCustomerPositions?:(customer:CustomerContext)=>Promise<unknown[]>;
 capabilities?:Partial<Record<ModuleId,()=>Promise<Pick<Capability,'execution_status'|'reason'|'actions'>>>>;
 registerAdapters?:(app:FastifyInstance)=>Promise<void>;
}
const metadata:Record<ModuleId,{name:string;provider:string;description:string}>={
 'capital.wallets':{name:'Wallet Infrastructure',provider:'privy',description:'Customer-owned Stellar Testnet wallets'},
 'capital.testnet_funding':{name:'Testnet Funding & Return',provider:'stellar',description:'Treasury-backed Testnet token transfers'},
 'capital.lending':{name:'Lending, Borrowing & Yield',provider:'blend',description:'Variable-rate Testnet lending positions'},
 'trade.spot':{name:'Crypto Spot',provider:'soroswap',description:'Stellar Testnet swaps'},
 'trade.stocks':{name:'Tokenized Stocks',provider:'unverified',description:'Discovery only; no verified Testnet execution route'},
 'trade.perps':{name:'Perpetual Futures',provider:'noether',description:'Unavailable for execution; provider restrictions apply'},
 'trade.commodities':{name:'Commodity-linked Assets',provider:'unverified',description:'Discovery only; no verified Testnet execution route'}
};
export async function buildApp(options:AppOptions={}):Promise<FastifyInstance>{
 const config=options.config??loadConfig();const ownPool=!options.pool;const pool=options.pool??createPool(config.databaseUrl);
 const app=Fastify({logger:false,bodyLimit:262144,genReqId:()=>`req_${randomUUID()}`,disableRequestLogging:true});
 const operations=new OperationService(pool);
 await app.register(cookie);
 await app.register(cors,{origin:[config.dashboardOrigin,config.fintechOrigin],credentials:true,allowedHeaders:['Content-Type','Authorization','Idempotency-Key','X-Customer-Identity','X-CSRF-Token'],exposedHeaders:['X-Request-ID']});
 await app.register(rateLimit,{max:120,timeWindow:'1 minute',errorResponseBuilder:()=>({error:{code:'RATE_LIMITED',message:'Request limit exceeded',retryable:true,details:{}}})});
 app.decorateRequest('grapnel');
 app.addHook('onRequest',async(request,reply)=>{request.grapnel={pool,config,identityVerifier:options.identityVerifier??unavailableIdentityVerifier};reply.header('X-Request-ID',request.id);reply.header('Cache-Control','no-store');});
 app.addHook('onResponse',async(request,reply)=>{
  const context=request.businessContext;if(!context)return;
  try{await pool.query('INSERT INTO api_request_logs(business_id,api_key_id,request_id,method,path_template,status,duration_ms) VALUES($1,$2,$3,$4,$5,$6,$7)',[context.businessId,context.apiKeyId,request.id,request.method,request.routeOptions.url??'/unknown',reply.statusCode,Math.round(reply.elapsedTime)]);}catch{app.log.warn('Request audit persistence failed');}
 });
 app.setErrorHandler((error,request,reply)=>{
  const e=error instanceof GrapnelError?error:error instanceof ZodError?new GrapnelError(422,'VALIDATION_ERROR','Invalid request payload',false,{issues:error.issues.map(i=>({path:i.path,code:i.code}))}):['FST_ERR_CTP_EMPTY_JSON_BODY','FST_ERR_CTP_INVALID_JSON_BODY'].includes((error as {code?:string}).code??'')?new GrapnelError(400,'INVALID_JSON','A valid JSON request body is required'):(error as {code?:string}).code==='22P02'?new GrapnelError(404,'NOT_FOUND','Resource not found'):new GrapnelError((error as {statusCode?:number}).statusCode && (error as {statusCode:number}).statusCode<500 ? (error as {statusCode:number}).statusCode : 500,'INTERNAL_ERROR','Request could not be completed');
  reply.code(e.statusCode).send({error:{code:e.code,message:e.message,retryable:e.retryable,details:e.details},meta:{request_id:request.id,network:NETWORK,as_of:new Date().toISOString()}});
 });
 app.setNotFoundHandler((request,reply)=>reply.code(404).send({error:{code:'NOT_FOUND',message:'Route not found',retryable:false,details:{}},meta:{request_id:request.id}}));
 if(ownPool)app.addHook('onClose',async()=>{await pool.end();});
 const capabilities=async(businessId:string)=>{
  const rows=(await pool.query('SELECT module_code,enabled FROM business_modules WHERE business_id=$1',[businessId])).rows;
  return Promise.all(MODULE_IDS.map(async module=>{
   const ready=options.capabilities?.[module];
   const availability=ready?await ready():{execution_status:module.startsWith('trade.')&&module!=='trade.spot'?'discovery_only' as const:'blocked' as const,reason:'Live Testnet execution has not passed the signing and provider acceptance gates',actions:[]};
   return {module,...metadata[module],enabled:!!rows.find(r=>r.module_code===module)?.enabled,...availability};
  }));
 };
 app.get('/health',async(_request,reply)=>{try{await pool.query('SELECT 1');return {status:'ok',network:NETWORK,db:'ok'};}catch{reply.code(503);return {status:'degraded',network:NETWORK,db:'unavailable'};}});
 app.get('/openapi.json',async(_request,reply)=>{reply.type('application/json');return JSON.parse(await readFile(new URL('../../../openapi/grapnel.json',import.meta.url),'utf8'));});
 app.get('/docs',async(_request,reply)=>reply.type('text/html').send('<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Grapnel API</title><link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.30.2/swagger-ui.css"></head><body><div id="swagger-ui"></div><script src="https://unpkg.com/swagger-ui-dist@5.30.2/swagger-ui-bundle.js"></script><script>SwaggerUIBundle({url:"/openapi.json",dom_id:"#swagger-ui",persistAuthorization:false})</script></body></html>'));
 app.post('/v1/dashboard/login',{config:{rateLimit:{max:5,timeWindow:'1 minute'}}},async(request,reply)=>{
  if(request.headers.origin!==config.dashboardOrigin)throw new GrapnelError(403,'CSRF_INVALID','Owner login requires the dashboard origin');
  const body=z.object({secret:z.string().max(1000)}).strict().parse(request.body);
  if(!constantEqual(body.secret,config.adminLoginSecret))throw new GrapnelError(401,'LOGIN_FAILED','Invalid owner credentials');
  const token=secretToken();const csrf=csrfToken(token,config.sessionSecret);
  await pool.query('INSERT INTO owner_sessions(token_hash,business_id,csrf_hash,expires_at) VALUES($1,$2,$3,now()+interval \'8 hours\')',[digest(token),config.demoBusinessId,digest(csrf)]);
  reply.setCookie('grapnel_owner',token,{path:'/',httpOnly:true,secure:config.production,sameSite:config.production?'none':'lax',maxAge:28800});
  return success(request,{business_id:config.demoBusinessId,csrf_token:csrf});
 });
 app.get('/v1/dashboard/session',async request=>{const owner=await requireOwner(request);return success(request,{business_id:owner.businessId,csrf_token:owner.csrfToken});});
 app.post('/v1/dashboard/logout',async(request,reply)=>{const owner=await requireOwner(request,true);await pool.query('DELETE FROM owner_sessions WHERE token_hash=$1',[digest(owner.token)]);reply.clearCookie('grapnel_owner',{path:'/'});return success(request,{logged_out:true});});
 app.get('/v1/dashboard/business',async request=>{const owner=await requireOwner(request);return success(request,(await pool.query('SELECT id,name,environment,revision,created_at FROM businesses WHERE id=$1',[owner.businessId])).rows[0]);});
 app.get('/v1/dashboard/customers',async request=>{
  const owner=await requireOwner(request);
  const rows=(await pool.query(`SELECT c.id AS customer_id,c.external_customer_id,c.created_at,
   w.id AS wallet_id,w.stellar_address AS wallet_address,w.status AS wallet_status
   FROM customers c LEFT JOIN LATERAL (SELECT id,stellar_address,status FROM wallets
    WHERE business_id=c.business_id AND customer_id=c.id ORDER BY (status='active') DESC,created_at DESC LIMIT 1) w ON true
   WHERE c.business_id=$1 ORDER BY c.created_at DESC LIMIT 250`,[owner.businessId])).rows;
  return success(request,{customers:rows.map(row=>({customer_id:row.customer_id,external_customer_id:row.external_customer_id,created_at:row.created_at,wallet:row.wallet_id?{wallet_id:row.wallet_id,address:row.wallet_address,status:row.wallet_status}:null}))});
 });
 app.get('/v1/dashboard/customers/:id/balances',async request=>{
  const owner=await requireOwner(request);const {id}=z.object({id:z.string().uuid()}).parse(request.params);
  const row=(await pool.query(`SELECT c.id,w.id AS wallet_id FROM customers c LEFT JOIN LATERAL
   (SELECT id FROM wallets WHERE business_id=c.business_id AND customer_id=c.id AND status='active' ORDER BY created_at DESC LIMIT 1) w ON true
   WHERE c.business_id=$1 AND c.id=$2`,[owner.businessId,id])).rows[0];
  if(!row)throw new GrapnelError(404,'NOT_FOUND','Customer not found');
  if(!row.wallet_id)return success(request,{customer_id:id,wallet_id:null,balances:[],as_of:new Date().toISOString()});
  if(!options.dashboardCustomerBalances)throw new GrapnelError(503,'BALANCE_UNAVAILABLE','Live wallet balance reads are unavailable',true);
  return success(request,{customer_id:id,wallet_id:row.wallet_id,balances:await options.dashboardCustomerBalances(owner.businessId,row.wallet_id),as_of:new Date().toISOString()});
 });
 app.get('/v1/dashboard/customers/:id/lending-positions',async request=>{
  const owner=await requireOwner(request);
  const {id}=z.object({id:z.string().uuid()}).parse(request.params);
  const row=(await pool.query(`SELECT c.id AS customer_id,c.privy_user_id,w.id AS wallet_id,w.stellar_address AS wallet_address
   FROM customers c LEFT JOIN LATERAL (SELECT id,stellar_address FROM wallets
    WHERE business_id=c.business_id AND customer_id=c.id AND status='active' ORDER BY created_at DESC LIMIT 1) w ON true
   WHERE c.business_id=$1 AND c.id=$2`,[owner.businessId,id])).rows[0];
  if(!row)throw new GrapnelError(404,'NOT_FOUND','Customer not found');
  if(!row.wallet_id)return success(request,{customer_id:id,positions:[],as_of:new Date().toISOString()});
  if(!options.dashboardCustomerPositions)throw new GrapnelError(503,'BLEND_UNAVAILABLE','Live Blend position reads are unavailable',true);
  const customer:CustomerContext={businessId:owner.businessId,customerId:row.customer_id,walletId:row.wallet_id,walletAddress:row.wallet_address,privyUserId:row.privy_user_id??''};
  const positions=await options.dashboardCustomerPositions(customer);
  return success(request,{customer_id:id,positions,as_of:new Date().toISOString()});
 });
 app.post('/v1/dashboard/businesses',async request=>{
  const owner=await requireOwner(request,true);const {name}=z.object({name:z.string().trim().min(1).max(120)}).strict().parse(request.body);
  const business=await transaction(pool,async client=>{
   const row=(await client.query('INSERT INTO businesses(name) VALUES($1) RETURNING id,name,environment,revision,created_at',[name])).rows[0];
   await client.query('INSERT INTO business_modules(business_id,module_code) SELECT $1,unnest(enum_range(NULL::module_code))',[row.id]);
   await client.query('INSERT INTO business_users(business_id,auth_provider_id,role) VALUES($1,$2,\'owner\')',[row.id,`demo-owner:${owner.businessId}`]);
   await client.query('UPDATE owner_sessions SET business_id=$2 WHERE token_hash=$1',[digest(owner.token),row.id]);return row;
  });return success(request,business);
 });
 app.get('/v1/dashboard/modules',async request=>{const owner=await requireOwner(request);return success(request,{modules:await capabilities(owner.businessId),revision:(await pool.query('SELECT revision FROM businesses WHERE id=$1',[owner.businessId])).rows[0].revision});});
 app.patch('/v1/dashboard/modules',async request=>{
  const owner=await requireOwner(request,true);const {modules}=ModulesInputSchema.parse(request.body);
  if(modules.some(m=>m!=='capital.wallets')&&!modules.includes('capital.wallets'))throw new GrapnelError(422,'MODULE_DEPENDENCY_MISSING','Enable capital.wallets before other financial modules');
  const revision=await transaction(pool,async client=>{
   const row=(await client.query('UPDATE businesses SET revision=revision+1 WHERE id=$1 RETURNING revision',[owner.businessId])).rows[0];
   await client.query('UPDATE business_modules SET enabled=(module_code=ANY($2::module_code[])),revision=$3,updated_at=now() WHERE business_id=$1',[owner.businessId,modules,row.revision]);return row.revision;
  });return success(request,{modules:await capabilities(owner.businessId),revision});
 });
 app.post('/v1/dashboard/api-keys',async request=>{
  const owner=await requireOwner(request,true);const {name}=z.object({name:z.string().trim().min(1).max(100)}).strict().parse(request.body);
  const secret=`gr_test_${secretToken()}`;
  const key=(await pool.query('INSERT INTO api_keys(business_id,prefix,last_four,key_hash,name) VALUES($1,$2,$3,$4,$5) RETURNING id,prefix,last_four,name,created_at,revoked_at',[owner.businessId,secret.slice(0,16),secret.slice(-4),digest(secret),name])).rows[0];
  return success(request,{...key,status:'active',secret});
 });
 app.get('/v1/dashboard/api-keys',async request=>{const owner=await requireOwner(request);return success(request,{keys:(await pool.query("SELECT id,prefix,last_four,name,created_at,revoked_at,last_used_at,CASE WHEN revoked_at IS NULL THEN 'active' ELSE 'revoked' END AS status FROM api_keys WHERE business_id=$1 ORDER BY created_at DESC",[owner.businessId])).rows});});
 app.delete('/v1/dashboard/api-keys/:id',async request=>{const owner=await requireOwner(request,true);const {id}=request.params as {id:string};const result=await pool.query('UPDATE api_keys SET revoked_at=COALESCE(revoked_at,now()) WHERE business_id=$1 AND id=$2 RETURNING id',[owner.businessId,id]);if(!result.rowCount)throw new GrapnelError(404,'NOT_FOUND','API key not found');return success(request,{id,status:'revoked'});});
 app.get('/v1/dashboard/requests',async request=>{const owner=await requireOwner(request);return success(request,{requests:(await pool.query('SELECT request_id,method,path_template,status,duration_ms,created_at FROM api_request_logs WHERE business_id=$1 ORDER BY created_at DESC LIMIT 100',[owner.businessId])).rows});});
 app.get('/v1/capabilities',async request=>{const business=await requireBusiness(request);return success(request,{capabilities:await capabilities(business.businessId),revision:(await pool.query('SELECT revision FROM businesses WHERE id=$1',[business.businessId])).rows[0].revision});});
 app.post('/v1/customers',async request=>{const business=await requireBusiness(request);const body=CustomerInputSchema.parse(request.body);const row=(await pool.query('INSERT INTO customers(business_id,external_customer_id) VALUES($1,$2) ON CONFLICT (business_id,external_customer_id) DO UPDATE SET external_customer_id=EXCLUDED.external_customer_id RETURNING id,external_customer_id,created_at',[business.businessId,body.external_customer_id])).rows[0];return success(request,{customer_id:row.id,...row});});
 app.get('/v1/customers/:id',async request=>{const business=await requireBusiness(request);const {id}=request.params as {id:string};const row=(await pool.query('SELECT id,external_customer_id,created_at FROM customers WHERE business_id=$1 AND id=$2',[business.businessId,id])).rows[0];if(!row)throw new GrapnelError(404,'NOT_FOUND','Customer not found');return success(request,{customer_id:row.id,...row});});
 app.get('/v1/operations',async request=>{
  const business=await requireBusiness(request);const {customer_id}=z.object({customer_id:z.string().uuid()}).strict().parse(request.query);
  await requireCustomer(request,customer_id);
  const rows=(await pool.query('SELECT id FROM operations WHERE business_id=$1 AND customer_id=$2 ORDER BY created_at DESC LIMIT 100',[business.businessId,customer_id])).rows;
  return success(request,{operations:await Promise.all(rows.map(row=>operations.get(business.businessId,row.id)))});
 });
 app.get('/v1/operations/:id',async request=>{
  const business=await requireBusiness(request);const {id}=request.params as {id:string};const operation=await operations.get(business.businessId,id);
  if(request.headers['x-customer-identity']){
   await requireCustomer(request,operation.customer_id,operation.wallet_id);
   if(operation.status==='awaiting_customer_authorization')Object.assign(operation,await operations.issueAuthorization(business.businessId,id));
  }
  return success(request,operation);
 });
 app.post('/v1/operations/:id/authorize',async(request,reply)=>{
  const business=await requireBusiness(request);const {id}=request.params as {id:string};const body=AuthorizeInputSchema.parse(request.body);const operation=await operations.get(business.businessId,id);
  await requireBusiness(request,operation.module);const customer=await requireCustomer(request,operation.customer_id,operation.wallet_id,body.privy_identity_proof);
  if(!options.verifySignedAction)throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Live Testnet signing has not been verified');
  const result=await operations.authorize({businessId:business.businessId,operationId:id,customerId:customer.customerId,token:body.customer_action_token,signedXdr:body.signed_xdr,verify:(action,signedXdr)=>options.verifySignedAction!(action,signedXdr,customer.privyUserId)});
  reply.code(202);return success(request,result);
 });
 app.get('/v1/portfolio',async request=>{
  const business=await requireBusiness(request,'capital.wallets');const {customer_id}=z.object({customer_id:z.string().uuid()}).parse(request.query);
  const customer=(await pool.query('SELECT id FROM customers WHERE business_id=$1 AND id=$2',[business.businessId,customer_id])).rows[0];if(!customer)throw new GrapnelError(404,'NOT_FOUND','Customer not found');
  const wallets=(await pool.query('SELECT id,stellar_address FROM wallets WHERE business_id=$1 AND customer_id=$2',[business.businessId,customer_id])).rows;
  if(wallets.length&&!options.balanceReader)throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Live chain balance reader is unavailable');
  const walletAssets=await Promise.all(wallets.map(async wallet=>({wallet_id:wallet.id,stellar_address:wallet.stellar_address,balances:await options.balanceReader!(wallet.stellar_address)})));
  return success(request,{customer_id,wallets:walletAssets,lending_positions:null,lending_status:'Live lending position adapter must be queried; cached amounts are not spendable',as_of:new Date().toISOString()});
 });
 if(options.registerAdapters)await options.registerAdapters(app);
 return app;
}
