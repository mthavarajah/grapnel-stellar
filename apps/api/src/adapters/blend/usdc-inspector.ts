import { Address, Contract, StrKey, Transaction, nativeToScVal, scValToNative, xdr } from '@stellar/stellar-sdk';
import { GrapnelError, NETWORK, NETWORK_PASSPHRASE, PreparedActionSchema, toAtomic, type PreparedAction } from '@grapnel/contracts';
import type { VerifiedBlendRegistry } from '../stellar/blend-soroban.js';
import { buildBlendOperation, type BlendIntent } from './index.js';

export const BLEND_USDC_ISSUER = 'GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56';
export const BLEND_USDC_CODE = 'USDC';
export const BLEND_USDC_DECIMALS = 7;
const fail=(code:string,message:string):never=>{throw new GrapnelError(403,code,message);};
const keyXdr=(key:xdr.LedgerKey)=>key.toXDR('base64');
const address=(a:xdr.ScAddress)=>Address.fromScAddress(a).toString();
const exactIntent=(intent:BlendIntent,registry:VerifiedBlendRegistry,action:'supply'|'withdraw')=>{
 if(intent.action!==action||intent.poolId!==registry.poolId||intent.reserveId!==registry.reserveId||!StrKey.isValidEd25519PublicKey(intent.walletAddress)||intent.amountAtomic<=0n||intent.amountAtomic>=(1n<<127n)) fail('BLEND_USDC_INTENT_MISMATCH','USDC Blend intent differs from the exact reviewed pool, reserve, customer or amount');
};
const contractFn=(intent:BlendIntent)=>xdr.Operation.fromXDR(buildBlendOperation(intent),'base64').body().invokeHostFunctionOp().hostFunction().invokeContract();

/** USDC supply explicitly requires source-account authorization plus exactly one SAC transfer grant. */
export function inspectBlendUsdcSupplyAuthorization(auth:xdr.SorobanAuthorizationEntry[],intent:BlendIntent,registry:VerifiedBlendRegistry):void{
 exactIntent(intent,registry,'supply');
 try{
  if(auth.length!==1||auth[0]!.credentials().switch().name!=='sorobanCredentialsSourceAccount')throw new Error();
  const root=auth[0]!.rootInvocation();
  if(root.function().switch().name!=='sorobanAuthorizedFunctionTypeContractFn'||root.subInvocations().length!==1)throw new Error();
  if(root.function().contractFn().toXDR('base64')!==contractFn(intent).toXDR('base64'))throw new Error();
  const child=root.subInvocations()[0]!;
  if(child.subInvocations().length!==0||child.function().switch().name!=='sorobanAuthorizedFunctionTypeContractFn')throw new Error();
  const childExpected=new Contract(registry.reserveId).call('transfer',Address.fromString(intent.walletAddress).toScVal(),Address.fromString(intent.poolId).toScVal(),nativeToScVal(intent.amountAtomic,{type:'i128'})).body().invokeHostFunctionOp().hostFunction().invokeContract();
  if(child.function().contractFn().toXDR('base64')!==childExpected.toXDR('base64'))throw new Error();
 }catch{fail('SOROBAN_AUTH_MISMATCH','USDC supply authorization must be the exact customer source and one exact SAC transfer to the Blend pool');}
}

/** Withdrawal is independently inspected: source-account root only, no customer token grant. */
export function inspectBlendUsdcWithdrawAuthorization(auth:xdr.SorobanAuthorizationEntry[],intent:BlendIntent,registry:VerifiedBlendRegistry):void{
 exactIntent(intent,registry,'withdraw');
 try{if(auth.length!==1||auth[0]!.credentials().switch().name!=='sorobanCredentialsSourceAccount'||auth[0]!.rootInvocation().function().switch().name!=='sorobanAuthorizedFunctionTypeContractFn'||auth[0]!.rootInvocation().subInvocations().length!==0||auth[0]!.rootInvocation().function().contractFn().toXDR('base64')!==contractFn(intent).toXDR('base64'))throw new Error();}
 catch{fail('SOROBAN_AUTH_MISMATCH','USDC withdrawal authorization must be the exact customer source-account request with no nested grants');}
}

