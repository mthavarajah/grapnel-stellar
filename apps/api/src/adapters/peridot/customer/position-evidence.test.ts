import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
import {Transaction,TransactionBuilder,xdr,scValToNative} from '@stellar/stellar-sdk';
import {NETWORK_PASSPHRASE,type CustomerContext} from '@grapnel/contracts';
import {canonicalJson,digest} from '../../../lib/crypto.js';
import type {MarginStepContext,MarginWorkflow} from '../../../modules/margin/types.js';
import {PERIDOT_MARKET_ID,PERIDOT_TESTNET_PINS as P} from '../config.js';
import {validateMarginPositionSnapshot} from '../execution/state.js';
import {createCustomerTerms} from './policy.js';
import {PeridotTransactionChanges,contractKey} from './metadata.js';
import {openSwapEvidence,openCancelEvidence} from './phase-evidence.js';
import {PeridotCustomerChain,type ConfirmedPeridotTransaction,type CustomerSnapshot} from './chain.js';
import {encodePrivate} from './encoding.js';
import type {PrivateMarginBaseline,PhasePrepared} from './bindings.js';
const owner='GAJZ5PEECGFB46QXKFW2QTWRXHYL4SOBS5VE2JDGJ4TDUIAUWEAHKV34';
const customer:CustomerContext={businessId:randomUUID(),customerId:randomUUID(),walletId:randomUUID(),walletAddress:owner,privyUserId:'did:privy:OFFLINE_QA_METADATA_NOT_CUSTOMER_PROOF'};
const terms=createCustomerTerms({market_id:PERIDOT_MARKET_ID,direction:'long',leverage:2,amount:'1',slippage_bps:50},customer);
function fixture(label:string){
 const raw=JSON.parse(readFileSync(new URL(`./research/${label}-transaction.json`,import.meta.url),'utf8')),b=raw.response.result,signed=TransactionBuilder.fromXDR(b.envelopeXdr,NETWORK_PASSPHRASE)as Transaction,envelope=xdr.TransactionEnvelope.fromXDR(b.envelopeXdr,'base64');envelope.v1().signatures([]);const unsigned=TransactionBuilder.fromXDR(envelope.toXDR('base64'),NETWORK_PASSPHRASE)as Transaction,meta=xdr.TransactionMeta.fromXDR(b.resultMetaXdr,'base64'),result=xdr.TransactionResult.fromXDR(b.resultXdr,'base64');
 return{raw,b,unsigned,confirmed:{hash:raw.hash,ledger:b.ledger,feeAtomic:result.feeCharged().toString(),meta,returnValue:meta.v4().sorobanMeta()?.returnValue()??undefined,transaction:signed}as ConfirmedPeridotTransaction};
}
function phase(kind:'open_swap'|'open_cancel'){
 const cancel=kind==='open_cancel',id=cancel?'13843':'13844',begin=fixture(cancel?'begin':'replacement_begin'),tx=fixture(cancel?'cancel':'open_swap'),now=Date.parse(tx.raw.observed_at),at=new Date(now).toISOString(),key=xdr.ScVal.scvU64(xdr.Uint64.fromString(id)),changes=new PeridotTransactionChanges(begin.confirmed.meta),position=validateMarginPositionSnapshot({positionId:id,walletAddress:owner,direction:'long',position:scValToNative(changes.entry(P.margin.address,contractKey('Position',key))!.after!),pendingOpen:scValToNative(changes.entry(P.margin.address,contractKey('PendingPerpsOpenPosition',key))!.after!),perps:null,pendingClose:null,openExecution:null,observedLedger:begin.b.ledger,observedAt:at});
 const workflow:MarginWorkflow={id:randomUUID(),businessId:customer.businessId,customerId:customer.customerId,walletId:customer.walletId,walletAddress:owner,terms,termsHash:digest(canonicalJson(terms)),revision:1,phase:'opening_pending',positionId:id,receiptAtomic:'9999780',activeOperationId:null,createdAt:at,updatedAt:at};
 const c:MarginStepContext={workflow,step:kind,terms:{},intentHash:digest(canonicalJson({workflowId:workflow.id,termsHash:workflow.termsHash,step:kind,terms:{},positionId:id,receiptAtomic:'9999780'})),operationId:randomUUID()};
 const native=cancel?'99848459509':'99846338907',before:CustomerSnapshot={walletUnderlyingAtomic:'5300316',walletReceiptAtomic:'0',marginReceiptAtomic:'0',marginDebtAtomic:'0',nativeWalletAtomic:native,nativeSpendableAtomic:native,ledger:tx.b.ledger-1,observedAt:at,position};
 const after:CustomerSnapshot={...before,nativeWalletAtomic:(BigInt(native)-BigInt(tx.confirmed.feeAtomic)).toString(),ledger:tx.b.ledger,position:null,marginReceiptAtomic:cancel?'9999780':'0'};
 if(!cancel){const output=new PeridotTransactionChanges(tx.confirmed.meta).entry(P.margin.address,contractKey('PendingPerpsOpenExecution',key))!.after!;after.position={...position,openExecution:scValToNative(output)as Record<string,unknown>};after.marginDebtAtomic='9999998';}
 const helper:PhasePrepared={intent:{step:kind,walletAddress:owner,positionId:id},pendingDigest:createHash('sha256').update(JSON.stringify(position.pendingOpen,(_,v)=>typeof v==='bigint'?v.toString():v)).digest('hex'),unsignedXdr:tx.unsigned.toXDR(),signingHashHex:tx.raw.hash,expiresAt:new Date(Number(tx.unsigned.timeBounds!.maxTime)*1000).toISOString(),feeStroops:tx.unsigned.fee,networkPassphrase:NETWORK_PASSPHRASE};
 const baseline={version:1,intentHash:c.intentHash,workflowRevision:1,helper,before:encodePrivate(before)}as PrivateMarginBaseline;
 return{c,baseline,before,after,now,confirmed:tx.confirmed};
}
describe('Actual open-swap and cancellation metadata (QA signer, not customer acceptance)',()=>{
 it('uses actual per-position vault debt even when legacy Position.debt_shares remains zero',()=>{
  const f=phase('open_swap');expect(f.after.position!.position.debt_shares).toBe(0n);
  const proof=openSwapEvidence(f.c,f.baseline,f.confirmed,f.after,customer,f.now);
  expect(proof.after.position).toMatchObject({positionId:'13844',status:'PendingOpen',debtAtomic:'9999998',swapOutputAtomic:'129932005'});
  expect(()=>openSwapEvidence(f.c,f.baseline,f.confirmed,{...f.after,marginDebtAtomic:'0'},customer,f.now)).toThrow();
 });
 it('rejects a changed stored pending digest or a second claimed swap output',()=>{
  const f=phase('open_swap');expect(()=>openSwapEvidence(f.c,{...f.baseline,helper:{...f.baseline.helper,pendingDigest:'f'.repeat(64)}},f.confirmed,f.after,customer,f.now)).toThrow();
  expect(()=>openSwapEvidence(f.c,f.baseline,f.confirmed,{...f.after,position:{...f.after.position!,openExecution:{margin_received:9999999n,position_amount:129932006n}}},customer,f.now)).toThrow();
 });
 it('proves cancellation through exact deleted owned records and restored controller receipts',()=>{
  const f=phase('open_cancel'),proof=openCancelEvidence(f.c,f.baseline,f.confirmed,f.after,customer,f.now);
  expect(proof).toMatchObject({cancellationVerified:true,before:{position:{positionId:'13843',status:'PendingOpen',debtAtomic:'0'}},after:{position:null,marginReceiptAtomic:'9999780'}});
  expect(()=>openCancelEvidence(f.c,f.baseline,f.confirmed,{...f.after,marginDebtAtomic:'1'},customer,f.now)).toThrow();
  expect(()=>openCancelEvidence(f.c,f.baseline,f.confirmed,{...f.after,marginReceiptAtomic:'9999779'},customer,f.now)).toThrow();
 });
});
describe('Explicit independently absent position reads',()=>{
 function reader(changed:Record<string,unknown>={}){const chain=new PeridotCustomerChain({nativeBalance:async()=>{throw Error('unused');},horizonTransaction:async()=>{throw Error('unused');}});vi.spyOn(chain,'view').mockImplementation(async(_owner,_contract,method)=>({ledger:100,value:Object.hasOwn(changed,method)?changed[method]:method==='get_margin_borrow_balance'?0n:method==='get_user_positions'?[]:null}));return chain;}
 it('accepts only all five null records, zero actual vault debt and no matching user position',async()=>expect(await reader().positionSnapshot(customer,'13843',true)).toBeNull());
 it.each([{get_position:{}},{get_perps_position:{}},{get_pending_perps_open:{}},{get_pending_perps_open_execution:{}},{get_pending_perps_close:{}},{get_margin_borrow_balance:1n},{get_user_positions:[13843n]}])('rejects contradictory absence evidence',async override=>{await expect(reader(override).positionSnapshot(customer,'13843',true)).rejects.toThrow();});
 it('propagates a transport error rather than interpreting it as missing position',async()=>{const chain=reader();vi.mocked(chain.view).mockRejectedValueOnce(Error('RPC unavailable'));await expect(chain.positionSnapshot(customer,'13843',true)).rejects.toThrow('RPC unavailable');});
});
