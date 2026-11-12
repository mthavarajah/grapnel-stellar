import type {HyperliquidTestnetMarket} from '../../adapters/hyperliquid/index.js';
/** Discovery metadata only. The source never establishes a customer position or balance. */
export function perpetualMarketRows(markets:HyperliquidTestnetMarket[],receivedAt:string){
 return markets.filter(row=>!row.isDelisted).map(row=>({
  market_id:`hyperliquid-testnet:perps:${row.assetIndex}`,label:`${row.name} / USDC`,asset_class:'perps' as const,module:'trade.perps' as const,
  provider:'hyperliquid' as const,network:'hyperliquid-testnet' as const,instrument_type:'perpetual_futures' as const,
  underlying:{symbol:row.name,name:row.name,display_decimals:row.szDecimals},reference_price:row.markPrice,reference_price_atomic:null,
  price_status:'current' as const,oracle_timestamp:receivedAt,observed_at:receivedAt,price_timestamp_basis:'provider_response_received_at',
  min_leverage:1,max_leverage:row.maxLeverage,only_isolated:row.onlyIsolated,
  settlement_asset:{code:'USDC',decimals:6,network:'hyperliquid-testnet'},
  perpetuals_stats:{mark_price:row.markPrice,oracle_price:row.oraclePrice,mid_price:row.midPrice,previous_day_price:row.previousDayPrice,
   funding_rate:row.fundingRate,open_interest:row.openInterest,day_notional_volume:row.dayNotionalVolume,day_base_volume:row.dayBaseVolume,premium:row.premium},
  execution_status:'discovery_only' as const,executable:false,reason:'HYPERLIQUID_FUNDING_AND_EXECUTION_PROOF_REQUIRED',
  reason_message:'Trading setup is being verified. No funds have been moved for this market.',source_url:'https://api.hyperliquid-testnet.xyz/info',history_available:true,
 }));
}

import {GrapnelError} from '@grapnel/contracts';
import type {HyperliquidTestnetReader,HyperliquidCandleInterval} from '../../adapters/hyperliquid/index.js';
import {priceChange,type HistoryRange} from '../market-data/service.js';
const windows:Record<HistoryRange,{interval:HyperliquidCandleInterval;duration:number}>={
 live:{interval:'1m',duration:3_600_000},'1d':{interval:'15m',duration:86_400_000},'1w':{interval:'1h',duration:604_800_000},
 '1m':{interval:'4h',duration:2_592_000_000},'1y':{interval:'1d',duration:31_536_000_000},all:{interval:'1d',duration:315_360_000_000},
};
export async function perpetualHistory(reader:HyperliquidTestnetReader,readMarkets:()=>Promise<ReturnType<typeof perpetualMarketRows>>,id:string,range:HistoryRange,now=Date.now()){
 const market=(await readMarkets()).find(row=>row.market_id===id);
 if(!market)throw new GrapnelError(404,'NOT_FOUND','Perpetual market not found');
 const window=windows[range];if(!window)throw new GrapnelError(422,'VALIDATION_ERROR','Unknown chart period');
 const start=Math.max(1,now-window.duration),snapshot=await reader.readCandles(market.underlying.symbol,window.interval,start,now);
 const points=snapshot.candles.map(candle=>({timestamp:new Date(candle.openTime).toISOString(),price:candle.close}));
 const change=points.length>1?priceChange(points[0]!.price,points.at(-1)!.price):{change_absolute:null,change_percent:null};
 return {market_id:id,base_asset_id:`hyperliquid-testnet:underlying:${market.underlying.symbol}`,base_symbol:market.underlying.symbol,quote_symbol:'USDC',
  latest_price:market.reference_price,as_of:snapshot.source.receivedAt,points,...change,interval:window.interval,price_basis:'source_candle_close_at_bar_open_time',
  source_url:snapshot.source.infoUrl,history_limit:snapshot.source.historicalLimit,requested_range:range,
 };
}
