import{it,expect}from'vitest';import{stockSigningDiagnostic}from'./stock-signing-diagnostic';
it('preserves an actionable SDK error code while excluding signatures, credentials and request payloads',()=>{
 const d=stockSigningDiagnostic('signing',{name:'WalletError',code:'unsupported_chain',message:'request failed 0x'+'ab'.repeat(64)+' Bearer token-secret access_token=secret-value',transaction:{private_key:'never-log-this'}});
 expect(d.code).toBe('unsupported_chain');expect(JSON.stringify(d)).not.toContain('token-secret');expect(JSON.stringify(d)).not.toContain('secret-value');expect(JSON.stringify(d)).not.toContain('never-log-this');expect(d.message).toContain('[redacted]');expect(d.message.length).toBeLessThanOrEqual(240);
});
it('handles non-Error wallet rejection objects and nested errors',()=>{expect(stockSigningDiagnostic('signing',{cause:{code:4001,message:'Rejected by user'}})).toMatchObject({code:'4001',message:'Rejected by user'});});
