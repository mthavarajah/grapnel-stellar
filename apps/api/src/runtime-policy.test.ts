import {describe,expect,it} from 'vitest';
import {financialRouteModule} from './runtime.js';

describe('provider write entitlement routing',()=>{
 it('requires Margin independently of the Spot entitlement',()=>{
  for(const path of ['/v1/trade/margin/workflows','/v1/trade/margin/workflows/id/steps/open_swap','/v1/trade/margin/workflows/id/reconcile?ignored=true'])
   expect(financialRouteModule(path)).toBe('trade.perps');
 });
 it('preserves separate spot, lending and funding permissions',()=>{
  expect(financialRouteModule('/v1/trade/quotes')).toBe('trade.spot');
  expect(financialRouteModule('/v1/capital/lending/borrowing/collateral/supply')).toBe('capital.lending');
  expect(financialRouteModule('/v1/capital/testnet/fund')).toBe('capital.testnet_funding');
  expect(financialRouteModule('/v1/capital/wallets')).toBeNull();
  expect(financialRouteModule('/health')).toBeNull();
 });
});
