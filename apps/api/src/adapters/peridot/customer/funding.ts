import {z} from 'zod';
import {StrKey,Transaction,TransactionBuilder,nativeToScVal,xdr} from '@stellar/stellar-sdk';
import {NETWORK,NETWORK_PASSPHRASE,fromAtomic,toAtomic,type CustomerContext,type PreparedAction} from '@grapnel/contracts';
import type {MarginPreparation} from '../../../modules/margin/types.js';
import type {DeltaVerification} from '../../../modules/operations/worker.js';
import {PERIDOT_BASE,PERIDOT_COLLATERAL,PERIDOT_TESTNET_PINS as P} from '../config.js';
import {PeridotQaPoolSwapPreparer,inspectQaPoolSwapTransaction,type QaPreparedPoolSwap} from '../execution/pool-swap.js';
import {PeridotCustomerChain,type CustomerSnapshot,type ConfirmedPeridotTransaction} from './chain.js';
import {PeridotTransactionChanges,addressValue,contractKey} from './metadata.js';
import {fail,invalid,unsigned} from './policy.js';
import {assertSamePrepared,inspectCustomerSignature} from './signature.js';
export interface CollateralQuote {from_asset_id:string;to_asset_id:string;amount_in_atomic:string;expected_out_atomic:string;minimum_out_atomic:string;expires_at:string;}
export interface FundingBaseline {version:1;kind:'peridot_collateral_swap';helper:QaPreparedPoolSwap;before:CustomerSnapshot;}
const helperSchema=z.object({intent:z.object({purpose:z.literal('qa_funding'),walletAddress:z.string(),inputXlmAtomic:z.string(),minimumMockUsdtAtomic:z.string()}).strict(),unsignedXdr:z.string(),signingHashHex:z.string().regex(/^[a-f0-9]{64}$/),expiresAt:z.string().datetime(),feeStroops:z.string(),networkPassphrase:z.literal(NETWORK_PASSPHRASE),signingMode:z.literal('ephemeral_qa_ed25519_NOT_Privy_customer_flow')}).strict();
function amount(value:string):bigint{let n:bigint;try{n=toAtomic(value,7);}catch{return invalid('COLLATERAL_INPUT');}if(n>100000000n)return invalid('TEN_XLM_CAP');return n;}
export function publicCollateralAction(operationId:string,helper:QaPreparedPoolSwap,customer:CustomerContext):PreparedAction {
 return{operationId,customerId:customer.customerId,network:NETWORK,walletAddress:customer.walletAddress,unsignedXdr:helper.unsignedXdr,signingHashHex:helper.signingHashHex,summary:{action:'margin.collateral_swap',fromAssetId:PERIDOT_BASE.id,toAssetId:PERIDOT_COLLATERAL.id,amount:fromAtomic(unsigned(helper.intent.inputXlmAtomic,true),7),minReceive:fromAtomic(unsigned(helper.intent.minimumMockUsdtAtomic,true),7),recipient:customer.walletAddress,contractId:P.aquarius_pool.address,maxFeeStroops:helper.feeStroops,expiresAt:helper.expiresAt},authorization:{method:'privy_stellar',expiresAt:helper.expiresAt}};
}
function nativeOperationDelta(meta:xdr.TransactionMeta,owner:string):bigint {
 const ops=meta.switch()===3?meta.v3().operations():meta.switch()===4?meta.v4().operations():null;if(!ops||ops.length!==1)return invalid('FUNDING_META_VERSION');
 let before:bigint|undefined,after:bigint|undefined;
 for(const c of ops[0]!.changes()){
  if(!['ledgerEntryState','ledgerEntryUpdated'].includes(c.switch().name))continue;
  const e=c.switch().name==='ledgerEntryState'?c.state():c.updated();if(e.data().switch().name!=='account')continue;
  const a=e.data().account();if(StrKey.encodeEd25519PublicKey(a.accountId().ed25519())!==owner)continue;
  const value=BigInt(a.balance().toString());if(c.switch().name==='ledgerEntryState'){if(before!==undefined)return invalid('FUNDING_DUPLICATE_ACCOUNT_STATE');before=value;}else{if(after!==undefined)return invalid('FUNDING_DUPLICATE_ACCOUNT_UPDATE');after=value;}
 }
 if(before===undefined||after===undefined)return invalid('FUNDING_NATIVE_META_REQUIRED');return after-before;
}
/** Exact successful operation-local native debit and MockUSDT credit, plus independent fee-net wallet checks. */
export function collateralFundingEvidence(baseline:FundingBaseline,confirmed:ConfirmedPeridotTransaction,after:CustomerSnapshot,customer:CustomerContext,now=Date.now()):DeltaVerification {
 const h=baseline.helper,before=baseline.before,input=unsigned(h.intent.inputXlmAtomic,true),minimum=unsigned(h.intent.minimumMockUsdtAtomic,true),fee=unsigned(confirmed.feeAtomic,true),credit=new PeridotTransactionChanges(confirmed.meta).balance(P.mock_usdt.address,contractKey('Balance',addressValue(customer.walletAddress)));
 if(confirmed.hash!==h.signingHashHex||h.intent.walletAddress!==customer.walletAddress||h.intent.purpose!=='qa_funding'||input>100000000n||fee>unsigned(h.feeStroops,true)||fee>10000000n||nativeOperationDelta(confirmed.meta,customer.walletAddress)!==-input||!credit||credit.before!==before.walletUnderlyingAtomic||credit.after!==after.walletUnderlyingAtomic||unsigned(credit.after)-unsigned(credit.before)<minimum||unsigned(before.nativeWalletAtomic)-unsigned(after.nativeWalletAtomic)!==input+fee||after.ledger<confirmed.ledger||before.ledger>confirmed.ledger||after.walletReceiptAtomic!==before.walletReceiptAtomic||after.marginReceiptAtomic!==before.marginReceiptAtomic||after.position!==null||before.position!==null||Date.parse(after.observedAt)>now+1000||now-Date.parse(after.observedAt)>15000)return invalid('COLLATERAL_SWAP_PRINCIPAL_OR_FEE_PROOF');
 return{verified:true,result:{margin_collateral_swap_verification:{verified:true,tx_hash:confirmed.hash,input_asset_id:PERIDOT_BASE.id,output_asset_id:PERIDOT_COLLATERAL.id,input_atomic:input.toString(),output_atomic:(unsigned(credit.after)-unsigned(credit.before)).toString(),minimum_output_atomic:minimum.toString(),actual_fee_stroops:fee.toString(),confirmed_ledger:confirmed.ledger,observed_at:new Date(now).toISOString()}}};
}
export class PeridotCollateralFundingAdapter {
 private readonly preparer:PeridotQaPoolSwapPreparer;
 constructor(readonly chain:PeridotCustomerChain,private readonly executionReady:()=>Promise<boolean>){this.preparer=new PeridotQaPoolSwapPreparer({server:chain.server,now:chain.now,policy:{allowPinnedMockCodeRestore:true}});}
 private async ready(){if(!await this.executionReady())return fail('PERIDOT_ROUND_TRIP_PROOF_REQUIRED');}
 async quoteCollateral(input:{amount:string},customer:CustomerContext):Promise<CollateralQuote>{
  await this.ready();await this.chain.verifyPins();const atomic=amount(input.amount),quote=await this.chain.view(customer.walletAddress,P.aquarius_pool.address,'estimate_swap',[nativeToScVal(0,{type:'u32'}),nativeToScVal(1,{type:'u32'}),nativeToScVal(atomic,{type:'u128'})]);
  if(typeof quote.value!=='bigint'||quote.value<=0n)return fail('COLLATERAL_QUOTE_UNAVAILABLE');
  return{from_asset_id:PERIDOT_BASE.id,to_asset_id:PERIDOT_COLLATERAL.id,amount_in_atomic:atomic.toString(),expected_out_atomic:quote.value.toString(),minimum_out_atomic:((quote.value*995n+999n)/1000n).toString(),expires_at:new Date(this.chain.now()+60000).toISOString()};
 }
 async prepareCollateralSwap(input:{operationId:string;amount:string;minimumOutputAtomic:string},customer:CustomerContext):Promise<MarginPreparation>{
  await this.ready();const atomic=amount(input.amount),minimum=unsigned(input.minimumOutputAtomic,true),helper=await this.preparer.prepare({purpose:'qa_funding',walletAddress:customer.walletAddress,inputXlmAtomic:atomic.toString(),minimumMockUsdtAtomic:minimum.toString()}),prepared=publicCollateralAction(input.operationId,helper,customer),before=await this.chain.snapshot(customer),fee=unsigned(helper.feeStroops,true);
  if(fee>10000000n||Date.parse(helper.expiresAt)<=this.chain.now()||Date.parse(helper.expiresAt)>this.chain.now()+120000)return invalid('COLLATERAL_PREPARATION_FEE_OR_EXPIRY');
  const baseline:FundingBaseline={version:1,kind:'peridot_collateral_swap',helper,before};
  return{prepared,baseline:JSON.parse(JSON.stringify(baseline)),reservations:[{assetId:PERIDOT_BASE.id,amountAtomic:atomic+fee,spendableAtomic:unsigned(before.nativeSpendableAtomic),observedAt:new Date(before.observedAt)}]};
 }
 private baseline(raw:Record<string,unknown>,prepared:PreparedAction,customer:CustomerContext):FundingBaseline{
  if(raw.version!==1||raw.kind!=='peridot_collateral_swap'||!raw.before||typeof raw.before!=='object')return invalid('COLLATERAL_BASELINE');
  const helper=helperSchema.parse(raw.helper)as QaPreparedPoolSwap;
  if(helper.intent.walletAddress!==customer.walletAddress||unsigned(helper.intent.inputXlmAtomic,true)>100000000n)return invalid('COLLATERAL_HELPER_INTENT');
  const tx=TransactionBuilder.fromXDR(helper.unsignedXdr,NETWORK_PASSPHRASE);if(!(tx instanceof Transaction)||tx.source!==customer.walletAddress||tx.hash().toString('hex')!==helper.signingHashHex||tx.fee!==helper.feeStroops)return invalid('COLLATERAL_HELPER_HASH');
  assertSamePrepared(prepared,publicCollateralAction(prepared.operationId,helper,customer));return{version:1,kind:'peridot_collateral_swap',helper,before:raw.before as CustomerSnapshot};
 }
 async verifyCollateralSwap(input:{prepared:PreparedAction;baseline:Record<string,unknown>},signedXdr:string,customer:CustomerContext):Promise<void>{
  await this.ready();const baseline=this.baseline(input.baseline,input.prepared,customer);inspectCustomerSignature(input.prepared,signedXdr,customer);await this.preparer.verifySigned(baseline.helper,signedXdr);
 }
 async readFundingEvidence(input:{prepared:PreparedAction;baseline:Record<string,unknown>;txHash:string},customer:CustomerContext):Promise<DeltaVerification>{
  const baseline=this.baseline(input.baseline,input.prepared,customer),confirmed=await this.chain.confirmed(input.txHash,customer);
  if(input.txHash!==input.prepared.signingHashHex)return invalid('COLLATERAL_CONFIRMED_HASH');inspectCustomerSignature(input.prepared,confirmed.transaction.toXDR(),customer);inspectQaPoolSwapTransaction(confirmed.transaction,baseline.helper.intent,baseline.helper.expiresAt,{allowPinnedMockCodeRestore:true});
  return collateralFundingEvidence(baseline,confirmed,await this.chain.snapshot(customer),customer,this.chain.now());
 }
}
