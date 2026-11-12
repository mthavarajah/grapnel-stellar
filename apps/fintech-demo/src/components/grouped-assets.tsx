"use client";
import {Fragment,useId,useMemo,useState} from 'react';
import {AssetLogo} from './asset-logo';
import {buildGroupedAssets,groupedAmount,groupedUsd,groupedSourceLabel,type AssetBalanceRow,type AssetBalanceValuation,type GroupedAsset} from '../lib/grouped-assets';
export type GroupedAssetsProps={balances:AssetBalanceRow[];valuation?:AssetBalanceValuation;connected:boolean};
/** Controlled view makes the expandable source breakdown independently testable. */
export function GroupedAssetRows({group,expanded,onToggle,detailsId}:{group:GroupedAsset;expanded:boolean;onToggle:()=>void;detailsId:string}){
 const source=group.children[0]!,logo=<span className="asset-mark" aria-hidden="true"><AssetLogo symbol={group.code==='USDC.SG'?'USDC':group.code} name={group.name} assetId={group.expandable?undefined:source.asset_id} size={26}/></span>;
 return <Fragment><tbody><tr><td>{group.expandable?<button type="button" className="text-button" aria-expanded={expanded} aria-controls={detailsId} aria-label={`${expanded?'Collapse':'Expand'} USDC balances`} onClick={onToggle} style={{display:'inline-flex',alignItems:'center',gap:11,color:'inherit',textAlign:'left',padding:0}}>{logo}<strong>USDC</strong><span aria-hidden="true">{expanded?'▾':'▸'}</span></button>:<>{logo}<div><strong>{group.label}</strong>{group.name&&group.name!==group.label&&<small>{group.name}</small>}<small style={{display:'block'}}>{groupedSourceLabel(source)}</small></div></>}</td><td>{groupedAmount(group.wallet_amount)}{group.unknown_wallet_count>0&&group.known_wallet_amount!==null&&<small style={{display:'block'}} className="muted">Known subtotal: {groupedAmount(group.known_wallet_amount)} {group.code}</small>}</td><td>{groupedUsd(group.value_usd)}</td><td>{groupedAmount(group.reserved)}</td><td><strong>{groupedAmount(group.spendable)}</strong></td></tr></tbody>{group.expandable&&<tbody id={detailsId} hidden={!expanded} aria-label="USDC balance breakdown">{group.children.map(row=><tr key={row.asset_id} style={{background:'var(--bg)'}}><td style={{paddingLeft:30}}><span aria-hidden="true">↳</span><span>{groupedSourceLabel(row)}</span></td><td>{groupedAmount(row.wallet_amount)}</td><td>{groupedUsd(row.value_usd)}</td><td>{groupedAmount(row.reserved)}</td><td><strong>{groupedAmount(row.spendable)}</strong></td></tr>)}</tbody>}</Fragment>;
}
/** Display source balances together without treating protocol token identities as interchangeable. */
export function GroupedAssets({balances,valuation,connected}:GroupedAssetsProps){
 const rows=useMemo(()=>buildGroupedAssets(balances,valuation),[balances,valuation]),[expanded,setExpanded]=useState(false),detailsId=useId()+'-usdc-balances';
 if(!connected||!rows.length)return <div className="empty-state" role="status">{connected?'Waiting for a live balance read.':'Connect to see your assets.'}</div>;
 return <div className="table-wrap"><table aria-label="Wallet assets"><thead><tr><th>Asset</th><th>Balance</th><th>Value (USD)</th><th>Reserved</th><th>Available</th></tr></thead>{rows.map(group=><GroupedAssetRows key={group.key} group={group} expanded={expanded} onToggle={()=>setExpanded(value=>!value)} detailsId={detailsId}/>)}</table></div>;
}
export default GroupedAssets;
