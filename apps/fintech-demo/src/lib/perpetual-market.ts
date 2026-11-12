import {HYPERLIQUID_LOGO_PATHS} from './hyperliquid-logos';
export type DerivativeClass='perps'|'stocks';
const marketPattern=/^hyperliquid-testnet:(perps|stocks):(?:0|[1-9]\d{0,8})$/;
export function derivativeClass(id:unknown):DerivativeClass|null{return typeof id==='string'?(/^robinhood-testnet:stocks:(?:TSLA|AMZN|PLTR|NFLX|AMD)$/.test(id)?'stocks':(marketPattern.exec(id)?.[1] as DerivativeClass|undefined)??null):null;}
/** A source-qualified equity perpetual is not a Stellar stock token. */
export function isCurrentDerivativeMarket(value:unknown,assetClass:DerivativeClass):boolean{
 if(!value||typeof value!=='object')return false;const market=value as Record<string,unknown>;
 if(assetClass==='stocks'&&typeof market.market_id==='string'&&market.market_id.startsWith('robinhood-testnet:stocks:'))return derivativeClass(market.market_id)==='stocks'&&market.asset_class==='stocks'&&market.module==='trade.stocks'&&market.provider==='robinhood'&&market.network==='robinhood-testnet'&&market.instrument_type==='stock_token'&&market.provider_symbol===market.market_id.split(':')[2]&&(market.underlying as Record<string,unknown>|undefined)?.symbol===market.provider_symbol;
 return market.asset_class===assetClass&&(market.module===undefined||market.module==='trade.'+assetClass)&&derivativeClass(market.market_id)===assetClass&&market.provider==='hyperliquid'&&market.network==='hyperliquid-testnet'&&(assetClass!=='stocks'||market.instrument_type==='perpetual_futures');
}
export function isCurrentPerpetualMarket(value:unknown):boolean{return isCurrentDerivativeMarket(value,'perps');}
export function bindMarketDetail(value:unknown,id:string,assetClass:DerivativeClass):Record<string,unknown>{
 if(!isCurrentDerivativeMarket(value,assetClass)||(value as Record<string,unknown>).market_id!==id)throw Error('The returned market does not match your selection.');
 return value as Record<string,unknown>;
}
export function clearMarketLiveFields<T extends Record<string,unknown>>(market:T){return {...market,reference_price:null,reference_price_atomic:null,price_status:'unavailable',observed_at:null,stats:null,perpetuals_stats:null,risk:null};}

/** Customer catalog excludes unreviewed builder listings without exact artwork. */
export function isRecognizedDerivativeMarket(value:unknown,assetClass:DerivativeClass):boolean{
 if(!isCurrentDerivativeMarket(value,assetClass))return false;
 const row=value as Record<string,unknown>;if(row.provider==='robinhood')return true;const underlying=row.underlying as Record<string,unknown>|undefined;
 const symbol=typeof row.provider_symbol==='string'?row.provider_symbol:underlying?.symbol;
 return typeof symbol==='string'&&Object.hasOwn(HYPERLIQUID_LOGO_PATHS,symbol);
}
