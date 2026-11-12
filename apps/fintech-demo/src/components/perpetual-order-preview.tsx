import {formatTokenAmount} from '@grapnel/contracts';
/** No customer trading account is bound yet; never reuse a Stellar wallet's USDC balance. */
export function PerpetualOrderPreview({symbol,price}:{symbol:string;price:string|null|undefined}){
 return <section className="market-order-card" aria-label="Trade market" data-testid="market-order-card">
  <h2>Trade {symbol}</h2>
  <div className="public-order-direction" role="group" aria-label="Position direction"><button type="button" disabled>Long</button><button type="button" disabled>Short</button></div>
  <p className="small muted">Available trading balance: — USDC</p>
  <label>Order size (USDC)<input aria-label="Order amount" placeholder="0.00" inputMode="decimal" disabled/></label>
  <div className="detail-row"><span>Market price</span><strong>{price==null?'—':`${formatTokenAmount(price)} USDC`}</strong></div>
  <div className="detail-row"><span>Settlement</span><strong>USDC</strong></div>
  <p className="small muted" role="status">Trading is not available yet.</p>
  <button className="button wide" aria-label={`Review ${symbol} perpetual order`} disabled>Review</button>
 </section>;
}

export function PerpetualMarketMetrics({stats,symbol,maxLeverage}:{stats?:Record<string,string|null>;symbol:string;maxLeverage?:number}){
 const shown=(value:string|null|undefined)=>value==null?'—':formatTokenAmount(value);
 return <dl className="public-market-stats" data-testid="perps-market-metrics">
  {typeof maxLeverage==='number'&&Number.isSafeInteger(maxLeverage)&&maxLeverage>0&&<div><dt>Maximum leverage</dt><dd>{maxLeverage}×</dd></div>}
  <div><dt>Settlement</dt><dd>USDC</dd></div>
  <div><dt>Mark price</dt><dd>{shown(stats?.mark_price)} USDC</dd></div>
  <div><dt>Oracle price</dt><dd>{shown(stats?.oracle_price)} USDC</dd></div>
  <div><dt>24h volume</dt><dd>{shown(stats?.day_notional_volume)} USDC</dd></div>
  <div><dt>Open interest</dt><dd>{shown(stats?.open_interest)} {symbol}</dd></div>
  <div><dt>Funding rate (fraction)</dt><dd>{stats?.funding_rate??'—'}</dd></div>
 </dl>;
}
