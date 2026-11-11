import { describe, expect, it } from 'vitest';
import { MODULE_IDS, NETWORK_PASSPHRASE, toAtomic, fromAtomic, formatTokenAmount, FundingInputSchema, ModulesInputSchema, SpotMarketAssetsSchema, XLM } from './index.js';
describe('frozen contracts', () => {
 it('retains exact precision above safe integer range', () => {expect(toAtomic('9007199254740993.0000001',7)).toBe(90071992547409930000001n); expect(fromAtomic(123400001n,7)).toBe('12.3400001');});
 it.each(['-1','0','1e7','1.00000001','NaN',' 1','01'])('rejects invalid Stellar amount %s',(v)=>expect(()=>toAtomic(v,7)).toThrow());
 it('freezes seven modules and Testnet only',()=>{expect(MODULE_IDS).toHaveLength(7);expect(NETWORK_PASSPHRASE).toBe('Test SDF Network ; September 2015');expect(ModulesInputSchema.safeParse({modules:['fiat.deposit']}).success).toBe(false);});
 it('rejects caller-controlled recipient for funding',()=>expect(FundingInputSchema.safeParse({customer_id:'00000000-0000-4000-8000-000000000001',wallet_id:'00000000-0000-4000-8000-000000000002',asset_id:'stellar-testnet:native:XLM',amount:'1',recipient:'GATTACKER'}).success).toBe(false));
});

it('formats six significant digits without overstating balances',()=>{expect(formatTokenAmount('0.1002446')).toBe('0.100244');expect(formatTokenAmount('9999.5545194')).toBe('9,999.55');expect(formatTokenAmount('0.0000001')).toBe('0.0000001');expect(formatTokenAmount('0.0000000')).toBe('0');expect(formatTokenAmount('NaN')).toBe('Unavailable');});
it('binds optional selector metadata to the exact market asset identity',()=>{
 const market={asset_in_id:XLM.id,asset_out_id:'another-asset',asset_in:{...XLM,name:'Stellar Lumens'}};
 expect(SpotMarketAssetsSchema.parse(market).asset_in?.name).toBe('Stellar Lumens');
 expect(SpotMarketAssetsSchema.safeParse({...market,asset_in:{...XLM,id:'another-asset'}}).success).toBe(false);
 expect(SpotMarketAssetsSchema.safeParse({...market,asset_in:{...XLM,network:'mainnet'}}).success).toBe(false);
});
