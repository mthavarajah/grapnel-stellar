import { describe, expect, it } from 'vitest';
import { Address, Asset, Contract, Keypair, StrKey, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { NETWORK_PASSPHRASE } from '@grapnel/contracts';
import { buildBlendOperation, type BlendIntent } from './index.js';
import { BLEND_USDC_ASSET_ID, inspectBlendUsdcDeltas, inspectBlendUsdcSupplyAuthorization, inspectBlendUsdcWithdrawAuthorization } from './usdc-inspector.js';
import type { VerifiedBlendRegistry } from '../stellar/blend-soroban.js';

const user=Keypair.random().publicKey(),pool=StrKey.encodeContract(Buffer.alloc(32,21));
const reserve=new Asset('USDC','GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56').contractId(NETWORK_PASSPHRASE);
const registry:VerifiedBlendRegistry={poolId:pool,reserveId:reserve,poolWasmHash:'a'.repeat(64),reserveIndex:3};
const intent=(action:'supply'|'withdraw'):BlendIntent=>({action,poolId:pool,reserveId:reserve,walletAddress:user,amountAtomic:1_000_000n});
function authorization(action:'supply'|'withdraw',changed:Partial<BlendIntent>={}){
 const approved={...intent(action),...changed};const rootFn=xdr.Operation.fromXDR(buildBlendOperation(approved),'base64').body().invokeHostFunctionOp().hostFunction().invokeContract();
 const fn=xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn;
 const transfer=new Contract(reserve).call('transfer',Address.fromString(user).toScVal(),Address.fromString(pool).toScVal(),nativeToScVal(approved.amountAtomic,{type:'i128'})).body().invokeHostFunctionOp().hostFunction().invokeContract();
 const children=action==='withdraw'?[]:[new xdr.SorobanAuthorizedInvocation({function:fn(transfer),subInvocations:[]})];
 return[new xdr.SorobanAuthorizationEntry({credentials:xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),rootInvocation:new xdr.SorobanAuthorizedInvocation({function:fn(rootFn),subInvocations:children})})];
}
describe('exact Blend classic USDC authorization',()=>{
 it('accepts source-account USDC supply plus one exact customer-to-pool SAC transfer',()=>expect(()=>inspectBlendUsdcSupplyAuthorization(authorization('supply'),intent('supply'),registry)).not.toThrow());
 it('rejects another transfer target, amount, reserve, or missing child',()=>{
  expect(()=>inspectBlendUsdcSupplyAuthorization(authorization('supply',{amountAtomic:1_000_001n}),intent('supply'),registry)).toThrow();
  expect(()=>inspectBlendUsdcSupplyAuthorization(authorization('supply',{walletAddress:Keypair.random().publicKey()}),intent('supply'),registry)).toThrow();
  const noChild=[new xdr.SorobanAuthorizationEntry({credentials:xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),rootInvocation:new xdr.SorobanAuthorizedInvocation({function:xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(xdr.Operation.fromXDR(buildBlendOperation(intent('supply')),'base64').body().invokeHostFunctionOp().hostFunction().invokeContract()),subInvocations:[]})})];
  expect(()=>inspectBlendUsdcSupplyAuthorization(noChild,intent('supply'),registry)).toThrow();
 });
 it('accepts a standalone exact USDC withdrawal with no token grant',()=>expect(()=>inspectBlendUsdcWithdrawAuthorization(authorization('withdraw'),intent('withdraw'),registry)).not.toThrow());
 it('rejects any nested customer grant on withdrawal',()=>expect(()=>inspectBlendUsdcWithdrawAuthorization(authorization('supply'),intent('withdraw'),registry)).toThrow());
});

describe('USDC Blend position and wallet reconciliation',()=>{
 const time='2026-11-11T15:00:00.000Z',baseline={asset_id:BLEND_USDC_ASSET_ID,market_id:'usdc-market',pool_contract_id:pool,reserve_contract_id:reserve,wallet_address:user,wallet_amount:'10.0000000',collateral:'0.0000000',as_of:time,position_as_of:time,position_ledger:100};
 const position={market_id:'usdc-market',pool_contract_id:pool,reserve_contract_id:reserve,asset_id:BLEND_USDC_ASSET_ID,supplied:'1.0000000',collateral:'1.0000000',borrowed:'0.0000000',wallet_spendable:false as const,supply_apy_variable:null,health_factor:null,as_of_ledger:101,as_of:time,readiness:'discovery_only' as const};
 const observation={baseline,request:{asset_id:BLEND_USDC_ASSET_ID,market_id:'usdc-market',amount:'1.0000000'},walletAddress:user,positions:[position],balances:[{asset_id:BLEND_USDC_ASSET_ID,wallet_amount:'9.0000000',reserved:'0',spendable:'8.0000000',as_of:time,source:'stellar_horizon_testnet' as const}],confirmedLedger:100,now:Date.parse(time)};
 it('verifies USDC supply from exact trustline debit and Blend collateral growth',()=>expect(inspectBlendUsdcDeltas({operation:'supply',...observation})).toMatchObject({verified:true,result:{blend_usdc_verification:{verified:true,requested_atomic:'10000000',wallet_delta:'-1.0000000',collateral_delta:'1.0000000',soroban_fee_asset_id:'stellar-testnet:native:XLM'}}}));
 it('verifies USDC withdrawal without subtracting the separately reserved XLM fee',()=>expect(inspectBlendUsdcDeltas({operation:'withdraw',...observation,baseline:{...baseline,wallet_amount:'9.0000000',collateral:'1.0000000'},positions:[{...position,collateral:'0.0000000',supplied:'0.0000000'}],balances:[{...observation.balances[0]!,wallet_amount:'10.0000000'}]})).toMatchObject({verified:true,result:{blend_usdc_verification:{verified:true,wallet_delta:'1.0000000',collateral_delta:'-1.0000000'}}}));
 it('does not accept XLM balances or stale USDC reads as a USDC delta',()=>{expect(inspectBlendUsdcDeltas({operation:'supply',...observation,balances:[]}).verified).toBe(false);expect(inspectBlendUsdcDeltas({operation:'supply',...observation,request:{...observation.request,asset_id:'stellar-testnet:native:XLM'}}).verified).toBe(false);});
});
