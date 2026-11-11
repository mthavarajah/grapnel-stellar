import {z} from 'zod';
import type {FastifyInstance} from 'fastify';
import {GrapnelError,NETWORK_PASSPHRASE,XLM,toAtomic,type PreparedAction} from '@grapnel/contracts';
import {lock} from '../../db/index.js';
import {requireBusiness,requireCustomer,success} from '../../lib/context.js';
import type {OperationService} from '../operations/service.js';
import type {StellarTestnetExecutor} from '../../adapters/stellar/index.js';
import {buildUsdcTrustline,TESTNET_USDC_ISSUER} from '../../adapters/stellar/usdc-trustline.js';
export async function registerUsdcTrustline(app:FastifyInstance,deps:{chain:StellarTestnetExecutor;operations:OperationService;verifyGate1:()=>Promise<boolean>}):Promise<void>{
 app.post('/v1/capital/wallets/:id/usdc-trustline',async(request,reply)=>{
  await requireBusiness(request,'capital.wallets');
  if(!await deps.verifyGate1())throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Current customer signing proof is required');
  const {id}=z.object({id:z.string().uuid()}).parse(request.params);
  const body=z.object({customer_id:z.string().uuid(),limit:z.literal('1000')}).strict().parse(request.body);
  const customer=await requireCustomer(request,body.customer_id,id);
  const result=await deps.operations.createIdempotent({businessId:customer.businessId,customerId:customer.customerId,walletId:id,module:'capital.wallets',type:'wallet.usdc_trustline',provider:'stellar',route:'/v1/capital/wallets/:id/usdc-trustline',idempotencyKey:String(request.headers['idempotency-key']??''),request:body},async(client,operationId)=>{
   await lock(client,`wallet:${customer.businessId}:${id}`);
   await deps.chain.verifyLiveNetwork();
   const account=await deps.chain.horizon.loadAccount(customer.walletAddress);
   if(account.balances.some(b=>b.asset_type!=='native'&&'asset_code'in b&&b.asset_code==='USDC'&&b.asset_issuer===TESTNET_USDC_ISSUER))throw new GrapnelError(409,'TRUSTLINE_EXISTS','Testnet USDC is already enabled');
   const ledger=(await deps.chain.horizon.ledgers().order('desc').limit(1).call()).records[0]!;
   const reserve=BigInt(ledger.base_reserve_in_stroops);
   if(reserve!==5000000n)throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Current reserve differs from reviewed 0.5 XLM trustline reserve');
   const balance=(await deps.chain.getClassicBalances(customer.walletAddress)).find(b=>b.asset_id===XLM.id)!;
   const available=/^0(?:\.0+)?$/.test(balance.spendable)?0n:toAtomic(balance.spendable,7);
   const expiresAt=new Date(Math.floor(Date.now()/1000)*1000+120000).toISOString();
   const reviewed=buildUsdcTrustline({network:'testnet',passphrase:NETWORK_PASSPHRASE},{network:'stellar-testnet',action:'wallet.usdc_trustline',walletAddress:customer.walletAddress,assetCode:'USDC',issuer:TESTNET_USDC_ISSUER,limit:body.limit,sequence:(BigInt(account.sequence)+1n).toString(),maxFeeStroops:'100',expiresAt},{spendableXlmAtomic:available,additionalReserveAtomic:reserve});
   const prepared:PreparedAction={operationId,customerId:customer.customerId,network:'stellar-testnet',walletAddress:customer.walletAddress,unsignedXdr:reviewed.unsignedXdr,signingHashHex:reviewed.signingHashHex,summary:{action:'wallet.usdc_trustline',fromAssetId:`stellar-testnet:classic:USDC:${TESTNET_USDC_ISSUER}`,amount:body.limit,recipient:customer.walletAddress,maxFeeStroops:'100',expiresAt},authorization:{method:'privy_stellar',expiresAt}};
   await deps.operations.reserve(client,{businessId:customer.businessId,customerId:customer.customerId,walletId:id,operationId,assetId:XLM.id,amountAtomic:reserve+100n,spendableAtomic:available,observedAt:new Date(balance.as_of),expiresAt:new Date(expiresAt)});
   await deps.operations.setPrepared(client,customer.businessId,operationId,prepared);
  });
  reply.code(202);return success(request,result.operation);
 });
}
