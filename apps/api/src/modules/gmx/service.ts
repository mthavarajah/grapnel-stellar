import {randomUUID} from 'node:crypto';
import {GrapnelError,fromAtomic,toAtomic,type CustomerContext} from '@grapnel/contracts';
import type {Hex} from 'viem';
import {canonicalJson,digest} from '../../lib/crypto.js';
import {GMX_TESTNET,createGmxTestnetAdapter,type GmxPrepared,type GmxSymbol,type GmxCreationProof} from '../../adapters/gmx/index.js';
import type {GmxScope,GmxRequest,GmxRequestStore} from './contracts.js';
export interface GmxInput {account_address:string;kind:'mint'|'approve'|'open'|'close';market_id:string;is_long?:boolean;amount?:string;collateral?:string;size_usd?:string;slippage_bps?:number;}
export const gmxScope=(c:CustomerContext):GmxScope=>({businessId:c.businessId,customerId:c.customerId,walletId:c.walletId,stellarAddress:c.walletAddress});
const notReady=(reason:string):never=>{throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','This trade needs verified account and market conditions',false,{reason});};
export interface GmxServiceDependencies {
 store:GmxRequestStore;adapter:ReturnType<typeof createGmxTestnetAdapter>;
 readWallets:(c:CustomerContext)=>Promise<{address:string}[]>;
 acceptance:(symbol?:GmxSymbol)=>Promise<boolean>;
 sendRaw:(raw:Hex)=>Promise<Hex>;
 gasStatus?:(c:CustomerContext,account:Hex)=>Promise<unknown>;
}
export class GmxCustomerService {
 constructor(readonly d:GmxServiceDependencies){}
 private symbol(id:string):GmxSymbol {if(!/^gmx-testnet:perps:(ETH|BTC)$/.test(id))throw new GrapnelError(404,'NOT_FOUND','Market not found');return id.endsWith(':ETH')?'ETH':'BTC';}
 async account(c:CustomerContext,address?:string){const rows=await this.d.readWallets(c),normalized=address?.toLowerCase();if(normalized&&!rows.some(w=>w.address.toLowerCase()===normalized))throw new GrapnelError(403,'WALLET_OWNERSHIP_INVALID','Choose your connected trading wallet');return(normalized??rows[0]?.address.toLowerCase()??null) as Hex|null;}
 async status(c:CustomerContext,address:string|undefined,id:string){const symbol=this.symbol(id),account=await this.account(c,address),available=await this.d.acceptance(symbol),market=await this.d.adapter.readMarket(symbol);
  const scope={business_id:c.businessId,customer_id:c.customerId,wallet_id:c.walletId};
  const common={scope,provider:'gmx',network:'arbitrum-sepolia',chain_id:421614,account_address:account,asset:{symbol:'USDC',decimals:6,address:GMX_TESTNET.pins.collateral.address,identity:'USDC.SG'},market,execution_available:available,reason:available?null:'GMX_OWN_EXECUTION_PROOF_REQUIRED'};
  if(!account)return {...common,native_balance:null,collateral_balance:null,allowance:null,positions:[],gas_funding_available:false,gas_grant:null};
  const [status,positions,gas]=await Promise.all([this.d.adapter.readStatus(account),this.d.adapter.readPositions(account),this.d.gasStatus?.(c,account)??null]);
  return {...common,native_balance:fromAtomic(BigInt(status.nativeWei),18),collateral_balance:fromAtomic(BigInt(status.collateralAtomic6),6),allowance:fromAtomic(BigInt(status.allowanceAtomic6),6),positions,gas_funding_available:!!this.d.gasStatus,gas_grant:gas,observed_at:status.observedAt};
 }
 async prepare(c:CustomerContext,input:GmxInput,key:string){const account=await this.account(c,input.account_address);if(!account)return notReady('CREATE_TRADING_WALLET');if(!await this.d.acceptance(this.symbol(input.market_id)))return notReady('GMX_OWN_EXECUTION_PROOF_REQUIRED');
  const scope=gmxScope(c),symbol=this.symbol(input.market_id),pending=await this.d.store.pending(scope);
  const requestHash=digest(canonicalJson(input));
  if(pending&&pending.idempotencyKey===key&&pending.requestHash===requestHash)return this.public(pending);
  if(pending)throw new GrapnelError(409,'GMX_REQUEST_PENDING','Finish or check the existing trading request before preparing another',false,{request_id:pending.id});
  const base={id:randomUUID(),account,expiresAt:new Date(Date.now()+90000).toISOString()};let prepared:GmxPrepared;
  if(input.kind==='mint'||input.kind==='approve'){
   if(input.is_long!==undefined||input.collateral!==undefined||input.size_usd!==undefined||input.slippage_bps!==undefined)return notReady('GMX_UNEXPECTED_INTENT_FIELDS');
   const amount=toAtomic(input.amount??'0',6).toString();prepared=input.kind==='mint'?await this.d.adapter.prepareMint({...base,amountAtomic6:amount}):await this.d.adapter.prepareApproval({...base,amountAtomic6:amount});
  }else{
   if(input.amount!==undefined||typeof input.is_long!=='boolean')return notReady('GMX_EXACT_SIDE_REQUIRED');
   const trade={...base,symbol,isLong:input.is_long,executionFeeWei:'500000000000000',slippageBps:input.slippage_bps??50};
   if(input.kind==='open')prepared=await this.d.adapter.prepareOpen({...trade,collateralAtomic6:toAtomic(input.collateral??'0',6).toString(),sizeUsd30:toAtomic(input.size_usd??'0',30).toString()});
   else{if(input.collateral!==undefined||input.size_usd!==undefined)return notReady('GMX_FULL_CLOSE_REQUIRED');prepared=await this.d.adapter.prepareClose(trade);}
  }
  return this.public(await this.d.store.create(scope,key,requestHash,prepared,input.market_id));
 }
 async get(c:CustomerContext,id?:string){const s=gmxScope(c);let r=id?await this.d.store.get(s,id):await this.d.store.pending(s);if(!r)return null;await this.account(c,r.accountAddress);
  if(r.txHash&&!r.creationProof){try{const proof=await this.d.adapter.confirmTransaction(r.prepared,r.txHash);await this.d.store.creation(s,r.id,proof);}catch{/* Keep the same retained hash through chain/indexing delays. */}}
  r=(await this.d.store.get(s,r.id))!;
  if(r.creationProof&&'orderKey'in r.creationProof&&(!r.settlement||r.settlement.state==='pending')){try{const result=await this.d.adapter.reconcileOrder(r.prepared,r.creationProof as GmxCreationProof);await this.d.store.settlement(s,r.id,result);}catch{/* Acknowledgement or a local error never substitutes for a fill. */}}
  return this.public((await this.d.store.get(s,r.id))!);
 }
 async authorize(c:CustomerContext,id:string,raw:Hex){const s=gmxScope(c),r=await this.d.store.get(s,id);if(!r)throw new GrapnelError(404,'NOT_FOUND','Trading request not found');await this.account(c,r.accountAddress);
  if(!await this.d.acceptance(this.symbol(r.marketId)))return notReady('GMX_OWN_EXECUTION_PROOF_REQUIRED');
  await this.d.store.sign(s,id,raw);
  if(await this.d.store.claimSend(s,id)){try{const hash=await this.d.sendRaw(raw),stored=await this.d.store.get(s,id);if(hash.toLowerCase()!==stored?.txHash)return notReady('GMX_SUBMISSION_HASH_MISMATCH');}finally{await this.d.store.markUncertain(s,id);}}
  return this.get(c,id);
 }
 public(r:GmxRequest){const t=r.prepared.transaction,proof=r.settlement?.state==='executed'||r.settlement?.state==='cancelled'?{network:'arbitrum-sepolia',account:r.accountAddress,...r.settlement}:r.creationProof;
  return {id:r.id,business_id:r.scope.businessId,customer_id:r.scope.customerId,wallet_id:r.scope.walletId,account_address:r.accountAddress,kind:r.kind,market_id:r.marketId,state:r.state,expires_at:r.prepared.expiresAt,intent:{...r.prepared.intent,kind:r.kind,account:r.accountAddress,symbol:this.symbol(r.marketId)},baseline:r.prepared.baseline,transaction:{...t,value:t.value.toString(),nonce:t.nonce.toString(),gas:t.gas.toString(),maxFeePerGas:t.maxFeePerGas.toString(),maxPriorityFeePerGas:t.maxPriorityFeePerGas.toString()},tx_hash:r.txHash,proof};
 }
}
