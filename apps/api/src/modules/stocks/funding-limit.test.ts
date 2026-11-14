import {describe,expect,it} from 'vitest';
import {stockFundingMaxWallets} from './funding-limit.js';

describe('finite Stocks funding budget',()=>{
  it('defaults to 100 wallets',()=>expect(stockFundingMaxWallets()).toBe(100n));
  it.each(['1','100','10000',250])('accepts an explicit bounded limit %s',value=>expect(stockFundingMaxWallets(value)).toBe(BigInt(value)));
  it.each(['','0','-1','1.5','1e3','unlimited','10001',NaN,Infinity])('fails closed on invalid budget %s',value=>expect(()=>stockFundingMaxWallets(value)).toThrow('ROBINHOOD_TESTNET_FUNDING_MAX_WALLETS'));
});
