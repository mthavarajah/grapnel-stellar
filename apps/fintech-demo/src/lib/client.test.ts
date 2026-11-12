import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, clearOperationRequest, operationRequestKey, consumerErrorMessage } from './client';
afterEach(()=>vi.unstubAllGlobals());
describe('ambiguous financial request recovery',()=>{
 it('keeps the same key until a known accepted response is received',async()=>{
  const body={asset_id:'stellar-testnet:native:XLM',amount:'1'};const key=operationRequestKey('customer-a','fund',body);
  vi.stubGlobal('fetch',vi.fn().mockRejectedValueOnce(Error('Timeout after send')).mockResolvedValueOnce({ok:true,json:async()=>({data:{operation_id:'known-operation'}})}));
  await expect(api('grapnel/fund',body,'POST',key)).rejects.toThrow('Timeout');
  expect(operationRequestKey('customer-a','fund',body)).toBe(key);
  await api('grapnel/fund',body,'POST',operationRequestKey('customer-a','fund',body));
  const calls=vi.mocked(fetch).mock.calls;expect((calls[0]![1]!.headers as Record<string,string>)['Idempotency-Key']).toBe((calls[1]![1]!.headers as Record<string,string>)['Idempotency-Key']);
  clearOperationRequest('customer-a','fund',body);expect(operationRequestKey('customer-a','fund',body)).not.toBe(key);
 });
 it('separates customer sessions and changed intents',()=>{const body={amount:'2'};expect(operationRequestKey('customer-a','return',body)).not.toBe(operationRequestKey('customer-b','return',body));expect(operationRequestKey('customer-a','return',body)).not.toBe(operationRequestKey('customer-a','return',{amount:'3'}));});
 it('uses session storage to retain pending intent keys across client reloads',()=>{const body={amount:'4'};const intent='grapnel.pending:customer-c:fund:'+JSON.stringify(body);vi.stubGlobal('sessionStorage',{getItem:(name:string)=>name===intent?'existing-pending-key':null,setItem:vi.fn(),removeItem:vi.fn()});expect(operationRequestKey('customer-c','fund',body)).toBe('existing-pending-key');clearOperationRequest('customer-c','fund',body);expect(sessionStorage.removeItem).toHaveBeenCalledWith(intent);});
});

it('preserves pending-operation recovery details',async()=>{
 const id='00000000-0000-4000-8000-000000000003';
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:409,json:async()=>({error:{code:'WALLET_OPERATION_PENDING',message:'Finish the pending wallet action',details:{operation_id:id}}})}));
 await expect(api('grapnel/usdc-trustline',{limit:'1000'})).rejects.toMatchObject({code:'WALLET_OPERATION_PENDING',status:409,details:{operation_id:id}});
});
it('rejects malformed error details as a recovery object',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:409,json:async()=>({error:{code:'WALLET_OPERATION_PENDING',message:'Pending',details:['not-an-object']}})}));
 await expect(api('grapnel/usdc-trustline',{limit:'1000'})).rejects.toMatchObject({details:{}});
});

it('shows customer error copy while preserving structured diagnostic codes',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:409,json:async()=>({error:{code:'EXECUTION_UNAVAILABLE',message:'Soroswap GATE_1_SIGNING_PROOF_REQUIRED',details:{}}})}));
 await expect(api('grapnel/quote',{})).rejects.toMatchObject({code:'EXECUTION_UNAVAILABLE',message:'This action is unavailable right now.'});
 expect(consumerErrorMessage('INSUFFICIENT_POSITION','technical pool position')).toBe('You do not have enough in Earn to withdraw this amount.');
 expect(consumerErrorMessage('VALIDATION_ERROR','Enter a positive amount.')).toBe('Enter a positive amount.');
});
it('translates borrowing reasons into actionable customer messages without exposing diagnostics',async()=>{
 expect(consumerErrorMessage('EXECUTION_UNAVAILABLE','Borrowing unavailable',{reason:'MIN_COLLATERAL_REQUIRED'})).toContain('below the minimum');
 expect(consumerErrorMessage('EXECUTION_UNAVAILABLE','Borrowing unavailable',{reason:'BORROW_CAPACITY_EXCEEDED'})).toContain('smaller amount');
 expect(consumerErrorMessage('EXECUTION_UNAVAILABLE','Borrowing unavailable',{reason:'COLLATERAL_WITHDRAW_WITH_DEBT_REQUIRES_REPAYMENT'})).toBe('Repay your outstanding loans before removing collateral.');
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:409,json:async()=>({error:{code:'EXECUTION_UNAVAILABLE',message:'Borrowing is unavailable',details:{reason:'MIN_COLLATERAL_REQUIRED'}}})}));
 await expect(api('grapnel/lending/borrow',{})).rejects.toMatchObject({message:expect.stringContaining('below the minimum'),details:{reason:'MIN_COLLATERAL_REQUIRED'}});
});
