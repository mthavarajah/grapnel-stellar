import {formatTokenAmount} from '@grapnel/contracts';
import {ProgressIndicator} from './operation-progress';
export type SettlementIdentity={code?:string|null;decimals?:number|null;network?:string;token_id?:string|null;compatibility?:'usdc'|'other'|'unresolved'};
const assetCode=(settlement?:SettlementIdentity|null)=>settlement?.code?.trim()||'Unresolved';
/** No customer trading balance is bound yet. Never reuse Stellar or same-symbol balances. */
export function PerpetualOrderPreview({symbol,price,quoteSymbol,settlementAsset,stock=false,error,loading=false}:{symbol:string;price:string|null|undefined;quoteSymbol?:string|null;settlementAsset?:SettlementIdentity|null;stock?:boolean;error?:string;loading?:boolean}){
 const code=assetCode(settlementAsset),unit=quoteSymbol?.trim()||'—';
 const reason=settlementAsset?.compatibility==='other'?`Funding this market with ${code} is not supported.`:settlementAsset?.compatibility!=='usdc'?'This market’s settlement asset has not been verified. Trading is unavailable.':'Trading is not available yet.';
 return <section className="market-order-card" aria-label="Trade market" data-testid="market-order-card">
  <h2>Trade {symbol}</h2>{stock&&<p className="small muted">Stock perpetual</p>}
  <div className="public-order-direction" role="group" aria-label="Position direction"><button type="button" disabled>Long</button><button type="button" disabled>Short</button></div>
  <p className="small muted">Available trading balance: — {code}</p>
  <label>Order size ({unit})<input aria-label="Order amount" placeholder="0.00" inputMode="decimal" disabled/></label>
  <div className="detail-row"><span>Market price</span><strong>{price==null?'—':`${formatTokenAmount(price)} ${unit}`}</strong></div>
  <div className="detail-row"><span>Settlement</span><strong>{code}</strong></div>
  {error?<p className="swap-action-error" role="alert">{error}</p>:loading?<p className="small muted"><ProgressIndicator label="Loading market" spinning/></p>:<p className="small muted" role="status">{reason}</p>}
  <button className="button wide" aria-label={`Review ${symbol} ${stock?'stock perpetual':'perpetual'} order`} disabled>Review</button>
 </section>;
}
export function PerpetualMarketMetrics({stats,symbol,maxLeverage,quoteSymbol,settlementAsset}:{stats?:Record<string,string|null>|null;symbol:string;maxLeverage?:number;quoteSymbol?:string|null;settlementAsset?:SettlementIdentity|null}){
 const shown=(value:string|null|undefined)=>value==null?'—':formatTokenAmount(value),unit=quoteSymbol?.trim()||'—';
 return <dl className="public-market-stats" data-testid="perps-market-metrics">
  {typeof maxLeverage==='number'&&Number.isSafeInteger(maxLeverage)&&maxLeverage>0&&<div><dt>Maximum leverage</dt><dd>{maxLeverage}×</dd></div>}
  <div><dt>Settlement</dt><dd>{assetCode(settlementAsset)}</dd></div>
  <div><dt>Mark price</dt><dd>{shown(stats?.mark_price)} {unit}</dd></div>
  <div><dt>Oracle price</dt><dd>{shown(stats?.oracle_price)} {unit}</dd></div>
  <div><dt>24h volume</dt><dd>{shown(stats?.day_notional_volume)} {unit}</dd></div>
  <div><dt>Open interest</dt><dd>{shown(stats?.open_interest)} {symbol}</dd></div>
  <div><dt>Funding rate (fraction)</dt><dd>{stats?.funding_rate??'—'}</dd></div>
 </dl>;
}
