import {describe,it,expect,vi} from 'vitest';
import {operationProgress,trackApproval,type ApprovalPhase} from './operation-progress';
describe('truthful operation progress',()=>{
 it.each(['accepted','validating','preparing'])('shows processing only for actual %s state',status=>expect(operationProgress(status)).toEqual({label:'Processing',spinning:true,completed:false}));
 it('never treats a waiting approval as an active signature request',()=>expect(operationProgress('awaiting_customer_authorization')).toMatchObject({label:'Needs approval',spinning:false}));
 it('keeps submission and chain confirmation separate',()=>{
  expect(operationProgress('submitted')).toMatchObject({label:'Submitted',spinning:true,completed:false});
  expect(operationProgress('confirming')).toMatchObject({label:'Confirming',spinning:true,completed:false});
  expect(operationProgress('completed','signed')).toEqual({label:'Completed',spinning:false,completed:true});
 });
 it.each(['failed','rejected','expired','recovery_required','unknown'])('stops spinning for %s without claiming success',status=>expect(operationProgress(status,'approving')).toMatchObject({spinning:false,completed:false}));
 it('reports approval only after signing returns and clears it after submission',async()=>{
  let finishSign!:(value:string)=>void,finishSubmit!:(value:string)=>void;const phases:(ApprovalPhase|null)[]=[];
  const submit=vi.fn(()=>new Promise<string>(resolve=>{finishSubmit=resolve;}));
  const result=trackApproval(()=>new Promise<string>(resolve=>{finishSign=resolve;}),submit,phase=>phases.push(phase));
  expect(phases).toEqual(['approving']);expect(submit).not.toHaveBeenCalled();
  finishSign('exact-signed-envelope');await Promise.resolve();
  expect(phases).toEqual(['approving','signed']);expect(submit).toHaveBeenCalledExactlyOnceWith('exact-signed-envelope');
  finishSubmit('submitted-operation');await expect(result).resolves.toBe('submitted-operation');expect(phases).toEqual(['approving','signed',null]);
 });
 it('does not submit or claim approval after a rejected signature',async()=>{
  const submit=vi.fn(),phases:(ApprovalPhase|null)[]=[];
  await expect(trackApproval(async()=>{throw Error('Customer declined');},submit,phase=>phases.push(phase))).rejects.toThrow('Customer declined');
  expect(phases).toEqual(['approving',null]);expect(submit).not.toHaveBeenCalled();
 });
 it('clears local progress after an uncertain submission without retrying it',async()=>{
  const submit=vi.fn(async()=>{throw Error('Response timed out');}),phases:(ApprovalPhase|null)[]=[];
  await expect(trackApproval(async()=>'signed',submit,phase=>phases.push(phase))).rejects.toThrow('Response timed out');expect(submit).toHaveBeenCalledTimes(1);expect(phases).toEqual(['approving','signed',null]);
 });
});
