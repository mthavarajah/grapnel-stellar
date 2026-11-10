import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, clearOperationRequest, operationRequestKey } from './client';
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
