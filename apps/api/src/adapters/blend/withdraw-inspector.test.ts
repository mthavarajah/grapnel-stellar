import { describe, expect, it } from 'vitest';
import {
  Address, Asset, Keypair, SorobanDataBuilder, StrKey,
  nativeToScVal, xdr,
} from '@stellar/stellar-sdk';
import { NETWORK_PASSPHRASE } from '@grapnel/contracts';
import { buildBlendOperation, type BlendIntent } from './index.js';
import {
  inspectBlendWithdrawAuthorization,
  inspectBlendWithdrawDeltas,
  inspectBlendWithdrawFootprint,
} from './withdraw-inspector.js';
import type { VerifiedBlendRegistry } from '../stellar/blend-soroban.js';

const customer = Keypair.random().publicKey();
const stranger = Keypair.random().publicKey();
const pool = StrKey.encodeContract(Buffer.alloc(32, 31));
const reserve = Asset.native().contractId(NETWORK_PASSPHRASE);
const registry: VerifiedBlendRegistry = { poolId: pool, reserveId: reserve, poolWasmHash: 'a'.repeat(64), reserveIndex: 0 };
const intent: BlendIntent = { action: 'withdraw', poolId: pool, reserveId: reserve, walletAddress: customer, amountAtomic: 1_000_000n };
const address = (value: string) => Address.fromString(value).toScVal();
const symbol = (value: string) => nativeToScVal(value, { type: 'symbol' });
const vector = (...values: xdr.ScVal[]) => xdr.ScVal.scvVec(values);
function dataKey(contract: string, key: xdr.ScVal, temporary = false): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({
    contract: Address.fromString(contract).toScAddress(), key,
    durability: temporary ? xdr.ContractDataDurability.temporary() : xdr.ContractDataDurability.persistent(),
  }));
}
const accountKey = (value: string) => xdr.LedgerKey.account(new xdr.LedgerKeyAccount({
  accountId: xdr.PublicKey.publicKeyTypeEd25519(StrKey.decodeEd25519PublicKey(value)),
}));
function footprint(extraReadOnly: xdr.LedgerKey[] = [], extraReadWrite: xdr.LedgerKey[] = []) {
  return new SorobanDataBuilder().setResourceFee('20000').setResources(1_000_000, 160, 2048)
    .setReadOnly([
      dataKey(pool, xdr.ScVal.scvLedgerKeyContractInstance()),
      dataKey(reserve, xdr.ScVal.scvLedgerKeyContractInstance()),
      dataKey(pool, vector(symbol('ResConfig'), address(reserve))),
      dataKey(pool, vector(symbol('EmisData'), nativeToScVal(1, { type: 'u32' }))),
      xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash: Buffer.from(registry.poolWasmHash, 'hex') })),
      ...extraReadOnly,
    ]).setReadWrite([
      accountKey(customer),
      dataKey(pool, vector(symbol('Positions'), address(customer))),
      dataKey(pool, vector(symbol('ResData'), address(reserve))),
      dataKey(reserve, vector(symbol('Balance'), address(pool))),
      ...extraReadWrite,
    ]).build();
}
function auth(changedIntent: Partial<BlendIntent> = {}, child = false) {
  const approved = { ...intent, ...changedIntent };
  const root = xdr.Operation.fromXDR(buildBlendOperation(approved), 'base64')
    .body().invokeHostFunctionOp().hostFunction().invokeContract();
  const fn = xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn;
  const childInvocation = new xdr.SorobanAuthorizedInvocation({ function: fn(root), subInvocations: [] });
  return [new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: fn(root), subInvocations: child ? [childInvocation] : [],
    }),
  })];
}

describe('exact Blend Testnet withdrawal authorization', () => {
  it('accepts a single exact source-account pool withdrawal with no token grant child', () => {
    expect(() => inspectBlendWithdrawAuthorization(auth(), intent, registry)).not.toThrow();
  });
  it('rejects amount/customer substitution and any nested authorization', () => {
    expect(() => inspectBlendWithdrawAuthorization(auth({ amountAtomic: 1_000_001n }), intent, registry)).toThrow();
    expect(() => inspectBlendWithdrawAuthorization(auth({ walletAddress: stranger }), intent, registry)).toThrow();
    expect(() => inspectBlendWithdrawAuthorization(auth({}, true), intent, registry)).toThrow();
  });
});

