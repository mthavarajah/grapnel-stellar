import{GrapnelError}from'@grapnel/contracts';
import{signL1Action}from'@nktkas/hyperliquid/signing';
import type{ApprovedPerpetualIntent,BoundPerpetualAccount,SignedPerpetualAction,PerpetualExecutionAdapter,PerpetualExecutionStatus}from'../../../modules/perpetuals/execution-contract.js';
import{HL_EXCHANGE,type HyperliquidExecutionDependencies}from'./types.js';
import{assertScope,assertFreshIntent,assertPrecision,assertPositionIntent,orderAction,hash,stable,inspectArtifact,fail}from'./guards.js';
import{network,market,position}from'./reads.js';
import{inspectSettlement,unknown}from'./reconcile.js';
/** Injected only. No account creation, funding, leverage update, GTC, default HTTP transport or automatic resend. */
export class HyperliquidTestnetExecutionAdapter implements PerpetualExecutionAdapter{
 constructor(private readonly d:HyperliquidExecutionDependencies){this.d={...d,scope:structuredClone(d.scope)};}
 private async guarded<T>(run:()=>Promise<T>):Promise<T>{try{return await run();}catch(error){if(error instanceof GrapnelError)throw error;return fail('PROVIDER_INPUT_OR_DURABILITY_UNAVAILABLE');}}
 async prepare(intent:ApprovedPerpetualIntent,account:BoundPerpetualAccount):Promise<SignedPerpetualAction>{return this.guarded(()=>this.prepareExact(intent,account));}
 private async prepareExact(intent:ApprovedPerpetualIntent,account:BoundPerpetualAccount):Promise<SignedPerpetualAction>{
  // Clone before awaiting authorization so caller mutations cannot swap the approved intent in flight.
  const i=structuredClone(intent),a=structuredClone(account);assertScope(i,a,this.d.scope);assertFreshIntent(i,this.d.now?.()??Date.now());
  if(!await this.d.verifyCustomerApproval?.(structuredClone(i),structuredClone(a))||!await this.d.verifyAccountExecutionProof?.(structuredClone(a)))return fail('EXACT_CUSTOMER_APPROVAL_AND_ACCOUNT_PROOF_REQUIRED');
  await network(this.d);const [m,before]=await Promise.all([market(this.d,i),position(this.d,i)]);assertPrecision(i,m);assertPositionIntent(i,m,before);
  const intentHash=hash({intent:i,account:a});if(!await this.d.durability.reserveIntent(structuredClone(i),structuredClone(a),intentHash))return fail('DURABLE_NONCE_CLOID_OR_OPERATION_REPLAY');
  const wallet=await this.d.resolveSigner(a.signingKeyRef).catch(()=>fail('CONFIGURED_SIGNER_UNAVAILABLE'));if(wallet.address.toLowerCase()!==a.accountAddress.toLowerCase())return fail('CONFIGURED_SOURCE_SIGNER_MISMATCH');
  const action=orderAction(i),expiresAfter=Date.parse(i.expiresAt),signature=await signL1Action({wallet,action,nonce:i.nonce,expiresAfter,isTestnet:true}).catch(()=>fail('TYPED_DATA_SIGNATURE_UNAVAILABLE'));assertFreshIntent(i,this.d.now?.()??Date.now());
  const result:SignedPerpetualAction={network:'hyperliquid-testnet',accountAddress:i.accountAddress,operationId:i.operationId,nonce:i.nonce,clientOrderId:i.clientOrderId,intentHash,payload:{version:1,intent:i,account:a,market:m,before,wire:{action,nonce:i.nonce,expiresAfter,signature}}};await inspectArtifact(result,this.d.scope);return structuredClone(result);
 }
 private async persisted(action:SignedPerpetualAction){const copy=structuredClone(action),p=await inspectArtifact(copy,this.d.scope),stored=await this.d.durability.loadPrepared(copy.operationId,copy.intentHash);if(!stored||stable(stored)!==stable(copy))return fail('EXACT_SIGNED_PAYLOAD_MUST_BE_DURABLY_PERSISTED');return{copy,p};}
 async send(action:SignedPerpetualAction):Promise<PerpetualExecutionStatus>{return this.guarded(()=>this.sendExact(action));}
 private async sendExact(action:SignedPerpetualAction):Promise<PerpetualExecutionStatus>{
  const {copy,p}=await this.persisted(action),i=p.intent as ApprovedPerpetualIntent;
  if(Date.parse(i.expiresAt)<=(this.d.now?.()??Date.now()))return this.reconcile(copy);
  if(!await this.d.verifyCustomerApproval?.(structuredClone(i),structuredClone(p.account) as BoundPerpetualAccount)||!await this.d.verifyAccountExecutionProof?.(structuredClone(p.account) as BoundPerpetualAccount))return fail('CURRENT_APPROVAL_AND_ACCOUNT_PROOF_REQUIRED');
  await network(this.d);if(!await this.d.durability.claimSend(copy.operationId,copy.intentHash,hash(copy.payload)))return this.reconcile(copy);const [m,current]=await Promise.all([market(this.d,i),position(this.d,i)]);if(stable(m)!==stable(p.market)||current.size!==p.before.size||current.leverageType!==p.before.leverageType)return fail('POSITION_OR_MARKET_CHANGED_BEFORE_SEND');assertFreshIntent(i,this.d.now?.()??Date.now());
  // Persisted send claim is never reset, including timeout/throw/ack error. Only reconciliation follows.
  try{await this.d.transport.exchange(HL_EXCHANGE,structuredClone(p.wire));}catch{/* Ambiguous outcome: never resubmit. */}
  return this.reconcile(copy);
 }
 async reconcile(action:SignedPerpetualAction):Promise<PerpetualExecutionStatus>{return this.guarded(()=>this.reconcileExact(action));}
 private async reconcileExact(action:SignedPerpetualAction):Promise<PerpetualExecutionStatus>{const {copy,p}=await this.persisted(action);try{await network(this.d);return await inspectSettlement(this.d,p);}catch{return unknown(copy.clientOrderId);}}
}
export type{HyperliquidExecutionDependencies,ExecutionTransport,ExecutionDurability,ReadReceipt}from'./types.js';
export{HL_INFO,HL_EXCHANGE,HL_RPC}from'./types.js';
