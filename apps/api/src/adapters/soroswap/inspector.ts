import { verifySignedAction } from '../stellar/index.js';
import {Address, Asset, Transaction, TransactionBuilder, SorobanDataBuilder, StrKey, rpc, scValToNative, xdr} from '@stellar/stellar-sdk';
import {GrapnelError, NETWORK, NETWORK_PASSPHRASE, PreparedActionSchema, XLM, toAtomic, type PreparedAction} from '@grapnel/contracts';
import type {SpotMarket,SpotXdrInspector} from './index.js';
export const SOROSWAP_TESTNET_REGISTRY='https://raw.githubusercontent.com/soroswap/core/main/public/testnet.contracts.json';
export const USDC_ISSUER='GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56';
export const NATIVE_SAC=Asset.native().contractId(NETWORK_PASSPHRASE);
export const USDC_SAC=new Asset('USDC',USDC_ISSUER).contractId(NETWORK_PASSPHRASE);
export interface SwapRegistry {router:string;factory:string;pair:string;routerHash:string;pairHash:string;}
export interface SwapIntent {wallet:string;amount:bigint;minimum:bigint;expiresAt:string;}
const fail=(message:string):never=>{throw new GrapnelError(403,'SOROSWAP_INTENT_MISMATCH',message);};
const addr=(a:xdr.ScAddress)=>Address.fromScAddress(a).toString();
const encoded=(a:{toXDR(format:'base64'):string})=>a.toXDR('base64');
const keys=(a:xdr.LedgerKey[])=>a.map(encoded).sort().join(':');
const MAX_FEE=10_000_000n;
async function bounded<T>(task:Promise<T>):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([task,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new GrapnelError(503,'PROVIDER_UNAVAILABLE','Current Testnet inspection timed out',true)),15000);})]);}
 finally{if(timer)clearTimeout(timer);}
}
/** Source-only exact-in native XLM -> issuer-pinned USDC. No aggregators, hops or fees. */
export function inspectSwapTransaction(tx:Transaction,intent:SwapIntent,reg:SwapRegistry,original=false,observedNow=Date.now()):void {
 try {
  const expires=Date.parse(intent.expiresAt),now=observedNow;
  if(tx.networkPassphrase!==NETWORK_PASSPHRASE||tx.source!==intent.wallet||!StrKey.isValidEd25519PublicKey(intent.wallet)||BigInt(tx.sequence)<=0n||tx.memo.type!=='none'||tx.extraSigners?.length||tx.operations.length!==1||tx.signatures.length)throw Error();
  if(tx.toEnvelope().v1().tx().cond().switch().name!=='precondTime'||!tx.timeBounds||tx.timeBounds.minTime!=='0'||tx.timeBounds.maxTime==='0'||!Number.isFinite(expires)||expires<=now||expires>now+120000)throw Error();
  const end=Number(tx.timeBounds.maxTime)*1000;
  if(end<=now||end>(original?now+300000:expires))throw Error();
  if(intent.amount<=0n||intent.minimum<=0n||BigInt(tx.fee)>MAX_FEE||BigInt(tx.fee)<=100n)throw Error();
  const op=tx.operations[0];if(op?.type!=='invokeHostFunction'||op.source||op.func.switch().name!=='hostFunctionTypeInvokeContract')throw Error();
  const fn=op.func.invokeContract(),args=fn.args();
  if(addr(fn.contractAddress())!==reg.router||fn.functionName().toString()!=='swap_exact_tokens_for_tokens'||args.length!==5||args[0]!.switch().name!=='scvI128'||args[1]!.switch().name!=='scvI128'||args[2]!.switch().name!=='scvVec'||args[3]!.switch().name!=='scvAddress'||args[4]!.switch().name!=='scvU64')throw Error();
  const [amount,min,path,to,deadline]=args.map(scValToNative);
  if(amount!==intent.amount||min!==intent.minimum||!Array.isArray(path)||path.length!==2||path[0]!==NATIVE_SAC||path[1]!==USDC_SAC||to!==intent.wallet||typeof deadline!=='bigint'||deadline*1000n<BigInt(end)||deadline*1000n>BigInt(now+3600000))throw Error();
  const auth=op.auth??[];if(auth.length!==1||auth[0]!.credentials().switch().name!=='sorobanCredentialsSourceAccount')throw Error();
  const root=auth[0]!.rootInvocation();if(root.function().switch().name!=='sorobanAuthorizedFunctionTypeContractFn'||encoded(root.function().contractFn())!==encoded(fn)||root.subInvocations().length!==1)throw Error();
  const child=root.subInvocations()[0]!;if(child.function().switch().name!=='sorobanAuthorizedFunctionTypeContractFn'||child.subInvocations().length)throw Error();
  const transfer=child.function().contractFn(),t=transfer.args().map(scValToNative);
  if(addr(transfer.contractAddress())!==NATIVE_SAC||transfer.functionName().toString()!=='transfer'||t.length!==3||t[0]!==intent.wallet||t[1]!==reg.pair||t[2]!==intent.amount)throw Error();
  const ext=tx.toEnvelope().v1().tx().ext();if(ext.switch()!==1)throw Error();const data=ext.sorobanData(),res=data.resources();
  if(data.ext().switch()!==0||BigInt(data.resourceFee().toString())<=0n||BigInt(tx.fee)<BigInt(data.resourceFee().toString())+100n||res.instructions()<=0||res.instructions()>10000000||res.diskReadBytes()>1048576||res.writeBytes()>131072)throw Error();
  const ro=res.footprint().readOnly(),rw=res.footprint().readWrite();if(ro.length!==5||rw.length!==5||new Set([...ro,...rw].map(encoded)).size!==10)throw Error();
  const expectedRo=new Set([`instance:${reg.router}`,`instance:${NATIVE_SAC}`,`instance:${USDC_SAC}`,`code:${reg.routerHash}`,`code:${reg.pairHash}`]);
  const expectedRw=new Set(['account','trustline',`instance:${reg.pair}`,`balance:${NATIVE_SAC}`,`balance:${USDC_SAC}`]);
  for(const [writable,list] of [[false,ro],[true,rw]] as const)for(const key of list){
   let tag:string;
   if(key.switch().name==='account'){if(!writable||StrKey.encodeEd25519PublicKey(key.account().accountId().ed25519())!==intent.wallet)throw Error();tag='account';}
   else if(key.switch().name==='trustline'){
    const line=key.trustLine(),asset=line.asset();if(!writable||StrKey.encodeEd25519PublicKey(line.accountId().ed25519())!==intent.wallet||asset.switch().name!=='assetTypeCreditAlphanum4'||asset.alphaNum4().assetCode().toString().replace(/\0/g,'')!=='USDC'||StrKey.encodeEd25519PublicKey(asset.alphaNum4().issuer().ed25519())!==USDC_ISSUER)throw Error();tag='trustline';
   }else if(key.switch().name==='contractCode'){if(writable)throw Error();tag=`code:${key.contractCode().hash().toString('hex')}`;}
   else if(key.switch().name==='contractData'){
    const cd=key.contractData(),id=addr(cd.contract());if(cd.durability().name!=='persistent')throw Error();
    if(cd.key().switch().name==='scvLedgerKeyContractInstance')tag=`instance:${id}`;
    else {const k=scValToNative(cd.key());if(!writable||!Array.isArray(k)||k.length!==2||k[0]!=='Balance'||k[1]!==reg.pair)throw Error();tag=`balance:${id}`;}
   }else throw Error();
   const set=writable?expectedRw:expectedRo;if(!set.delete(tag))throw Error();
  }
  if(expectedRo.size||expectedRw.size)throw Error();
 }catch{fail('Swap transaction, authorization, footprint, bounds or fee differs from the reviewed direct XLM/USDC intent');}
}
/** Canonical changes are limited to shorter expiry and bounded numeric resources/fees.
 * Invocation deadline remains <= one hour, but its signature cannot outlive the
 * envelope's <= quote/120s expiry. No operation or authorization byte changes. */
