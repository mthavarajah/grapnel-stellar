import{describe,it,expect}from'vitest';
import{isCurrentPerpetualMarket,isCurrentDerivativeMarket,bindMarketDetail,clearMarketLiveFields,derivativeClass}from'./perpetual-market';
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

describe('selected source detail binding',()=>{
 const equity={...market,market_id:'hyperliquid-testnet:stocks:750009',asset_class:'stocks',instrument_type:'perpetual_futures'};
 it('maps Stocks aliases to stock perpetuals without treating them as Stellar tokens',()=>{expect(derivativeClass(equity.market_id)).toBe('stocks');expect(isCurrentDerivativeMarket(equity,'stocks')).toBe(true);expect(isCurrentDerivativeMarket({...equity,instrument_type:'tokenized_stock'},'stocks')).toBe(false);});
 it('rejects different IDs, modules, venues and networks before a detail is merged',()=>{expect(bindMarketDetail(equity,equity.market_id,'stocks')).toEqual(equity);for(const row of [{...equity,market_id:'hyperliquid-testnet:stocks:750010'},{...equity,asset_class:'perps'},{...equity,provider:'sodax'},{...equity,network:'hyperliquid-mainnet'}])expect(()=>bindMarketDetail(row,equity.market_id,'stocks')).toThrow('does not match');});
 it('clears all volatile price, activity and risk values on a failed selected read',()=>{const cleared=clearMarketLiveFields({...equity,reference_price:'200',reference_price_atomic:'200000000',price_status:'current',observed_at:'now',perpetuals_stats:{mark_price:'200'},stats:{volume:'20'},risk:{enabled:true}});expect(cleared).toMatchObject({market_id:equity.market_id,reference_price:null,reference_price_atomic:null,price_status:'unavailable',observed_at:null,stats:null,perpetuals_stats:null,risk:null});});
});
