import {randomBytes,randomUUID} from 'node:crypto';
import {verifyMessage} from 'viem';
import {GrapnelError} from '@grapnel/contracts';
import {HyperliquidTestnetExecutionAdapter} from '../../adapters/hyperliquid/execution/index.js';
import type {UnsignedPerpetualAction} from '../../adapters/hyperliquid/execution/types.js';
import {hash,units,freshReceipt} from '../../adapters/hyperliquid/execution/guards.js';
import {HL_INFO} from '../../adapters/hyperliquid/execution/types.js';
import {z} from 'zod';
import type {HyperliquidExecutionDependencies,ExecutionTransport} from '../../adapters/hyperliquid/execution/types.js';
import type {ApprovedPerpetualIntent,BoundPerpetualAccount,PerpetualExecutionStatus} from './execution-contract.js';
import type {PendingPerpetualOrder,PerpetualAccount,PerpetualScope,PerpetualWorkflowStore} from './workflow-contract.js';
import {approvalDigest,bindingMessage,orderApprovalMessage,stellarApproval} from './approval.js';
import {PerpetualAccountReader} from './account-reader.js';
import {CCTP_CIRCLE_ASSET_ID} from '../../adapters/cctp/inspector.js';
export interface OrderInput {market_id:string;side:'buy'|'sell';size:string;limit_price:string;leverage:number;reduce_only:boolean;}
export interface ExecutionMarket {market_id:string;provider_symbol:string;provider_dex:string;asset_category:string;settlement_asset:{compatibility:string};underlying:{display_decimals:number};max_leverage:number;}
export interface PerpetualServiceDependencies {
 store:PerpetualWorkflowStore;transport:ExecutionTransport;
 market:(id:string)=>Promise<ExecutionMarket>;
 /** Trusted configured provider-access decision, not a body/browser assertion. */
 accessApproved:()=>Promise<boolean>;
 fundingStatus?:(scope:PerpetualScope)=>Promise<{trustline_ready:boolean;balance:string|null;allowance:string|null;bridge_available:boolean;reason:string|null}>;
 now?:()=>number;
}
const unavailable=(message:string,reason:string):never=>{throw new GrapnelError(409,'EXECUTION_UNAVAILABLE',message,false,{reason});};
const positive=(value:string)=>/^[0-9]+(?:\.[0-9]+)?$/.test(value)&&BigInt(value.replace('.',''))>0n;
const fundedVenue=(row:{withdrawable:string;positions:{size:string}[]})=>positive(row.withdrawable)||row.positions.some(position=>units(position.size,18,true)!==0n);
const bound=(a:PerpetualAccount):BoundPerpetualAccount=>({businessId:a.businessId,customerId:a.customerId,walletId:a.walletId,stellarAddress:a.stellarAddress,accountAddress:a.accountAddress,signingKeyRef:a.signingKeyRef});
export class PerpetualCustomerService {
 private now:()=>number;private accounts:PerpetualAccountReader;
 constructor(private d:PerpetualServiceDependencies){this.now=d.now??Date.now;this.accounts=new PerpetualAccountReader(d.transport,this.now);}
 async challenge(scope:PerpetualScope,address:`0x${string}`){
  const accountAddress=address.toLowerCase() as `0x${string}`,old=await this.d.store.account(scope);
  if(old&&old.accountAddress!==accountAddress)throw new GrapnelError(409,'ACCOUNT_ALREADY_BOUND','This wallet already has a different trading account');
  const id=randomUUID(),expiresAt=new Date(this.now()+300000).toISOString(),message=bindingMessage(scope,id,accountAddress,expiresAt),value={id,scope:{...scope},accountAddress,message,digest:approvalDigest(message),expiresAt};
  await this.d.store.challenge(value);return value;
 }
 async bind(scope:PerpetualScope,id:string,stellarSignature:string,evmSignature:`0x${string}`){
  const c=await this.d.store.getChallenge(scope,id);
  if(!c||Date.parse(c.expiresAt)<=this.now())throw new GrapnelError(409,'APPROVAL_EXPIRED','Account approval expired. Connect the trading wallet again');
  if(c.message!==bindingMessage(scope,c.id,c.accountAddress,c.expiresAt)||c.digest!==approvalDigest(c.message))throw new GrapnelError(409,'APPROVAL_CHANGED','Account approval changed');
  stellarApproval(scope.stellarAddress,c.digest,stellarSignature);
  if(!await verifyMessage({address:c.accountAddress,message:c.message,signature:evmSignature}).catch(()=>false))throw new GrapnelError(403,'CUSTOMER_APPROVAL_INVALID','The account approval does not match your trading wallet');
  return this.d.store.bind(scope,id,{id:randomUUID(),...scope,accountAddress:c.accountAddress,signingKeyRef:`customer-wallet:${c.accountAddress}`,createdAt:new Date(this.now()).toISOString()});
 }
 async status(scope:PerpetualScope,marketId?:string){
  const account=await this.d.store.account(scope),access=await this.d.accessApproved();
  const funding=await this.d.fundingStatus?.(scope).catch(()=>({trustline_ready:false,balance:null,allowance:null,bridge_available:false,reason:'CIRCLE_USDC_STATUS_UNAVAILABLE'}))??{trustline_ready:false,balance:null,allowance:null,bridge_available:false,reason:'CIRCLE_USDC_SETUP_REQUIRED'};
  if(!account)return {network:'hyperliquid-testnet',account:null,execution_available:false,reason:'CONNECT_TRADING_WALLET',withdrawable:null,account_value:null,positions:[],funding:{asset_id:CCTP_CIRCLE_ASSET_ID,...funding}};
  const state=await this.accounts.read(account.accountAddress),native=state.venues.find(row=>row.dex==='')!;
  let selected_market=null;
  if(marketId){const market=await this.d.market(marketId);if(['','xyz'].includes(market.provider_dex)&&market.settlement_asset.compatibility==='usdc'){
   const query={type:'activeAssetData',user:account.accountAddress,coin:market.provider_symbol};
   const raw=z.object({user:z.string(),coin:z.string(),leverage:z.object({type:z.enum(['cross','isolated']),value:z.number().int().positive()}),maxTradeSzs:z.array(z.string().regex(/^[0-9]+(?:\.[0-9]+)?$/)).optional(),availableToTrade:z.array(z.string().regex(/^[0-9]+(?:\.[0-9]+)?$/)).optional()}).passthrough().parse(freshReceipt(await this.d.transport.info(HL_INFO,query),HL_INFO,query,this.now()));
   if(raw.user.toLowerCase()!==account.accountAddress||raw.coin!==market.provider_symbol)throw new GrapnelError(502,'PROVIDER_INVALID_RESPONSE','Trading account details do not match your selection');
   selected_market={market_id:marketId,symbol:raw.coin,leverage:raw.leverage.value,leverage_type:raw.leverage.type,max_trade_sizes:raw.maxTradeSzs??null,available_to_trade:raw.availableToTrade??null};
  }}
  return {network:'hyperliquid-testnet',account,execution_available:access&&state.venues.some(fundedVenue),reason:!access?'PROVIDER_ACCESS_VERIFICATION_REQUIRED':!state.venues.some(fundedVenue)?'TRADING_ACCOUNT_FUNDING_REQUIRED':null,withdrawable:native.withdrawable,account_value:native.accountValue,positions:state.positions,venues:state.venues,selected_market,funding:{asset_id:CCTP_CIRCLE_ASSET_ID,...funding}};
 }
 private adapter(scope:PerpetualScope,account:PerpetualAccount){
  const a=bound(account),proof=async()=>{if(!await this.d.accessApproved())return false;const row=await this.d.store.account(scope);if(!row||row.accountAddress!==a.accountAddress)return false;const snapshot=await this.accounts.read(a.accountAddress);return snapshot.venues.some(fundedVenue);};
  const dependencies:HyperliquidExecutionDependencies={scope:a,transport:this.d.transport,
   durability:{reserveIntent:(i,b,h)=>this.d.store.reserveIntent(scope,i,b,h),loadPrepared:(id,h)=>this.d.store.loadPrepared(scope,id,h),claimSend:(id,h,p)=>this.d.store.claimSend(scope,id,h,p)},
   verifyAccountExecutionProof:proof,
   verifyCustomerApproval:async i=>{const order=await this.d.store.order(scope,i.operationId);if(!order?.customerSignature||order.approvalDigest!==i.customerApprovalHash||hash(order.intent)!==hash(i))return false;try{stellarApproval(scope.stellarAddress,order.approvalDigest,order.customerSignature);return true;}catch{return false;}},
   verifyStockMarketCategory:async identity=>{const row=await this.d.market(`hyperliquid-testnet:stocks:${identity.assetIndex}`);return ['equity','index'].includes(row.asset_category)&&row.provider_symbol===identity.symbol&&row.provider_dex===identity.dex?{network:'hyperliquid-testnet',assetIndex:identity.assetIndex,providerSymbol:identity.symbol,dex:identity.dex,category:row.asset_category as 'equity'|'index',observedAt:this.now()}:null;},
   resolveSigner:async()=>{throw new Error('Customer signatures stay in their browser');},now:this.now,
  };return new HyperliquidTestnetExecutionAdapter(dependencies);
 }
 async prepare(scope:PerpetualScope,input:OrderInput,key:string){
  const status=await this.status(scope,input.market_id),account=status.account;
  if(!account)return unavailable('Connect your trading wallet first','CONNECT_TRADING_WALLET');
  if(!status.execution_available)return unavailable(status.reason==='PROVIDER_ACCESS_VERIFICATION_REQUIRED'?'Trading access still needs verification':'Add funds to your trading account first',status.reason??'TRADING_NOT_READY');
  const market=await this.d.market(input.market_id);
  if(market.settlement_asset.compatibility!=='usdc'||!['','xyz'].includes(market.provider_dex))return unavailable('This market’s collateral is not supported for trading','UNSUPPORTED_PERPETUAL_COLLATERAL');
  if(units(input.size,18)*units(input.limit_price,18)<10n*10n**36n)throw new GrapnelError(422,'ORDER_TOO_SMALL','The minimum order value is $10. Increase the quantity or price limit');
  const venue=status.venues?.find(row=>row.dex===market.provider_dex);
  if(!venue||!input.reduce_only&&!positive(venue.withdrawable))return unavailable('Add USDC to this market’s trading account first','TRADING_VENUE_FUNDING_REQUIRED');
  if(!input.reduce_only&&units(input.size,18)*units(input.limit_price,18)>units(venue.withdrawable,18)*BigInt(input.leverage)*10n**18n)throw new GrapnelError(409,'INSUFFICIENT_AVAILABLE_BALANCE','Your available trading balance is too low for this order');
  const nonce=this.now(),id=randomUUID(),expiresAt=new Date(nonce+60000).toISOString();
  const intent:ApprovedPerpetualIntent={operationId:id,businessId:scope.businessId,customerId:scope.customerId,walletId:scope.walletId,network:'hyperliquid-testnet',accountAddress:account.accountAddress,marketId:market.market_id,providerSymbol:market.provider_symbol,assetIndex:Number(market.market_id.split(':').at(-1)),dex:market.provider_dex,side:input.side,leverage:input.leverage,size:input.size,limitPrice:input.limit_price,reduceOnly:input.reduce_only,nonce,clientOrderId:`0x${randomBytes(16).toString('hex')}`,expiresAt,customerApprovalHash:'0'.repeat(64)};
  const message=orderApprovalMessage(scope,intent),digest=approvalDigest(message);intent.customerApprovalHash=digest;
  const order=await this.d.store.createOrder({id,scope:{...scope},accountId:account.id,idempotencyKey:key,requestHash:hash(input),intent,approvalMessage:message,approvalDigest:digest,unsignedAction:null,signedAction:null,payloadHash:null,state:'preparing',result:null,createdAt:new Date(nonce).toISOString()});
  if(order.id!==id)return this.publicOrder(order);
  const unsigned=await this.adapter(scope,account).prepareCustomer(intent,bound(account));await this.d.store.saveUnsigned(scope,id,unsigned);
  return this.get(scope,id);
 }
 async get(scope:PerpetualScope,id:string){const order=await this.d.store.order(scope,id);if(!order)throw new GrapnelError(404,'NOT_FOUND','Order not found');return this.publicOrder(order);}
 private publicOrder(order:PendingPerpetualOrder){return {id:order.id,intent:order.intent,approvalMessage:order.approvalMessage,approvalDigest:order.approvalDigest,unsignedAction:order.unsignedAction,state:!order.signedAction&&Date.parse(order.intent.expiresAt)<=this.now()?'expired':order.state,result:order.result,createdAt:order.createdAt};}
 async authorize(scope:PerpetualScope,id:string,stellarSignature:string,evmSignature:`0x${string}`){
  const order=await this.d.store.order(scope,id),account=await this.d.store.account(scope);
  if(!order||!account||order.accountId!==account.id)throw new GrapnelError(404,'NOT_FOUND','Order not found');
  const adapter=this.adapter(scope,account);
  if(order.signedAction){const result=order.state==='approved'?await adapter.send(order.signedAction):await adapter.reconcile(order.signedAction);await this.d.store.saveResult(scope,id,result);return this.get(scope,id);}
  if(!order.unsignedAction)return unavailable('This order is still preparing. Refresh its status','ORDER_PREPARING');
  if(Date.parse(order.intent.expiresAt)<=this.now())throw new GrapnelError(409,'APPROVAL_EXPIRED','This order expired. Review a fresh order');
  const signature=stellarApproval(scope.stellarAddress,order.approvalDigest,stellarSignature);
  await this.d.store.recordApproval(scope,id,signature);
  const signed=await adapter.authorizeCustomer(order.unsignedAction as UnsignedPerpetualAction,evmSignature);
  await this.d.store.saveSigned(scope,id,signed,hash(signed.payload));
  let result:PerpetualExecutionStatus;
  try{result=await adapter.send(signed);}catch{result={state:'unknown',orderId:null,clientOrderId:signed.clientOrderId,filledSize:'0',averagePrice:null,fillIds:[],rawStatus:'Submission requires reconciliation'};}
  await this.d.store.saveResult(scope,id,result);return this.get(scope,id);
 }
 async resume(scope:PerpetualScope,id:string){
  const order=await this.d.store.order(scope,id),account=await this.d.store.account(scope);
  if(!order||!account||order.accountId!==account.id||!order.signedAction)return false;
  const adapter=this.adapter(scope,account);
  // Sending an approved immutable payload still uses the one-use database claim.
  // An uncertain/sending record is reconciled, never transmitted again.
  const result=order.state==='approved'?await adapter.send(order.signedAction):await adapter.reconcile(order.signedAction);
  await this.d.store.saveResult(scope,id,result);return true;
 }
 async reconcile(scope:PerpetualScope,id:string){const order=await this.d.store.order(scope,id),account=await this.d.store.account(scope);if(!order||!account||order.accountId!==account.id)throw new GrapnelError(404,'NOT_FOUND','Order not found');if(order.signedAction){const result=await this.adapter(scope,account).reconcile(order.signedAction);await this.d.store.saveResult(scope,id,result);}return this.get(scope,id);}
}
