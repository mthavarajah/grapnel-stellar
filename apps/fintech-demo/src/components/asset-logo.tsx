import {HYPERLIQUID_LOGO_PATHS,HYPERLIQUID_EQUITY_SYMBOLS} from '../lib/hyperliquid-logos';
export type AssetLogoProps={symbol:string;name?:string;assetId?:string;providerSymbol?:string;size?:number};
/** Local presentation only. A logo never establishes asset identity or execution availability. */
export const ASSET_LOGO_PATHS:Readonly<Record<string,string>>={
  "AAPL": "/assets/logos/aapl.svg",
  "ADA": "/assets/logos/ada.svg",
  "AMC": "/assets/logos/amc.png",
  "AMD": "/assets/logos/amd.svg",
  "AMZN": "/assets/logos/amzn.png",
  "BABA": "/assets/logos/baba.svg",
  "BCH": "/assets/logos/bch.svg",
  "BNB": "/assets/logos/bnb.svg",
  "BTC": "/assets/logos/btc.svg",
  "BULL": "/assets/logos/bull.png",
  "COIN": "/assets/logos/coin.svg",
  "COST": "/assets/logos/cost.svg",
  "CRCL": "/assets/logos/crcl.png",
  "DJT": "/assets/logos/djt.png",
  "DOGE": "/assets/logos/doge.svg",
  "ETH": "/assets/logos/eth.svg",
  "EURC": "/assets/logos/eurc.png",
  "GLD": "/assets/logos/gld.png",
  "GME": "/assets/logos/gme.png",
  "GOOGL": "/assets/logos/googl.svg",
  "HIMS": "/assets/logos/hims.svg",
  "HYPE": "/assets/logos/hype.png",
  "IBM": "/assets/logos/ibm.png",
  "INTC": "/assets/logos/intc.svg",
  "JNJ": "/assets/logos/jnj.png",
  "LINK": "/assets/logos/link.svg",
  "LLY": "/assets/logos/lly.png",
  "LTC": "/assets/logos/ltc.svg",
  "LULU": "/assets/logos/lulu.png",
  "META": "/assets/logos/meta.svg",
  "MRNA": "/assets/logos/mrna.png",
  "MSFT": "/assets/logos/msft.png",
  "MSTR": "/assets/logos/mstr.png",
  "MU": "/assets/logos/mu.png",
  "NET": "/assets/logos/net.svg",
  "NFLX": "/assets/logos/nflx.svg",
  "NVDA": "/assets/logos/nvda.svg",
  "PLTR": "/assets/logos/pltr.svg",
  "PUMP": "/assets/logos/pump.png",
  "QQQ": "/assets/logos/qqq.png",
  "QUBT": "/assets/logos/qubt.png",
  "RBLX": "/assets/logos/rblx.svg",
  "RDDT": "/assets/logos/rddt.svg",
  "RIVN": "/assets/logos/rivn.png",
  "SGOV": "/assets/logos/sgov.png",
  "SKHY": "/assets/logos/skhy.png",
  "SLV": "/assets/logos/slv.png",
  "SNAP": "/assets/logos/snap.svg",
  "SNDK": "/assets/logos/sndk.png",
  "SOL": "/assets/logos/sol.svg",
  "SPCX": "/assets/logos/spcx.svg",
  "SPY": "/assets/logos/spy.png",
  "TRX": "/assets/logos/trx.svg",
  "TSM": "/assets/logos/tsm.svg",
  "TSLA": "/assets/logos/tsla.svg",
  "TTWO": "/assets/logos/ttwo.svg",
  "UNI": "/assets/logos/uni.svg",
  "UPS": "/assets/logos/ups.svg",
  "USDC": "/assets/usdc.svg",
  "USDG": "/assets/logos/usdg.png",
  "USDT": "/assets/logos/usdt.svg",
  "USO": "/assets/logos/uso.png",
  "WYFI": "/assets/logos/wyfi.png",
  "XLM": "/assets/xlm.svg",
  "XRP": "/assets/logos/xrp.svg",
  "XTAR": "/assets/logos/xtar.png",
  "ZEC": "/assets/logos/zec.svg"
};
export function assetLogoPath(symbol:string,assetId?:string,providerSymbol?:string):string{
 const fallback='/assets/logos/asset.svg',name=(providerSymbol??symbol).trim();
 const hyperliquid=typeof assetId==='string'&&/^hyperliquid-testnet:(?:perps|stocks):(?:0|[1-9]\d{0,8})$/.test(assetId);
 if(name.includes(':')){
  // Never strip arbitrary provider prefixes or treat a same-ticker token as equity.
  if(!hyperliquid||!HYPERLIQUID_LOGO_PATHS[name])return fallback;
  if(HYPERLIQUID_EQUITY_SYMBOLS.has(name)){const company=name.slice(4);return ASSET_LOGO_PATHS[company]??HYPERLIQUID_LOGO_PATHS[name]!;}
  return HYPERLIQUID_LOGO_PATHS[name]!;
 }
 if(hyperliquid)return HYPERLIQUID_LOGO_PATHS[name.toUpperCase()]??fallback;
 return ASSET_LOGO_PATHS[symbol.trim().toUpperCase().replace(/-PERP$/, '')]??fallback;
}
export function AssetLogo({symbol,name,assetId,providerSymbol,size=24}:AssetLogoProps){
 const pixels=Number.isFinite(size)&&size>0?Math.min(size,256):24;
 return <img src={assetLogoPath(symbol,assetId,providerSymbol)} alt={`${name?.trim()||symbol} logo`} width={pixels} height={pixels} data-asset-id={assetId} loading="lazy" decoding="async" style={{width:pixels,height:pixels,objectFit:'contain',flexShrink:0,verticalAlign:'middle',...(symbol.toUpperCase()==='LULU'?{background:'#202428',borderRadius:4,padding:2,boxSizing:'border-box' as const}:{})}}/>;
}
