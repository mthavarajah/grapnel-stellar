import type {rpc} from '@stellar/stellar-sdk';
import type {Pool,PoolClient} from 'pg';
import type {CustomerContext} from '@grapnel/contracts';
import {GrapnelError} from '@grapnel/contracts';
import type {Hex} from 'viem';
import {canonicalJson} from '../../lib/crypto.js';
import {CctpBurnPreparer} from '../../adapters/cctp/preparer.js';
import {CctpSourceBurnReader} from '../../adapters/cctp/source-proof.js';
import {readHyperCoreEligibility,readHyperCoreBaseline,confirmHyperCoreCredit,type CctpCoreBaseline} from '../../adapters/cctp/core-proof.js';
import {CctpDestinationPreparer,createCctpEvmReadTransport,readCctpAttestation,decodeCctpV2Message,confirmDestinationMint,confirmCoreDepositTransfer} from '../../adapters/cctp/destination.js';
import {CCTP_TESTNET as P} from '../../adapters/cctp/registry.js';
import type {CctpUsdcSetupPreparer} from '../../adapters/cctp/setup.js';
import type {OperationService} from '../operations/service.js';
import {PgPerpetualWorkflowStore} from './persistence.js';
import {PgCctpFundingStore} from './cctp-store.js';
import {CctpFundingCoordinator} from './cctp-service.js';
import {CctpBurnExecutionBridge} from './cctp-burn-execution.js';
import type {CircleSetupChain} from './funding.js';
import type {PerpetualScope} from './workflow-contract.js';
const fail=():never=>{throw new GrapnelError(409,'CCTP_PROOF_UNVERIFIED','Independent matching chain evidence is required');};
const same=(a:unknown,b:unknown)=>{if(canonicalJson(a)!==canonicalJson(b))return fail();};
export function createCctpRuntime(d:{pool:Pool;operations:OperationService;chain:CircleSetupChain&{server:Pick<rpc.Server,'getNetwork'>};setup:CctpUsdcSetupPreparer;verifyGate1:()=>Promise<boolean>;accessApproved:()=>Promise<boolean>}){
 const accounts=new PgPerpetualWorkflowStore(d.pool),transport=createCctpEvmReadTransport();let coordinator:CctpFundingCoordinator;
 async function customer(scope:PerpetualScope,client?:PoolClient):Promise<CustomerContext>{const row=(await (client??d.pool).query("SELECT c.privy_user_id FROM customers c JOIN wallets w ON w.business_id=c.business_id AND w.customer_id=c.id WHERE c.business_id=$1 AND c.id=$2 AND w.id=$3 AND w.stellar_address=$4 AND w.network='stellar-testnet' AND w.status='active'",[scope.businessId,scope.customerId,scope.walletId,scope.stellarAddress])).rows[0];if(typeof row?.privy_user_id!=='string'||!row.privy_user_id.startsWith('did:privy:'))return fail();return {...scope,walletAddress:scope.stellarAddress,privyUserId:row.privy_user_id};}
 const binding=async(c:CustomerContext)=>{const a=await accounts.account({businessId:c.businessId,customerId:c.customerId,walletId:c.walletId,stellarAddress:c.walletAddress});return a?{businessId:c.businessId,customerId:c.customerId,walletId:c.walletId,walletAddress:c.walletAddress,evmRecipient:a.accountAddress,network:'hyperevm-testnet' as const,chainId:998 as const}:null;};
 const store=new PgCctpFundingStore(d.pool,{
  verifyProof:async(record,patch,client)=>{
   if(!client)return fail();const r=await coordinator.request(record,await customer(record.scope,client));
   if(patch.sourceTxHash){const row=(await client.query('SELECT tx_hash,signed_xdr FROM operations WHERE id=$1 AND business_id=$2 AND customer_id=$3 AND wallet_id=$4',[record.id,record.scope.businessId,record.scope.customerId,record.scope.walletId])).rows[0];if(row?.tx_hash!==patch.sourceTxHash||!row.signed_xdr)return fail();}
   if(patch.sourceProof){const reader=new CctpSourceBurnReader({server:d.chain.server,readPreparedBurn:async(req,hash)=>{if(hash!==record.sourceTxHash||req.operationId!==record.id||req.customer.businessId!==record.scope.businessId||req.customer.customerId!==record.scope.customerId||req.customer.walletId!==record.scope.walletId)return null;return {request:{operationId:record.id,customer:r.customer,amountStellarAtomic:record.amountAtomic7,evmRecipient:record.accountAddress,destinationDomain:19,expiresAt:record.source.authorization.expiresAt,maxFeeStroops:'10000000'},prepared:record.source};}});same(patch.sourceProof,await reader.read(r,patch.sourceProof.sourceTxHash));}
   if(patch.messageHex||patch.attestationHex){if(!record.sourceTxHash)return fail();const a=await readCctpAttestation(27,record.sourceTxHash);if(!a)return fail();same(patch.messageHex,a.message.hex);same(patch.attestationHex,a.attestation);}
   if(patch.mintProof){if(!record.messageHex||!record.sourceTxHash)return fail();same(patch.mintProof,await confirmDestinationMint(r,record.sourceTxHash,decodeCctpV2Message(record.messageHex),patch.mintProof.destinationTxHash,transport));}
   if(patch.depositProof){if(!record.mintProof)return fail();same(patch.depositProof,await confirmCoreDepositTransfer(r,record.mintProof,patch.depositProof.depositTxHash,transport));}
   if(patch.coreProof){if(!record.depositProof)return fail();const stage=(await client.query("SELECT baseline FROM cctp_customer_stages WHERE funding_id=$1 AND business_id=$2 AND customer_id=$3 AND wallet_id=$4 AND step='core.deposit' AND tx_hash=$5 AND state='confirmed'",[record.id,record.scope.businessId,record.scope.customerId,record.scope.walletId,record.depositProof.depositTxHash])).rows[0];if(!stage?.baseline)return fail();same(patch.coreProof,await confirmHyperCoreCredit(r,record.depositProof,stage.baseline as unknown as CctpCoreBaseline,{transport}));}
  },
  verifyStageResult:async(record,stage,state,proof,client)=>{
   if(!client)return fail();
   if(!stage.txHash)return fail();
   if(state==='reverted'){const receipt=await transport.request('eth_getTransactionReceipt',[stage.txHash]) as any;if(receipt?.status!=='0x0'||receipt.transactionHash?.toLowerCase()!==stage.txHash)return fail();const [block,head]=await Promise.all([transport.request('eth_getBlockByNumber',[receipt.blockNumber,false]),transport.request('eth_blockNumber',[])]) as any[];if(block?.hash?.toLowerCase()!==receipt.blockHash?.toLowerCase()||BigInt(head)<BigInt(receipt.blockNumber)+1n)return fail();return;}
   if(stage.step==='core.approve'){same(proof,await coordinator.approvalProof(record,stage));return;}
   const r=await coordinator.request(record,await customer(record.scope,client));
   if(stage.step==='cctp.receive'){if(!record.sourceTxHash||!record.messageHex)return fail();same(proof,await confirmDestinationMint(r,record.sourceTxHash,decodeCctpV2Message(record.messageHex),stage.txHash,transport));}
   else{if(!record.mintProof||!stage.baseline)return fail();same(proof,await confirmCoreDepositTransfer(r,record.mintProof,stage.txHash,transport));}
  },
 });
 const source=new CctpSourceBurnReader({server:d.chain.server,readPreparedBurn:async(r,hash)=>{
  const record=await store.get({businessId:r.customer.businessId,customerId:r.customer.customerId,walletId:r.customer.walletId,stellarAddress:r.customer.walletAddress},r.operationId);if(!record)return null;
  const op=(await d.pool.query('SELECT tx_hash,prepared_action FROM operations WHERE id=$1 AND business_id=$2 AND customer_id=$3 AND wallet_id=$4',[record.id,record.scope.businessId,record.scope.customerId,record.scope.walletId])).rows[0];if(op?.tx_hash!==hash)return null;same(op.prepared_action,record.source);
  return {request:{operationId:record.id,customer:r.customer,amountStellarAtomic:record.amountAtomic7,evmRecipient:record.accountAddress,destinationDomain:19,expiresAt:record.source.authorization.expiresAt,maxFeeStroops:'10000000'},prepared:record.source};
 }});
 const burn=new CctpBurnPreparer({server:d.chain.server,readRecipientBinding:binding});
 const destination=new CctpDestinationPreparer({transport,readBinding:binding,readEligibility:async c=>{const b=await binding(c);return b?readHyperCoreEligibility(b.evmRecipient):null;},readSourceBurn:(r,hash)=>source.read(r,hash),readMintProof:async r=>(await store.get({businessId:r.customer.businessId,customerId:r.customer.customerId,walletId:r.customer.walletId,stellarAddress:r.customer.walletAddress},r.operationId))?.mintProof??null});
 coordinator=new CctpFundingCoordinator({operations:d.operations,store,accounts,setup:d.setup,burn,destination,transport,customer,eligibility:readHyperCoreEligibility,verifyGate1:d.verifyGate1,accessApproved:d.accessApproved,readSourceProof:(r,hash)=>source.read(r,hash),
  readCoreBaseline:async request=>({...await readHyperCoreBaseline(request,{transport})}),
  confirmCoreCredit:(r,p,b)=>confirmHyperCoreCredit(r,p,b as unknown as CctpCoreBaseline,{transport}),
  // No invented receive-capacity oracle: source burns stay unavailable until a supported reader exists.
  sendRaw:async serialized=>{const response=await fetch(P.hyperEvm.rpc,{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_sendRawTransaction',params:[serialized]}),signal:AbortSignal.timeout(15000)});if(!response.ok||Number(response.headers.get('content-length')??0)>32768)return fail();const body=await response.text();if(body.length>32768)return fail();const json=JSON.parse(body);if(json.jsonrpc!=='2.0'||json.id!==1||json.error||!/^0x[0-9a-f]{64}$/i.test(json.result))return fail();return json.result as Hex;},
 });
 const execution=new CctpBurnExecutionBridge(coordinator,d.chain);
 const fundingStatus=async(scope:PerpetualScope)=>{const status=await d.setup.readStatus(await customer(scope)),account=await accounts.account(scope);let reason='CONNECT_TRADING_WALLET';if(account){const e=await readHyperCoreEligibility(account.accountAddress);reason=e.preexistingMainnetState==='verified'?'CCTP_TESTNET_RECEIVE_CAPACITY_UNVERIFIED':'HYPERCORE_TESTNET_EXISTING_ACCOUNT_REQUIRED';}return {trustline_ready:status.trustline_exists&&status.trustline_authorized===true,balance:status.wallet_amount,allowance:status.allowance_amount,bridge_available:false,reason};};
 return {coordinator,execution,fundingStatus};
}
