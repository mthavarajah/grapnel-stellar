import {describe,it,expect} from 'vitest';import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {GroupedAssets} from './grouped-assets';import type{AssetBalanceRow}from'../lib/grouped-assets';
const row=(id:string,amount:string|null,network:string):AssetBalanceRow=>({asset_id:id,asset:{id,code:'USDC',verified:true,decimals:7,network},wallet_amount:amount,reserved:'0',spendable:amount,network_label:network,feature_label:'Wallet'}),balances=[row('stellar-usdc','10','Stellar'),row('hyperevm-usdc','2','HyperEVM')];
describe('flat asset balance table',()=>{
 it('shows each source balance directly without a dropdown or aggregate total',()=>{const html=renderToStaticMarkup(createElement(GroupedAssets,{balances,connected:true}));expect(html).toContain('Stellar · Wallet');expect(html).toContain('HyperEVM · Wallet');expect(html).toContain('>10<');expect(html).toContain('>2<');expect(html).not.toContain('aria-expanded');expect(html).not.toContain(' hidden=');expect(html).not.toContain('>12<');});
 it('hides exact zero balances on the main page while preserving unknown and positive balances',()=>{const html=renderToStaticMarkup(createElement(GroupedAssets,{balances:[...balances,row('zero-native','0','Zero network'),row('zero-decimal','0.0000000','Other zero network'),row('unknown',null,'Updating network')],connected:true,hideZeroBalances:true}));expect(html).not.toContain('Zero network');expect(html).not.toContain('Other zero network');expect(html).toContain('Updating network');expect(html).toContain('—');expect(html).toContain('>10<');});
 it('does not expose old balances after disconnect or invent a zero when no read exists',()=>{expect(renderToStaticMarkup(createElement(GroupedAssets,{balances,connected:false}))).not.toContain('<table');expect(renderToStaticMarkup(createElement(GroupedAssets,{balances:[],connected:true}))).toContain('Waiting for a live balance read.');expect(renderToStaticMarkup(createElement(GroupedAssets,{balances:[row('zero','0','Stellar')],connected:true,hideZeroBalances:true}))).toContain('No assets with a balance.');});
});

it('shows confirmed purchased stock holdings alongside USDG and hides sold-out stocks',()=>{
 const stock=(code:string,amount:string)=>({asset_id:'robinhood-testnet:erc20:'+code,asset:{id:'robinhood-testnet:erc20:'+code,code,verified:true,decimals:18,network:'robinhood-testnet'},wallet_amount:amount,reserved:null,spendable:null});
 const html=renderToStaticMarkup(createElement(GroupedAssets,{balances:[stock('TSLA','0.125'),stock('AMD','0')],connected:true,hideZeroBalances:true}));
 expect(html).toContain('TSLA');expect(html).toContain('>0.125<');expect(html).not.toContain('>AMD<');
});
