import{describe,it,expect}from'vitest';
import{isCurrentPerpetualMarket}from'./perpetual-market';
const market={market_id:'hyperliquid-testnet:perps:0',asset_class:'perps',provider:'hyperliquid',network:'hyperliquid-testnet'};
describe('current perpetual market boundary',()=>{
 it('accepts the exact Testnet provider identity without promoting execution',()=>expect(isCurrentPerpetualMarket({...market,executable:false})).toBe(true));
 it.each([{provider:'peridot'},{network:'hyperliquid-mainnet'},{market_id:'stellar-testnet:peridot:XLM-USDT-MARGIN'},{market_id:'hyperliquid-testnet:perps:BTC'},{asset_class:'stocks'}])('excludes retired or mismatched venues %j',change=>expect(isCurrentPerpetualMarket({...market,...change})).toBe(false));
 it.each([null,undefined,'market',{},[]])('rejects malformed market metadata %j',value=>expect(isCurrentPerpetualMarket(value)).toBe(false));
});
it('accepts canonical builder asset indices through nine digits without leading zeros',()=>{
 for(const id of ['0','750009','999999999'])expect(isCurrentPerpetualMarket({...market,market_id:'hyperliquid-testnet:perps:'+id})).toBe(true);
 for(const id of ['00','01','-1','1000000000'])expect(isCurrentPerpetualMarket({...market,market_id:'hyperliquid-testnet:perps:'+id})).toBe(false);
});
