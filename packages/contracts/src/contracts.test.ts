import { describe, expect, it } from 'vitest';
import { MODULE_IDS, NETWORK_PASSPHRASE, toAtomic, fromAtomic, formatTokenAmount, FundingInputSchema, ModulesInputSchema, SpotMarketAssetsSchema, XLM,MarginWorkflowInputSchema,MarginStepTermsSchema } from './index.js';
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
it('keeps Margin policy and custody fields server-owned',()=>{
 const input={customer_id:'00000000-0000-4000-8000-000000000001',market_id:'stellar-testnet:peridot:XLM-USDT-MARGIN',direction:'long',leverage:2,amount:'1',slippage_bps:50};
 expect(MarginWorkflowInputSchema.safeParse(input).success).toBe(true);
 for(const key of ['pinsHash','network','poolId','owner','tx_hash','evidence','maxFeeStroops'])expect(MarginWorkflowInputSchema.safeParse({...input,[key]:'caller-controlled'}).success).toBe(false);
 for(const amount of ['0','-1','1e2','0.00000001'])expect(MarginWorkflowInputSchema.safeParse({...input,amount}).success).toBe(false);
 expect(MarginWorkflowInputSchema.safeParse({...input,leverage:10}).success).toBe(false);
 expect(MarginWorkflowInputSchema.safeParse({...input,slippage_bps:51}).success).toBe(false);
 expect(MarginStepTermsSchema.safeParse({minimumOutputAtomic:'1',owner:'caller'}).success).toBe(false);
 expect(MarginStepTermsSchema.safeParse({minimumOutputAtomic:'1.5'}).success).toBe(false);
});
