import { describe, expect, it } from 'vitest';
import { Address, Asset, Contract, Keypair, StrKey, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { NETWORK_PASSPHRASE } from '@grapnel/contracts';
import { buildBlendOperation, type BlendIntent } from './index.js';
import { inspectBlendUsdcSupplyAuthorization, inspectBlendUsdcWithdrawAuthorization } from './usdc-inspector.js';
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
