import {STANDALONE_SPOT_ASSETS,isApprovedStandaloneAssetId,standaloneAssetId} from '../../adapters/soroswap/direct-assets.js';
import type {Pool} from 'pg';
import {Address,Keypair,Transaction,TransactionBuilder,rpc,scValToNative,StrKey,xdr} from '@stellar/stellar-sdk';
import {NETWORK_PASSPHRASE,PreparedActionSchema,XLM,toAtomic} from '@grapnel/contracts';
import {inspectApprovedSwapTransaction,NATIVE_SAC,USDC_SAC,USDC_ISSUER,type SoroswapDirectInspector,type SwapRegistry} from '../../adapters/soroswap/inspector.js';
import type {SoroswapSpotAdapter} from '../../adapters/soroswap/index.js';
import {SpotBaselineSchema,SPOT_USDC_ID} from './reservations.js';
const VERIFIED=Symbol('independently-confirmed-spot-execution');
export interface VerifiedSpotProof {market_id:string;asset_in_id:string;asset_out_id:string;tx_hash:string;ledger:number;verified_at:string;valid_until:number;[VERIFIED]:true;}
export const isVerifiedSpotProof=(value:unknown):value is VerifiedSpotProof=>!!value&&typeof value==='object'&&(value as VerifiedSpotProof)[VERIFIED]===true&&(value as VerifiedSpotProof).valid_until>Date.now();
export interface SpotTransfer {contract:string;from:string;to:string;amount:string;asset:string;}
export interface SpotChainObservation {hash:string;ledger:number;created_at:number;fee_stroops:string;envelope_xdr:string;transfers:SpotTransfer[];}
export interface StoredSpotProof {id:string;business_id:string;customer_id:string;wallet_address:string;privy_user_id:string;state:string;module_code:string;provider:string;type:string;tx_hash:string;signed_xdr:string;prepared_action:unknown;result_json:{spot_swap_baseline?:unknown;spot_swap_verification?:Record<string,unknown>};market_id:string;amount_in_atomic:string;min_out_atomic:string;actual_in_atomic:string;actual_out_atomic:string;}
/** Decode successful operation events only. System fee/refund events are excluded. */
export function confirmedSpotObservation(result:rpc.Api.GetTransactionResponse):SpotChainObservation|null {
 if(result.status!=='SUCCESS'||result.feeBump||!result.resultMetaXdr)return null;
 try{
  const tx=TransactionBuilder.fromXDR(result.envelopeXdr.toXDR('base64'),NETWORK_PASSPHRASE);if(!(tx instanceof Transaction)||tx.hash().toString('hex')!==result.txHash)return null;
  const meta=result.resultMetaXdr,events:xdr.ContractEvent[]=meta.switch()===4?meta.v4().operations().flatMap(o=>o.events()):meta.switch()===3?(meta.v3().sorobanMeta()?.events()??[]):[];
  const transfers:SpotTransfer[]=[];
  for(const e of events){if(e.type().name!=='contract'||!e.contractId()||e.body().switch()!==0)continue;const id=StrKey.encodeContract(e.contractId()! as unknown as Buffer),body=e.body().v0(),topics=body.topics().map(scValToNative);if(topics[0]!=='transfer'||![NATIVE_SAC,USDC_SAC,...STANDALONE_SPOT_ASSETS.map(r=>r.contract)].includes(id))continue;const value=scValToNative(body.data());const standalone=STANDALONE_SPOT_ASSETS.some(r=>r.contract===id);if(topics.length!==(standalone?3:4)||typeof topics[1]!=='string'||typeof topics[2]!=='string'||(!standalone&&typeof topics[3]!=='string')||typeof value!=='bigint'||value<=0n)return null;transfers.push({contract:id,from:topics[1],to:topics[2],asset:standalone?`soroban:${id}`:String(topics[3]),amount:value.toString()});}
  return {hash:result.txHash,ledger:result.ledger,created_at:Number(result.createdAt)*1000,fee_stroops:result.resultXdr.feeCharged().toString(),envelope_xdr:tx.toXDR(),transfers};
 }catch{return null;}
}
const atomic=(value:unknown)=>{if(typeof value!=='string'||!/^\d+(\.\d{1,7})?$/.test(value))throw Error('Invalid exact amount');return /^0(?:\.0+)?$/.test(value)?0n:toAtomic(value,7);};
/** Recheck durable completion, exact historical signed intent, observed deltas and actual token events. */
export function verifyStoredSpotProof(record:StoredSpotProof,chain:SpotChainObservation,registry:SwapRegistry,now=Date.now()):VerifiedSpotProof|null {
 try{
  if(record.state!=='completed'||record.module_code!=='trade.spot'||record.provider!=='soroswap'||record.type!=='spot.swap'||!record.privy_user_id.startsWith('did:privy:')||record.tx_hash!==chain.hash||!Number.isSafeInteger(chain.ledger)||chain.ledger<=0||!Number.isFinite(chain.created_at)||chain.created_at>now+1000)return null;
  const action=PreparedActionSchema.parse(record.prepared_action),baseline=SpotBaselineSchema.parse(record.result_json.spot_swap_baseline),observed=record.result_json.spot_swap_verification;
  if(!observed||observed.verified!==true||observed.asset_in_id!==baseline.asset_in_id||observed.asset_out_id!==baseline.asset_out_id||observed.actual_in_atomic!==record.actual_in_atomic||observed.actual_out_atomic!==record.actual_out_atomic||observed.actual_in_atomic!==record.amount_in_atomic||baseline.amount_in_atomic!==record.amount_in_atomic||baseline.min_out_atomic!==record.min_out_atomic||observed.fee_stroops!==chain.fee_stroops||observed.confirmed_ledger!==chain.ledger||baseline.market_id!==record.market_id||observed.wallet_in_before!==baseline.wallet_in_amount||observed.wallet_out_before!==baseline.wallet_out_amount)return null;
  if(action.summary.fromAssetId!==baseline.asset_in_id||action.summary.toAssetId!==baseline.asset_out_id||!Number.isFinite(Date.parse(String(observed.observed_at)))||baseline.wallet_address!==record.wallet_address||action.walletAddress!==record.wallet_address||action.operationId!==record.id||action.customerId!==record.customer_id||baseline.signing_hash_hex!==record.tx_hash||action.signingHashHex!==record.tx_hash||Date.parse(baseline.as_of)>chain.created_at+1000||Date.parse(String(observed.observed_at))<chain.created_at-1000)return null;
  const tx=TransactionBuilder.fromXDR(chain.envelope_xdr,NETWORK_PASSPHRASE),unsigned=TransactionBuilder.fromXDR(action.unsignedXdr,NETWORK_PASSPHRASE);
  if(!(tx instanceof Transaction)||!(unsigned instanceof Transaction)||unsigned.signatures.length||tx.source!==record.wallet_address||tx.hash().toString('hex')!==record.tx_hash||unsigned.hash().toString('hex')!==record.tx_hash||tx.toXDR()!==record.signed_xdr||tx.signatures.length!==1||!Keypair.fromPublicKey(record.wallet_address).verify(tx.hash(),tx.signatures[0]!.signature()))return null;
  // Historical inspection uses the independently confirmed ledger time; no expired intent is submitted.
  inspectApprovedSwapTransaction(action,tx,registry,chain.created_at);
  if(toAtomic(action.summary.amount??'',7)!==BigInt(record.amount_in_atomic)||toAtomic(action.summary.minReceive??'',7)!==BigInt(record.min_out_atomic)||BigInt(chain.fee_stroops)>BigInt(baseline.max_fee_stroops))return null;
  const walletTransfers=chain.transfers.filter(t=>t.from===record.wallet_address||t.to===record.wallet_address);if(walletTransfers.length!==2)return null;
  const identity=(id:string)=>{if(id===XLM.id)return{contract:NATIVE_SAC,marker:'native'};const token=STANDALONE_SPOT_ASSETS.find(r=>standaloneAssetId(r.contract)===id);return token?{contract:token.contract,marker:`soroban:${token.contract}`}:{contract:USDC_SAC,marker:`USDC:${USDC_ISSUER}`};};
  const from=identity(baseline.asset_in_id),to=identity(baseline.asset_out_id);
  const debit=walletTransfers.find(t=>t.contract===from.contract&&t.asset===from.marker&&t.from===record.wallet_address&&t.to===registry.pair),credit=walletTransfers.find(t=>t.contract===to.contract&&t.asset===to.marker&&t.from===registry.pair&&t.to===record.wallet_address);
  if(!debit||!credit||debit.amount!==record.actual_in_atomic||credit.amount!==record.actual_out_atomic||BigInt(credit.amount)<BigInt(record.min_out_atomic))return null;
  if(atomic(observed.wallet_in_before)-atomic(observed.wallet_in_after)!==BigInt(debit.amount)+(baseline.asset_in_id===XLM.id?BigInt(chain.fee_stroops):0n)||atomic(observed.wallet_out_after)-atomic(observed.wallet_out_before)+(baseline.asset_out_id===XLM.id?BigInt(chain.fee_stroops):0n)!==BigInt(credit.amount))return null;
  return {market_id:record.market_id,asset_in_id:baseline.asset_in_id,asset_out_id:baseline.asset_out_id,tx_hash:chain.hash,ledger:chain.ledger,verified_at:new Date(now).toISOString(),valid_until:now+30000,[VERIFIED]:true};
 }catch{return null;}
}
export class SpotProofReadiness {
 private running:Promise<void>|null=null;private checkedAt=0;
 constructor(private pool:Pool,private adapter:SoroswapSpotAdapter,private inspector:Pick<SoroswapDirectInspector,'registry'|'market'> & Partial<Pick<SoroswapDirectInspector,'markets'>> & {registryForMarket?(id:string):Promise<SwapRegistry>},private server:Pick<rpc.Server,'getNetwork'|'getTransaction'>){}
 async refresh():Promise<void>{if(this.running)return this.running;if(Date.now()-this.checkedAt<25000)return;this.running=this.recheck().finally(()=>{this.checkedAt=Date.now();this.running=null;});return this.running;}
 private async recheck():Promise<void>{
  this.adapter.clearExecutionProof();
  try{
   if((await this.server.getNetwork()).passphrase!==NETWORK_PASSPHRASE)throw Error('Wrong network');
   const markets=this.inspector.markets?await this.inspector.markets():[await this.inspector.market()],registry=this.inspector.registryForMarket?undefined:await this.inspector.registry();
   for(const market of markets){this.adapter.refreshVerifiedMarket(market);let verified=false;
   const rows=(await this.pool.query(`SELECT p.id,p.business_id,p.customer_id,w.stellar_address AS wallet_address,c.privy_user_id,p.state,p.module_code,p.provider,p.type,p.tx_hash,p.signed_xdr,p.prepared_action,p.result_json,o.market_id,q.amount_in_atomic,q.min_out_atomic,o.actual_in_atomic,o.actual_out_atomic FROM operations p JOIN orders o ON o.business_id=p.business_id AND o.customer_id=p.customer_id AND o.operation_id=p.id JOIN trade_quotes q ON q.business_id=o.business_id AND q.customer_id=o.customer_id AND q.id=o.quote_id JOIN wallets w ON w.business_id=p.business_id AND w.customer_id=p.customer_id AND w.id=p.wallet_id JOIN customers c ON c.business_id=p.business_id AND c.id=p.customer_id WHERE p.state='completed' AND p.module_code='trade.spot' AND p.type='spot.swap' AND p.provider='soroswap' AND o.market_id=$1 AND p.tx_hash IS NOT NULL AND o.actual_out_atomic>0 ORDER BY p.updated_at DESC LIMIT 10`,[market.id])).rows as StoredSpotProof[];
   for(const record of rows){const observation=confirmedSpotObservation(await this.server.getTransaction(record.tx_hash));if(!observation)continue;const proofRegistry=this.inspector.registryForMarket?await this.inspector.registryForMarket(market.id):registry;const proof=verifyStoredSpotProof(record,observation,proofRegistry!);if(!proof)continue;this.adapter.applyVerifiedExecution(proof);await this.pool.query("UPDATE provider_markets SET readiness='testnet_verified',reason=NULL,as_of=$2 WHERE id=$1 AND module_code='trade.spot' AND provider='soroswap'",[market.id,proof.verified_at]);verified=true;break;}
   if(!verified)await this.pool.query("UPDATE provider_markets SET readiness='discovery_only',reason='Current completed swap proof is unavailable',as_of=now() WHERE id=$1 AND module_code='trade.spot'",[market.id]);}
  }catch{this.adapter.invalidateRoute();}
 }
 async capability(){await this.refresh();return this.adapter.capability();}
}
