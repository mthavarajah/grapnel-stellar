import {readFileSync} from 'node:fs';
import {describe,it,expect,vi} from 'vitest';
import {Transaction,TransactionBuilder,xdr} from '@stellar/stellar-sdk';
import {NETWORK,NETWORK_PASSPHRASE} from '@grapnel/contracts';
import {PeridotCustomerChain,type ConfirmedPeridotTransaction} from './chain.js';
import {reviewedPhaseBindings,type CustomerPhaseBindings,type CustomerPhaseBinding} from './bindings.js';
import {reviewedPositionBindings} from './position-bindings.js';
import {PeridotRoundTripVerifier} from './roundtrip.js';
import {PERIDOT_CUSTOMER_POLICY} from './policy.js';
import {reviewedExitBindings} from './exit-bindings.js';
import {reviewedAtomicCloseBinding} from './atomic-binding.js';
vi.mock('../execution/phase-reads.js',async original=>({...await original<typeof import('../execution/phase-reads.js')>(),verifyPeridotPhaseCodeBytes:vi.fn(async()=>{})}));
const owner='GAJZ5PEECGFB46QXKFW2QTWRXHYL4SOBS5VE2JDGJ4TDUIAUWEAHKV34';
const base={version:1,network:NETWORK,network_passphrase:NETWORK_PASSPHRASE,signer:'own_QA_ed25519_NOT_Privy_customer_flow',customer_privy_proof:false,owner,pins_hash:PERIDOT_CUSTOMER_POLICY.pinsHash};
function chain(){return new PeridotCustomerChain({nativeBalance:async()=>{throw Error('No live network');},horizonTransaction:async()=>{throw Error('No live network');}});}
function fixture(label:string){
 const file=JSON.parse(readFileSync(new URL(`./research/${label}-transaction.json`,import.meta.url),'utf8')),raw=file.response.result,meta=xdr.TransactionMeta.fromXDR(raw.resultMetaXdr,'base64'),result=xdr.TransactionResult.fromXDR(raw.resultXdr,'base64');
 return{hash:file.hash,createdAt:Number(raw.createdAt),ledger:raw.ledger,feeAtomic:result.feeCharged().toString(),meta,returnValue:meta.v4().sorobanMeta()?.returnValue()??undefined,transaction:TransactionBuilder.fromXDR(raw.envelopeXdr,NETWORK_PASSPHRASE)as Transaction}as ConfirmedPeridotTransaction;
}
const labels=[['collateral_swap','funding'],['vault_deposit','deposit'],['margin_transfer','transfer'],['open_begin','begin'],['open_cancel','cancel'],['open_begin','replacement_begin'],['open_swap','open_swap'],['open_activate','activate']]as const;
const prefix=()=>labels.map(([step,label])=>({step,tx_hash:fixture(label).hash}));
const missingTail=[{step:'close_atomic',tx_hash:fixture('atomic_close').hash},{step:'margin_return',tx_hash:'2'.repeat(64)},{step:'vault_withdraw',tx_hash:'3'.repeat(64)}];
function futurePlaceholder():CustomerPhaseBinding{return{prepare:async()=>{throw Error('UNPROVEN_PHASE');},verify:async()=>{throw Error('UNPROVEN_PHASE');},inspectHistorical:()=>{throw Error('UNPROVEN_PHASE');}};}
describe('Trusted round-trip verification never substitutes configured truth for chain proof',()=>{
 it('returns false for the root null evidence file',async()=>{
  const source=chain(),read=vi.fn(async()=>null),get=vi.spyOn(source,'confirmed'),verifier=new PeridotRoundTripVerifier({chain:source,bindings:{},readManifest:read});expect(await verifier.verify()).toBe(false);expect(get).not.toHaveBeenCalled();expect(verifier.lastFailureReason).toBe('ROUND_TRIP_MANIFEST_REQUIRED');
 });
 it('rejects a missing required phase guard before making ledger requests',async()=>{
  const source=chain(),get=vi.spyOn(source,'confirmed'),verifier=new PeridotRoundTripVerifier({chain:source,bindings:{},readManifest:async()=>({...base,steps:[...prefix(),...missingTail]})});expect(await verifier.verify()).toBe(false);expect(get).not.toHaveBeenCalled();expect(verifier.lastFailureReason).toBe('ROUND_TRIP_PHASE_GUARD_REQUIRED');
 });
 it.each([{network:'stellar-mainnet'},{network_passphrase:'Public Global Stellar Network ; September 2015'},{signer:'privy_stellar'},{customer_privy_proof:true},{pins_hash:'f'.repeat(64)},{owner:'attacker'}])('rejects identity/network/proof-label substitution',async changed=>{
  const source=chain(),get=vi.spyOn(source,'confirmed'),verifier=new PeridotRoundTripVerifier({chain:source,bindings:{},readManifest:async()=>({...base,...changed,steps:[...prefix(),...missingTail]})});expect(await verifier.verify()).toBe(false);expect(get).not.toHaveBeenCalled();
 });
 it('replays all actual signed transactions through final withdrawal and checks current zero exposure',async()=>{
  const source=chain(),bindings={...reviewedPhaseBindings(source),...reviewedPositionBindings(source),...reviewedAtomicCloseBinding(source),...reviewedExitBindings(source)};
  const all=[...labels,['close_atomic','atomic_close'],['margin_return','margin_return'],['vault_withdraw','vault_withdraw']],recorded=new Map(all.map(([,label])=>{const tx=fixture(label);return[tx.hash,tx]as const;}));
  vi.spyOn(source,'confirmed').mockImplementation(async hash=>recorded.get(hash)!);
  vi.spyOn(source,'positionSnapshot').mockResolvedValue(null);
  const snapshot=vi.spyOn(source,'snapshot').mockResolvedValue({walletUnderlyingAtomic:'15180497',walletReceiptAtomic:'0',marginReceiptAtomic:'0',marginDebtAtomic:'0',nativeWalletAtomic:'99844281574',nativeSpendableAtomic:'99844281574',observedAt:new Date().toISOString(),ledger:5685880,position:null});
  const manifest={...base,steps:all.map(([step,label])=>({step,tx_hash:fixture(label).hash}))};
  const verifier=new PeridotRoundTripVerifier({chain:source,bindings,readManifest:async()=>manifest});expect(await verifier.verify(),verifier.lastFailureReason).toBe(true);
  snapshot.mockResolvedValue({...await source.snapshot({}as never),marginDebtAtomic:'1'});
  const poisoned=new PeridotRoundTripVerifier({chain:source,bindings,readManifest:async()=>manifest});expect(await poisoned.verify()).toBe(false);expect(poisoned.lastFailureReason).toBe('ROUND_TRIP_FINAL_BALANCES');
 });
 it('coalesces concurrent checks and does not persist a negative result as a verified cache',async()=>{
  let resolve!:(value:null)=>void;const read=vi.fn(()=>new Promise<null>(r=>{resolve=r;})),verifier=new PeridotRoundTripVerifier({chain:chain(),bindings:{},readManifest:read});const a=verifier.verify(),b=verifier.verify();resolve(null);expect(await Promise.all([a,b])).toEqual([false,false]);expect(read).toHaveBeenCalledTimes(1);const c=verifier.verify();resolve(null);expect(await c).toBe(false);expect(read).toHaveBeenCalledTimes(2);
 });
 it('replays nine actual recorded QA transactions through atomic close, then remains blocked awaiting actual return proof',async()=>{
  const source=chain(),bindings:CustomerPhaseBindings={...reviewedPhaseBindings(source),...reviewedPositionBindings(source),...reviewedAtomicCloseBinding(source),margin_return:futurePlaceholder(),vault_withdraw:futurePlaceholder()};
  const recorded=new Map([...labels.map(([,label])=>label),'atomic_close'].map(label=>{const tx=fixture(label);return[tx.hash,tx]as const;})),get=vi.spyOn(source,'confirmed').mockImplementation(async hash=>{const tx=recorded.get(hash);if(!tx)throw Error('WAITING_FOR_ACTUAL_RETURN_PROOF');return tx;});
  const verifier=new PeridotRoundTripVerifier({chain:source,bindings,readManifest:async()=>({...base,steps:[...prefix(),...missingTail]})});expect(await verifier.verify()).toBe(false);expect(verifier.lastFailureReason).toBe('WAITING_FOR_ACTUAL_RETURN_PROOF');expect(get).toHaveBeenCalledTimes(10);
 });
});