/** Validate the live USDC SAC + classic trustline footprint; pool emissions use reserveIndex*2+1 (index 3 => 7). */
export function inspectBlendUsdcFootprint(data:xdr.SorobanTransactionData,intent:BlendIntent,registry:VerifiedBlendRegistry,action:'supply'|'withdraw',feeCeiling=10_000_000n):void{
 exactIntent(intent,registry,action);
 try{
  const fee=data.resourceFee().toString();if(!/^\d{1,12}$/.test(fee)||BigInt(fee)>feeCeiling)throw new Error();
  const resources=data.resources();if(data.ext().switch()!==0||resources.instructions()<=0||resources.instructions()>20_000_000||resources.diskReadBytes()>1_048_576||resources.writeBytes()>131_072)throw new Error();
  const fp=resources.footprint(),ro=fp.readOnly(),rw=fp.readWrite(),all=[...ro,...rw].map(keyXdr);if(rw.length!==4||ro.length!==6||new Set(all).size!==all.length)throw new Error();
  let poolInstance=false,reserveInstance=false,poolCode=false,resConfig=false,emission=false,auction=false,poolBalance=false,positions=false,resData=false,trustline=false;
  const expectedEmission=registry.reserveIndex*2+1;
  for(const [write,keys] of [[false,ro],[true,rw]] as const)for(const key of keys){
   const kind=key.switch().name;
   if(kind==='contractCode'){if(write||key.contractCode().hash().toString('hex')!==registry.poolWasmHash)throw new Error();poolCode=true;continue;}
   if(kind==='trustline'){
    if(!write)throw new Error();const line=key.trustLine();const asset=line.asset();if(asset.switch().name!=='assetTypeCreditAlphanum4')throw new Error();const a=asset.alphaNum4();
    const code=Buffer.from(a.assetCode()).toString('ascii').replace(/\0+$/,'');const issuer=StrKey.encodeEd25519PublicKey(a.issuer().ed25519());
    if(StrKey.encodeEd25519PublicKey(line.accountId().ed25519())!==intent.walletAddress||code!==BLEND_USDC_CODE||issuer!==BLEND_USDC_ISSUER)throw new Error();trustline=true;continue;
   }
   if(kind!=='contractData')throw new Error();const cd=key.contractData(),id=address(cd.contract()),dur=cd.durability().name;
   if(id!==registry.poolId&&id!==registry.reserveId)throw new Error();
   if(cd.key().switch().name==='scvLedgerKeyContractInstance'){if(write||dur!=='persistent')throw new Error();if(id===registry.poolId)poolInstance=true;else reserveInstance=true;continue;}
   const decoded=scValToNative(cd.key());if(!Array.isArray(decoded)||decoded.length!==2)throw new Error();const [name,target]=decoded;
   if(id===registry.reserveId){if(!write||name!=='Balance'||target!==registry.poolId||dur!=='persistent')throw new Error();poolBalance=true;continue;}
   if(name==='Auction'&&!write&&dur==='temporary'&&target&&typeof target==='object'&&target.auct_type===0&&target.user===intent.walletAddress){auction=true;continue;}
   if(dur!=='persistent')throw new Error();if(name==='ResConfig'&&!write&&target===registry.reserveId){resConfig=true;continue;}
   if(name==='EmisData'&&!write&&target===expectedEmission){emission=true;continue;}
   if(name==='Positions'&&write&&target===intent.walletAddress){positions=true;continue;}
   if(name==='ResData'&&write&&target===registry.reserveId){resData=true;continue;}throw new Error();
  }
  if(!poolInstance||!reserveInstance||!poolCode||!resConfig||!emission||!auction||!poolBalance||!positions||!resData||!trustline)throw new Error();
 }catch{fail('SOROBAN_FOOTPRINT_MISMATCH','USDC Blend footprint must match the live exact SAC, customer classic USDC trustline and reviewed reserve index');}
}

/** Reinspect complete USDC envelope after generic signer/digest checks. */
export function inspectPreparedBlendUsdcAction(action:PreparedAction,tx:Transaction,registry:VerifiedBlendRegistry,operation:'supply'|'withdraw',feeCeiling=10_000_000n):void{
 PreparedActionSchema.parse(action);const expectedAction=`blend.${operation}`,expires=Date.parse(action.summary.expiresAt??'');
 if(action.network!==NETWORK||action.authorization.method!=='privy_stellar'||action.summary.action!==expectedAction||action.summary.fromAssetId!==`stellar-testnet:classic:USDC:${BLEND_USDC_ISSUER}`||action.summary.toAssetId!==undefined||action.summary.minReceive!==undefined||action.summary.contractId!==registry.poolId||action.summary.recipient!==action.walletAddress||action.summary.expiresAt!==action.authorization.expiresAt||action.summary.maxFeeStroops!==tx.fee||tx.hash().toString('hex')!==action.signingHashHex)fail('SOROBAN_TRANSACTION_MISMATCH','USDC Blend intent, transaction digest or fee differs from approval');
 let amount:bigint;try{amount=toAtomic(action.summary.amount??'',BLEND_USDC_DECIMALS);}catch{return fail('BLEND_USDC_INTENT_MISMATCH','USDC amount must use exact seven-decimal precision');}
 const intent:BlendIntent={action:operation,poolId:registry.poolId,reserveId:registry.reserveId,walletAddress:action.walletAddress,amountAtomic:amount};
 if(tx.networkPassphrase!==NETWORK_PASSPHRASE||tx.source!==action.walletAddress||tx.operations.length!==1||tx.memo.type!=='none'||tx.extraSigners?.length||!tx.timeBounds||tx.timeBounds.minTime!=='0'||tx.timeBounds.maxTime==='0'||!Number.isFinite(expires)||expires<=Date.now()||expires>Date.now()+120_000||BigInt(tx.timeBounds.maxTime)*1000n>BigInt(expires)||BigInt(tx.fee)<=100n||BigInt(tx.fee)>feeCeiling)fail('SOROBAN_TRANSACTION_MISMATCH','USDC transaction source, bounds or fee exceeds exact approved intent');
 const op=tx.operations[0];if(!op||op.type!=='invokeHostFunction'){return fail('BLEND_USDC_INTENT_MISMATCH','USDC operation is not a contract invocation');}
 if(op.source||op.func.switch().name!=='hostFunctionTypeInvokeContract'||op.func.toXDR('base64')!==xdr.Operation.fromXDR(buildBlendOperation(intent),'base64').body().invokeHostFunctionOp().hostFunction().toXDR('base64'))fail('BLEND_USDC_INTENT_MISMATCH','USDC operation differs from exact approved Blend request');
 const envelope=tx.toEnvelope().v1().tx();if(envelope.ext().switch()!==1)fail('SOROBAN_FOOTPRINT_MISMATCH','Missing USDC Soroban resources');const data=envelope.ext().sorobanData();
 if(operation==='supply')inspectBlendUsdcSupplyAuthorization(op.auth??[],intent,registry);else inspectBlendUsdcWithdrawAuthorization(op.auth??[],intent,registry);
 inspectBlendUsdcFootprint(data,intent,registry,operation,feeCeiling);if(BigInt(tx.fee)<BigInt(data.resourceFee().toString())+100n)fail('SOROBAN_FEE_LIMIT','Transaction fee does not cover USDC Blend resources');
}

