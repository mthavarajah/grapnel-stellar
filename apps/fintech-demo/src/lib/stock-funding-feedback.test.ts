import {describe,expect,it} from 'vitest';
import {stockFundingRejectionMessage,stockFundingRejectionReason} from './stock-funding-feedback';

describe('Stocks funding failure classification',()=>{
  it('explains a verified preflight fee shortage without calling it an uncertain transfer',()=>{
    const message=stockFundingRejectionMessage('EXECUTION_UNAVAILABLE',409,'STOCK_FUNDING_TREASURY_GAS');
    expect(message).toContain('transaction fees');expect(message).toContain('No funds were sent');expect(message).not.toContain('uncertain');
  });
  it.each(['STOCK_FUNDING_TREASURY_LOW','STOCK_FUNDING_CAP','STOCK_FUNDING_TREASURY_PENDING','STOCK_FUNDING_ALREADY_ALLOCATED'])('allows the reviewed preflight reason %s',reason=>expect(stockFundingRejectionMessage('EXECUTION_UNAVAILABLE',409,reason)).toBeTruthy());
  it.each(['STOCK_FUNDING_HASH','STOCK_FUNDING_SIGNATURE','RPC_TIMEOUT','toString','__proto__',null,{}])('does not treat unknown or possibly submitted failures as safe to retry: %s',reason=>{
    expect(stockFundingRejectionReason(reason)).toBeUndefined();expect(stockFundingRejectionMessage('EXECUTION_UNAVAILABLE',409,reason)).toBeNull();
  });
  it('requires the expected structured response code and status',()=>{
    expect(stockFundingRejectionMessage('INTERNAL_ERROR',500,'STOCK_FUNDING_TREASURY_GAS')).toBeNull();
    expect(stockFundingRejectionMessage('EXECUTION_UNAVAILABLE',503,'STOCK_FUNDING_TREASURY_GAS')).toBeNull();
  });
});
