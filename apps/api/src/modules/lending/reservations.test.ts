import { describe, expect, it } from 'vitest';
import { XLM } from '@grapnel/contracts';
import { BLEND_USDC_ASSET_ID } from '../../adapters/blend/usdc-inspector.js';
import { blendReservationPlan } from './routes.js';

describe('Blend asset and XLM fee reservations',()=>{
 it('keeps XLM supply principal and fee in one XLM reservation',()=>expect(blendReservationPlan('supply',XLM.id,'1.2500000','500000')).toEqual([{assetId:XLM.id,amountAtomic:12_500_000n+500_000n}]));
 it('reserves only XLM fee for native withdrawal',()=>expect(blendReservationPlan('withdraw',XLM.id,'1.2500000','500000')).toEqual([{assetId:XLM.id,amountAtomic:500_000n}]));
 it('reserves classic USDC principal and Soroban fee as separate assets',()=>expect(blendReservationPlan('supply',BLEND_USDC_ASSET_ID,'1.2500000','500000')).toEqual([{assetId:BLEND_USDC_ASSET_ID,amountAtomic:12_500_000n},{assetId:XLM.id,amountAtomic:500_000n}]));
 it('reserves only XLM resource fee for USDC withdrawal',()=>expect(blendReservationPlan('withdraw',BLEND_USDC_ASSET_ID,'1.2500000','500000')).toEqual([{assetId:XLM.id,amountAtomic:500_000n}]));
 it('rejects unknown assets and invalid fee values',()=>{expect(()=>blendReservationPlan('supply','fake','1','1')).toThrow();expect(()=>blendReservationPlan('supply',BLEND_USDC_ASSET_ID,'1','0')).toThrow();});
});
