import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {Transaction,TransactionBuilder,xdr} from '@stellar/stellar-sdk';
import {NETWORK_PASSPHRASE,toAtomic,type CustomerContext} from '@grapnel/contracts';
import type {MarginStepContext} from '../../../modules/margin/types.js';
import {marginReturnEvidence,vaultWithdrawEvidence,reviewedExitBindings} from './exit-bindings.js';
import {PeridotCustomerChain,type CustomerSnapshot,type ConfirmedPeridotTransaction} from './chain.js';
import type {PrivateMarginBaseline} from './bindings.js';
const journal=JSON.parse(readFileSync(new URL('../execution/research/qa-recovery-evidence.json',import.meta.url),'utf8'));
const customer:CustomerContext={businessId:randomUUID(),customerId:randomUUID(),walletId:randomUUID(),walletAddress:journal.qa_address,privyUserId:'did:privy:OFFLINE_QA_METADATA_NOT_CUSTOMER_PROOF'};
function fixture(step:'margin_return'|'vault_withdraw'){
 const raw=JSON.parse(readFileSync(new URL(`./research/${step}-transaction.json`,import.meta.url),'utf8')),body=raw.response.result,transaction=TransactionBuilder.fromXDR(body.envelopeXdr,NETWORK_PASSPHRASE)as Transaction,meta=xdr.TransactionMeta.fromXDR(body.resultMetaXdr,'base64'),result=xdr.TransactionResult.fromXDR(body.resultXdr,'base64');
 const confirmed:ConfirmedPeridotTransaction={hash:raw.hash,ledger:body.ledger,feeAtomic:result.feeCharged().toString(),transaction,meta,returnValue:undefined};
 const row=journal.snapshots.find((s:{phase:string})=>s.phase==='qa_'+step),now=Date.now(),at=new Date(now).toISOString();
 const snapshot=(b:{native:string;mock_usdt_atomic:string;vault_receipt_atomic:string;margin_receipt_atomic:string},ledger:number):CustomerSnapshot=>({walletUnderlyingAtomic:b.mock_usdt_atomic,walletReceiptAtomic:b.vault_receipt_atomic,marginReceiptAtomic:b.margin_receipt_atomic,marginDebtAtomic:'0',nativeWalletAtomic:toAtomic(b.native,7).toString(),nativeSpendableAtomic:toAtomic(b.native,7).toString(),observedAt:at,ledger,position:null});
 const context={workflow:{revision:1,positionId:'13844',receiptAtomic:'9879964'},step,intentHash:'a'.repeat(64)}as MarginStepContext;
 const helper={intent:row.intent,expectedUnderlyingAtomic:'9880181',unsignedXdr:body.envelopeXdr,signingHashHex:raw.hash,expiresAt:new Date(Number(transaction.timeBounds!.maxTime)*1000).toISOString(),feeStroops:transaction.fee,networkPassphrase:NETWORK_PASSPHRASE};
 const baseline:PrivateMarginBaseline={version:1,intentHash:context.intentHash,workflowRevision:1,helper,before:snapshot(row.before,body.ledger-1)},after=snapshot(row.after,body.ledger);
 return{context,baseline,after,confirmed,now,read:step==='margin_return'?marginReturnEvidence:vaultWithdrawEvidence};
}
describe('Recorded real QA exit conservation (not customer Privy proof)',()=>{
 it.each(['margin_return','vault_withdraw']as const)('verifies %s and exact actual native fee',step=>{
  const f=fixture(step);expect(f.read(f.context,f.baseline,f.confirmed,f.after,customer,f.now)).toMatchObject({chainStatus:'SUCCESS',step,txHash:f.confirmed.hash});
  expect(()=>f.read(f.context,f.baseline,f.confirmed,{...f.after,nativeWalletAtomic:(BigInt(f.after.nativeWalletAtomic)+1n).toString()},customer,f.now)).toThrow();
 });
 it.each(['margin_return','vault_withdraw']as const)('rejects %s with foreign repaid position or remaining debt',step=>{
  const f=fixture(step);expect(()=>f.read({...f.context,workflow:{...f.context.workflow,positionId:'13843'}},f.baseline,f.confirmed,f.after,customer,f.now)).toThrow();
  expect(()=>f.read(f.context,f.baseline,f.confirmed,{...f.after,marginDebtAtomic:'1'},customer,f.now)).toThrow();
 });
 it('rejects withdrawal amount changes and a changed approved underlying conversion',()=>{
  const f=fixture('vault_withdraw');expect(()=>f.read(f.context,f.baseline,f.confirmed,{...f.after,walletUnderlyingAtomic:'15180498'},customer,f.now)).toThrow();
  expect(()=>f.read(f.context,{...f.baseline,helper:{...f.baseline.helper,expectedUnderlyingAtomic:'9880182'}},f.confirmed,f.after,customer,f.now)).toThrow();
 });
 it.each(['margin_return','vault_withdraw']as const)('binds %s approval to the exact closed position',step=>{
  const f=fixture(step),chain=new PeridotCustomerChain({nativeBalance:async()=>{throw Error('Offline');},horizonTransaction:async()=>{throw Error('Offline');}});
  const action=reviewedExitBindings(chain)[step]!.publicAction!(f.context,f.baseline.helper,customer);expect(action.summary).toMatchObject({positionId:'13844',amount:'9.879964',recipient:customer.walletAddress});
 });
});
