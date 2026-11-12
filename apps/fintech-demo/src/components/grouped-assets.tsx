"use client";
import {useMemo} from 'react';
import {AssetLogo} from './asset-logo';
import {buildGroupedAssets,groupedAmount,groupedUsd,groupedSourceLabel,type AssetBalanceRow,type AssetBalanceValuation} from '../lib/grouped-assets';
export type GroupedAssetsProps={balances:AssetBalanceRow[];valuation?:AssetBalanceValuation;connected:boolean;hideZeroBalances?:boolean};
/** One visible row per verified source identity; no expandable aggregate balance. */
export function GroupedAssets({balances,valuation,connected,hideZeroBalances=false}:GroupedAssetsProps){
 const rows=useMemo(()=>buildGroupedAssets(balances,valuation).flatMap(group=>group.children).filter(row=>!hideZeroBalances||row.wallet_amount!==null&&!/^0+(?:\.0+)?$/.test(row.wallet_amount)),[balances,valuation,hideZeroBalances]);
 if(!connected||!rows.length)return <div className="empty-state" role="status">{!connected?'Connect to see your assets.':balances.some(row=>row.wallet_amount==null)?'Balances are updating.':balances.length?'No assets with a balance.':'Waiting for a live balance read.'}</div>;
 return <div className="table-wrap"><table aria-label="Wallet assets"><thead><tr><th>Asset</th><th>Balance</th><th>Value (USD)</th><th>Reserved</th><th>Available</th></tr></thead><tbody>{rows.map(row=><tr key={row.asset_id}><td><span className="asset-mark" aria-hidden="true"><AssetLogo symbol={row.code==='USDC.SG'?'USDC':row.code} name={row.name} assetId={row.asset_id} size={26}/></span><div><strong>{row.label}</strong><small style={{display:'block'}}>{groupedSourceLabel(row)}</small></div></td><td>{groupedAmount(row.wallet_amount)}</td><td>{groupedUsd(row.value_usd)}</td><td>{groupedAmount(row.reserved)}</td><td><strong>{groupedAmount(row.spendable)}</strong></td></tr>)}</tbody></table></div>;
}
export default GroupedAssets;
