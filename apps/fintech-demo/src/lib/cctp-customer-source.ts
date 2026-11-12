/** Browser mirror of the pinned pure source inspector. No RPC or server authorization. */
import {Address,Contract,StrKey,Transaction,TransactionBuilder,nativeToScVal,scValToNative,xdr} from '@stellar/stellar-sdk';
import {GrapnelError,NETWORK,NETWORK_PASSPHRASE,PreparedActionSchema,fromAtomic,type CustomerContext,type PreparedAction} from '@grapnel/contracts';
import {Buffer} from 'buffer';
import {CCTP_CUSTOMER_PINS as P} from './cctp-customer-pins';
const evmRecipientBytes32=(value:string)=>{if(!/^0x[a-fA-F0-9]{40}$/.test(value)||/^0x0{40}$/i.test(value))throw Error('Invalid receiving wallet.');return '0x'+value.slice(2).toLowerCase().padStart(64,'0');};
const stellarAtomicToCctp=(value:bigint)=>{if(value<=0n||value%10n)throw Error('Enter an amount with at most six decimal places.');return value/10n;};
export const CCTP_BURN_ACTION='perps.fund_cctp';
export const CCTP_CIRCLE_ASSET_ID=`stellar-testnet:classic:USDC:${P.stellar.issuer}`;
export const CCTP_BURN_MAX_NETWORK_FEE=10_000_000n;
const CODES=['a04c09f4bf064cfafb7e4e931752de15a216af1d59373bdd9d53908e7d29a9fe','8927f7389410044b35b1d3d0d7d42ea4ed0677dea18cb1bd89be4a980566c614'];
export interface CctpBurnRequest{operationId:string;customer:CustomerContext;amountStellarAtomic:string;evmRecipient:string;destinationDomain:19;expiresAt:string;maxFeeStroops:string;}
/** Supplied by a server-owned binding reader, never derived from request recipient alone. */
export interface CctpRecipientBinding{businessId:string;customerId:string;walletId:string;walletAddress:string;evmRecipient:string;network:'hyperevm-testnet';chainId:998;}
export interface CctpBurnIntent{operationId:string;businessId:string;customerId:string;walletId:string;walletAddress:string;amountAtomic:bigint;evmRecipient:string;recipientBytes32:string;expiresAt:string;feeCeiling:bigint;}
export const cctpFail=(code:string):never=>{throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','This transfer needs a fresh review',false,{reason:code});};
const bytes=(v:{toXDR(format:'base64'):string})=>v.toXDR('base64');
const addr=(s:string)=>new Address(s).toScVal();
export function cctpBurnIntent(request:CctpBurnRequest,binding:CctpRecipientBinding|null,now=Date.now()):CctpBurnIntent{
 const c=request.customer,expiry=Date.parse(request.expiresAt);
 if(!c||!c.businessId||!c.customerId||!c.walletId||!c.privyUserId||!StrKey.isValidEd25519PublicKey(c.walletAddress)||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.operationId)||request.destinationDomain!==19||!Number.isFinite(expiry)||expiry<=now||expiry>now+120000)return cctpFail('CCTP_INTENT_INVALID');
 if(!binding||binding.businessId!==c.businessId||binding.customerId!==c.customerId||binding.walletId!==c.walletId||binding.walletAddress!==c.walletAddress||binding.network!=='hyperevm-testnet'||binding.chainId!==998||binding.evmRecipient.toLowerCase()!==request.evmRecipient.toLowerCase())return cctpFail('CCTP_RECIPIENT_BINDING_REQUIRED');
 let recipientBytes32:string;try{recipientBytes32=evmRecipientBytes32(request.evmRecipient);}catch{return cctpFail('CCTP_RECIPIENT_INVALID');}
 if(typeof request.amountStellarAtomic!=='string'||!/^[1-9]\d{0,38}$/.test(request.amountStellarAtomic))return cctpFail('CCTP_AMOUNT_INVALID');
 const amountAtomic=BigInt(request.amountStellarAtomic);let canonicalAmount:bigint;try{canonicalAmount=stellarAtomicToCctp(amountAtomic);}catch{return cctpFail('CCTP_AMOUNT_PRECISION_INVALID');}if(canonicalAmount>1_000_000_000n)return cctpFail('CCTP_TESTNET_AMOUNT_LIMIT');
 if(typeof request.maxFeeStroops!=='string'||!/^[1-9]\d{0,7}$/.test(request.maxFeeStroops))return cctpFail('CCTP_NETWORK_FEE_INVALID');
 const feeCeiling=BigInt(request.maxFeeStroops);if(feeCeiling<=100n||feeCeiling>CCTP_BURN_MAX_NETWORK_FEE)return cctpFail('CCTP_NETWORK_FEE_LIMIT');
 return Object.freeze({operationId:request.operationId,businessId:c.businessId,customerId:c.customerId,walletId:c.walletId,walletAddress:c.walletAddress,amountAtomic,evmRecipient:request.evmRecipient.toLowerCase(),recipientBytes32,expiresAt:new Date(Math.floor(expiry/1000)*1000).toISOString(),feeCeiling});
}
/** Deployed ABI: caller,address; amount,i128; domain,u32; recipient,bytes32;
 * token,address; destination_caller,bytes32; max_fee,i128; finality,u32.
 * Fixed max_fee0 is USDC-denominated. It is distinct from the XLM network fee. */
