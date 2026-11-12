import {randomBytes,randomUUID} from 'node:crypto';
import {GrapnelError} from '@grapnel/contracts';
import {signL1Action} from '@nktkas/hyperliquid/signing';
import {HL_EXCHANGE} from '../execution/types.js';
import {assertPrecision,assertPositionIntent,units} from '../execution/guards.js';
import {inspectSettlement,unknown} from '../execution/reconcile.js';
import type {ExecutionPayload} from '../execution/guards.js';
import {fail,scoped,live,hash,stable,subaccountName,atomic6,canonicalAction,inspectSolverAction,providerIntent} from './guards.js';
import {verifyNetwork,masterLiquidity,ownership,subaccounts,snapshot,readOrderContext,readPort,info,cash} from './reads.js';
import {reconcileCash,reconcileCreation} from './reconcile.js';
import type {HyperliquidSolverDependencies,SolverRequest,SolverWallet,SolverProviderAction,SolverSignedPayload,SolverReconciliation,SolverActionKind} from './types.js';
const immutable=(action:SolverProviderAction)=>({id:action.id,businessId:action.businessId,customerId:action.customerId,identityWalletId:action.identityWalletId,requestId:action.requestId,kind:action.kind,masterAddress:action.masterAddress,subAccountAddress:action.subAccountAddress,nonce:action.nonce,clientOrderId:action.clientOrderId,intentHash:action.intentHash,payload:action.payload,createdAt:action.createdAt});
const sufficientMargin=(size:string,price:string,leverage:number,withdrawable:string)=>units(withdrawable,18)*10n**18n*BigInt(leverage)>=units(size,18)*units(price,18);
/** No default signer/transport or implicit account funding. Only trusted injected server records authorize work. */
export class HyperliquidSolverAdapter{
 private d:HyperliquidSolverDependencies;
 constructor(deps:HyperliquidSolverDependencies){this.d={...deps,scope:structuredClone(deps.scope)};}
 private now(){return this.d.now?.()??Date.now();}
 private async guarded<T>(fn:()=>Promise<T>):Promise<T>{try{return await fn();}catch(error){if(error instanceof GrapnelError)throw error;return fail('SOLVER_PROVIDER_OR_PERSISTENCE_UNAVAILABLE');}}
 async readLiquidity(){return this.guarded(async()=>{await verifyNetwork(this.d);const state=await masterLiquidity(this.d,this.d.scope);return{network:'hyperliquid-testnet' as const,masterAddress:this.d.scope.masterAddress,...state,observedAt:new Date(this.now()).toISOString()};});}
 private async permitted(request:SolverRequest,kind:SolverActionKind){
  scoped(request,this.d.scope);
  if(!await this.d.verifyRequestApproval?.(structuredClone(request),structuredClone(this.d.scope),kind)||!await this.d.verifyAccessAndCapacity?.(structuredClone(this.d.scope),kind))return fail('CUSTOMER_APPROVAL_AND_SOLVER_ACCESS_REQUIRED');
  if(kind==='fund')await this.source(request);
 }
 private async source(request:SolverRequest){
  if(request.terms.kind!=='deposit')return fail('CONFIRMED_SOURCE_DEPOSIT_REQUIRED');const t=request.terms,p=await this.d.readSourceDeposit?.(structuredClone(request),structuredClone(this.d.scope));
  if(!p||p.network!=='stellar-testnet'||p.txHash!==request.txHash||!/^[a-f0-9]{64}$/.test(p.txHash)||!Number.isSafeInteger(p.ledger)||p.ledger<=0||p.source!==t.source||p.destination!==t.escrowAddress||p.assetId!==t.assetId||p.amountAtomic7!==t.amountAtomic7||p.memoHashHex!==t.memoHashHex||!/^\d+$/.test(p.feeStroops)||BigInt(p.feeStroops)<=0n||!Number.isFinite(Date.parse(p.observedAt))||Date.parse(p.observedAt)>this.now()+1000||this.now()-Date.parse(p.observedAt)>30000)return fail('EXACT_CURRENT_ESCROW_PAYMENT_PROOF_REQUIRED');
 }
 async prepareSubaccount(request:SolverRequest){return this.prepare(request,'create_subaccount');}
 async prepareTransfer(request:SolverRequest,direction:'fund'|'return',amountAtomic7:string){
  if(request.terms.kind==='order'||request.terms.amountAtomic7!==amountAtomic7)return fail('CASH_AMOUNT_DIFFERS_FROM_CUSTOMER_INTENT');
  return this.prepare(request,direction,atomic6(amountAtomic7).toString());
 }
 async prepareOrder(request:SolverRequest){return this.prepare(request,'order');}
 private async prepare(input:SolverRequest,kind:SolverActionKind,amountAtomic6:string|null=null):Promise<SolverProviderAction>{return this.guarded(async()=>{
  const request=structuredClone(input),wallet=structuredClone(this.d.scope);scoped(request,wallet);
  if(kind==='create_subaccount'&&(request.kind!=='deposit'||wallet.subAccountAddress!==null))return fail('NEW_SCOPED_SUBACCOUNT_SETUP_REQUIRED');
  if(kind==='fund'&&request.kind!=='deposit'||kind==='return'&&request.kind!=='withdraw'||kind==='order'&&request.kind!=='order')return fail('ACTION_KIND_DIFFERS_FROM_INTENT');
  await this.permitted(request,kind);await verifyNetwork(this.d);
  const beforeMaster=await masterLiquidity(this.d,wallet);let beforeSub=null;
  if(kind==='create_subaccount'){
   if((await subaccounts(this.d,wallet)).some(row=>row.name===subaccountName(wallet)))return fail('SUBACCOUNT_ALREADY_EXISTS_RECONCILE_SETUP');
  }else{await ownership(this.d,wallet);beforeSub=await snapshot(this.d,wallet.subAccountAddress!,request.terms.kind==='order'?request.terms.dex:'');}
  if(kind==='fund'||kind==='return'){
   if(!amountAtomic6||beforeMaster.positions.length)return fail('SEGREGATED_IDLE_MASTER_POOL_REQUIRED');
   const available=kind==='fund'?beforeMaster.withdrawable:beforeSub!.withdrawable;
   if(units(available,18)<BigInt(amountAtomic6)*10n**12n)return fail('ACTUAL_UNRESERVED_PROVIDER_CASH_REQUIRED');
  }
  const reserved=await this.d.repository.reserveProviderAction({id:randomUUID(),businessId:request.businessId,customerId:request.customerId,identityWalletId:request.identityWalletId,requestId:request.id,kind,masterAddress:wallet.masterAddress,subAccountAddress:wallet.subAccountAddress,clientOrderId:kind==='order'?`0x${randomBytes(16).toString('hex')}`:null,intentHash:request.intentHash,payload:null,state:'prepared',result:null,createdAt:new Date(this.now()).toISOString()});
  if(reserved.businessId!==request.businessId||reserved.customerId!==request.customerId||reserved.identityWalletId!==request.identityWalletId||reserved.requestId!==request.id||reserved.kind!==kind||reserved.masterAddress!==wallet.masterAddress||reserved.subAccountAddress!==wallet.subAccountAddress||reserved.intentHash!==request.intentHash)return fail('GLOBAL_MASTER_NONCE_RESERVATION_REQUIRED');
  if(reserved.payload!==null){await inspectSolverAction(reserved,wallet);return structuredClone(reserved);}
  if(reserved.state!=='prepared')return fail('UNCERTAIN_ACTION_REQUIRES_RECONCILIATION');live(request,reserved.nonce,this.now());
  let market=null,position=null;
  if(kind==='order'){
   const provisional={...reserved,payload:{request}} as SolverProviderAction,i=providerIntent(provisional,wallet);[market,position]=await readOrderContext(this.d,wallet,i);assertPrecision(i,market);assertPositionIntent(i,market,position);
   if(!beforeSub)return fail('FRESH_ORDER_BASELINE_REQUIRED');
   const actual=beforeSub.positions.find(row=>row.coin===i.providerSymbol);if((actual?.size??'0')!==position.size||actual&&actual.leverage!==i.leverage)return fail('EXACT_POSITION_BASELINE_REQUIRED');
   if(actual&&actual.leverageType!==position.leverageType)return fail('EXACT_POSITION_BASELINE_REQUIRED');
   position={...position,observedAt:Math.min(position.observedAt,beforeSub.time)};
   if(!i.reduceOnly&&!sufficientMargin(i.size,i.limitPrice,i.leverage,beforeSub.withdrawable))return fail('SELECTED_VENUE_COLLATERAL_REQUIRED');
  }
  const action=canonicalAction(kind,request,wallet,reserved.clientOrderId,amountAtomic6),expiresAfter=Date.parse(request.expiresAt),signer=await this.d.resolveSigner?.(this.d.signingKeyRef);
  if(!signer||signer.address.toLowerCase()!==wallet.masterAddress)return fail('CONFIGURED_MASTER_SIGNER_REQUIRED');
  const vault=kind==='order'?{vaultAddress:wallet.subAccountAddress!}:{},signature=await signL1Action({wallet:signer,action,nonce:reserved.nonce,expiresAfter,isTestnet:true,...vault});live(request,reserved.nonce,this.now());
  const payload:SolverSignedPayload={version:1,request,wallet,wire:{action,nonce:reserved.nonce,expiresAfter,...vault,signature},before:{master:beforeMaster,subaccount:beforeSub},market,position,amountAtomic6,subaccountName:subaccountName(wallet)};
  const prepared:SolverProviderAction={...reserved,payload};await inspectSolverAction(prepared,wallet);
  await this.d.repository.saveProviderPayload(wallet,prepared.id,structuredClone(payload));
  const stored=await this.d.repository.providerAction(wallet,prepared.id);if(!stored||stable(immutable(stored))!==stable(immutable(prepared)))return fail('SIGNED_SOLVER_PAYLOAD_NOT_DURABLE');return structuredClone(stored);
 });}
 private async stored(action:SolverProviderAction){const copy=structuredClone(action),p=await inspectSolverAction(copy,this.d.scope),stored=await this.d.repository.providerAction(this.d.scope,copy.id);if(!stored||stable(immutable(stored))!==stable(immutable(copy)))return fail('EXACT_STORED_SOLVER_ACTION_REQUIRED');return{copy,p};}
 async send(action:SolverProviderAction):Promise<SolverReconciliation>{return this.guarded(async()=>{
  const{copy,p}=await this.stored(action);
  if(p.wire.expiresAfter<=this.now())return this.reconcile(copy);
  await this.permitted(p.request,copy.kind);await verifyNetwork(this.d);
  if(!await this.d.repository.claimProviderSend(this.d.scope,copy.id,hash(copy.payload)))return this.reconcile(copy);
  // Claim is never reset, even when this last fresh check fails before HTTP transmission.
  const currentMaster=await masterLiquidity(this.d,p.wallet);
  if(copy.kind==='create_subaccount'){
   if((await subaccounts(this.d,p.wallet)).some(row=>row.name===p.subaccountName))return this.reconcile(copy);
  }else{
   await ownership(this.d,p.wallet);const current=await snapshot(this.d,p.wallet.subAccountAddress!,p.request.terms.kind==='order'?p.request.terms.dex:'');
   if(copy.kind==='order'){
    const i=providerIntent(copy,p.wallet),[m,pos]=await readOrderContext(this.d,p.wallet,i);
   if(stable(m)!==stable(p.market)||pos.size!==p.position!.size||pos.leverageType!==p.position!.leverageType||stable(current.positions)!==stable(p.before.subaccount!.positions)||!i.reduceOnly&&!sufficientMargin(i.size,i.limitPrice,i.leverage,current.withdrawable))return fail('POSITION_OR_MARKET_CHANGED_BEFORE_SEND');
   }else{
    if(cash(current.cashBalance)!==cash(p.before.subaccount!.cashBalance)||cash(currentMaster.cashBalance)!==cash(p.before.master.cashBalance)||stable(current.positions)!==stable(p.before.subaccount!.positions)||stable(currentMaster.positions)!==stable(p.before.master.positions))return fail('CASH_OR_POSITIONS_CHANGED_BEFORE_SEND');
    if(units(copy.kind==='fund'?currentMaster.withdrawable:current.withdrawable,18)<BigInt(p.amountAtomic6!)*10n**12n)return fail('CURRENT_WITHDRAWABLE_CASH_REQUIRED');
   }
  }
  live(p.request,copy.nonce,this.now());try{await this.d.transport.exchange(HL_EXCHANGE,structuredClone(p.wire));}catch{/* Only reconciliation follows an ambiguous send. */}
  return this.reconcile(copy);
 });}
 async reconcile(action:SolverProviderAction):Promise<SolverReconciliation>{return this.guarded(async()=>{
  const{copy,p}=await this.stored(action);await verifyNetwork(this.d);
  try{
   if(copy.kind==='create_subaccount')return await reconcileCreation(this.d,copy,p);
   await ownership(this.d,p.wallet);
   if(copy.kind==='fund'||copy.kind==='return')return await reconcileCash(this.d,copy,p);
   const i=providerIntent(copy,p.wallet),status=await inspectSettlement(readPort(this.d,p.wallet),{version:1,intent:i,account:{businessId:i.businessId,customerId:i.customerId,walletId:i.walletId,stellarAddress:p.wallet.freighterAddress,accountAddress:i.accountAddress,signingKeyRef:'solver-read-only'},market:p.market!,before:p.position!,wire:p.wire} as ExecutionPayload);
   return{state:status.state==='unknown'||status.state==='open'?'unknown':'verified',reason:status.rawStatus,order:status};
  }catch{return{state:'unknown',reason:'CURRENT_SOLVER_RECONCILIATION_PROOF_REQUIRED'};}
 });}
}
export {inspectSolverAction,subaccountName} from './guards.js';
export type {HyperliquidSolverDependencies,SolverSignedPayload,SolverReconciliation} from './types.js';