describe('bounded Blend Testnet withdrawal footprint', () => {
  it('accepts the live observed source/pool/reserve footprint', () => {
    expect(() => inspectBlendWithdrawFootprint(footprint(), intent, registry)).not.toThrow();
  });
  it('rejects foreign positions, foreign source accounts, and code changes', () => {
    expect(() => inspectBlendWithdrawFootprint(
      footprint([dataKey(pool, vector(symbol('Positions'), address(stranger)))]), intent, registry,
    )).toThrow();
    expect(() => inspectBlendWithdrawFootprint(
      new SorobanDataBuilder().setResourceFee('20000').setResources(1_000_000, 160, 2048)
        .setReadOnly(footprint().resources().footprint().readOnly())
        .setReadWrite([accountKey(stranger), ...footprint().resources().footprint().readWrite().slice(1)]).build(), intent, registry,
    )).toThrow();
    expect(() => inspectBlendWithdrawFootprint(
      new SorobanDataBuilder().setResourceFee('20000').setResources(1_000_000, 160, 2048)
        .setReadOnly([xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash: Buffer.alloc(32, 99) })), ...footprint().resources().footprint().readOnly().slice(0, 4)])
        .setReadWrite(footprint().resources().footprint().readWrite()).build(), intent, registry,
    )).toThrow();
  });
  it('rejects over-budget resources and out-of-scope contracts', () => {
    expect(() => inspectBlendWithdrawFootprint(
      new SorobanDataBuilder().setResourceFee('10000001').setResources(1_000_000, 160, 2048)
        .setReadOnly(footprint().resources().footprint().readOnly()).setReadWrite(footprint().resources().footprint().readWrite()).build(), intent, registry,
    )).toThrow();
    const foreign = StrKey.encodeContract(Buffer.alloc(32, 55));
    expect(() => inspectBlendWithdrawFootprint(
      footprint([], [dataKey(foreign, vector(symbol('Positions'), address(customer)))]), intent, registry,
    )).toThrow();
  });
});

describe('Blend withdrawal chain reconciliation', () => {
  const baseline = {
    asset_id: 'stellar-testnet:native:XLM', market_id: 'test-market', pool_contract_id: pool,
    reserve_contract_id: reserve, wallet_address: customer, wallet_amount: '5.0000000', collateral: '0.1000000',
    as_of: '2026-11-11T04:00:00.000Z', position_as_of: '2026-11-11T04:00:00.000Z', position_ledger: 100,
  };
  const positions = [{
    market_id: 'test-market', provider: 'blend' as const, network: 'stellar-testnet' as const,
    pool_contract_id: pool, pool_name: 'TestnetV2', reserve_contract_id: reserve, asset_id: 'stellar-testnet:native:XLM',
    asset: { id: 'stellar-testnet:native:XLM', network: 'stellar-testnet' as const, kind: 'native' as const, code: 'XLM', decimals: 7, verified: true },
    pool_status: 0, supply_apy_variable: null, borrow_apy_variable: null, available_liquidity: '10.0000000', total_supplied: '1.0000000',
    total_borrowed: '0.0000000', as_of: '2026-11-11T04:00:10.000Z', as_of_ledger: 101,
    supplied: '0.0000000', collateral: '0.0000000', borrowed: '0.0000000', wallet_spendable: false as const,
    health_factor: null, readiness: 'discovery_only' as const,
  }];
  const balances = [{ asset_id: 'stellar-testnet:native:XLM', wallet_amount: '5.0982500', reserved: '0.0000000',
    spendable: '4.0000000', as_of: '2026-11-11T04:00:10.000Z', source: 'stellar_horizon_testnet' }];
  it('requires fresh confirmed collateral decrease and wallet credit net of actual fee', () => {
    const result = inspectBlendWithdrawDeltas({ baseline, request: { asset_id: 'stellar-testnet:native:XLM', market_id: 'test-market', amount: '0.1000000' },
      walletAddress: customer, positions, balances, confirmedLedger: 101, feeStroops: '17500', now: Date.parse('2026-11-11T04:00:11Z') });
    expect(result).toMatchObject({ verified: true, result: { blend_withdraw_verification: {
      collateral_decrease: '0.1000000', wallet_net_credit: '0.0982500', fee_stroops: '17500',
    } } });
  });
  it('does not complete when position delta, wallet credit, or requested scope is missing', () => {
    const args = { baseline, request: { asset_id: 'stellar-testnet:native:XLM', market_id: 'test-market', amount: '0.1000000' },
      walletAddress: customer, positions, balances, confirmedLedger: 101, feeStroops: '17500', now: Date.parse('2026-11-11T04:00:11Z') };
    expect(inspectBlendWithdrawDeltas({ ...args, positions: [{ ...positions[0]!, collateral: '0.1000000' }] }).verified).toBe(false);
    expect(inspectBlendWithdrawDeltas({ ...args, balances: [{ ...balances[0]!, wallet_amount: '5.0000000' }] }).verified).toBe(false);
    expect(inspectBlendWithdrawDeltas({ ...args, request: { ...args.request, asset_id: 'stellar-testnet:classic:XLM:wrong' } }).verified).toBe(false);
  });
});
