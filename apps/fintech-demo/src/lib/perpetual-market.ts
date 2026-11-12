/** Presentation boundary: retired Stellar margin venues cannot create a new customer setup. */
export function isCurrentPerpetualMarket(value:unknown):boolean{
 if(!value||typeof value!=='object')return false;
 const market=value as Record<string,unknown>;
 return market.asset_class==='perps'&&market.provider==='hyperliquid'&&market.network==='hyperliquid-testnet'&&typeof market.market_id==='string'&&/^hyperliquid-testnet:perps:\d+$/.test(market.market_id);
}
