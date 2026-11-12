/** Pure SDK/contract checks usable before a browser wallet signature. No RPC or secrets. */
import {Address,Asset,Contract,StrKey,Transaction,nativeToScVal,xdr} from '@stellar/stellar-sdk';
import {GrapnelError,NETWORK,NETWORK_PASSPHRASE,PreparedActionSchema,toAtomic,type PreparedAction} from '@grapnel/contracts';
import {CCTP_TESTNET as P} from './registry.js';
export const CIRCLE_USDC_ASSET_ID=`stellar-testnet:classic:USDC:${P.stellar.issuer}`;
export const CIRCLE_USDC_TRUSTLINE_ACTION='perps.usdc_trustline';
export const CIRCLE_USDC_ALLOWANCE_ACTION='perps.usdc_allowance';
export const CIRCLE_USDC_TRUSTLINE_LIMIT='1000.0000000';
export const CIRCLE_USDC_ALLOWANCE_LEDGER_WINDOW=120;
export const CIRCLE_USDC_MAX_SETUP_FEE=10_000_000n;
const reject=():never=>{throw new GrapnelError(403,'INTENT_MISMATCH','Circle USDC setup differs from the reviewed wallet request');};
const bytes=(v:{toXDR(format:'base64'):string})=>v.toXDR('base64');
const hex=(v:Uint8Array)=>Array.from(v).map(value=>value.toString(16).padStart(2,'0')).join('');
export function circleAllowanceAmount(value:string):bigint {
 try{const amount=toAtomic(value,7);if(amount<=0n||amount>10_000_000_000n||amount%10n)throw Error();return amount;}catch{return reject();}
}
export function buildCircleAllowanceOperation(owner:string,amount:bigint,expirationLedger:number):xdr.Operation {
 if(!StrKey.isValidEd25519PublicKey(owner)||amount<=0n||amount>10_000_000_000n||amount%10n||!Number.isSafeInteger(expirationLedger)||expirationLedger<=0||expirationLedger>4294967295)return reject();
 return new Contract(P.stellar.usdc).call('approve',new Address(owner).toScVal(),new Address(P.stellar.messenger).toScVal(),nativeToScVal(amount,{type:'i128'}),nativeToScVal(expirationLedger,{type:'u32'}));
}
/** Optional current ledger adds a freshness/window check; the server always supplies it. */
export function inspectCircleSetupOperation(action:PreparedAction,op:Transaction['operations'][number],currentLedger?:number):void {
 try{
  const s=action.summary;
  if(action.network!==NETWORK||!StrKey.isValidEd25519PublicKey(action.walletAddress)||s.fromAssetId!==CIRCLE_USDC_ASSET_ID||s.toAssetId!==undefined||s.minReceive!==undefined||s.positionId!==undefined||!s.maxFeeStroops||!/^[1-9]\d{0,7}$/.test(s.maxFeeStroops)||BigInt(s.maxFeeStroops)>CIRCLE_USDC_MAX_SETUP_FEE||op.source)throw Error();
  if(s.action===CIRCLE_USDC_TRUSTLINE_ACTION){
   if(s.amount!==CIRCLE_USDC_TRUSTLINE_LIMIT||s.recipient!==action.walletAddress||s.contractId!==undefined||s.allowanceExpirationLedger!==undefined||s.maxFeeStroops!=='100'||op.type!=='changeTrust'||!(op.line instanceof Asset)||op.line.getCode()!=='USDC'||op.line.getIssuer()!==P.stellar.issuer||op.limit!==CIRCLE_USDC_TRUSTLINE_LIMIT)throw Error();return;
  }
  if(s.action!==CIRCLE_USDC_ALLOWANCE_ACTION||s.recipient!==P.stellar.messenger||s.contractId!==P.stellar.usdc||typeof s.amount!=='string'||!s.allowanceExpirationLedger||!/^[1-9]\d{0,9}$/.test(s.allowanceExpirationLedger)||op.type!=='invokeHostFunction'||op.func.switch().name!=='hostFunctionTypeInvokeContract')throw Error();
  const ledger=Number(s.allowanceExpirationLedger),amount=circleAllowanceAmount(s.amount);
  if(!Number.isSafeInteger(ledger)||ledger>4294967295||currentLedger!==undefined&&(!Number.isSafeInteger(currentLedger)||currentLedger<=0||ledger<=currentLedger||ledger>currentLedger+CIRCLE_USDC_ALLOWANCE_LEDGER_WINDOW))throw Error();
  const expected=buildCircleAllowanceOperation(action.walletAddress,amount,ledger).body().invokeHostFunctionOp().hostFunction();
  if(bytes(op.func)!==bytes(expected)||op.auth?.length!==1||op.auth[0]!.credentials().switch().name!=='sorobanCredentialsSourceAccount')throw Error();
  const root=op.auth[0]!.rootInvocation();
  if(root.function().switch().name!=='sorobanAuthorizedFunctionTypeContractFn'||bytes(root.function().contractFn())!==bytes(expected.invokeContract())||root.subInvocations().length)throw Error();
 }catch{return reject();}
}
export function inspectCircleAllowanceFootprint(data:xdr.SorobanTransactionData,owner:string,feeCeiling:bigint):void {
 try{
  const resources=data.resources(),ro=resources.footprint().readOnly(),rw=resources.footprint().readWrite(),keys=[...ro,...rw].map(bytes);
  if(!StrKey.isValidEd25519PublicKey(owner)||data.ext().switch()!==0||BigInt(data.resourceFee().toString())<0n||BigInt(data.resourceFee().toString())+100n>feeCeiling||feeCeiling>CIRCLE_USDC_MAX_SETUP_FEE||resources.instructions()<=0||resources.instructions()>10_000_000||resources.diskReadBytes()>131072||resources.writeBytes()>32768||keys.length>8||new Set(keys).size!==keys.length||rw.length!==1)throw Error();
  let instance=false,allowance=false;
  for(const[write,list]of [[false,ro],[true,rw]]as const)for(const key of list){
   if(key.switch().name==='account'){if(write||![owner,P.stellar.issuer].includes(StrKey.encodeEd25519PublicKey(key.account().accountId().ed25519())))throw Error();continue;}
   if(key.switch().name==='trustline'){const t=key.trustLine(),a=t.asset();if(write||StrKey.encodeEd25519PublicKey(t.accountId().ed25519())!==owner||a.switch().name!=='assetTypeCreditAlphanum4'||a.alphaNum4().assetCode().toString().replace(/\0+$/,'')!=='USDC'||StrKey.encodeEd25519PublicKey(a.alphaNum4().issuer().ed25519())!==P.stellar.issuer)throw Error();continue;}
   if(key.switch().name!=='contractData')throw Error();const d=key.contractData();if(Address.fromScAddress(d.contract()).toString()!==P.stellar.usdc)throw Error();
   if(d.key().switch().name==='scvLedgerKeyContractInstance'){if(write||d.durability().name!=='persistent')throw Error();instance=true;continue;}
   if(!write||d.durability().name!=='temporary')throw Error();
   // Compare the entire canonical key XDR, including both owner and spender.
   const map=xdr.ScVal.scvMap([new xdr.ScMapEntry({key:nativeToScVal('from',{type:'symbol'}),val:new Address(owner).toScVal()}),new xdr.ScMapEntry({key:nativeToScVal('spender',{type:'symbol'}),val:new Address(P.stellar.messenger).toScVal()})]);
   const expected=xdr.ScVal.scvVec([nativeToScVal('Allowance',{type:'symbol'}),map]);
   if(bytes(d.key())!==bytes(expected))throw Error();allowance=true;
  }
  if(!instance||!allowance)throw Error();
 }catch{return reject();}
}
export interface CircleSetupReview {customerId:string;walletAddress:string;expectedSequence:bigint;currentLedger?:number;now?:number;}
/** Unsigned prepared envelope only. Signature authorization/submission is owned by the root. */
export function inspectCircleSetupPrepared(action:PreparedAction,transaction:Transaction,review:CircleSetupReview):void {
 try{
  PreparedActionSchema.parse(action);const expiry=Date.parse(action.summary.expiresAt),now=review.now??Date.now();
  if(action.customerId!==review.customerId||action.walletAddress!==review.walletAddress||transaction.networkPassphrase!==NETWORK_PASSPHRASE||transaction.source!==review.walletAddress||BigInt(transaction.sequence)!==review.expectedSequence||transaction.signatures.length||transaction.operations.length!==1||transaction.memo.type!=='none'||transaction.extraSigners?.length||transaction.toEnvelope().v1().tx().cond().switch().name!=='precondTime'||action.unsignedXdr!==transaction.toXDR()||action.signingHashHex!==hex(transaction.hash())||!Number.isFinite(expiry)||expiry<=now||expiry>now+120000||expiry%1000||action.authorization.method!=='privy_stellar'||action.authorization.expiresAt!==action.summary.expiresAt||!transaction.timeBounds||transaction.timeBounds.minTime!=='0'||BigInt(transaction.timeBounds.maxTime)*1000n!==BigInt(expiry)||transaction.fee!==action.summary.maxFeeStroops)throw Error();
  inspectCircleSetupOperation(action,transaction.operations[0]!,review.currentLedger);
  const ext=transaction.toEnvelope().v1().tx().ext();
  if(action.summary.action===CIRCLE_USDC_TRUSTLINE_ACTION){if(ext.switch()!==0)throw Error();}
  else{if(ext.switch()!==1)throw Error();inspectCircleAllowanceFootprint(ext.sorobanData(),review.walletAddress,BigInt(transaction.fee));if(BigInt(transaction.fee)<BigInt(ext.sorobanData().resourceFee().toString())+100n)throw Error();}
 }catch{return reject();}
}
