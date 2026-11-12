import {describe,it,expect,vi} from 'vitest';
vi.mock('viem',async original=>({...await original<typeof import('viem')>(),createPublicClient:()=>({getChainId:async()=>1})}));
import {readNetworkAssets,registerNetworkAssetsRoute} from './network-assets.js';
import Fastify from 'fastify';
const customer={businessId:'11111111-1111-4111-8111-111111111111',customerId:'22222222-2222-4222-8222-222222222222',walletId:'33333333-3333-4333-8333-333333333333',walletAddress:'G',privyUserId:'did:privy:fixture'};
describe('network assets ownership and unknown reads',()=>{
 it('keeps unfunded/uncreated wallet observations unknown and asset identities separate',async()=>{const result=await readNetworkAssets(customer,async()=>[]);expect(result.scope.customer_id).toBe(customer.customerId);expect(result.balances.map(b=>b.asset.code)).toEqual(['USDC','USDG','USDC.SG']);expect(result.balances.every(b=>b.wallet_amount===null&&b.reserved===null&&b.spendable===null)).toBe(true);expect(new Set(result.balances.map(b=>b.asset_id)).size).toBe(3);});
 it('does not fabricate zero after a network mismatch',async()=>{const result=await readNetworkAssets(customer,async()=>[{address:'0x'+'11'.repeat(20)}]);expect(result.balances.every(b=>b.wallet_amount===null&&!b.balance_verified)).toBe(true);});
 it('rejects malformed ownership responses',async()=>{await expect(readNetworkAssets(customer,async()=>[{address:'not-a-wallet'}])).rejects.toThrow();});
 it('checks entitlement then tenant-bound customer before reading any linked wallet',async()=>{const app=Fastify(),readWallets=vi.fn();await registerNetworkAssetsRoute(app,{requireBusiness:vi.fn().mockRejectedValue(Error('disabled')),requireCustomer:vi.fn(),readWallets,success:(_r,d)=>d});const result=await app.inject({url:`/v1/capital/wallets/${customer.walletId}/network-assets?customer_id=${customer.customerId}`});expect(result.statusCode).toBe(500);expect(readWallets).not.toHaveBeenCalled();await app.close();});
});
