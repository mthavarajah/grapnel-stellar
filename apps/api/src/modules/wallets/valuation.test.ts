import {describe,expect,it,vi} from 'vitest';
import {Keypair,StrKey} from '@stellar/stellar-sdk';
import {NETWORK,XLM,type AssetIdentity,type WalletBalance} from '@grapnel/contracts';
import {valueWalletBalances} from './valuation.js';
const now=Date.parse('2026-11-11T20:00:00.000Z'),asOf=new Date(now).toISOString();
const issuer=Keypair.random().publicKey(),usdc=`stellar-testnet:classic:USDC:${issuer}`;
const contract=StrKey.encodeContract(Buffer.alloc(32,7)),tokenId=`stellar-testnet:soroban:${contract}`;
const token:AssetIdentity={id:tokenId,network:NETWORK,kind:'soroban',code:'TOKEN',contractId:contract,decimals:18,verified:true,sourceUrl:'https://example.com/verified-registry'};
const balance=(asset_id:string,wallet_amount:string,asset?:AssetIdentity):WalletBalance=>({asset_id,wallet_amount,asset,reserved:'0',spendable:'0',as_of:asOf,source:'stellar_horizon_testnet'});
const price=(value:string,at=asOf)=>({value,as_of:at});
describe('Exact wallet-only USD valuation',()=>{
 it('converts native and classic seven-decimal holdings without floating point or a USDC peg',async()=>{
  const read=vi.fn(async(id:string)=>price(id===XLM.id?'0.153456789':'0.9981'));
  expect(await valueWalletBalances([balance(XLM.id,'100.0000001'),balance(usdc,'4.1234567')],read,now)).toEqual({total_usd:'19.4613010476156789',priced_subtotal_usd:'19.4613010476156789',unpriced_asset_count:0,as_of:asOf});
 });
 it('uses verified eighteen-decimal token metadata and floors below 18 USD decimals',async()=>{
  const result=await valueWalletBalances([balance(tokenId,'1.000000000000000001',token)],async()=>price('0.123456789123456789'),now);
  expect(result.total_usd).toBe('0.123456789123456789');
 });
 it('retains large exact quantities beyond JavaScript safe integers',async()=>expect((await valueWalletBalances([balance(tokenId,'9007199254740993.000000000000000001',token)],async()=>price('1'),now)).total_usd).toBe('9007199254740993.000000000000000001'));
 it('never includes spendable/reserved amounts or protocol positions in the value',async()=>{
  const row={...balance(XLM.id,'10'),spendable:'2',reserved:'8',collateral:'100000',borrowed:'999'};
  expect((await valueWalletBalances([row],async()=>price('0.1'),now)).total_usd).toBe('1');
 });
 it('returns an explicit priced subtotal when any positive asset is unpriced',async()=>{
  const result=await valueWalletBalances([balance(XLM.id,'10'),balance(usdc,'4')],async(id)=>id===XLM.id?price('0.15'):null,now);
  expect(result).toMatchObject({total_usd:null,priced_subtotal_usd:'1.5',unpriced_asset_count:1});
 });
 it('does not count zero amounts or require prices for them, even without metadata',async()=>{
  const read=vi.fn(async()=>null);
  expect(await valueWalletBalances([balance('unknown-token','0.0000000')],read,now)).toEqual({total_usd:'0',priced_subtotal_usd:'0',unpriced_asset_count:0,as_of:asOf});expect(read).not.toHaveBeenCalled();
 });
 it('empty holdings legitimately value at zero',async()=>expect(await valueWalletBalances([],async()=>null,now)).toEqual({total_usd:'0',priced_subtotal_usd:'0',unpriced_asset_count:0,as_of:asOf}));
 it.each([
  {...token,verified:false},{...token,id:'other'},{...token,decimals:39},{...token,network:'stellar-mainnet'},{...token,contractId:StrKey.encodeContract(Buffer.alloc(32,8))},
 ])('leaves unknown or invalid metadata unpriced without calling a code-based price source',async metadata=>{
  const read=vi.fn(async()=>price('100'));
  expect(await valueWalletBalances([balance(tokenId,'1',metadata as AssetIdentity)],read,now)).toMatchObject({total_usd:null,priced_subtotal_usd:'0',unpriced_asset_count:1});expect(read).not.toHaveBeenCalled();
 });
 it('does not recognize an asset merely because its code says USDC',async()=>{
  const read=vi.fn(async()=>price('1'));expect((await valueWalletBalances([balance('fake:USDC','1')],read,now)).total_usd).toBeNull();expect(read).not.toHaveBeenCalled();
 });
 it.each(['-1','NaN','1e5','+1','01','1.00000001','1'+ '0'.repeat(78)])('rejects invalid seven-decimal wallet amount %s before fetching prices',async amount=>{
  const read=vi.fn(async()=>price('1'));await expect(valueWalletBalances([balance(XLM.id,amount)],read,now)).rejects.toMatchObject({code:'PROVIDER_INVALID_RESPONSE'});expect(read).not.toHaveBeenCalled();
 });
 it('rejects duplicate exact identities before any source calls',async()=>{
  const read=vi.fn(async()=>price('1'));await expect(valueWalletBalances([balance(XLM.id,'1'),balance(XLM.id,'2')],read,now)).rejects.toMatchObject({code:'PROVIDER_INVALID_RESPONSE'});expect(read).not.toHaveBeenCalled();
 });
 it.each(['-1','0','NaN','1e2','1.0000000000000000001'])('marks an invalid source price %s unpriced',async value=>expect((await valueWalletBalances([balance(usdc,'1')],async()=>price(value),now)).total_usd).toBeNull());
 it.each([-300001,1001])('rejects stale/future source timestamp delta %s',async delta=>expect((await valueWalletBalances([balance(XLM.id,'1')],async()=>price('1',new Date(now+delta).toISOString()),now)).total_usd).toBeNull());
 it.each([-300000,1000])('accepts the exact allowed source timestamp boundary %s',async delta=>expect((await valueWalletBalances([balance(XLM.id,'1')],async()=>price('1',new Date(now+delta).toISOString()),now)).total_usd).toBe('1'));
 it('catches source errors independently and preserves other priced holdings',async()=>expect(await valueWalletBalances([balance(XLM.id,'1'),balance(usdc,'4')],async id=>{if(id===usdc)throw Error('Offline source failure');return price('0.15');},now)).toMatchObject({total_usd:null,priced_subtotal_usd:'0.15',unpriced_asset_count:1}));
 it('limits price reads to eight in flight',async()=>{
  let active=0,maximum=0;const releases:(()=>void)[]=[];
  const rows=Array.from({length:20},(_,i)=>{const c=StrKey.encodeContract(Buffer.alloc(32,i+1)),asset={...token,id:`stellar-testnet:soroban:${c}`,contractId:c,decimals:7};return balance(asset.id,'1',asset);});
  const task=valueWalletBalances(rows,async()=>{active++;maximum=Math.max(maximum,active);await new Promise<void>(resolve=>releases.push(resolve));active--;return price('1');},now);
  while(releases.length||active){releases.splice(0).forEach(resolve=>resolve());await Promise.resolve();await Promise.resolve();}
  expect((await task).total_usd).toBe('20');expect(maximum).toBe(8);
 });
});
