export type DerivativeClass='perps'|'stocks';
const marketPattern=/^hyperliquid-testnet:(perps|stocks):(?:0|[1-9]\d{0,8})$/;
export function derivativeClass(id:unknown):DerivativeClass|null{return typeof id==='string'?(/^gmx-testnet:perps:(?:ETH|BTC)$/.test(id)?'perps':/^robinhood-testnet:stocks:(?:TSLA|AMZN|PLTR|NFLX|AMD)$/.test(id)?'stocks':(marketPattern.exec(id)?.[1] as DerivativeClass|undefined)??null):null;}
/** A source-qualified equity perpetual is not a Stellar stock token. */
export function isCurrentDerivativeMarket(value:unknown,assetClass:DerivativeClass):boolean{
 if(!value||typeof value!=='object')return false;const market=value as Record<string,unknown>;
 if(assetClass==='stocks'&&typeof market.market_id==='string'&&market.market_id.startsWith('robinhood-testnet:stocks:'))return derivativeClass(market.market_id)==='stocks'&&market.asset_class==='stocks'&&market.module==='trade.stocks'&&market.provider==='robinhood'&&market.network==='robinhood-testnet'&&market.instrument_type==='stock_token'&&market.provider_symbol===market.market_id.split(':')[2]&&(market.underlying as Record<string,unknown>|undefined)?.symbol===market.provider_symbol;
 if(market.provider==='gmx')return assetClass==='perps'&&derivativeClass(market.market_id)==='perps'&&market.asset_class==='perps'&&market.module==='trade.perps'&&market.network==='arbitrum-sepolia'&&market.chain_id===421614&&market.instrument_type==='perpetual_futures'&&market.provider_symbol===(market.market_id as string).split(':')[2]&&(market.underlying as Record<string,unknown>|undefined)?.symbol===market.provider_symbol;
 return market.asset_class===assetClass&&(market.module===undefined||market.module==='trade.'+assetClass)&&derivativeClass(market.market_id)===assetClass&&market.provider==='hyperliquid'&&market.network==='hyperliquid-testnet'&&(assetClass!=='stocks'||market.instrument_type==='perpetual_futures');
}
export function isCurrentPerpetualMarket(value:unknown):boolean{return isCurrentDerivativeMarket(value,'perps');}
export function bindMarketDetail(value:unknown,id:string,assetClass:DerivativeClass):Record<string,unknown>{
 if(!isCurrentDerivativeMarket(value,assetClass)||(value as Record<string,unknown>).market_id!==id)throw Error('The returned market does not match your selection.');
 return value as Record<string,unknown>;
}
export function clearMarketLiveFields<T extends Record<string,unknown>>(market:T){return {...market,reference_price:null,reference_price_atomic:null,price_status:'unavailable',observed_at:null,stats:null,perpetuals_stats:null,risk:null};}

/** Display every source-qualified active listing, independently of artwork.
 * Catalog presence grants no signing or collateral compatibility permission. */
export function isRecognizedDerivativeMarket(value:unknown,assetClass:DerivativeClass):boolean{
 return isCurrentDerivativeMarket(value,assetClass);
}
