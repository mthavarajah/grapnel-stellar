import {describe,expect,it} from 'vitest';
import {applyMarginEvidence,assertNextMarginStep,validateMarginTerms} from './state.js';
import type {MarginEvidence,MarginStep,MarginWorkflow,MarginPositionEvidence} from './types.js';
const now=Date.parse('2026-11-11T21:00:00Z'),hash='a'.repeat(64),intent='b'.repeat(64);
export function fixture():MarginWorkflow{return{id:'00000000-0000-4000-8000-000000000001',businessId:'b',customerId:'c',walletId:'w',walletAddress:'owner',terms:{network:'stellar-testnet',provider:'peridot',marketId:'verified-market',poolId:'verified-pool',marginAssetId:'mockusdt',baseAssetId:'xlm',receiptAssetId:'vault',direction:'long',leverage:2,collateralAtomic:'10000000',slippageBps:50,maxFeeStroops:'10000000',depositMaxFeeStroops:'80000000',pinsHash:'c'.repeat(64),policyVersion:'reviewed-v1'},termsHash:'d'.repeat(64),phase:'awaiting_collateral',revision:0,positionId:null,receiptAtomic:null,activeOperationId:null,createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString()};}
function p(status:MarginPositionEvidence['status'],debt='0',output='0'):MarginPositionEvidence{return{positionId:'42',owner:'owner',marketId:'verified-market',direction:'long',status,debtAtomic:debt,swapOutputAtomic:output,pendingExpiresAt:status==='PendingOpen'||status==='Closing'?new Date(now+1800000).toISOString():null};}
function evidence(step:MarginStep):MarginEvidence{return{network:'stellar-testnet',chainStatus:'SUCCESS',txHash:hash,ledger:42,owner:'owner',step,intentHash:intent,observedAt:new Date(now).toISOString(),before:{walletUnderlyingAtomic:'20000000',walletReceiptAtomic:'0',marginReceiptAtomic:'0',position:null},after:{walletUnderlyingAtomic:'10000000',walletReceiptAtomic:'9999780',marginReceiptAtomic:'0',position:null}};}
const apply=(w:MarginWorkflow,e:MarginEvidence)=>({...w,...applyMarginEvidence(w,e.step,intent,hash,e,now)});
describe('Margin workflow phase/evidence defense (offline fixtures, not chain proof)',()=>{
 it('requires actual deposit and transfer deltas before begin can be prepared',()=>{
  let w=fixture();expect(()=>assertNextMarginStep(w,'open_begin',{minimumOutputAtomic:'1'})).toThrow();
  w=apply(w,evidence('vault_deposit'));expect(w.phase).toBe('awaiting_margin_transfer');expect(w.receiptAtomic).toBe('9999780');
  const transfer=evidence('margin_transfer');transfer.before.walletUnderlyingAtomic=transfer.after.walletUnderlyingAtomic='10000000';transfer.before.walletReceiptAtomic='9999780';transfer.after.walletReceiptAtomic='0';transfer.after.marginReceiptAtomic='9999780';w=apply(w,transfer);expect(w.phase).toBe('awaiting_open_begin');expect(()=>assertNextMarginStep(w,'open_begin',{minimumOutputAtomic:'123'})).not.toThrow();
 });
 it('binds returned position ID to independently read owner PendingOpen state; then requires swap before activation',()=>{
  let w={...fixture(),phase:'awaiting_open_begin' as const,receiptAtomic:'9999780'} as MarginWorkflow;
  const begin=evidence('open_begin');begin.before.marginReceiptAtomic='9999780';begin.after.marginReceiptAtomic='0';begin.after.position=p('PendingOpen');begin.returnedPositionId='42';w=apply(w,begin);expect(w.positionId).toBe('42');expect(w.phase).toBe('opening_pending');expect(()=>assertNextMarginStep(w,'open_activate',{})).toThrow();
  const swap=evidence('open_swap');swap.before.position=p('PendingOpen');swap.after.position=p('PendingOpen','0','130000000');w=apply(w,swap);expect(w.phase).toBe('opening_swapped');
  const activate=evidence('open_activate');activate.before.position=swap.after.position;activate.after.position=p('Open','9999998');w=apply(w,activate);expect(w.phase).toBe('open');
 });
 it('requires each close phase and repaid debt before receipt return and withdrawal',()=>{
  let w={...fixture(),phase:'open' as const,receiptAtomic:'9999780',positionId:'42'} as MarginWorkflow;
  const prepare=evidence('close_prepare');prepare.before.position=p('Open','9999998');prepare.after.position=p('Closing','9999998');w=apply(w,prepare);
  const swap=evidence('close_swap');swap.before.position=prepare.after.position;swap.after.position=p('Closing','9999998','10000000');w=apply(w,swap);
  const finish=evidence('close_finish');finish.before.position=swap.after.position;finish.after.position=p('Closed');finish.after.marginReceiptAtomic='9900000';w=apply(w,finish);expect(w.phase).toBe('closed');expect(w.receiptAtomic).toBe('9900000');
  const ret=evidence('margin_return');ret.before.marginReceiptAtomic='9900000';ret.after.marginReceiptAtomic='0';ret.after.walletReceiptAtomic='9900000';w=apply(w,ret);expect(w.phase).toBe('awaiting_vault_withdraw');
  const withdraw=evidence('vault_withdraw');withdraw.before.walletReceiptAtomic='9900000';withdraw.after.walletReceiptAtomic='0';withdraw.before.walletUnderlyingAtomic='10000000';withdraw.after.walletUnderlyingAtomic='19900000';w=apply(w,withdraw);expect(w.phase).toBe('recovered');
 });
 it.each(['hash','intent','owner','network','status','ledger','stale','future'] as const)('rejects mismatched or unverified evidence: %s',field=>{
  const e=evidence('vault_deposit');if(field==='hash')e.txHash='e'.repeat(64);if(field==='intent')e.intentHash='e'.repeat(64);if(field==='owner')e.owner='other';if(field==='network')(e as any).network='stellar-mainnet';if(field==='status')(e as any).chainStatus='PENDING';if(field==='ledger')e.ledger=0;if(field==='stale')e.observedAt=new Date(now-15001).toISOString();if(field==='future')e.observedAt=new Date(now+1001).toISOString();expect(()=>apply(fixture(),e)).toThrow();
 });
 it.each(['foreignOwner','wrongID','wrongDirection','wrongMarket','debt','missingReturn','expired','wrongReceipts'] as const)('rejects begin evidence %s',field=>{
  const w={...fixture(),phase:'awaiting_open_begin' as const,receiptAtomic:'9999780'},e=evidence('open_begin');e.before.marginReceiptAtomic='9999780';e.after.marginReceiptAtomic='0';e.after.position=p('PendingOpen');e.returnedPositionId='42';
  if(field==='foreignOwner')e.after.position.owner='other';if(field==='wrongID')e.returnedPositionId='43';if(field==='wrongDirection')e.after.position.direction='short';if(field==='wrongMarket')e.after.position.marketId='other';if(field==='debt')e.after.position.debtAtomic='1';if(field==='missingReturn')delete e.returnedPositionId;if(field==='expired')e.after.position.pendingExpiresAt=new Date(now).toISOString();if(field==='wrongReceipts')e.before.marginReceiptAtomic='9999779';expect(()=>apply(w,e)).toThrow();
 });
 it('keeps expired/cancel recovery separate from automatic signing, refuses cancelling already-swapped opens',()=>{
  const w={...fixture(),phase:'opening_pending' as const,receiptAtomic:'9999780',positionId:'42'},e=evidence('open_cancel');e.before.position=p('PendingOpen','0','1');e.after.position=null;e.cancellationVerified=true;expect(()=>apply(w,e)).toThrow();e.before.position.swapOutputAtomic='0';e.after.marginReceiptAtomic='9999780';const next=apply(w,e);expect(next.phase).toBe('closed');expect(next.receiptAtomic).toBe('9999780');
 });
 it('rejects finish with foreign owner, outstanding debt or missing swap proceeds',()=>{
  const w={...fixture(),phase:'closing_swapped' as const,positionId:'42',receiptAtomic:'9999780'},e=evidence('close_finish');e.before.position=p('Closing','1','0');e.after.position=p('Closed');expect(()=>apply(w,e)).toThrow();e.before.position.swapOutputAtomic='1';e.after.position.debtAtomic='1';expect(()=>apply(w,e)).toThrow();e.after.position.debtAtomic='0';e.after.position.owner='other';expect(()=>apply(w,e)).toThrow();
 });
 it('validates canonical bigint amounts and approved Testnet terms',()=>{validateMarginTerms(fixture().terms);for(const amount of ['-1','1.1','1e7','01','0'])expect(()=>validateMarginTerms({...fixture().terms,collateralAtomic:amount})).toThrow();expect(()=>validateMarginTerms({...fixture().terms,network:'stellar-mainnet'} as any)).toThrow();});
 it('blocks new steps when a prior child is pending and never accepts caller position/receipt overrides',()=>{
  const w={...fixture(),activeOperationId:'pending'};expect(()=>assertNextMarginStep(w,'vault_deposit',{})).toThrow();expect(()=>assertNextMarginStep(fixture(),'vault_deposit',{positionId:'99'} as any)).toThrow();
 });
 it('routes short closing to the reviewed short ABI only',()=>{const w={...fixture(),phase:'closing_prepared' as const,positionId:'42',receiptAtomic:'1',terms:{...fixture().terms,direction:'short' as const}};expect(()=>assertNextMarginStep(w,'close_swap',{minimumOutputAtomic:'1'})).toThrow();expect(()=>assertNextMarginStep(w,'close_short_swap',{maximumInputAtomic:'2',minimumDebtOutputAtomic:'1'})).not.toThrow();});
});
