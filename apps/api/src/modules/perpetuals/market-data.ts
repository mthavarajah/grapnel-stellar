import type {HyperliquidTestnetMarket} from '../../adapters/hyperliquid/index.js';
const EQUITIES:Record<string,string>={TSLA:'Tesla',NVDA:'NVIDIA',HOOD:'Robinhood',INTC:'Intel',PLTR:'Palantir',COIN:'Coinbase',META:'Meta',AAPL:'Apple',MSFT:'Microsoft',ORCL:'Oracle',GOOGL:'Alphabet',AMZN:'Amazon',AMD:'AMD',MU:'Micron',SNDK:'Sandisk',MSTR:'Strategy',CRCL:'Circle',NFLX:'Netflix',COST:'Costco',LLY:'Eli Lilly',SKHX:'SK Hynix',TSM:'TSMC',RIVN:'Rivian',BABA:'Alibaba',SMSN:'Samsung',USAR:'USA Rare Earth',CRWV:'CoreWeave'};
const INDICES:Record<string,string>={XYZ100:'XYZ100 index',VIX:'VIX index'};
const OTHER_NAMES:Record<string,string>={GOLD:'Gold',SILVER:'Silver',CL:'Crude oil',COPPER:'Copper',NATGAS:'Natural gas',PLATINUM:'Platinum',JPY:'Japanese yen',EUR:'Euro'};
const underlying=(name:string)=>{const symbol=name.startsWith('xyz:')?name.slice(4):name;return {symbol,name:EQUITIES[symbol]??INDICES[symbol]??OTHER_NAMES[symbol]??symbol};};
type InputMarket=HyperliquidTestnetMarket|import('../../adapters/hyperliquid/catalog.js').HyperliquidCatalogMarket;
function category(row:InputMarket):'crypto'|'equity'|'index'|'commodity'|'fx'|'other'{
 const source='sourceCategory' in row?row.sourceCategory?.toLowerCase():null;
 if(source&&['stocks','stock','equity','equities'].includes(source))return 'equity';
 if(source&&['indices','index'].includes(source))return 'index';
 if(source&&['commodities','commodity'].includes(source))return 'commodity';
 if(source&&['fx','forex'].includes(source))return 'fx';
 if(source==='crypto')return 'crypto';
 if(!row.name.includes(':'))return 'crypto';
 if(row.name.startsWith('xyz:')){const symbol=row.name.slice(4);return EQUITIES[symbol]?'equity':INDICES[symbol]?'index':['JPY','EUR'].includes(symbol)?'fx':OTHER_NAMES[symbol]?'commodity':'other';}
 return 'other';
}
/** Source catalog rows never establish a customer position, balance or permission. */
export function perpetualMarketRows(markets:InputMarket[],receivedAt:string){
 return markets.filter(row=>!row.isDelisted).map(row=>{
  const collateral='collateral' in row?row.collateral:null,compatibility='collateralCompatibility' in row?row.collateralCompatibility:'usdc';
  const unit=collateral?.name??(compatibility==='usdc'?'USDC':'Source units');
  const dex='dex' in row?row.dex??'':'';
  return {
   market_id:`hyperliquid-testnet:perps:${row.assetIndex}`,label:`${row.name} / ${unit}`,asset_class:'perps' as const,module:'trade.perps' as const,
   provider:'hyperliquid' as const,network:'hyperliquid-testnet' as const,instrument_type:'perpetual_futures' as const,
   provider_symbol:row.name,provider_dex:dex,asset_category:category(row),source_category:'sourceCategory' in row?row.sourceCategory:null,
   underlying:{...underlying(row.name),name:('displayName' in row?row.displayName:null)??underlying(row.name).name,display_decimals:row.szDecimals},
   reference_price:row.markPrice,reference_price_atomic:null,price_status:row.markPrice===null?'unavailable' as const:'current' as const,
   price_availability:row.markPrice===null?'metadata_only':'source_context',quote_symbol:unit,
   oracle_timestamp:row.markPrice===null?null:receivedAt,observed_at:receivedAt,price_timestamp_basis:'provider_response_received_at',
   min_leverage:1,max_leverage:row.maxLeverage,only_isolated:row.onlyIsolated,
   settlement_asset:{code:unit,decimals:collateral?.weiDecimals??null,transfer_decimals:compatibility==='usdc'?6:null,network:'hyperliquid-testnet',token_id:collateral?.tokenId??null,compatibility},
   perpetuals_stats:{mark_price:row.markPrice,oracle_price:row.oraclePrice,mid_price:row.midPrice,previous_day_price:row.previousDayPrice,
    funding_rate:row.fundingRate,open_interest:row.openInterest,day_notional_volume:row.dayNotionalVolume,day_base_volume:row.dayBaseVolume,premium:row.premium},
   execution_status:'discovery_only' as const,executable:false,reason:compatibility==='usdc'?'HYPERLIQUID_FUNDING_AND_EXECUTION_PROOF_REQUIRED':'UNSUPPORTED_PERPETUAL_COLLATERAL',
   reason_message:compatibility==='usdc'?'Trading setup is being verified.':'This market uses a different collateral asset.',
   source_url:'https://api.hyperliquid-testnet.xyz/info',history_available:true,
  };
 });
}
export function stockPerpetualRows(rows:ReturnType<typeof perpetualMarketRows>){
 return rows.filter(row=>row.asset_category==='equity'||row.asset_category==='index').map(row=>({...row,market_id:row.market_id.replace(':perps:',':stocks:'),asset_class:'stocks' as const,module:'trade.stocks' as const}));
}

