import { Address, Horizon, Keypair, StrKey, Transaction, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import type { Pool } from 'pg';
import { GrapnelError, NETWORK_PASSPHRASE, XLM, fromAtomic, type CustomerContext } from '@grapnel/contracts';
import { buildBlendOperation, type BlendPosition } from '../../adapters/blend/index.js';
import { BLEND_USDC_ASSET_ID } from '../../adapters/blend/usdc-inspector.js';
import { inspectBlendUsdcSupplyAuthorization, inspectBlendUsdcWithdrawAuthorization } from '../../adapters/blend/usdc-inspector.js';
import { inspectBlendSupplyAuthorization } from '../../adapters/stellar/blend-soroban.js';
import { inspectBlendWithdrawAuthorization } from '../../adapters/blend/withdraw-inspector.js';
import type { VerifiedBlendRegistry } from '../../adapters/stellar/blend-soroban.js';

const HORIZON_TESTNET = 'https://horizon-testnet.stellar.org';
const PAGE_SIZE = 200;
const MAX_HISTORY_PAGES = 20;
const MINOR_ROUNDING_ATOMIC = 10n;
const ASSET_IDS = [XLM.id, BLEND_USDC_ASSET_ID] as const;

export interface EarnedAmount { asset_id: string; earned: string | null; earned_since: string | null; }
export interface AccountHistoryTransaction {
  hash: string;
  ledger: number;
  successful: boolean;
  envelopeXdr: string;
  createdAt: string;
  sourceAccount: string;
  pagingToken?: string;
}
export interface AccountHistory { complete: boolean; transactions: AccountHistoryTransaction[]; }
export interface EarningsRow {
  id: string; business_id: string; customer_id: string; wallet_id: string; stellar_address: string;
  module_code: string; provider: string; type: string; state: string; network: string;
  tx_hash: string | null; signed_xdr: string | null; request_json: Record<string, unknown>;
  prepared_action: Record<string, unknown> | null; result_json: Record<string, unknown> | null; created_at: string | Date;
}
export interface LendingEarningsDependencies {
  pool: Pick<Pool, 'query'>;
  positions: (customer: CustomerContext) => Promise<BlendPosition[]>;
  history?: (walletAddress: string, fromLedger: number) => Promise<AccountHistory>;
  now?: () => number;
}

const rowsSql = `SELECT o.id,o.business_id,o.customer_id,o.wallet_id,w.stellar_address,
 o.module_code,o.provider,o.type,o.state,o.network,o.tx_hash,o.signed_xdr,o.request_json,
 o.prepared_action,o.result_json,o.created_at
 FROM operations o
 JOIN wallets w ON w.business_id=o.business_id AND w.customer_id=o.customer_id AND w.id=o.wallet_id
 JOIN customers c ON c.business_id=o.business_id AND c.id=o.customer_id
 WHERE o.business_id=$1 AND o.customer_id=$2 AND o.wallet_id=$3 AND w.stellar_address=$4
 AND o.module_code='capital.lending' AND o.provider='blend' AND o.type LIKE 'blend.%'
 ORDER BY o.created_at ASC,o.id ASC`;

interface Snapshot {
  assetId: string; marketId: string; poolId: string; reserveId: string; wallet: string;
  collateral: bigint; walletAmount: bigint; positionLedger: number; positionAsOf: string;
  initialBaselineAt: string; initialBaselineLedger: number;
}
interface VerifiedOperation { row: EarningsRow; assetId: string; marketId: string; poolId: string; reserveId: string; amount: bigint; baseline: Record<string, unknown>; proof: Record<string, unknown>; ledger: number; }

function atomic(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/.test(value)) throw new Error('invalid amount');
  const [whole, fraction = ''] = value.split('.');
  const result = BigInt(whole!) * 10_000_000n + BigInt(fraction.padEnd(7, '0') || '0');
  if (result.toString().length > 78) throw new Error('amount too large');
  return result;
}
function plain(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function time(value: unknown): number { return typeof value === 'string' || value instanceof Date ? Date.parse(value instanceof Date ? value.toISOString() : value) : NaN; }
function isFresh(value: string, maxAge: number, now: number): boolean { const parsed = Date.parse(value); return Number.isFinite(parsed) && parsed <= now + 1000 && now - parsed <= maxAge; }

function baselineFor(row: EarningsRow): Record<string, unknown> | null {
  const result = row.result_json;
  if (!plain(result)) return null;
  const key = row.type === 'blend.supply' ? 'blend_supply_baseline' : row.type === 'blend.withdraw' ? 'blend_withdraw_baseline' : '';
  const baseline = result[key];
  return plain(baseline) ? baseline : null;
}

function proofFor(row: EarningsRow): Record<string, unknown> | null {
  const result = row.result_json;
  if (!plain(result)) return null;
  const keys = row.request_json.asset_id === BLEND_USDC_ASSET_ID
    ? ['blend_usdc_verification']
    : row.type === 'blend.withdraw' ? ['blend_withdraw_verification'] : ['blend_supply_verification'];
  const proof = result[keys[0]!];
  return plain(proof) ? proof : null;
}

function validateCompletedOperation(row: EarningsRow, wallet: string): VerifiedOperation | null {
  try {
    if (row.state !== 'completed' || row.module_code !== 'capital.lending' || row.provider !== 'blend' || row.network !== 'stellar-testnet'
      || !['blend.supply', 'blend.withdraw'].includes(row.type) || !row.tx_hash || !/^[a-f0-9]{64}$/.test(row.tx_hash)
      || !row.signed_xdr || row.stellar_address !== wallet || !plain(row.request_json) || !plain(row.prepared_action)) return null;
    const assetId = row.request_json.asset_id;
    if (typeof assetId !== 'string' || !ASSET_IDS.includes(assetId as typeof ASSET_IDS[number])) return null;
    const amount = atomic(row.request_json.amount);
    const marketId = row.request_json.market_id;
    const baseline = baselineFor(row), proof = proofFor(row);
    if (!baseline || !proof || proof.verified !== true || typeof marketId !== 'string' || !marketId) return null;
    const poolId = baseline.pool_contract_id, reserveId = baseline.reserve_contract_id;
    if (baseline.asset_id !== assetId || baseline.market_id !== marketId || baseline.wallet_address !== wallet
      || typeof poolId !== 'string' || !StrKey.isValidContract(poolId) || typeof reserveId !== 'string' || !StrKey.isValidContract(reserveId)) return null;
    atomic(baseline.collateral); atomic(baseline.wallet_amount);
    const baselineLedger = baseline.position_ledger;
    if (!Number.isSafeInteger(baselineLedger) || (baselineLedger as number) <= 0 || typeof baseline.as_of !== 'string'
      || !Number.isFinite(Date.parse(baseline.as_of)) || typeof baseline.position_as_of !== 'string'
      || !Number.isFinite(Date.parse(baseline.position_as_of))) return null;
    const proofOperation = row.type === 'blend.supply' ? 'supply' : 'withdraw';
    const action = row.prepared_action;
    const summary = action.summary;
    if (amount <= 0n || !plain(summary) || action.operationId !== row.id || action.customerId !== row.customer_id
      || action.network !== 'stellar-testnet' || action.walletAddress !== wallet || action.signingHashHex !== row.tx_hash
      || summary.action !== row.type || summary.fromAssetId !== assetId || summary.contractId !== poolId
      || atomic(summary.amount) !== amount || proof.asset_id !== assetId || proof.market_id !== marketId
      || proof.pool_contract_id !== poolId || proof.reserve_contract_id !== reserveId || proof.requested_atomic !== amount.toString()) return null;
    if (assetId === BLEND_USDC_ASSET_ID && proof.operation !== proofOperation) return null;
    const tx = TransactionBuilder.fromXDR(row.signed_xdr, NETWORK_PASSPHRASE);
    const unsignedXdr = action.unsignedXdr;
    if (!(tx instanceof Transaction) || typeof unsignedXdr !== 'string' || tx.hash().toString('hex') !== row.tx_hash || tx.source !== wallet) return null;
    const unsigned = TransactionBuilder.fromXDR(unsignedXdr, NETWORK_PASSPHRASE);
    if (!(unsigned instanceof Transaction) || unsigned.signatures.length !== 0 || unsigned.hash().toString('hex') !== row.tx_hash) return null;
    const intent = { action: proofOperation, poolId, reserveId, walletAddress: wallet, amountAtomic: amount } as const;
    const expectedOperation = xdr.Operation.fromXDR(buildBlendOperation(intent), 'base64');
    const txOperations = tx.toEnvelope().v1().tx().operations();
    if (txOperations.length !== 1 || tx.operations.length !== 1 || tx.operations[0]!.source
      || txOperations[0]!.body().invokeHostFunctionOp().hostFunction().toXDR('base64')
        !== expectedOperation.body().invokeHostFunctionOp().hostFunction().toXDR('base64')) return null;
    const registry: VerifiedBlendRegistry = { poolId, reserveId, reserveIndex: 0, poolWasmHash: '0'.repeat(64) };
    const auth = txOperations[0]!.body().invokeHostFunctionOp().auth();
    if (assetId === BLEND_USDC_ASSET_ID) {
      if (proofOperation === 'supply') inspectBlendUsdcSupplyAuthorization(auth, intent, registry);
      else inspectBlendUsdcWithdrawAuthorization(auth, intent, registry);
    } else if (proofOperation === 'supply') inspectBlendSupplyAuthorization(auth, intent);
    else inspectBlendWithdrawAuthorization(auth, intent, registry);
    if (tx.signatures.length !== 1 || !Keypair.fromPublicKey(wallet).verify(tx.hash(), tx.signatures[0]!.signature())) return null;
    const proofLedger = proof.confirmed_ledger;
    const observedLedger = proof.observed_ledger;
    if (!Number.isSafeInteger(proofLedger) || (proofLedger as number) < (baselineLedger as number)
      || !Number.isSafeInteger(observedLedger) || (observedLedger as number) < (proofLedger as number)) return null;
    return { row, assetId, marketId, poolId, reserveId, amount, baseline, proof, ledger: proofLedger as number };
  } catch { return null; }
}

function hasPoolSubmit(tx: Transaction, poolId: string): boolean {
  return tx.operations.some(operation => {
    if (operation.type !== 'invokeHostFunction' || operation.func.switch().name !== 'hostFunctionTypeInvokeContract') return false;
    const call = operation.func.invokeContract();
    return Address.fromScAddress(call.contractAddress()).toString() === poolId && call.functionName().toString() === 'submit';
  });
}

async function readHorizonHistory(wallet: string, fromLedger: number): Promise<AccountHistory> {
  const server = new Horizon.Server(HORIZON_TESTNET);
  const transactions: AccountHistoryTransaction[] = [];
  let cursor: string | undefined;
  for (let pageNo = 0; pageNo < MAX_HISTORY_PAGES; pageNo++) {
    let page: Awaited<ReturnType<ReturnType<Horizon.Server['transactions']>['call']>>;
    try {
      const builder = server.transactions().forAccount(wallet).order('desc').limit(PAGE_SIZE);
      if (cursor) builder.cursor(cursor);
      page = await builder.call();
    } catch { return { complete: false, transactions }; }
    if (!Array.isArray(page.records)) return { complete: false, transactions };
    for (const record of page.records) {
      const ledger = Number(record.ledger_attr);
      if (!Number.isSafeInteger(ledger) || ledger <= 0 || typeof record.hash !== 'string' || typeof record.envelope_xdr !== 'string'
        || typeof record.created_at !== 'string' || typeof record.source_account !== 'string') return { complete: false, transactions };
      transactions.push({ hash: record.hash, ledger, successful: record.successful, envelopeXdr: record.envelope_xdr,
        createdAt: record.created_at, sourceAccount: record.source_account, pagingToken: record.paging_token });
    }
    const oldest = page.records.at(-1);
    if (page.records.some(record => Number(record.ledger_attr) < fromLedger) || page.records.length < PAGE_SIZE) return { complete: true, transactions };
    if (!oldest?.paging_token || oldest.paging_token === cursor) return { complete: false, transactions };
    cursor = oldest.paging_token;
  }
  return { complete: false, transactions };
}

function poolSubmitFromHistory(record: AccountHistoryTransaction, wallet: string, poolId: string): boolean | null {
  if (!record.successful || record.sourceAccount !== wallet) return false;
  try {
    const tx = TransactionBuilder.fromXDR(record.envelopeXdr, NETWORK_PASSPHRASE);
    if (!(tx instanceof Transaction) || tx.hash().toString('hex') !== record.hash || tx.source !== wallet) return null;
    return hasPoolSubmit(tx, poolId);
  } catch { return null; }
}

/** Read verified realized + unrealized token-denominated Blend interest. It never estimates APY. */
export class LendingEarningsReader {
  private readonly now: () => number;
  private readonly history: NonNullable<LendingEarningsDependencies['history']>;
  constructor(private readonly deps: LendingEarningsDependencies) {
    this.now = deps.now ?? Date.now;
    this.history = deps.history ?? readHorizonHistory;
  }

  async getEarnings(customer: CustomerContext): Promise<EarnedAmount[]> {
    const empty = (): EarnedAmount[] => ASSET_IDS.map(asset_id => ({ asset_id, earned: null, earned_since: null }));
    if (!StrKey.isValidEd25519PublicKey(customer.walletAddress)) throw new GrapnelError(422, 'INVALID_WALLET', 'Expected verified Stellar customer wallet');
    let rows: EarningsRow[], positions: BlendPosition[];
    try {
      const result = await this.deps.pool.query(rowsSql, [customer.businessId, customer.customerId, customer.walletId, customer.walletAddress]);
      rows = result.rows as EarningsRow[];
      positions = await this.deps.positions(customer);
    } catch { return empty(); }
    const now = this.now();
    if (rows.some(row => !['completed', 'failed', 'rejected', 'expired'].includes(row.state))) return empty();

    const completed = rows.filter(row => row.state === 'completed').map(row => validateCompletedOperation(row, customer.walletAddress));
    const invalidCompletedRows = rows.filter(row => row.state === 'completed').filter((_, index) => !completed[index]);
    if (invalidCompletedRows.length) return empty();
    const verifiedOperations = completed.filter((value): value is VerifiedOperation => value !== null);
    let output: EarnedAmount[] = [];
    for (const assetId of ASSET_IDS) {
      output.push(await this.calculateAsset(customer.walletAddress, assetId, rows, verifiedOperations, positions, now));
    }
    return output;
  }

  private async calculateAsset(wallet: string, assetId: string, rows: EarningsRow[], verified: VerifiedOperation[], positions: BlendPosition[], now: number): Promise<EarnedAmount> {
    const nullResult = (): EarnedAmount => ({ asset_id: assetId, earned: null, earned_since: null });
    const positionsForAsset = positions.filter(position => position.asset_id === assetId);
    if (positionsForAsset.length !== 1) return nullResult();
    const position = positionsForAsset[0]!;
    if (!Number.isSafeInteger(position.as_of_ledger) || position.as_of_ledger <= 0 || !isFresh(position.as_of, 30000, now)) return nullResult();
    let currentCollateral: bigint;
    try { currentCollateral = atomic(position.collateral); } catch { return nullResult(); }
    const operationRows = rows.filter(row => row.request_json?.asset_id === assetId);
    const operations = verified.filter(operation => operation.assetId === assetId);
    if (!operationRows.length) {
      return currentCollateral === 0n ? { asset_id: assetId, earned: '0.0000000', earned_since: null } : nullResult();
    }
    if (operationRows.some(row => !baselineFor(row))) return nullResult();
    if (operations.length !== operationRows.filter(row => row.state === 'completed').length) return nullResult();
    if (!operations.length) return nullResult();
    const anchor = operationRows.map(row => ({ row, baseline: baselineFor(row)! }))
      .sort((a, b) => time(a.row.created_at) - time(b.row.created_at))[0]!;
    const initial = anchor.baseline;
    if (typeof initial.asset_id !== 'string' || initial.asset_id !== assetId || typeof initial.wallet_address !== 'string' || initial.wallet_address !== wallet
      || typeof initial.market_id !== 'string' || typeof initial.pool_contract_id !== 'string' || typeof initial.reserve_contract_id !== 'string'
      || !Number.isSafeInteger(initial.position_ledger) || (initial.position_ledger as number) <= 0
      || typeof initial.position_as_of !== 'string' || !Number.isFinite(Date.parse(initial.position_as_of))) return nullResult();
    const marketId = initial.market_id, poolId = initial.pool_contract_id, reserveId = initial.reserve_contract_id;
    if (operations.some(operation => operation.marketId !== marketId || operation.poolId !== poolId || operation.reserveId !== reserveId)) return nullResult();
    if (position.market_id !== marketId || position.pool_contract_id !== poolId || position.reserve_contract_id !== reserveId
      || position.as_of_ledger < (initial.position_ledger as number)) return nullResult();

    const initialOps = operationRows.map(row => ({ row, baseline: baselineFor(row)! }));
    for (const entry of initialOps) {
      const baseline = entry.baseline;
      if (baseline.asset_id !== assetId || baseline.wallet_address !== wallet || baseline.market_id !== marketId
        || baseline.pool_contract_id !== poolId || baseline.reserve_contract_id !== reserveId
        || !Number.isSafeInteger(baseline.position_ledger) || (baseline.position_ledger as number) <= 0) return nullResult();
    }
    let initialCollateral: bigint, sumSupply = 0n, sumWithdraw = 0n;
    try {
      initialCollateral = atomic(initial.collateral);
      for (const operation of operations) {
        if (operation.row.type === 'blend.supply') sumSupply += operation.amount;
        else if (operation.row.type === 'blend.withdraw') sumWithdraw += operation.amount;
        else return nullResult();
      }
    } catch { return nullResult(); }

    const minLedger = Math.min(...initialOps.map(entry => Number(entry.baseline.position_ledger)));
    const earliestTime = Math.min(...initialOps.map(entry => time(entry.row.created_at)));
    if (!Number.isFinite(earliestTime)) return nullResult();
    let history: AccountHistory;
    try { history = await this.history(wallet, minLedger); } catch { return nullResult(); }
    if (!history.complete) return nullResult();

    const verifiedHashes = new Set(verified.map(operation => operation.row.tx_hash!));
    let latestObservedLedger = Number(initial.position_ledger);
    for (const entry of history.transactions) {
      if (entry.ledger < minLedger || time(entry.createdAt) < earliestTime) continue;
      const submit = poolSubmitFromHistory(entry, wallet, poolId);
      if (submit === null) return nullResult();
      if (!submit) continue;
      if (!verifiedHashes.has(entry.hash)) return nullResult();
      latestObservedLedger = Math.max(latestObservedLedger, entry.ledger);
    }
    for (const operation of operations) latestObservedLedger = Math.max(latestObservedLedger, operation.ledger);
    if (position.as_of_ledger < latestObservedLedger) return nullResult();

    const earnedAtomic = currentCollateral + sumWithdraw - sumSupply - initialCollateral;
    if (earnedAtomic < -MINOR_ROUNDING_ATOMIC) return nullResult();
    const earned = earnedAtomic < 0n ? 0n : earnedAtomic;
    const sinceMillis = time(initial.position_as_of);
    if (!Number.isFinite(sinceMillis) || sinceMillis > now + 1000) return nullResult();
    return { asset_id: assetId, earned: fromAtomic(earned, 7), earned_since: new Date(sinceMillis).toISOString() };
  }
}
