export type DerivativeClass='perps'|'stocks';
const marketPattern=/^hyperliquid-testnet:(perps|stocks):(?:0|[1-9]\d{0,8})$/;
export function derivativeClass(id:unknown):DerivativeClass|null{return typeof id==='string'?(marketPattern.exec(id)?.[1] as DerivativeClass|undefined)??null:null;}
/** A source-qualified equity perpetual is not a Stellar stock token. */
export function isCurrentDerivativeMarket(value:unknown,assetClass:DerivativeClass):boolean{
 if(!value||typeof value!=='object')return false;const market=value as Record<string,unknown>;
 return market.asset_class===assetClass&&derivativeClass(market.market_id)===assetClass&&market.provider==='hyperliquid'&&market.network==='hyperliquid-testnet'&&(assetClass!=='stocks'||market.instrument_type==='perpetual_futures');
}
export function isCurrentPerpetualMarket(value:unknown):boolean{return isCurrentDerivativeMarket(value,'perps');}
export function bindMarketDetail(value:unknown,id:string,assetClass:DerivativeClass):Record<string,unknown>{
 if(!isCurrentDerivativeMarket(value,assetClass)||(value as Record<string,unknown>).market_id!==id)throw Error('The returned market does not match your selection.');
 return value as Record<string,unknown>;
}
export function clearMarketLiveFields<T extends Record<string,unknown>>(market:T){return {...market,reference_price:null,reference_price_atomic:null,price_status:'unavailable',observed_at:null,stats:null,perpetuals_stats:null,risk:null};}