function rebuild(tx:Transaction,expiresAt:string,data:xdr.SorobanTransactionData,fee:string):Transaction {
 const maxTime=Math.min(Number(tx.timeBounds?.maxTime),Math.floor(Date.parse(expiresAt)/1000));
 return TransactionBuilder.cloneFrom(tx,{networkPassphrase:NETWORK_PASSPHRASE,fee:(BigInt(fee)-BigInt(data.resourceFee().toString())).toString(),sorobanData:data,timebounds:{minTime:0,maxTime}}).build();
}
export function narrowSwapTimebounds(tx:Transaction,expiresAt:string):Transaction {
 return rebuild(tx,expiresAt,tx.toEnvelope().v1().tx().ext().sorobanData(),tx.fee);
}
export function assertCanonicalSwapTransformation(originalXdr:string,action:PreparedAction):void {
 if(action.unsignedXdr===originalXdr)return;
 try{
  const raw=TransactionBuilder.fromXDR(originalXdr,NETWORK_PASSPHRASE),final=TransactionBuilder.fromXDR(action.unsignedXdr,NETWORK_PASSPHRASE);
  if(!(raw instanceof Transaction)||!(final instanceof Transaction)||final.signatures.length)throw Error();
  const a=raw.toEnvelope().v1().tx().ext().sorobanData(),b=final.toEnvelope().v1().tx().ext().sorobanData(),ar=a.resources(),br=b.resources();
  if(a.ext().switch()!==0||b.ext().switch()!==0||encoded(ar.footprint())!==encoded(br.footprint())||br.instructions()<ar.instructions()||br.instructions()>10000000||br.diskReadBytes()<ar.diskReadBytes()||br.diskReadBytes()>1048576||br.writeBytes()<ar.writeBytes()||br.writeBytes()>131072||BigInt(b.resourceFee().toString())<BigInt(a.resourceFee().toString())||BigInt(final.fee)<BigInt(raw.fee)||BigInt(final.fee)>MAX_FEE||BigInt(final.fee)<BigInt(b.resourceFee().toString())+100n)throw Error();
  const canonicalData=new SorobanDataBuilder(a).setResourceFee(b.resourceFee().toString()).setResources(br.instructions(),br.diskReadBytes(),br.writeBytes()).build();
  if(rebuild(raw,action.summary.expiresAt,canonicalData,final.fee).toXDR()!==action.unsignedXdr)throw Error();
 }catch{throw new GrapnelError(403,'PREPARED_ACTION_MISMATCH','Inspector changed fields beyond narrowed expiry and bounded numeric resource/fee reconstruction');}
}
function requireSimulation(tx:Transaction,sim:rpc.Api.SimulateTransactionResponse,coverage:boolean):asserts sim is rpc.Api.SimulateTransactionSuccessResponse {
 if(!rpc.Api.isSimulationSuccess(sim)||rpc.Api.isSimulationRestore(sim)||!sim.result)return fail('Exact narrowed transaction failed enforce simulation');
 const declared=tx.toEnvelope().v1().tx().ext().sorobanData(),observed=sim.transactionData.build(),a=declared.resources(),b=observed.resources();
 if(sim.result.auth.length!==1||encoded(sim.result.auth[0]!)!==encoded((tx.operations[0] as {auth:xdr.SorobanAuthorizationEntry[]}).auth[0]!)||keys(a.footprint().readOnly())!==keys(b.footprint().readOnly())||keys(a.footprint().readWrite())!==keys(b.footprint().readWrite())||b.instructions()>10000000||b.diskReadBytes()>1048576||b.writeBytes()>131072||BigInt(sim.minResourceFee)+100n>MAX_FEE)fail('Fresh simulation changed auth, footprint or exceeded bounded resources');
 if(coverage&&(a.instructions()<b.instructions()||a.diskReadBytes()<b.diskReadBytes()||a.writeBytes()<b.writeBytes()||BigInt(declared.resourceFee().toString())<BigInt(sim.minResourceFee)||BigInt(tx.fee)<BigInt(sim.minResourceFee)+100n))fail('Fresh simulation exceeds approved numeric resource budget');
}
export function reconstructSwapResources(tx:Transaction,sim:rpc.Api.SimulateTransactionResponse,expiresAt:string):Transaction {
 requireSimulation(tx,sim,false);
 const original=tx.toEnvelope().v1().tx().ext().sorobanData(),a=original.resources(),b=sim.transactionData.build().resources();
 const instructions=Math.max(a.instructions(),Math.ceil(b.instructions()*1.10));
 const resourceFee=BigInt(original.resourceFee().toString())>((BigInt(sim.minResourceFee)*110n+99n)/100n+1000n)?BigInt(original.resourceFee().toString()):(BigInt(sim.minResourceFee)*110n+99n)/100n+1000n;
 const data=new SorobanDataBuilder(original).setResourceFee(resourceFee.toString()).setResources(instructions,Math.max(a.diskReadBytes(),b.diskReadBytes()),Math.max(a.writeBytes(),b.writeBytes())).build();
 return rebuild(tx,expiresAt,data,(BigInt(tx.fee)>resourceFee+100n?BigInt(tx.fee):resourceFee+100n).toString());
}
/** Callback for the common exact-envelope signature verifier; never verifies a signature itself. */
export function inspectApprovedSwapTransaction(action:PreparedAction,tx:Transaction,reg:SwapRegistry,observedNow=Date.now()):void {
 PreparedActionSchema.parse(action);
 if(action.network!==NETWORK||action.authorization.method!=='privy_stellar'||action.summary.action!=='spot.swap'||action.summary.fromAssetId!==XLM.id||action.summary.toAssetId!==`stellar-testnet:classic:USDC:${USDC_ISSUER}`||action.summary.recipient!==action.walletAddress||action.summary.contractId!==reg.router||action.summary.maxFeeStroops!==tx.fee||action.summary.expiresAt!==action.authorization.expiresAt||action.signingHashHex!==tx.hash().toString('hex'))fail('Approved summary differs from exact reviewed swap');
 const envelope=tx.toEnvelope();envelope.v1().signatures([]);
 inspectSwapTransaction(new Transaction(envelope,NETWORK_PASSPHRASE),{wallet:action.walletAddress,amount:toAtomic(action.summary.amount??'',7),minimum:toAtomic(action.summary.minReceive??'',7),expiresAt:action.summary.expiresAt},reg,false,observedNow);
}
export interface InspectorDependencies {server?:Pick<rpc.Server,'getNetwork'|'getAccount'|'getContractData'|'simulateTransaction'>;fetcher?:typeof fetch;}
/** Preparation and inspection only; contains no signing or broadcasting method. */
export class SoroswapDirectInspector {
 private server:NonNullable<InspectorDependencies['server']>;private fetcher:typeof fetch;
 constructor(private pair:string,deps:InspectorDependencies={}){this.server=deps.server??new rpc.Server('https://soroban-testnet.stellar.org');this.fetcher=deps.fetcher??fetch;}
 async registry():Promise<SwapRegistry>{
  if((await bounded(this.server.getNetwork())).passphrase!==NETWORK_PASSPHRASE)fail('RPC must report explicit Stellar Testnet');
  const response=await this.fetcher(SOROSWAP_TESTNET_REGISTRY,{signal:AbortSignal.timeout(15000)});if(!response.ok)fail('Official Testnet registry unavailable');
  const body=await response.json() as {ids?:Record<string,string>;hashes?:Record<string,string>};
  const reg:SwapRegistry={router:body.ids?.router??'',factory:body.ids?.factory??'',pair:this.pair,routerHash:body.hashes?.router??'',pairHash:body.hashes?.pair??''};
  if(![reg.router,reg.factory,reg.pair].every(StrKey.isValidContract)||![reg.routerHash,reg.pairHash].every(h=>/^[a-f0-9]{64}$/.test(h)))fail('Invalid official registry');
  const ids=[reg.router,reg.pair,NATIVE_SAC,USDC_SAC];const entries=await Promise.all(ids.map(id=>bounded(this.server.getContractData(id,xdr.ScVal.scvLedgerKeyContractInstance()))));
  for(let i=0;i<entries.length;i++){const exe=entries[i]!.val.contractData().val().instance().executable();if(i<2){if(exe.switch().name!=='contractExecutableWasm'||exe.wasmHash().toString('hex')!==(i===0?reg.routerHash:reg.pairHash))fail('Live contract executable differs from official registry');}else if(exe.switch().name!=='contractExecutableStellarAsset')fail('Exact token must be a Stellar Asset Contract');}
  const storage=entries[1]!.val.contractData().val().instance().storage()??[];const value=(key:number)=>{const e=storage.find(e=>scValToNative(e.key())===key);return e?scValToNative(e.val()):undefined;};
  if(value(0)!==USDC_SAC||value(1)!==NATIVE_SAC||value(4)!==reg.factory||typeof value(2)!=='bigint'||typeof value(3)!=='bigint'||BigInt(value(2) as bigint)<=0n||BigInt(value(3) as bigint)<=0n)fail('Live pair identity/factory differs from the approved exact route');
  return reg;
 }
 async market():Promise<SpotMarket>{
  const reg=await this.registry();
  return {id:`stellar-testnet:soroswap:${reg.pair}:XLM-USDC`,asset_in:{...XLM,contractId:NATIVE_SAC},asset_out:{id:`stellar-testnet:classic:USDC:${USDC_ISSUER}`,network:NETWORK,kind:'classic',code:'USDC',issuer:USDC_ISSUER,contractId:USDC_SAC,decimals:7,verified:true,sourceUrl:'https://raw.githubusercontent.com/blend-capital/blend-utils/main/testnet.contracts.json'},protocols:['soroswap'],route_verified_at:new Date().toISOString(),execution_verified_at:null};
 }
 /** Revalidate exact customer signature/intent/current contracts and enforce-simulate immutable signed bytes. Root runtime must enforce Gate1 before calling. */
 async verifyForSubmission(action:PreparedAction,signedXdr:string):Promise<void>{
  const reg=await this.registry();verifySignedAction(action,signedXdr,(a,tx)=>inspectApprovedSwapTransaction(a,tx,reg));
  const tx=TransactionBuilder.fromXDR(signedXdr,NETWORK_PASSPHRASE) as Transaction;
  const account=await bounded(this.server.getAccount(action.walletAddress));if(BigInt(account.sequenceNumber())+1n!==BigInt(tx.sequence))fail('Source sequence changed before submission');
  const sim=await bounded(this.server.simulateTransaction(tx,undefined,'enforce'));requireSimulation(tx,sim,true);
 }
 readonly inspect:SpotXdrInspector=async input=>{
  const {quote,market,customer}=input;
  if(market.asset_in.id!==XLM.id||market.asset_out.id!==`stellar-testnet:classic:USDC:${USDC_ISSUER}`||market.asset_in.network!==NETWORK||market.asset_out.network!==NETWORK||market.asset_in.kind!=='native'||market.asset_out.kind!=='classic'||market.asset_out.issuer!==USDC_ISSUER||quote.network!==NETWORK||quote.market_id!==market.id||quote.asset_in_id!==market.asset_in.id||quote.asset_out_id!==market.asset_out.id||toAtomic(quote.amount_in,7)!==BigInt(quote.amount_in_atomic)||toAtomic(quote.min_receive,7)!==BigInt(quote.min_out_atomic)||market.asset_in.contractId!==NATIVE_SAC||market.asset_out.contractId!==USDC_SAC||market.asset_in.decimals!==7||market.asset_out.decimals!==7||market.protocols.length!==1||market.protocols[0]!=='soroswap'||quote.provider_quote.platform!=='router')fail('Only the direct native XLM to exact USDC router route is reviewed');
  const reg=await this.registry();const intent:SwapIntent={wallet:customer.walletAddress,amount:BigInt(quote.amount_in_atomic),minimum:BigInt(quote.min_out_atomic),expiresAt:quote.expires_at};
  const raw=TransactionBuilder.fromXDR(input.unsignedXdr,NETWORK_PASSPHRASE);if(!(raw instanceof Transaction))fail('Fee-bump envelope is unavailable');
  inspectSwapTransaction(raw as Transaction,intent,reg,true);
  const narrowed=narrowSwapTimebounds(raw as Transaction,quote.expires_at);inspectSwapTransaction(narrowed,intent,reg);
  const account=await bounded(this.server.getAccount(customer.walletAddress));if(BigInt(account.sequenceNumber())+1n!==BigInt(narrowed.sequence))fail('Source sequence changed; request a new quote');
  const initial=await bounded(this.server.simulateTransaction(narrowed,undefined,'enforce'));
  const tx=reconstructSwapResources(narrowed,initial,quote.expires_at);inspectSwapTransaction(tx,intent,reg);
  const final=await bounded(this.server.simulateTransaction(tx,undefined,'enforce'));requireSimulation(tx,final,true);inspectSwapTransaction(tx,intent,reg);
  const expiresAt=new Date(Number(tx.timeBounds!.maxTime)*1000).toISOString();
  return PreparedActionSchema.parse({operationId:input.operationId,customerId:customer.customerId,network:NETWORK,walletAddress:customer.walletAddress,unsignedXdr:tx.toXDR(),signingHashHex:tx.hash().toString('hex'),summary:{action:'spot.swap',fromAssetId:quote.asset_in_id,toAssetId:quote.asset_out_id,amount:quote.amount_in,minReceive:quote.min_receive,recipient:customer.walletAddress,contractId:reg.router,maxFeeStroops:tx.fee,expiresAt},authorization:{method:'privy_stellar',expiresAt}});
 };
}
