import { describe,it,expect,vi } from 'vitest';
import { Keypair, TransactionBuilder, Transaction, Networks } from '@stellar/stellar-sdk';
import { NETWORK_PASSPHRASE, XLM, type CustomerContext } from '@grapnel/contracts';
import { TestnetFundingAdapter } from './index.js';
import { FundingService } from '../../modules/funding/service.js';

// Local keypairs are cryptographic test fixtures only. No network requests or chain-proof claims.
const treasury=Keypair.random();const wallet=Keypair.random();
const customer:CustomerContext={businessId:'10000000-0000-4000-8000-000000000001',customerId:'10000000-0000-4000-8000-000000000002',walletId:'10000000-0000-4000-8000-000000000003',walletAddress:wallet.publicKey(),privyUserId:'did:privy:test'};
const base={network:'testnet',networkPassphrase:NETWORK_PASSPHRASE,treasurySecret:treasury.secret(),gate1Passed:true,enabled:true};
function horizon(options:{network?:string;balance?:string;sponsored?:number}={}) {
  return vi.fn<typeof fetch>(async input=>{
    const url=String(input);
    if(url.endsWith('stellar.org'))return Response.json({network_passphrase:options.network??NETWORK_PASSPHRASE});
    if(url.includes('/ledgers?'))return Response.json({_embedded:{records:[{sequence:123,base_reserve_in_stroops:5000000}]}});
    if(url.includes('/accounts/'))return Response.json({account_id:url.split('/').at(-1),sequence:'10',subentry_count:2,num_sponsoring:1,num_sponsored:options.sponsored??0,balances:[{asset_type:'native',balance:options.balance??'100.0000000',selling_liabilities:'5.0000000'}]});
    throw new Error('Unexpected fixture request');
  });
}
describe('Testnet treasury policy',()=>{
  it('rejects mainnet configuration before contacting a provider',()=>{
    expect(()=>new TestnetFundingAdapter({...base,network:'public'})).toThrow('Only Stellar Testnet');
    expect(()=>new TestnetFundingAdapter({...base,networkPassphrase:Networks.PUBLIC})).toThrow('Only Stellar Testnet');
  });
  it('does not invent an inventory when treasury credentials are absent',async()=>{
    const provider=horizon();const adapter=new TestnetFundingAdapter({...base,treasurySecret:undefined,gate1Passed:false},provider);
    const [asset]=await adapter.discoverAssets();
    expect(asset?.treasury_available).toBeNull();expect(asset?.available).toBe(false);expect(asset?.execution_status).toBe('blocked');expect(provider).not.toHaveBeenCalled();
  });
  it('gates treasury preparation on chain signing proof and kill switch',async()=>{
    for(const config of [{...base,gate1Passed:false},{...base,enabled:false}]){
      const provider=horizon();const adapter=new TestnetFundingAdapter(config,provider);
      await expect(adapter.prepareFund({assetId:XLM.id,amount:'1',customer,reservedTreasuryAtomic:0n})).rejects.toMatchObject({code:'EXECUTION_UNAVAILABLE'});
      expect(provider).not.toHaveBeenCalled();
    }
  });
  it('deducts sponsorship, subentries and selling liabilities with exact integers',async()=>{
    const adapter=new TestnetFundingAdapter(base,horizon({sponsored:1}));
    const snapshot=await adapter.accountSnapshot(wallet.publicKey());
    expect(snapshot.reserveAtomic).toBe(20000000n);expect(snapshot.spendableAtomic).toBe(930000000n);
  });
  it('checks the actual Horizon network and refuses a mismatched server',async()=>{
    const adapter=new TestnetFundingAdapter(base,horizon({network:Networks.PUBLIC}));
    await expect(adapter.accountSnapshot(wallet.publicKey())).rejects.toMatchObject({code:'NETWORK_MISMATCH'});
  });
  it('rejects symbol-only assets, precision overflow and return of reserved funds',async()=>{
    const adapter=new TestnetFundingAdapter(base,horizon());
    expect(()=>adapter.assertAsset('USDC')).toThrow('not allowlisted');expect(()=>adapter.parseAmount('1.00000001')).toThrow('seven decimals');
    await expect(adapter.prepareReturn({operationId:'operation',assetId:XLM.id,amount:'93',customer,reservedCustomerAtomic:0n})).rejects.toMatchObject({code:'INSUFFICIENT_BALANCE'});
    await expect(adapter.prepareReturn({operationId:'operation',assetId:XLM.id,amount:'10',customer,reservedCustomerAtomic:850000000n})).rejects.toMatchObject({code:'INSUFFICIENT_BALANCE'});
  });
  it('prepares a fixed-treasury customer debit and never signs it',async()=>{
    const adapter=new TestnetFundingAdapter(base,horizon());
    const action=await adapter.prepareReturn({operationId:'operation',assetId:XLM.id,amount:'2.1234567',customer,reservedCustomerAtomic:0n});
    const tx=TransactionBuilder.fromXDR(action.unsignedXdr,NETWORK_PASSPHRASE) as Transaction;
    expect(tx.source).toBe(wallet.publicKey());expect(tx.signatures).toHaveLength(0);expect(tx.operations).toHaveLength(1);
    expect(tx.operations[0]).toMatchObject({type:'payment',destination:treasury.publicKey(),amount:'2.1234567'});
    expect(action.summary.recipient).toBe(treasury.publicKey());expect(action.signingHashHex).toBe(tx.hash().toString('hex'));
  });
  it('prepares only treasury-owned outgoing funds with a deterministic signed hash and no broadcast',async()=>{
    const provider=horizon();const adapter=new TestnetFundingAdapter(base,provider);
    const transfer=await adapter.prepareFund({assetId:XLM.id,amount:'1.0000001',customer,reservedTreasuryAtomic:0n});
    const tx=TransactionBuilder.fromXDR(transfer.signedXdr,NETWORK_PASSPHRASE) as Transaction;
    expect(tx.source).toBe(treasury.publicKey());expect(tx.signatures).toHaveLength(1);
    expect(treasury.verify(tx.hash(),tx.signatures[0]!.signature())).toBe(true);
    expect(transfer.txHash).toBe(tx.hash().toString('hex'));expect(transfer.amountAtomic).toBe(10000001n);
    expect(provider.mock.calls.every(call=>!call[1]?.method || call[1]?.method==='GET')).toBe(true);
  });
  it('rejects wrong customer wallet context before opening a durable operation',async()=>{
    const createIdempotent=vi.fn();
    const service=new FundingService(new TestnetFundingAdapter(base,horizon()),{createIdempotent,setPrepared:vi.fn()});
    await expect(service.create('fund',{customer_id:'other',wallet_id:customer.walletId,asset_id:XLM.id,amount:'1'},customer,'key')).rejects.toMatchObject({statusCode:404});
    expect(createIdempotent).not.toHaveBeenCalled();
  });
});
