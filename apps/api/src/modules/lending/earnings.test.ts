import { describe, expect, it, vi } from 'vitest';
import { Account, Keypair, StrKey, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { NETWORK_PASSPHRASE, XLM, type CustomerContext } from '@grapnel/contracts';
import type { BlendPosition } from '../../adapters/blend/index.js';
import { buildBlendOperation } from '../../adapters/blend/index.js';
import { BLEND_USDC_ASSET_ID } from '../../adapters/blend/usdc-inspector.js';
import type { AccountHistory, EarningsRow } from './earnings.js';
import { LendingEarningsReader } from './earnings.js';

const key = Keypair.random(), wallet = key.publicKey();
const poolId = StrKey.encodeContract(Buffer.alloc(32, 9));
const reserveXlm = StrKey.encodeContract(Buffer.alloc(32, 10));
const reserveUsdc = StrKey.encodeContract(Buffer.alloc(32, 11));
const customer: CustomerContext = { businessId: 'tenant-A', customerId: 'customer-A', walletId: 'wallet-A', walletAddress: wallet, privyUserId: 'did:privy:test' };
const now = Date.parse('2026-11-11T17:00:00.000Z');
const supplyAt = '2026-11-11T16:41:00.000Z';
const withdrawAt = '2026-11-11T16:50:00.000Z';
const hashOf = (value: string) => TransactionBuilder.fromXDR(value, NETWORK_PASSPHRASE).hash().toString('hex');
let sequence = 4;

function amountAtomic(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole!) * 10_000_000n + BigInt(fraction.padEnd(7, '0') || '0');
}
function envelope(action: 'supply' | 'withdraw' = 'supply', reserveId = reserveXlm, amount = '0.1000000'): string {
  const tx = new TransactionBuilder(new Account(wallet, String(sequence++)), { fee: '100', networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(xdr.Operation.fromXDR(buildBlendOperation({ action, poolId, reserveId,
      walletAddress: wallet, amountAtomic: amountAtomic(amount) }), 'base64')).setTimeout(60).build();
  return tx.toXDR();
}
function proof(assetId: string, marketId: string, reserveId: string, amount: string, operation: 'supply' | 'withdraw', ledger: number) {
  return { verified: true, asset_id: assetId, operation, market_id: marketId, pool_contract_id: poolId,
    reserve_contract_id: reserveId, requested_atomic: (BigInt(amount.replace('.', '')) * (amount.includes('.') ? 10n ** BigInt(7 - amount.split('.')[1]!.length) : 10_000_000n)).toString(),
    confirmed_ledger: ledger, observed_ledger: ledger + 1, soroban_fee_asset_id: XLM.id, fee_stroops: '8000' };
}
function baseline(assetId: string, marketId: string, reserveId: string, collateral: string, ledger: number, at: string) {
  return { asset_id: assetId, market_id: marketId, pool_contract_id: poolId, reserve_contract_id: reserveId,
    wallet_address: wallet, wallet_amount: '20.0000000', collateral, as_of: at, position_as_of: at, position_ledger: ledger };
}
function operation(type: 'blend.supply' | 'blend.withdraw', assetId: string, marketId: string, reserveId: string, amount: string, at: string, preCollateral: string, ledger: number): EarningsRow {
  const verb = type.split('.')[1]! as 'supply' | 'withdraw', signedXdr = envelope(verb, reserveId, amount), hash = hashOf(signedXdr), id = `${type}-${at}`;
  const observation = proof(assetId, marketId, reserveId, amount, verb as 'supply' | 'withdraw', ledger + 1);
  const resultKey = assetId === BLEND_USDC_ASSET_ID ? 'blend_usdc_verification' : type === 'blend.supply' ? 'blend_supply_verification' : 'blend_withdraw_verification';
  const prepared = { operationId: id, customerId: customer.customerId, unsignedXdr: signedXdr, network: 'stellar-testnet', walletAddress: wallet, signingHashHex: hash,
    summary: { action: type, fromAssetId: assetId, amount, contractId: poolId } };
  return { id, business_id: customer.businessId, customer_id: customer.customerId, wallet_id: customer.walletId,
    stellar_address: wallet, module_code: 'capital.lending', provider: 'blend', type, state: 'completed', network: 'stellar-testnet',
    tx_hash: hash, signed_xdr: signedXdr, request_json: { asset_id: assetId, market_id: marketId, amount },
    prepared_action: prepared, result_json: { [type === 'blend.supply' ? 'blend_supply_baseline' : 'blend_withdraw_baseline']:
      baseline(assetId, marketId, reserveId, preCollateral, ledger, at), [resultKey]: observation }, created_at: at };
}
function chainRecord(row: EarningsRow, ledger: number, createdAt: string) {
  return { hash: row.tx_hash!, ledger, successful: true, envelopeXdr: row.signed_xdr!, createdAt, sourceAccount: wallet };
}
function pos(assetId: string, marketId: string, reserveId: string, collateral: string, ledger = 104, asOf = new Date(now - 1000).toISOString()): BlendPosition {
  return { asset_id: assetId, market_id: marketId, pool_contract_id: poolId, reserve_contract_id: reserveId,
    supplied: collateral, collateral, borrowed: '0.0000000', wallet_spendable: false, supply_apy_variable: null,
    health_factor: null, as_of_ledger: ledger, as_of: asOf, readiness: 'discovery_only' };
}
function makeReader(rows: EarningsRow[], positions: BlendPosition[], history: AccountHistory = { complete: true, transactions: [] }) {
  const query = vi.fn(async (_sql: string, _values: unknown[]) => ({ rows }));
  const positionsRead = vi.fn(async (_customer: CustomerContext) => positions);
  const historyRead = vi.fn(async (_wallet: string, _ledger: number) => history);
  const reader = new LendingEarningsReader({ pool: { query } as never, positions: positionsRead, history: historyRead, now: () => now });
  return { reader, query, positionsRead, historyRead };
}

describe('tenant-scoped Blend earnings since verified baseline', () => {
  it('calculates 0.1 supply, 0.05 gross withdrawal and 0.0503 collateral as 0.0003 XLM earned', async () => {
    const supply = operation('blend.supply', XLM.id, 'market-XLM', reserveXlm, '0.1000000', supplyAt, '0.0000000', 100);
    const withdraw = operation('blend.withdraw', XLM.id, 'market-XLM', reserveXlm, '0.0500000', withdrawAt, '0.0999997', 102);
    const history = { complete: true, transactions: [chainRecord(supply, 101, '2026-11-11T16:42:00.000Z'), chainRecord(withdraw, 103, '2026-11-11T16:51:00.000Z')] };
    const { reader, historyRead } = makeReader([supply, withdraw], [pos(XLM.id, 'market-XLM', reserveXlm, '0.0503000')], history);
    await expect(reader.getEarnings(customer)).resolves.toEqual([
      { asset_id: XLM.id, earned: '0.0003000', earned_since: new Date(supplyAt).toISOString() },
      { asset_id: BLEND_USDC_ASSET_ID, earned: null, earned_since: null },
    ]);
    expect(historyRead).toHaveBeenCalledWith(wallet, 100);
  });

  it('excludes XLM fee from USDC interest and computes token earnings only', async () => {
    const supply = operation('blend.supply', BLEND_USDC_ASSET_ID, 'market-USDC', reserveUsdc, '1.0000000', supplyAt, '0.0000000', 100);
    const withdraw = operation('blend.withdraw', BLEND_USDC_ASSET_ID, 'market-USDC', reserveUsdc, '0.5000000', withdrawAt, '1.0000000', 102);
    const history = { complete: true, transactions: [chainRecord(supply, 101, '2026-11-11T16:42:00.000Z'), chainRecord(withdraw, 103, '2026-11-11T16:51:00.000Z')] };
    const { reader } = makeReader([supply, withdraw], [pos(XLM.id, 'market-XLM', reserveXlm, '0.0000000'), pos(BLEND_USDC_ASSET_ID, 'market-USDC', reserveUsdc, '0.5003000')], history);
    await expect(reader.getEarnings(customer)).resolves.toEqual([
      { asset_id: XLM.id, earned: '0.0000000', earned_since: null },
      { asset_id: BLEND_USDC_ASSET_ID, earned: '0.0003000', earned_since: new Date(supplyAt).toISOString() },
    ]);
  });

  it('returns null for an untracked external Blend pool submit and truncated history', async () => {
    const supply = operation('blend.supply', XLM.id, 'market-XLM', reserveXlm, '0.1000000', supplyAt, '0.0000000', 100);
    const externalXdr = envelope(), externalTx: AccountHistory['transactions'][number] = {
      hash: hashOf(externalXdr), ledger: 103, successful: true, envelopeXdr: externalXdr,
      createdAt: '2026-11-11T16:45:00.000Z', sourceAccount: wallet,
    };
    const { reader } = makeReader([supply], [pos(XLM.id, 'market-XLM', reserveXlm, '0.1003000')], { complete: true, transactions: [chainRecord(supply, 101, '2026-11-11T16:42:00.000Z'), externalTx] });
    expect((await reader.getEarnings(customer))[0]).toMatchObject({ asset_id: XLM.id, earned: null });
    const truncated = makeReader([supply], [pos(XLM.id, 'market-XLM', reserveXlm, '0.1003000')], { complete: false, transactions: [] });
    expect((await truncated.reader.getEarnings(customer))[0]).toMatchObject({ asset_id: XLM.id, earned: null });
  });

  it('rounds only sub-atomic negative residuals to zero and rejects larger losses or stale positions', async () => {
    const supply = operation('blend.supply', XLM.id, 'market-XLM', reserveXlm, '0.1000000', supplyAt, '0.0000000', 100);
    const history = { complete: true, transactions: [chainRecord(supply, 101, '2026-11-11T16:42:00.000Z')] };
    const rounded = makeReader([supply], [pos(XLM.id, 'market-XLM', reserveXlm, '0.0999995')], history);
    expect((await rounded.reader.getEarnings(customer))[0]).toMatchObject({ earned: '0.0000000' });
    const loss = makeReader([supply], [pos(XLM.id, 'market-XLM', reserveXlm, '0.0999000')], history);
    expect((await loss.reader.getEarnings(customer))[0]).toMatchObject({ earned: null });
    const stale = makeReader([supply], [pos(XLM.id, 'market-XLM', reserveXlm, '0.1000000', 104, new Date(now - 31_000).toISOString())], history);
    expect((await stale.reader.getEarnings(customer))[0]).toMatchObject({ earned: null });
  });

  it('returns null while Blend work is pending or completed proof is incomplete', async () => {
    const supply = operation('blend.supply', XLM.id, 'market-XLM', reserveXlm, '0.1000000', supplyAt, '0.0000000', 100);
    const pending = { ...supply, state: 'awaiting_customer_authorization' };
    const waiting = makeReader([pending], [pos(XLM.id, 'market-XLM', reserveXlm, '0.0000000')]);
    expect((await waiting.reader.getEarnings(customer))[0]).toMatchObject({ asset_id: XLM.id, earned: null });
    const incomplete = makeReader([{ ...supply, result_json: { blend_supply_baseline: baseline(XLM.id, 'market-XLM', reserveXlm, '0.0000000', 100, supplyAt) } }], [pos(XLM.id, 'market-XLM', reserveXlm, '0.1003000')]);
    expect((await incomplete.reader.getEarnings(customer))[0]).toMatchObject({ asset_id: XLM.id, earned: null });
  });

  it('returns 0 since null only when there is no tracked history and live collateral is zero', async () => {
    const { reader } = makeReader([], [pos(XLM.id, 'market-XLM', reserveXlm, '0.0000000'), pos(BLEND_USDC_ASSET_ID, 'market-USDC', reserveUsdc, '0.0000000')]);
    await expect(reader.getEarnings(customer)).resolves.toEqual([
      { asset_id: XLM.id, earned: '0.0000000', earned_since: null },
      { asset_id: BLEND_USDC_ASSET_ID, earned: '0.0000000', earned_since: null },
    ]);
  });

  it('keeps positive collateral without a tracked baseline unknown and scopes SQL to tenant/customer/wallet', async () => {
    const { reader, query } = makeReader([], [pos(XLM.id, 'market-XLM', reserveXlm, '2.0000000'), pos(BLEND_USDC_ASSET_ID, 'market-USDC', reserveUsdc, '0.0000000')]);
    expect((await reader.getEarnings(customer))[0]).toMatchObject({ asset_id: XLM.id, earned: null });
    expect(query.mock.calls[0]?.[1]).toEqual([customer.businessId, customer.customerId, customer.walletId, wallet]);
    expect(query.mock.calls[0]?.[0]).toContain('o.business_id=$1 AND o.customer_id=$2 AND o.wallet_id=$3 AND w.stellar_address=$4');
  });
});
