import {Keypair,Transaction,TransactionBuilder} from '@stellar/stellar-sdk';
import {GrapnelError,NETWORK,NETWORK_PASSPHRASE,PreparedActionSchema,XLM,toAtomic,type CustomerContext,type PreparedAction} from '@grapnel/contracts';
import {PERIDOT_COLLATERAL,PERIDOT_TESTNET_PINS} from '../../adapters/peridot/config.js';
import {canonicalJson,digest} from '../../lib/crypto.js';
import type {OperationService} from '../operations/service.js';
import type {DeltaVerification} from '../operations/worker.js';
import {MARGIN_COLLATERAL_SWAP,MarginCollateralSwapInputSchema,type MarginCollateralFundingAdapter} from './index.js';

export interface MarginFundingExecutionBridge {verifyForSubmission(action:PreparedAction,signedXdr:string):Promise<void>;verifyDeltas(id:string,hash:string):Promise<DeltaVerification>;}
const invalid=():never=>{throw new GrapnelError(403,'MARGIN_FUNDING_BINDING_INVALID','Collateral swap differs from its durable customer approval');};
/** A business key alone never supplies a signer, arbitrary XDR, baseline or success evidence. */
export function createMarginFundingExecutionBridge(operations:OperationService,adapter:MarginCollateralFundingAdapter|undefined):MarginFundingExecutionBridge{
 async function load(id:string,signedXdr:string){
  if(!adapter)throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Reviewed collateral funding execution is unavailable');
  const row=(await operations.pool.query('SELECT o.*,w.stellar_address,c.privy_user_id FROM operations o JOIN wallets w ON(w.business_id=o.business_id AND w.customer_id=o.customer_id AND w.id=o.wallet_id) JOIN customers c ON(c.business_id=o.business_id AND c.id=o.customer_id) WHERE o.id=$1',[id])).rows[0];
  if(!row||row.id!==id||row.network!==NETWORK||row.module_code!=='trade.perps'||row.provider!=='peridot'||row.type!==MARGIN_COLLATERAL_SWAP||typeof row.privy_user_id!=='string'||!row.privy_user_id.startsWith('did:privy:'))return invalid();
  const request=MarginCollateralSwapInputSchema.parse(row.request_json),prepared=PreparedActionSchema.parse(row.prepared_action),s=prepared.summary,baseline=row.result_json?.margin_collateral_swap_baseline;
  if(request.customer_id!==row.customer_id||request.wallet_id!==row.wallet_id||prepared.operationId!==id||prepared.customerId!==row.customer_id||prepared.walletAddress!==row.stellar_address||prepared.network!==NETWORK||s.action!==MARGIN_COLLATERAL_SWAP||s.fromAssetId!==XLM.id||s.toAssetId!==PERIDOT_COLLATERAL.id||s.recipient!==row.stellar_address||s.contractId!==PERIDOT_TESTNET_PINS.aquarius_pool.address||toAtomic(s.amount??'',7)!==toAtomic(request.amount,7)||toAtomic(s.minReceive??'',7)!==BigInt(request.minimum_output_atomic)||s.expiresAt!==prepared.authorization.expiresAt||row.approved_intent_hash!==digest(canonicalJson(s))||row.xdr_hash!==digest(prepared.unsignedXdr)||!baseline||typeof baseline!=='object'||Array.isArray(baseline))return invalid();
  const unsigned=TransactionBuilder.fromXDR(prepared.unsignedXdr,NETWORK_PASSPHRASE),signed=TransactionBuilder.fromXDR(signedXdr,NETWORK_PASSPHRASE);
  if(!(unsigned instanceof Transaction)||!(signed instanceof Transaction)||unsigned.source!==prepared.walletAddress||signed.source!==prepared.walletAddress||unsigned.signatures.length||signed.signatures.length!==1||signed.operations.length!==1||signed.hash().toString('hex')!==prepared.signingHashHex||unsigned.hash().toString('hex')!==prepared.signingHashHex||unsigned.toEnvelope().v1().tx().toXDR('base64')!==signed.toEnvelope().v1().tx().toXDR('base64')||s.maxFeeStroops!==signed.fee||BigInt(signed.fee)<=0n||BigInt(signed.fee)>10000000n)return invalid();
  const key=Keypair.fromPublicKey(prepared.walletAddress),signature=signed.signatures[0]!;
  if(!key.verify(signed.hash(),signature.signature())||!key.signatureHint().equals(signature.hint()))return invalid();
  const customer:CustomerContext={businessId:row.business_id,customerId:row.customer_id,walletId:row.wallet_id,walletAddress:row.stellar_address,privyUserId:row.privy_user_id};
  return{row,prepared,baseline:baseline as Record<string,unknown>,signed,customer};
 }
 return{
  async verifyForSubmission(action,signedXdr){
   const bound=await load(action.operationId,signedXdr);if(canonicalJson(bound.prepared)!==canonicalJson(action))return invalid();
   const expiry=Date.parse(action.authorization.expiresAt),hash=bound.signed.hash().toString('hex');
   if(!Number.isFinite(expiry)||expiry<=Date.now()||expiry>Date.now()+120000||!bound.signed.timeBounds||BigInt(bound.signed.timeBounds.maxTime)*1000n!==BigInt(expiry))return invalid();
   if(bound.row.state==='awaiting_customer_authorization'){if(bound.row.tx_hash||bound.row.signed_xdr)return invalid();}
   else if(bound.row.state!=='submitted'||bound.row.tx_hash!==hash||bound.row.signed_xdr!==signedXdr)return invalid();
   await adapter!.verifyCollateralSwap({prepared:bound.prepared,baseline:bound.baseline},signedXdr,bound.customer);
  },
  async verifyDeltas(id,hash){
   try{
    const record=(await operations.pool.query('SELECT signed_xdr FROM operations WHERE id=$1 AND tx_hash=$2',[id,hash])).rows[0];if(!record?.signed_xdr)return{verified:false,result:{reason:'MARGIN_FUNDING_HASH_UNAVAILABLE'}};
    const bound=await load(id,record.signed_xdr);
    if(bound.row.tx_hash!==hash||bound.signed.hash().toString('hex')!==hash||!['submitted','confirming','recovery_required','completed'].includes(bound.row.state))return{verified:false,result:{reason:'MARGIN_FUNDING_HASH_MISMATCH'}};
    return await adapter!.readFundingEvidence({prepared:bound.prepared,baseline:bound.baseline,txHash:hash},bound.customer);
   }catch{return{verified:false,result:{reason:'MARGIN_FUNDING_EVIDENCE_UNAVAILABLE'}};}
  }
 };
}
