import {z} from 'zod';
import {StrKey} from '@stellar/stellar-sdk';
import {canonicalize,createL1ActionHash} from '@nktkas/hyperliquid/signing';
import {CreateSubAccountRequest,SubAccountTransferRequest,OrderRequest} from '@nktkas/hyperliquid/api/exchange';
import {recoverTypedDataAddress,serializeSignature} from 'viem';
import {GrapnelError} from '@grapnel/contracts';
import {hash,stable,address,decimal,signedDecimal,units,normalize,assertPrecision,assertPositionIntent} from '../execution/guards.js';
import type {ApprovedPerpetualIntent} from '../../../modules/perpetuals/execution-contract.js';
import type {SolverSignedPayload,SolverProviderAction,SolverRequest,SolverWallet} from './types.js';
export {hash,stable,address,decimal,signedDecimal,units,normalize};
export const fail=(reason:string):never=>{throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Verified solver execution is unavailable',false,{reason});};
const uuid=z.string().uuid(),hex=z.string().regex(/^[a-f0-9]{64}$/),lowerAddress=z.string().regex(/^0x[a-f0-9]{40}$/);
export const scopeSchema=z.object({businessId:uuid,customerId:uuid,identityWalletId:uuid});
export const walletSchema=scopeSchema.extend({id:uuid,freighterAddress:z.string(),assetId:z.string().min(1),escrowAddress:z.string(),masterAddress:lowerAddress,subAccountAddress:lowerAddress.nullable(),createdAt:z.string().datetime()}).strict();
const deposit=z.object({kind:z.literal('deposit'),assetId:z.string(),amountAtomic7:z.string().regex(/^[1-9]\d{0,20}$/),source:z.string(),escrowAddress:z.string(),memoHashHex:hex}).strict();
const order=z.object({kind:z.literal('order'),marketId:z.string().regex(/^hyperliquid-testnet:perps:(?:0|[1-9]\d{0,8})$/),providerSymbol:z.string().min(1).max(128),assetIndex:z.number().int().nonnegative().safe(),dex:z.union([z.literal(''),z.literal('xyz')]),side:z.enum(['buy','sell']),size:decimal,limitPrice:decimal,leverage:z.number().int().min(1).max(1000),reduceOnly:z.boolean()}).strict();
const withdrawal=z.object({kind:z.literal('withdraw'),assetId:z.string(),amountAtomic7:z.string().regex(/^[1-9]\d{0,20}$/),recipient:z.string()}).strict();
export const requestSchema=scopeSchema.extend({id:uuid,walletId:uuid,kind:z.enum(['deposit','order','withdraw']),module:z.literal('trade.perps'),idempotencyKey:z.string().min(1).max(200),requestHash:hex,intentHash:hex,terms:z.discriminatedUnion('kind',[deposit,order,withdrawal]),state:z.enum(['preparing','awaiting_approval','authorized','submitted','confirming','completed','failed','recovery_required','expired']),challenge:z.unknown().nullable(),prepared:z.unknown().nullable(),signedXdr:z.string().nullable(),txHash:z.string().nullable(),proof:z.unknown().nullable(),expiresAt:z.string().datetime(),result:z.record(z.unknown()).nullable(),createdAt:z.string().datetime()}).strict();
export function sameBinding(a:SolverWallet,b:SolverWallet,creation=false){
 walletSchema.parse(a);walletSchema.parse(b);
 for(const v of [a.freighterAddress,a.escrowAddress])if(!StrKey.isValidEd25519PublicKey(v))return fail('STELLAR_BINDING_REQUIRED');
 const {subAccountAddress:sa,...aa}=a,{subAccountAddress:sb,...bb}=b;
 if(stable(aa)!==stable(bb)||(!creation&&sa!==sb)||a.masterAddress===a.subAccountAddress)return fail('EXACT_SOLVER_WALLET_BINDING');
}
export function scoped(request:SolverRequest,wallet:SolverWallet){
 requestSchema.parse(request);walletSchema.parse(wallet);
 if(request.businessId!==wallet.businessId||request.customerId!==wallet.customerId||request.identityWalletId!==wallet.identityWalletId||request.walletId!==wallet.id||request.kind!==request.terms.kind)return fail('TENANT_CUSTOMER_IDENTITY_WALLET_BINDING');
 if(request.kind==='deposit'){const t=request.terms as z.infer<typeof deposit>;if(t.source!==wallet.freighterAddress||t.escrowAddress!==wallet.escrowAddress||t.assetId!==wallet.assetId)return fail('SOURCE_DEPOSIT_BINDING');}
 if(request.kind==='withdraw'){const t=request.terms as z.infer<typeof withdrawal>;if(t.recipient!==wallet.freighterAddress||t.assetId!==wallet.assetId)return fail('WITHDRAWAL_BINDING');}
}
export function live(request:SolverRequest,nonce:number,now:number){
 const expiry=Date.parse(request.expiresAt);if(expiry<=now||expiry>now+300000||nonce>now+1000||nonce<now-60000||!Number.isSafeInteger(nonce))return fail('SOLVER_ACTION_EXPIRED');
}
export const subaccountName=(wallet:SolverWallet)=>'g'+hash({businessId:wallet.businessId,customerId:wallet.customerId,identityWalletId:wallet.identityWalletId,walletId:wallet.id}).slice(0,15);
export function atomic6(amount7:string):bigint{if(!/^[1-9]\d{0,20}$/.test(amount7))return fail('EXACT_STELLAR_AMOUNT_REQUIRED');const n=BigInt(amount7);if(n%10n||n/10n>BigInt(Number.MAX_SAFE_INTEGER))return fail('UNREPRESENTABLE_HYPERCORE_USDC_AMOUNT');return n/10n;}
export function providerIntent(action:SolverProviderAction,wallet:SolverWallet):ApprovedPerpetualIntent{
 const r=(action.payload as SolverSignedPayload).request;if(r.terms.kind!=='order'||!wallet.subAccountAddress||!action.clientOrderId)return fail('ORDER_INTENT_REQUIRED');const t=r.terms;
 return {operationId:r.id,businessId:r.businessId,customerId:r.customerId,walletId:r.identityWalletId,network:'hyperliquid-testnet',accountAddress:wallet.subAccountAddress,marketId:t.marketId,providerSymbol:t.providerSymbol,assetIndex:t.assetIndex,dex:t.dex,side:t.side,leverage:t.leverage,size:t.size,limitPrice:t.limitPrice,reduceOnly:t.reduceOnly,nonce:action.nonce,clientOrderId:action.clientOrderId as `0x${string}`,expiresAt:r.expiresAt,customerApprovalHash:r.intentHash};
}
export function canonicalAction(kind:SolverProviderAction['kind'],request:SolverRequest,wallet:SolverWallet,cloid:string|null,amount:string|null){
 if(kind==='create_subaccount')return canonicalize(CreateSubAccountRequest.entries.action,{type:'createSubAccount',name:subaccountName(wallet)});
 if(kind==='fund'||kind==='return'){
  if(!wallet.subAccountAddress||!amount||BigInt(amount)<=0n||BigInt(amount)>BigInt(Number.MAX_SAFE_INTEGER))return fail('EXACT_CASH_TRANSFER_REQUIRED');
  return canonicalize(SubAccountTransferRequest.entries.action,{type:'subAccountTransfer',subAccountUser:wallet.subAccountAddress,isDeposit:kind==='fund',usd:Number(amount)});
 }
 if(request.terms.kind!=='order'||!cloid)return fail('EXACT_ORDER_REQUIRED');const t=request.terms;
 return canonicalize(OrderRequest.entries.action,{type:'order',orders:[{a:t.assetIndex,b:t.side==='buy',p:normalize(t.limitPrice),s:normalize(t.size),r:t.reduceOnly,t:{limit:{tif:'Ioc' as const}},c:cloid as `0x${string}`}],grouping:'na' as const});
}
export const solverTypedData=(wire:Pick<SolverSignedPayload['wire'],'action'|'nonce'|'expiresAfter'|'vaultAddress'>)=>({domain:{name:'Exchange',version:'1',chainId:1337,verifyingContract:'0x0000000000000000000000000000000000000000' as const},types:{Agent:[{name:'source',type:'string'},{name:'connectionId',type:'bytes32'}]},primaryType:'Agent' as const,message:{source:'b',connectionId:createL1ActionHash({action:wire.action,nonce:wire.nonce,expiresAfter:wire.expiresAfter,...wire.vaultAddress?{vaultAddress:wire.vaultAddress}:{}})}});
const snapshot=z.object({accountValue:signedDecimal,cashBalance:signedDecimal,withdrawable:decimal,positions:z.array(z.object({coin:z.string(),size:signedDecimal,leverage:z.number().int().positive(),leverageType:z.enum(['cross','isolated'])}).strict()).max(10000),time:z.number().int().positive().safe()}).strict();
const market=z.object({symbol:z.string(),assetIndex:z.number().int(),localAssetIndex:z.number().int(),dex:z.string(),dexIndex:z.number().int(),szDecimals:z.number().int().min(0).max(6),maxLeverage:z.number().int().positive()}).strict();
const wire=z.object({action:z.record(z.unknown()),nonce:z.number().int().positive().safe(),expiresAfter:z.number().int().positive().safe(),vaultAddress:lowerAddress.optional(),signature:z.object({r:z.string().regex(/^0x[a-f0-9]{64}$/),s:z.string().regex(/^0x[a-f0-9]{64}$/),v:z.union([z.literal(27),z.literal(28)])}).strict()}).strict();
export const payloadSchema=z.object({version:z.literal(1),request:requestSchema,wallet:walletSchema,wire,before:z.object({master:snapshot,subaccount:snapshot.nullable()}).strict(),market:market.nullable(),position:z.object({size:signedDecimal,leverageType:z.enum(['cross','isolated']),observedAt:z.number().int().positive().safe()}).strict().nullable(),amountAtomic6:z.string().regex(/^[1-9]\d{0,15}$/).nullable(),subaccountName:z.string().length(16)}).strict();
const actionSchema=scopeSchema.extend({id:uuid,requestId:uuid,kind:z.enum(['create_subaccount','fund','order','return']),masterAddress:lowerAddress,subAccountAddress:lowerAddress.nullable(),nonce:z.number().int().positive().safe(),clientOrderId:z.string().regex(/^0x[a-f0-9]{32}$/).nullable(),intentHash:hex,payload:z.unknown(),state:z.enum(['prepared','sending','unknown','verified','failed']),result:z.record(z.unknown()).nullable(),createdAt:z.string().datetime()}).strict();
export async function inspectSolverAction(action:SolverProviderAction,scope:SolverWallet):Promise<SolverSignedPayload>{
 actionSchema.parse(action);
 const p=payloadSchema.parse(action.payload) as SolverSignedPayload,r=p.request;scoped(r,p.wallet);sameBinding(p.wallet,scope,action.kind==='create_subaccount');
 if(action.businessId!==r.businessId||action.customerId!==r.customerId||action.identityWalletId!==r.identityWalletId||action.requestId!==r.id||action.masterAddress!==p.wallet.masterAddress||action.subAccountAddress!==p.wallet.subAccountAddress||action.intentHash!==r.intentHash||action.nonce!==p.wire.nonce||p.wire.expiresAfter!==Date.parse(r.expiresAt)||p.subaccountName!==subaccountName(p.wallet))return fail('SIGNED_SOLVER_ACTION_BINDING');
 if(action.kind==='create_subaccount'){if(r.kind!=='deposit'||p.wallet.subAccountAddress!==null||p.amountAtomic6!==null||p.before.subaccount!==null||p.market!==null||p.position!==null||action.clientOrderId!==null)return fail('SUBACCOUNT_CREATION_BINDING');}
 else if(action.kind==='fund'||action.kind==='return'){
  if(r.kind!==(action.kind==='fund'?'deposit':'withdraw')||r.terms.kind==='order'||p.amountAtomic6!==atomic6(r.terms.amountAtomic7).toString()||!p.before.subaccount||p.market!==null||p.position!==null||action.clientOrderId!==null)return fail('CASH_INTENT_BINDING');
 }else{
  if(r.kind!=='order'||!p.market||!p.position||!p.before.subaccount||p.amountAtomic6!==null||!/^0x[a-f0-9]{32}$/.test(action.clientOrderId??''))return fail('ORDER_ACTION_BINDING');
  const i=providerIntent(action,p.wallet);assertPrecision(i,p.market);assertPositionIntent(i,p.market,p.position);
  if(p.market.symbol!==i.providerSymbol||p.market.assetIndex!==i.assetIndex||p.market.dex!==i.dex||p.position.observedAt>p.before.subaccount.time||p.before.subaccount.time-p.position.observedAt>5000)return fail('ORDER_BASELINE_BINDING');
 }
 const expected=canonicalAction(action.kind,r,p.wallet,action.clientOrderId,p.amountAtomic6);
 if(stable(p.wire.action)!==stable(expected)||p.wire.vaultAddress!==(action.kind==='order'?p.wallet.subAccountAddress:undefined))return fail('MASTER_SUBACCOUNT_SIGNATURE_SCOPE');
 const recovered=await recoverTypedDataAddress({...solverTypedData(p.wire),signature:serializeSignature({r:p.wire.signature.r,s:p.wire.signature.s,v:BigInt(p.wire.signature.v)})});
 if(recovered.toLowerCase()!==p.wallet.masterAddress)return fail('MASTER_SIGNATURE_REQUIRED');return p;
}
