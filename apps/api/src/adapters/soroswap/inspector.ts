import {STANDALONE_NATIVE_ROUTES,APPROVED_TOKEN_WASM,standaloneAsset,standaloneAssetId,CORE_TESTNET_TOKENS} from './direct-assets.js';
import { verifySignedAction } from '../stellar/index.js';
import {Address, Asset, Transaction, TransactionBuilder, SorobanDataBuilder, StrKey, rpc, scValToNative, xdr} from '@stellar/stellar-sdk';
import {GrapnelError, NETWORK, NETWORK_PASSPHRASE, PreparedActionSchema, XLM, toAtomic, type PreparedAction,type AssetIdentity} from '@grapnel/contracts';
import type {SpotMarket,SpotXdrInspector} from './index.js';
export const SOROSWAP_TESTNET_REGISTRY='https://raw.githubusercontent.com/soroswap/core/main/public/testnet.contracts.json';
export const USDC_ISSUER='GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56';
export const NATIVE_SAC=Asset.native().contractId(NETWORK_PASSPHRASE);
export const USDC_SAC=new Asset('USDC',USDC_ISSUER).contractId(NETWORK_PASSPHRASE);
export interface SwapRegistry {router:string;factory:string;pair:string;routerHash:string;pairHash:string;tokenId?:string;tokenWasmHash?:string;tokenAsset?:AssetIdentity;protocolVersion?:number;}
export interface SwapIntent {wallet:string;amount:bigint;minimum:bigint;expiresAt:string;assetIn?:string;assetOut?:string;}
const fail=(message:string):never=>{throw new GrapnelError(403,'SOROSWAP_INTENT_MISMATCH',message);};
const addr=(a:xdr.ScAddress)=>Address.fromScAddress(a).toString();
const encoded=(a:{toXDR(format:'base64'):string})=>a.toXDR('base64');
const MAX_FEE=10_000_000n;
async function bounded<T>(task:Promise<T>):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([task,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new GrapnelError(503,'PROVIDER_UNAVAILABLE','Current Testnet inspection timed out',true)),15000);})]);}
 finally{if(timer)clearTimeout(timer);}
}
/** Protocol23 automatic restoration may only name already inspected persistent RW contract data. */
export function inspectSwapArchiveExtension(data:xdr.SorobanTransactionData,standalone:boolean,protocolVersion?:number):void {
 if(data.ext().switch()===0)return;
 if(data.ext().switch()!==1||!standalone||!Number.isSafeInteger(protocolVersion)||(protocolVersion??0)<23)fail('Automatic restoration is outside the reviewed current protocol scope');
 const indices=data.ext().resourceExt().archivedSorobanEntries(),rw=data.resources().footprint().readWrite();let previous=-1;
 for(const index of indices){if(!Number.isSafeInteger(index)||index<=previous||index<0||index>=rw.length||rw[index]!.switch().name!=='contractData'||rw[index]!.contractData().durability().name!=='persistent')fail('Archived indices must identify only exact inspected persistent RW contract data');previous=index;}
}
/** Source-only exact-in native XLM -> issuer-pinned USDC. No aggregators, hops or fees. */
export function inspectSwapTransaction(tx:Transaction,intent:SwapIntent,reg:SwapRegistry,original=false,observedNow=Date.now()):void {
 try {
  const expires=Date.parse(intent.expiresAt),now=observedNow;
  const token=reg.tokenId??USDC_SAC,standalone=!!reg.tokenWasmHash;
  if(standalone&&(!STANDALONE_NATIVE_ROUTES.some(r=>r.contract===token&&r.pair===reg.pair)||reg.tokenWasmHash!==APPROVED_TOKEN_WASM))throw Error();
  if(!standalone&&token!==USDC_SAC)throw Error();
  const assetIn=intent.assetIn??NATIVE_SAC,assetOut=intent.assetOut??token;
  if(!((assetIn===NATIVE_SAC&&assetOut===token)||(assetIn===token&&assetOut===NATIVE_SAC)))throw Error();
  if(tx.networkPassphrase!==NETWORK_PASSPHRASE||tx.source!==intent.wallet||!StrKey.isValidEd25519PublicKey(intent.wallet)||BigInt(tx.sequence)<=0n||tx.memo.type!=='none'||tx.extraSigners?.length||tx.operations.length!==1||tx.signatures.length)throw Error();
  if(tx.toEnvelope().v1().tx().cond().switch().name!=='precondTime'||!tx.timeBounds||tx.timeBounds.minTime!=='0'||tx.timeBounds.maxTime==='0'||!Number.isFinite(expires)||expires<=now||expires>now+120000)throw Error();
  const end=Number(tx.timeBounds.maxTime)*1000;
  if(end<=now||end>(original?now+300000:expires))throw Error();
  if(intent.amount<=0n||intent.minimum<=0n||BigInt(tx.fee)>MAX_FEE||BigInt(tx.fee)<=100n)throw Error();
  const op=tx.operations[0];if(op?.type!=='invokeHostFunction'||op.source||op.func.switch().name!=='hostFunctionTypeInvokeContract')throw Error();
  const fn=op.func.invokeContract(),args=fn.args();
  if(addr(fn.contractAddress())!==reg.router||fn.functionName().toString()!=='swap_exact_tokens_for_tokens'||args.length!==5||args[0]!.switch().name!=='scvI128'||args[1]!.switch().name!=='scvI128'||args[2]!.switch().name!=='scvVec'||args[3]!.switch().name!=='scvAddress'||args[4]!.switch().name!=='scvU64')throw Error();
  const [amount,min,path,to,deadline]=args.map(scValToNative);
  if(amount!==intent.amount||min!==intent.minimum||!Array.isArray(path)||path.length!==2||path[0]!==assetIn||path[1]!==assetOut||to!==intent.wallet||typeof deadline!=='bigint'||deadline*1000n<BigInt(end)||deadline*1000n>BigInt(now+3600000))throw Error();
  const auth=op.auth??[];if(auth.length!==1||auth[0]!.credentials().switch().name!=='sorobanCredentialsSourceAccount')throw Error();
  const root=auth[0]!.rootInvocation();if(root.function().switch().name!=='sorobanAuthorizedFunctionTypeContractFn'||encoded(root.function().contractFn())!==encoded(fn)||root.subInvocations().length!==1)throw Error();
  const child=root.subInvocations()[0]!;if(child.function().switch().name!=='sorobanAuthorizedFunctionTypeContractFn'||child.subInvocations().length)throw Error();
  const transfer=child.function().contractFn(),t=transfer.args().map(scValToNative);
  if(addr(transfer.contractAddress())!==assetIn||transfer.functionName().toString()!=='transfer'||t.length!==3||t[0]!==intent.wallet||t[1]!==reg.pair||t[2]!==intent.amount)throw Error();
  const ext=tx.toEnvelope().v1().tx().ext();if(ext.switch()!==1)throw Error();const data=ext.sorobanData(),res=data.resources();
  inspectSwapArchiveExtension(data,standalone,reg.protocolVersion);
  if(BigInt(data.resourceFee().toString())<=0n||BigInt(tx.fee)<BigInt(data.resourceFee().toString())+100n||res.instructions()<=0||res.instructions()>10000000||res.diskReadBytes()>1048576||res.writeBytes()>131072)throw Error();
  const ro=res.footprint().readOnly(),rw=res.footprint().readWrite();
  const tokenInstanceIndex=standalone?rw.findIndex(k=>k.switch().name==='contractData'&&addr(k.contractData().contract())===token&&k.contractData().key().switch().name==='scvLedgerKeyContractInstance'):-1;
  const tokenWritable=tokenInstanceIndex>=0;
  if(standalone&&tokenWritable&&(data.ext().switch()!==1||!data.ext().resourceExt().archivedSorobanEntries().includes(tokenInstanceIndex)))throw Error();
  if(ro.length!==(standalone&&!tokenWritable?6:5)||rw.length!==(standalone&&tokenWritable?6:5)||new Set([...ro,...rw].map(encoded)).size!==(standalone?11:10))throw Error();
  const expectedRo=new Set([`instance:${reg.router}`,`instance:${NATIVE_SAC}`,standalone?`code:${reg.tokenWasmHash}`:`instance:${token}`,`code:${reg.routerHash}`,`code:${reg.pairHash}`,...(standalone&&!tokenWritable?[`instance:${token}`]:[])]);
  const expectedRw=new Set(['account',...(standalone?[`wallet-balance:${token}`,...(tokenWritable?[`instance:${token}`]:[])]:['trustline']),`instance:${reg.pair}`,`balance:${NATIVE_SAC}`,`balance:${token}`]);
  for(const [writable,list] of [[false,ro],[true,rw]] as const)for(const key of list){
   let tag:string;
   if(key.switch().name==='account'){if(!writable||StrKey.encodeEd25519PublicKey(key.account().accountId().ed25519())!==intent.wallet)throw Error();tag='account';}
   else if(key.switch().name==='trustline'){
    const line=key.trustLine(),asset=line.asset();if(standalone||!writable||StrKey.encodeEd25519PublicKey(line.accountId().ed25519())!==intent.wallet||asset.switch().name!=='assetTypeCreditAlphanum4'||asset.alphaNum4().assetCode().toString().replace(/\0/g,'')!=='USDC'||StrKey.encodeEd25519PublicKey(asset.alphaNum4().issuer().ed25519())!==USDC_ISSUER)throw Error();tag='trustline';
   }else if(key.switch().name==='contractCode'){if(writable)throw Error();tag=`code:${key.contractCode().hash().toString('hex')}`;}
   else if(key.switch().name==='contractData'){
    const cd=key.contractData(),id=addr(cd.contract());if(cd.durability().name!=='persistent')throw Error();
    if(cd.key().switch().name==='scvLedgerKeyContractInstance')tag=`instance:${id}`;
    else {const k=scValToNative(cd.key());if(!writable||!Array.isArray(k)||k.length!==2||k[0]!=='Balance')throw Error();if(standalone&&id===token&&k[1]===intent.wallet)tag=`wallet-balance:${id}`;else if(k[1]===reg.pair)tag=`balance:${id}`;else throw Error();}
   }else throw Error();
   const set=writable?expectedRw:expectedRo;if(!set.delete(tag))throw Error();
  }
  if(expectedRo.size||expectedRw.size)throw Error();
 }catch{fail('Swap transaction, authorization, footprint, bounds or fee differs from the reviewed direct XLM token intent');}
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
  if(![0,1].includes(a.ext().switch())||encoded(a.ext())!==encoded(b.ext())||encoded(ar.footprint())!==encoded(br.footprint())||br.instructions()<ar.instructions()||br.instructions()>10000000||br.diskReadBytes()<ar.diskReadBytes()||br.diskReadBytes()>1048576||br.writeBytes()<ar.writeBytes()||br.writeBytes()>131072||BigInt(b.resourceFee().toString())<BigInt(a.resourceFee().toString())||BigInt(final.fee)<BigInt(raw.fee)||BigInt(final.fee)>MAX_FEE||BigInt(final.fee)<BigInt(b.resourceFee().toString())+100n)throw Error();
  const canonicalData=new SorobanDataBuilder(a).setResourceFee(b.resourceFee().toString()).setResources(br.instructions(),br.diskReadBytes(),br.writeBytes()).build();
  if(rebuild(raw,action.summary.expiresAt,canonicalData,final.fee).toXDR()!==action.unsignedXdr)throw Error();
 }catch{throw new GrapnelError(403,'PREPARED_ACTION_MISMATCH','Inspector changed fields beyond narrowed expiry and bounded numeric resource/fee reconstruction');}
}
function requireSimulation(tx:Transaction,sim:rpc.Api.SimulateTransactionResponse,coverage:boolean):asserts sim is rpc.Api.SimulateTransactionSuccessResponse {
 if(!rpc.Api.isSimulationSuccess(sim)||rpc.Api.isSimulationRestore(sim)||!sim.result)return fail('Exact narrowed transaction failed enforce simulation');
 const declared=tx.toEnvelope().v1().tx().ext().sorobanData(),observed=sim.transactionData.build(),a=declared.resources(),b=observed.resources();
 if(encoded(declared.ext())!==encoded(observed.ext())||sim.result.auth.length!==1||encoded(sim.result.auth[0]!)!==encoded((tx.operations[0] as {auth:xdr.SorobanAuthorizationEntry[]}).auth[0]!)||encoded(a.footprint())!==encoded(b.footprint())||b.instructions()>10000000||b.diskReadBytes()>1048576||b.writeBytes()>131072||BigInt(sim.minResourceFee)+100n>MAX_FEE)fail('Fresh simulation changed auth, footprint or exceeded bounded resources');
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
 if(action.network!==NETWORK||action.authorization.method!=='privy_stellar'||action.summary.action!=='spot.swap'||!((action.summary.fromAssetId===XLM.id&&action.summary.toAssetId===(reg.tokenAsset?.id??`stellar-testnet:classic:USDC:${USDC_ISSUER}`))||(action.summary.toAssetId===XLM.id&&action.summary.fromAssetId===(reg.tokenAsset?.id??`stellar-testnet:classic:USDC:${USDC_ISSUER}`)))||action.summary.recipient!==action.walletAddress||action.summary.contractId!==reg.router||action.summary.maxFeeStroops!==tx.fee||action.summary.expiresAt!==action.authorization.expiresAt||action.signingHashHex!==tx.hash().toString('hex'))fail('Approved summary differs from exact reviewed swap');
 const envelope=tx.toEnvelope();envelope.v1().signatures([]);
 inspectSwapTransaction(new Transaction(envelope,NETWORK_PASSPHRASE),{wallet:action.walletAddress,amount:toAtomic(action.summary.amount??'',7),minimum:toAtomic(action.summary.minReceive??'',7),expiresAt:action.summary.expiresAt,assetIn:action.summary.fromAssetId===XLM.id?NATIVE_SAC:(reg.tokenId??USDC_SAC),assetOut:action.summary.toAssetId===XLM.id?NATIVE_SAC:(reg.tokenId??USDC_SAC)},reg,false,observedNow);
}
export interface InspectorDependencies {server?:Pick<rpc.Server,'getNetwork'|'getAccount'|'getContractData'|'simulateTransaction'>;fetcher?:typeof fetch;}
/** Preparation and inspection only; contains no signing or broadcasting method. */
export class SoroswapDirectInspector {
 private server:NonNullable<InspectorDependencies['server']>;private fetcher:typeof fetch;
 constructor(private pair:string,deps:InspectorDependencies={}){this.server=deps.server??new rpc.Server('https://soroban-testnet.stellar.org');this.fetcher=deps.fetcher??fetch;}
 async registry():Promise<SwapRegistry>{
  const network=await bounded(this.server.getNetwork());if(network.passphrase!==NETWORK_PASSPHRASE)fail('RPC must report explicit Stellar Testnet');
  const response=await this.fetcher(SOROSWAP_TESTNET_REGISTRY,{signal:AbortSignal.timeout(15000)});if(!response.ok)fail('Official Testnet registry unavailable');
  const body=await response.json() as {ids?:Record<string,string>;hashes?:Record<string,string>};
  const reg:SwapRegistry={router:body.ids?.router??'',factory:body.ids?.factory??'',pair:this.pair,routerHash:body.hashes?.router??'',pairHash:body.hashes?.pair??''};
  if(![reg.router,reg.factory,reg.pair].every(StrKey.isValidContract)||![reg.routerHash,reg.pairHash].every(h=>/^[a-f0-9]{64}$/.test(h)))fail('Invalid official registry');
  const route=STANDALONE_NATIVE_ROUTES.find(r=>r.pair===reg.pair);const token=route?.contract??USDC_SAC;
  if(route){if(!Number.isSafeInteger(Number(network.protocolVersion))||Number(network.protocolVersion)<23)fail('Standalone restoration requires live protocol23 or newer');reg.protocolVersion=Number(network.protocolVersion);if(body.hashes?.token!==APPROVED_TOKEN_WASM)fail('Official standalone token code differs from reviewed implementation');reg.tokenId=token;reg.tokenWasmHash=APPROVED_TOKEN_WASM;}
  const ids=[reg.router,reg.pair,NATIVE_SAC,token];const entries=await Promise.all(ids.map(id=>bounded(this.server.getContractData(id,xdr.ScVal.scvLedgerKeyContractInstance()))));
  for(let i=0;i<entries.length;i++){const exe=entries[i]!.val.contractData().val().instance().executable();if(i<2){if(exe.switch().name!=='contractExecutableWasm'||exe.wasmHash().toString('hex')!==(i===0?reg.routerHash:reg.pairHash))fail('Live contract executable differs from official registry');}else if(i===3&&route){if(exe.switch().name!=='contractExecutableWasm'||exe.wasmHash().toString('hex')!==APPROVED_TOKEN_WASM)fail('Standalone token executable differs from reviewed official hash');}else if(exe.switch().name!=='contractExecutableStellarAsset')fail('Exact token must be a Stellar Asset Contract');}
  const storage=entries[1]!.val.contractData().val().instance().storage()??[];const value=(key:number)=>{const e=storage.find(e=>scValToNative(e.key())===key);return e?scValToNative(e.val()):undefined;};
  if(!([value(0),value(1)].includes(token)&&[value(0),value(1)].includes(NATIVE_SAC))||value(4)!==reg.factory||typeof value(2)!=='bigint'||typeof value(3)!=='bigint'||BigInt(value(2) as bigint)<=0n||BigInt(value(3) as bigint)<=0n)fail('Live pair identity/factory differs from the approved exact route');
  if(route){const metadata=(entries[3]!.val.contractData().val().instance().storage()??[]).find(e=>scValToNative(e.key())==='METADATA');const m=metadata?scValToNative(metadata.val()) as {decimal?:unknown;symbol?:unknown;name?:unknown}:undefined;if(m?.decimal!==7||m.symbol!==route.code||m.name!==route.name)fail('Standalone token metadata differs from official Testnet identity');reg.tokenAsset=standaloneAsset(route);}
  return reg;
 }
 async market():Promise<SpotMarket>{
  const reg=await this.registry();
  return {id:`stellar-testnet:soroswap:${reg.pair}:XLM-${reg.tokenAsset?.code??'USDC'}`,asset_in:{...XLM,name:'Stellar Lumens',contractId:NATIVE_SAC},asset_out:reg.tokenAsset??{id:`stellar-testnet:classic:USDC:${USDC_ISSUER}`,network:NETWORK,kind:'classic',code:'USDC',issuer:USDC_ISSUER,contractId:USDC_SAC,decimals:7,verified:true,sourceUrl:'https://raw.githubusercontent.com/blend-capital/blend-utils/main/testnet.contracts.json'},protocols:['soroswap'],route_verified_at:new Date().toISOString(),execution_verified_at:null};
 }
 async markets():Promise<SpotMarket[]>{const forward=await this.market();return [forward,{...forward,id:forward.id.replace(`:XLM-${forward.asset_out.code}`,`:${forward.asset_out.code}-XLM`),asset_in:forward.asset_out,asset_out:forward.asset_in}];}
 /** Revalidate exact customer signature/intent/current contracts and enforce-simulate immutable signed bytes. Root runtime must enforce Gate1 before calling. */
 async verifyForSubmission(action:PreparedAction,signedXdr:string):Promise<void>{
  const reg=await this.registry();verifySignedAction(action,signedXdr,(a,tx)=>inspectApprovedSwapTransaction(a,tx,reg));
  const tx=TransactionBuilder.fromXDR(signedXdr,NETWORK_PASSPHRASE) as Transaction;
  const account=await bounded(this.server.getAccount(action.walletAddress));if(BigInt(account.sequenceNumber())+1n!==BigInt(tx.sequence))fail('Source sequence changed before submission');
  const sim=await bounded(this.server.simulateTransaction(tx,undefined,'enforce'));requireSimulation(tx,sim,true);
 }
 readonly inspect:SpotXdrInspector=async input=>{
  const {quote,market,customer}=input;
  const reverse=market.asset_out.id===XLM.id;const expectedRoute=STANDALONE_NATIVE_ROUTES.find(r=>r.pair===this.pair);const expectedTokenId=expectedRoute?standaloneAssetId(expectedRoute.contract):`stellar-testnet:classic:USDC:${USDC_ISSUER}`;
  const native=reverse?market.asset_out:market.asset_in,usdc=reverse?market.asset_in:market.asset_out;
  if(native.id!==XLM.id||usdc.id!==expectedTokenId||native.network!==NETWORK||usdc.network!==NETWORK||native.kind!=='native'||usdc.kind!==(expectedRoute?'soroban':'classic')||(!expectedRoute&&usdc.issuer!==USDC_ISSUER)||quote.network!==NETWORK||quote.market_id!==market.id||quote.asset_in_id!==market.asset_in.id||quote.asset_out_id!==market.asset_out.id||toAtomic(quote.amount_in,7)!==BigInt(quote.amount_in_atomic)||toAtomic(quote.min_receive,7)!==BigInt(quote.min_out_atomic)||native.contractId!==NATIVE_SAC||usdc.contractId!==(expectedRoute?.contract??USDC_SAC)||native.decimals!==7||usdc.decimals!==7||market.protocols.length!==1||market.protocols[0]!=='soroswap'||quote.provider_quote.platform!=='router')fail('Only finite verified direct XLM token routes are reviewed');
  const reg=await this.registry();const intent:SwapIntent={wallet:customer.walletAddress,amount:BigInt(quote.amount_in_atomic),minimum:BigInt(quote.min_out_atomic),expiresAt:quote.expires_at,assetIn:reverse?(expectedRoute?.contract??USDC_SAC):NATIVE_SAC,assetOut:reverse?NATIVE_SAC:(expectedRoute?.contract??USDC_SAC)};
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
