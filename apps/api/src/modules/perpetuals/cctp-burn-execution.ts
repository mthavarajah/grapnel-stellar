import {Keypair,Transaction,TransactionBuilder,rpc} from '@stellar/stellar-sdk';
import {GrapnelError,NETWORK_PASSPHRASE,PreparedActionSchema,type PreparedAction} from '@grapnel/contracts';
import {canonicalJson,digest} from '../../lib/crypto.js';
import {CCTP_BURN_ACTION,cctpBurnIntent,inspectPreparedCctpBurn,inspectCctpBurnAuthorization,inspectCctpBurnFootprint} from '../../adapters/cctp/inspector.js';
import {readStellarRegistry} from '../../adapters/cctp/reader.js';
import type {CircleSetupChain} from './funding.js';
import type {CctpFundingCoordinator} from './cctp-service.js';
import type {CctpFundingRecord} from './cctp-contract.js';
const fail=():never=>{throw new GrapnelError(403,'CCTP_SOURCE_APPROVAL_INVALID','The signed transfer differs from the exact reviewed funding request');};
function tx(xdr:string){const parsed=TransactionBuilder.fromXDR(xdr,NETWORK_PASSPHRASE);if(!(parsed instanceof Transaction))return fail();return parsed;}
/** Only the existing durable operations worker may broadcast the source burn. */
export class CctpBurnExecutionBridge {
 constructor(private readonly coordinator:CctpFundingCoordinator,private readonly chain:CircleSetupChain){}
 private async load(id:string,signedXdr:string,historical=false){
  const pool=this.coordinator.d.operations.pool,row=(await pool.query('SELECT o.*,w.stellar_address FROM operations o JOIN wallets w ON w.business_id=o.business_id AND w.customer_id=o.customer_id AND w.id=o.wallet_id WHERE o.id=$1',[id])).rows[0];
  if(!row||row.type!==CCTP_BURN_ACTION||row.module_code!=='trade.perps'||row.provider!=='circle-cctp')return fail();
  const scope={businessId:row.business_id,customerId:row.customer_id,walletId:row.wallet_id,stellarAddress:row.stellar_address},record=await this.coordinator.d.store.get(scope,id);if(!record)return fail();
  const action=PreparedActionSchema.parse(row.prepared_action),unsigned=tx(action.unsignedXdr),signed=tx(signedXdr),hash=signed.hash().toString('hex');
  if(canonicalJson(record.source)!==canonicalJson(action)||action.operationId!==id||action.customerId!==scope.customerId||action.walletAddress!==scope.stellarAddress||row.approved_intent_hash!==digest(canonicalJson(action.summary))||row.xdr_hash!==digest(action.unsignedXdr)||unsigned.toEnvelope().v1().tx().toXDR('base64')!==signed.toEnvelope().v1().tx().toXDR('base64')||hash!==action.signingHashHex||signed.signatures.length!==1)return fail();
  const key=Keypair.fromPublicKey(scope.stellarAddress),signature=signed.signatures[0]!;if(!key.signatureHint().equals(signature.hint())||!key.verify(signed.hash(),signature.signature()))return fail();
  const customer=await this.coordinator.d.customer(scope),binding={businessId:scope.businessId,customerId:scope.customerId,walletId:scope.walletId,walletAddress:scope.stellarAddress,evmRecipient:record.accountAddress,network:'hyperevm-testnet' as const,chainId:998 as const};
  const request={operationId:id,customer,amountStellarAtomic:record.amountAtomic7,evmRecipient:record.accountAddress,destinationDomain:19 as const,expiresAt:action.authorization.expiresAt,maxFeeStroops:'10000000'};
  const now=historical?Date.parse(request.expiresAt)-1:Date.now(),intent=cctpBurnIntent(request,binding,now);
  inspectPreparedCctpBurn(action,unsigned,intent,BigInt(unsigned.sequence),now);
  return {row,scope,record,action,unsigned,signed,hash,intent,customer};
 }
 async verifyForSubmission(action:PreparedAction,signedXdr:string){
  const b=await this.load(action.operationId,signedXdr);if(canonicalJson(b.action)!==canonicalJson(action)||!['awaiting_customer_authorization','submitted'].includes(b.row.state))return fail();
  await this.coordinator.assertReady(b.scope,b.record,BigInt(b.record.amountAtomic7));await this.chain.verifyLiveNetwork();await readStellarRegistry();
  const modules=await this.coordinator.d.operations.pool.query("SELECT module_code FROM business_modules WHERE business_id=$1 AND enabled=true AND module_code IN ('capital.wallets','trade.perps')",[b.scope.businessId]);if(modules.rowCount!==2)throw new GrapnelError(403,'MODULE_NOT_ENABLED','Current wallet and perpetuals permissions are required');
  const available=await this.coordinator.d.burn.readAvailability(b.customer);
  if(available.balanceAtomic<BigInt(b.record.amountAtomic7)||available.allowanceAtomic<BigInt(b.record.amountAtomic7))return fail();
  if(BigInt((await this.chain.server.getAccount(b.scope.stellarAddress)).sequenceNumber())+1n!==BigInt(b.signed.sequence))return fail();
  const sim=await this.chain.server.simulateTransaction(b.signed,undefined,'enforce');
  if(!rpc.Api.isSimulationSuccess(sim)||rpc.Api.isSimulationRestore(sim)||!sim.result||sim.result.retval.switch().name!=='scvVoid')return fail();
  inspectCctpBurnAuthorization(sim.result.auth,b.intent);inspectCctpBurnFootprint(sim.transactionData.build(),b.intent);
  const approved=b.signed.toEnvelope().v1().tx().ext().sorobanData().resources(),actual=sim.transactionData.build().resources(),op=b.signed.operations[0];
  if(op.type!=='invokeHostFunction'||actual.footprint().toXDR('base64')!==approved.footprint().toXDR('base64')||actual.instructions()>approved.instructions()||actual.diskReadBytes()>approved.diskReadBytes()||actual.writeBytes()>approved.writeBytes()||!/^[0-9]{1,12}$/.test(sim.minResourceFee)||BigInt(sim.minResourceFee)+100n>BigInt(b.signed.fee)||sim.result.auth.map(a=>a.toXDR('base64')).join(':')!==(op.auth??[]).map(a=>a.toXDR('base64')).join(':'))return fail();
  return {txHash:b.hash};
 }
 async broadcast(action:PreparedAction,signedXdr:string){
  const verified=await this.verifyForSubmission(action,signedXdr),b=await this.load(action.operationId,signedXdr);if(b.row.state!=='submitted'||b.row.tx_hash!==verified.txHash||b.row.signed_xdr!==signedXdr)return fail();
  const claim=await this.coordinator.d.operations.pool.query("UPDATE operations SET result_json=COALESCE(result_json,'{}'::jsonb)||jsonb_build_object('cctp_source_send_claim',$3::text) WHERE id=$1 AND business_id=$2 AND state='submitted' AND signed_xdr=$4 AND tx_hash=$3 AND result_json->>'cctp_source_send_claim' IS NULL RETURNING id",[b.record.id,b.scope.businessId,b.hash,signedXdr]);if(claim.rowCount!==1)throw new GrapnelError(409,'SUBMISSION_UNCERTAIN','Reconcile the existing source transfer before retrying');
  const sent=await this.chain.server.sendTransaction(b.signed);if(sent.hash!==b.hash||!['PENDING','DUPLICATE'].includes(sent.status))throw new GrapnelError(409,'SUBMISSION_UNCERTAIN','Reconcile the retained source transaction hash');return verified;
 }
 async verifyDeltas(id:string,hash:string){
  const row=(await this.coordinator.d.operations.pool.query('SELECT signed_xdr FROM operations WHERE id=$1 AND tx_hash=$2',[id,hash])).rows[0];if(!row?.signed_xdr)return {verified:false,result:{bridge_completed:false}};
  try{const b=await this.load(id,row.signed_xdr,true),proof=await this.coordinator.d.readSourceProof(await this.coordinator.request(b.record),hash);return {verified:true,result:{cctp_source_burn:proof,bridge_completed:false}};}catch{return {verified:false,result:{bridge_completed:false}};}
 }
}