import {GrapnelError} from '@grapnel/contracts';
import type {HyperliquidTestnetReader,HyperliquidCandleInterval} from '../../adapters/hyperliquid/index.js';
import {priceChange,type HistoryRange} from '../market-data/service.js';
const windows:Record<HistoryRange,{interval:HyperliquidCandleInterval;duration:number}>={
 live:{interval:'1m',duration:3_600_000},'1d':{interval:'15m',duration:86_400_000},'1w':{interval:'1h',duration:604_800_000},
 '1m':{interval:'4h',duration:2_592_000_000},'1y':{interval:'1d',duration:31_536_000_000},all:{interval:'1d',duration:315_360_000_000},
};
export async function perpetualHistory(reader:HyperliquidTestnetReader,readMarkets:()=>Promise<ReturnType<typeof perpetualMarketRows>>,id:string,range:HistoryRange,now=Date.now()){
 const market=(await readMarkets()).find(row=>row.market_id===id.replace(':stocks:',':perps:'));
 if(id.includes(':stocks:')&&market&&!['equity','index'].includes(market.asset_category))throw new GrapnelError(404,'NOT_FOUND','Stock perpetual market not found');
 if(!market)throw new GrapnelError(404,'NOT_FOUND','Perpetual market not found');
 const window=windows[range];if(!window)throw new GrapnelError(422,'VALIDATION_ERROR','Unknown chart period');
 const start=Math.max(1,now-window.duration),snapshot=await reader.readCandles(market.provider_symbol,window.interval,start,now);
 const points=snapshot.candles.map(candle=>({timestamp:new Date(candle.openTime).toISOString(),price:candle.close}));
 const change=points.length>1&&!/^0(?:\.0+)?$/.test(points[0]!.price)&&!/^0(?:\.0+)?$/.test(points.at(-1)!.price)?priceChange(points[0]!.price,points.at(-1)!.price):{change_absolute:null,change_percent:null};
 return {market_id:id,base_asset_id:`hyperliquid-testnet:underlying:${market.underlying.symbol}`,base_symbol:market.underlying.symbol,quote_symbol:market.quote_symbol,
  latest_price:market.reference_price??points.at(-1)?.price??null,as_of:snapshot.source.receivedAt,points,...change,interval:window.interval,price_basis:'source_candle_close_at_bar_open_time',
  source_url:snapshot.source.infoUrl,history_limit:snapshot.source.historicalLimit,requested_range:range,
 };
}