export function buildCctpBurnOperation(intent:CctpBurnIntent):xdr.Operation{
 return new Contract(P.stellar.messenger).call('deposit_for_burn',addr(intent.walletAddress),nativeToScVal(intent.amountAtomic,{type:'i128'}),nativeToScVal(19,{type:'u32'}),xdr.ScVal.scvBytes(Buffer.from(intent.recipientBytes32.slice(2),'hex')),addr(P.stellar.usdc),xdr.ScVal.scvBytes(Buffer.alloc(32)),nativeToScVal(0n,{type:'i128'}),nativeToScVal(2000,{type:'u32'}));
}
export function inspectCctpBurnAuthorization(entries:xdr.SorobanAuthorizationEntry[],intent:CctpBurnIntent):void{
 try{if(entries.length!==1||entries[0]!.credentials().switch().name!=='sorobanCredentialsSourceAccount')throw Error();const root=entries[0]!.rootInvocation();if(root.function().switch().name!=='sorobanAuthorizedFunctionTypeContractFn'||root.subInvocations().length||bytes(root.function().contractFn())!==bytes(buildCctpBurnOperation(intent).body().invokeHostFunctionOp().hostFunction().invokeContract()))throw Error();}catch{return cctpFail('CCTP_AUTH_MISMATCH');}
}
export function inspectCctpBurnFootprint(data:xdr.SorobanTransactionData,intent:CctpBurnIntent):void{
 try{
  const r=data.resources(),ro=r.footprint().readOnly(),rw=r.footprint().readWrite(),all=[...ro,...rw].map(bytes);
  if(data.ext().switch()!==0||BigInt(data.resourceFee().toString())<0n||BigInt(data.resourceFee().toString())+100n>intent.feeCeiling||r.instructions()<=0||r.instructions()>50_000_000||r.diskReadBytes()>1_048_576||r.writeBytes()>131072||all.length>40||!rw.length||new Set(all).size!==all.length)throw Error();
  const instances=new Set<string>(),codes=new Set<string>();let allowance=false,trustline=false,balance=false;
  for(const [write,list]of [[false,ro],[true,rw]] as const)for(const key of list){
   if(key.switch().name==='trustline'){const t=key.trustLine(),a=t.asset();if(!write||StrKey.encodeEd25519PublicKey(t.accountId().ed25519())!==intent.walletAddress||a.switch().name!=='assetTypeCreditAlphanum4'||a.alphaNum4().assetCode().toString().replace(/\0+$/,'')!=='USDC'||StrKey.encodeEd25519PublicKey(a.alphaNum4().issuer().ed25519())!==P.stellar.issuer)throw Error();trustline=true;continue;}
   if(key.switch().name==='account'){const who=StrKey.encodeEd25519PublicKey(key.account().accountId().ed25519());if(write||![intent.walletAddress,P.stellar.issuer].includes(who))throw Error();continue;}
   if(key.switch().name==='contractCode'){const hash=key.contractCode().hash().toString('hex');if(write||!CODES.includes(hash))throw Error();codes.add(hash);continue;}
   if(key.switch().name!=='contractData')throw Error();const d=key.contractData(),id=Address.fromScAddress(d.contract()).toString(),dur=d.durability().name;
   if(d.key().switch().name==='scvLedgerKeyContractInstance'){if(write||dur!=='persistent'||!new Set<string>([P.stellar.messenger,P.stellar.transmitter,P.stellar.usdc]).has(id))throw Error();instances.add(id);continue;}
   const v:unknown=scValToNative(d.key());
   if(id===P.stellar.usdc){if(!Array.isArray(v)||v.length!==2)throw Error();if(v[0]==='Balance'&&v[1]===P.stellar.messenger&&write&&dur==='persistent'){balance=true;continue;}
    if(v[0]==='Allowance'&&write&&dur==='temporary'&&v[1]&&typeof v[1]==='object'&&!Array.isArray(v[1])){const fields=v[1]as Record<string,unknown>;if(Object.keys(fields).sort().join(',')==='from,spender'&&fields.from===intent.walletAddress&&fields.spender===P.stellar.messenger){allowance=true;continue;}}throw Error();
   }
   if(write||dur!=='persistent'||!new Set<string>([P.stellar.messenger,P.stellar.transmitter]).has(id))throw Error();
   if(v==='Paused'||Array.isArray(v)&&v.length===1&&v[0]==='Paused')continue;
   if(id!==P.stellar.messenger||!Array.isArray(v)||v.length!==2)throw Error();const[name,target]=v;
   if(name==='RemoteTokenMessenger'&&target===19)continue;
   if(['MinFeeByBurnToken','BurnLimit','TokenDecimalConfig'].includes(String(name))&&target===P.stellar.usdc)continue;
   if(name==='Denylist'&&target===intent.walletAddress)continue;
   throw Error();
  }
  if(instances.size!==3||codes.size!==2||!trustline||!allowance||!balance)throw Error();
 }catch{return cctpFail('CCTP_FOOTPRINT_UNREVIEWED');}
}
export function inspectPreparedCctpBurn(action:PreparedAction,tx:Transaction,intent:CctpBurnIntent,expectedSequence:bigint,now=Date.now()):void{
 try{
  PreparedActionSchema.parse(action);const summary=action.summary;if(now>=Date.parse(intent.expiresAt))throw Error();
  if(action.operationId!==intent.operationId||action.customerId!==intent.customerId||action.walletAddress!==intent.walletAddress||action.network!==NETWORK||summary.action!==CCTP_BURN_ACTION||summary.amount!==fromAtomic(intent.amountAtomic,7)||summary.fromAssetId!==CCTP_CIRCLE_ASSET_ID||summary.toAssetId!==undefined||summary.minReceive!==undefined||summary.positionId!==undefined||summary.recipient!==intent.evmRecipient||summary.contractId!==P.stellar.messenger||summary.expiresAt!==intent.expiresAt||action.authorization.method!=='privy_stellar'||action.authorization.expiresAt!==intent.expiresAt||summary.maxFeeStroops!==tx.fee||action.unsignedXdr!==tx.toXDR()||action.signingHashHex!==tx.hash().toString('hex')||tx.networkPassphrase!==NETWORK_PASSPHRASE||tx.source!==intent.walletAddress||BigInt(tx.sequence)!==expectedSequence||tx.signatures.length||tx.memo.type!=='none'||tx.extraSigners?.length||tx.operations.length!==1||!tx.timeBounds||tx.timeBounds.minTime!=='0'||BigInt(tx.timeBounds.maxTime)!==BigInt(Date.parse(intent.expiresAt)/1000)||BigInt(tx.fee)<=100n||BigInt(tx.fee)>intent.feeCeiling)throw Error();
  const op=tx.operations[0];if(op?.type!=='invokeHostFunction'||op.source||op.func.switch().name!=='hostFunctionTypeInvokeContract'||bytes(op.func)!==bytes(buildCctpBurnOperation(intent).body().invokeHostFunctionOp().hostFunction()))throw Error();
  inspectCctpBurnAuthorization(op.auth??[],intent);const ext=tx.toEnvelope().v1().tx().ext();if(ext.switch()!==1)throw Error();inspectCctpBurnFootprint(ext.sorobanData(),intent);if(BigInt(tx.fee)<BigInt(ext.sorobanData().resourceFee().toString())+100n)throw Error();
 }catch{return cctpFail('CCTP_PREPARED_INTENT_MISMATCH');}
}
