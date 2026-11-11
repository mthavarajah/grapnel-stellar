import {
  Address,
  StrKey,
  Transaction,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import {
  AmountSchema,
  NETWORK,
  NETWORK_PASSPHRASE,
  GrapnelError,
  PreparedActionSchema,
  XLM,
  fromAtomic,
  toAtomic,
  type PreparedAction,
  type WalletBalance,
} from '@grapnel/contracts';
import { z } from 'zod';
import { buildBlendOperation, type BlendIntent, type BlendPosition } from './index.js';
import type { VerifiedBlendRegistry } from '../stellar/blend-soroban.js';

const MAX_INSTRUCTIONS = 20_000_000;
const MAX_READ_BYTES = 1_048_576;
const MAX_WRITE_BYTES = 131_072;
const MAX_FOOTPRINT_ENTRIES = 32;
const DEFAULT_FEE_CEILING = 10_000_000n;

function fail(code: string, message: string): never { throw new GrapnelError(403, code, message); }
const checkedFee = (value: string): bigint => {
  if (!/^\d{1,12}$/.test(value)) return fail('SOROBAN_FEE_INVALID', 'Invalid exact Soroban fee');
  return BigInt(value);
};
const encodeKey = (key: xdr.LedgerKey): string => key.toXDR('base64');
const contractId = (value: xdr.ScAddress): string => Address.fromScAddress(value).toString();
const sameObjectKeys = (value: unknown, keys: string[]): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === keys.slice().sort().join(',');

function withdrawIntent(intent: BlendIntent, registry: VerifiedBlendRegistry): void {
  if (intent.action !== 'withdraw' || intent.poolId !== registry.poolId || intent.reserveId !== registry.reserveId
    || !StrKey.isValidEd25519PublicKey(intent.walletAddress) || intent.amountAtomic <= 0n
    || intent.amountAtomic >= (1n << 127n)) {
    fail('BLEND_INTENT_MISMATCH', 'Only an exact native-XLM Blend collateral withdrawal is supported');
  }
}

/** Withdrawal authorization has one exact source-account root and no token-transfer child grant. */
export function inspectBlendWithdrawAuthorization(
  auth: xdr.SorobanAuthorizationEntry[], intent: BlendIntent, registry: VerifiedBlendRegistry,
): void {
  withdrawIntent(intent, registry);
  try {
    if (auth.length !== 1 || auth[0]!.credentials().switch().name !== 'sorobanCredentialsSourceAccount') throw new Error();
    const root = auth[0]!.rootInvocation();
    if (root.function().switch().name !== 'sorobanAuthorizedFunctionTypeContractFn' || root.subInvocations().length !== 0) throw new Error();
    const expected = xdr.Operation.fromXDR(buildBlendOperation(intent), 'base64')
      .body().invokeHostFunctionOp().hostFunction().invokeContract();
    if (root.function().contractFn().toXDR('base64') !== expected.toXDR('base64')) throw new Error();
  } catch {
    fail('SOROBAN_AUTH_MISMATCH', 'Soroban authorization differs from the exact customer withdrawal');
  }
}

/**
 * Review the separately observed WithdrawCollateral footprint. It intentionally
 * does not share the supply auth rule: a withdrawal has no customer->pool token grant.
 */
export function inspectBlendWithdrawFootprint(
  data: xdr.SorobanTransactionData,
  intent: BlendIntent,
  registry: VerifiedBlendRegistry,
  ceiling = DEFAULT_FEE_CEILING,
): void {
  withdrawIntent(intent, registry);
  try {
    if (data.ext().switch() !== 0 || checkedFee(data.resourceFee().toString()) > ceiling) throw new Error();
    const resources = data.resources();
    if (resources.instructions() <= 0 || resources.instructions() > MAX_INSTRUCTIONS
      || resources.diskReadBytes() > MAX_READ_BYTES || resources.writeBytes() > MAX_WRITE_BYTES) throw new Error();
    const fp = resources.footprint();
    const ro = fp.readOnly(), rw = fp.readWrite();
    const all = [...ro, ...rw].map(encodeKey);
    if (!rw.length || all.length > MAX_FOOTPRINT_ENTRIES || new Set(all).size !== all.length) throw new Error();
    let sourceAccount = false, positions = false, reserveData = false, poolBalance = false;
    for (const [writable, keys] of [[false, ro], [true, rw]] as const) {
      for (const key of keys) {
        const kind = key.switch().name;
        if (kind === 'account') {
          if (!writable || StrKey.encodeEd25519PublicKey(key.account().accountId().ed25519()) !== intent.walletAddress) throw new Error();
          sourceAccount = true;
          continue;
        }
        if (kind === 'contractCode') {
          if (writable || key.contractCode().hash().toString('hex') !== registry.poolWasmHash) throw new Error();
          continue;
        }
        if (kind !== 'contractData') throw new Error();
        const cd = key.contractData();
        const id = contractId(cd.contract());
        if (id !== intent.poolId && id !== intent.reserveId) throw new Error();
        if (cd.key().switch().name === 'scvLedgerKeyContractInstance') {
          if (writable || cd.durability().name !== 'persistent') throw new Error();
          continue;
        }
        const decoded = scValToNative(cd.key());
        if (!Array.isArray(decoded) || decoded.length !== 2) throw new Error();
        const [name, target] = decoded;
        if (id === intent.reserveId) {
          if (!writable || name !== 'Balance' || target !== intent.poolId || cd.durability().name !== 'persistent') throw new Error();
          poolBalance = true;
          continue;
        }
        if (name === 'Auction' && !writable && cd.durability().name === 'temporary'
          && sameObjectKeys(target, ['auct_type', 'user']) && target.auct_type === 0 && target.user === intent.walletAddress) continue;
        if (cd.durability().name !== 'persistent') throw new Error();
        if (name === 'ResConfig' && !writable && target === intent.reserveId) continue;
        if (name === 'ResData' && writable && target === intent.reserveId) { reserveData = true; continue; }
        if (name === 'Positions' && writable && target === intent.walletAddress) { positions = true; continue; }
        const emissionId = registry.reserveIndex * 2 + 1;
        if (name === 'EmisData' && !writable && target === emissionId) continue;
        if (name === 'UserEmis' && !writable && sameObjectKeys(target, ['reserve_id', 'user'])
          && target.reserve_id === emissionId && target.user === intent.walletAddress) continue;
        throw new Error();
      }
    }
    if (!sourceAccount || !positions || !reserveData || !poolBalance) throw new Error();
  } catch {
    fail('SOROBAN_FOOTPRINT_MISMATCH', 'Soroban withdrawal footprint or resource budget exceeds the reviewed scope');
  }
}

/** Final exact-envelope inspection after generic signature/hash verification. */
export function inspectPreparedBlendWithdrawTransaction(
  action: PreparedAction,
  tx: Transaction,
  registry: VerifiedBlendRegistry,
  feeCeiling = DEFAULT_FEE_CEILING,
): void {
  PreparedActionSchema.parse(action);
  if (action.network !== NETWORK || action.authorization.method !== 'privy_stellar'
    || action.summary.action !== 'blend.withdraw' || action.summary.fromAssetId !== XLM.id
    || action.summary.toAssetId !== undefined || action.summary.minReceive !== undefined
    || action.summary.contractId !== registry.poolId || action.summary.recipient !== action.walletAddress
    || action.summary.expiresAt !== action.authorization.expiresAt
    || action.summary.maxFeeStroops !== tx.fee || tx.hash().toString('hex') !== action.signingHashHex) {
    fail('SOROBAN_TRANSACTION_MISMATCH', 'Approved withdrawal summary, fee, or digest differs from the transaction');
  }
  const expires = Date.parse(action.summary.expiresAt);
  const amountAtomic = toAtomic(action.summary.amount ?? '', 7);
  const intent: BlendIntent = {
    action: 'withdraw', poolId: registry.poolId, reserveId: registry.reserveId,
    walletAddress: action.walletAddress, amountAtomic,
  };
  const expected = xdr.Operation.fromXDR(buildBlendOperation(intent), 'base64').body().invokeHostFunctionOp().hostFunction();
  if (tx.networkPassphrase !== NETWORK_PASSPHRASE || tx.source !== action.walletAddress || BigInt(tx.sequence) <= 0n
    || tx.operations.length !== 1 || tx.memo.type !== 'none' || tx.extraSigners?.length
    || !tx.timeBounds || tx.timeBounds.minTime !== '0' || tx.timeBounds.maxTime === '0'
    || !Number.isFinite(expires) || expires <= Date.now() || expires > Date.now() + 120_000
    || BigInt(tx.timeBounds.maxTime) * 1000n > BigInt(expires)
    || checkedFee(tx.fee) <= 100n || checkedFee(tx.fee) > feeCeiling) {
    fail('SOROBAN_TRANSACTION_MISMATCH', 'Withdrawal source, bounds, sequence, or fee differs from approved intent');
  }
  const op = tx.operations[0];
  if (!op || op.type !== 'invokeHostFunction') fail('BLEND_INTENT_MISMATCH', 'Submitted operation is not a contract invocation');
  if (op.source || op.func.switch().name !== 'hostFunctionTypeInvokeContract'
    || op.func.toXDR('base64') !== expected.toXDR('base64')) {
    fail('BLEND_INTENT_MISMATCH', 'Submitted invocation differs from approved withdrawal');
  }
  inspectBlendWithdrawAuthorization(op.auth ?? [], intent, registry);
  const envelope = tx.toEnvelope().v1().tx();
  if (envelope.ext().switch() !== 1) fail('SOROBAN_FOOTPRINT_MISMATCH', 'Missing Soroban transaction data');
  const data = envelope.ext().sorobanData();
  inspectBlendWithdrawFootprint(data, intent, registry, feeCeiling);
  if (checkedFee(tx.fee) < BigInt(data.resourceFee().toString()) + 100n) {
    fail('SOROBAN_FEE_LIMIT', 'Declared fee does not cover withdrawal resources');
  }
}

export interface BlendWithdrawBaseline {
  asset_id: string;
  market_id: string;
  pool_contract_id: string;
  reserve_contract_id: string;
  wallet_address: string;
  wallet_amount: string;
  collateral: string;
  as_of: string;
  position_as_of: string;
  position_ledger: number;
}
export interface BlendWithdrawDeltaVerification {
  verified: boolean;
  result: { blend_withdraw_verification: Record<string, unknown> };
}
const withdrawBaselineSchema = z.object({
  asset_id: z.literal(XLM.id), market_id: z.string().min(1), pool_contract_id: z.string().min(1),
  reserve_contract_id: z.string().min(1), wallet_address: z.string().min(1), wallet_amount: AmountSchema,
  collateral: AmountSchema, as_of: z.string().datetime(), position_as_of: z.string().datetime(),
  position_ledger: z.number().int().positive(),
}).strict();
const withdrawRequestSchema = z.object({
  asset_id: z.literal(XLM.id), market_id: z.string().min(1), amount: AmountSchema,
});

const freshObservation = (value: string, maxAgeMs: number, now: number): boolean => {
  const at = Date.parse(value);
  return Number.isFinite(at) && at <= now + 1000 && now - at <= maxAgeMs;
};
const observedAtomic = (value: string, decimals: number): bigint =>
  /^0(?:\.0+)?$/.test(value) ? 0n : toAtomic(value, decimals);

/** Reconcile an actual confirmed customer withdrawal against fresh pool and wallet reads. */
export function inspectBlendWithdrawDeltas(input: {
  baseline: unknown;
  request: { asset_id?: unknown; market_id?: unknown; amount?: unknown };
  walletAddress: string;
  positions: BlendPosition[];
  balances: WalletBalance[];
  confirmedLedger: number;
  feeStroops: string;
  now?: number;
}): BlendWithdrawDeltaVerification {
  const now = input.now ?? Date.now();
  const reject = (reason: string): BlendWithdrawDeltaVerification => ({ verified: false,
    result: { blend_withdraw_verification: { verified: false, reason, observed_at: new Date(now).toISOString() } } });
  try {
    const parsedBaseline = withdrawBaselineSchema.safeParse(input.baseline);
    const parsedRequest = withdrawRequestSchema.safeParse(input.request);
    if (!parsedBaseline.success || !parsedRequest.success || parsedBaseline.data.wallet_address !== input.walletAddress
      || parsedBaseline.data.market_id !== parsedRequest.data.market_id
      || !Number.isSafeInteger(input.confirmedLedger) || input.confirmedLedger <= 0
      || !Number.isSafeInteger(Date.parse(parsedBaseline.data.as_of))
      || !Number.isSafeInteger(Date.parse(parsedBaseline.data.position_as_of))
      || !/^[0-9]{1,12}$/.test(input.feeStroops)) return reject('WITHDRAW_BASELINE_OR_INTENT_MISMATCH');
    const baseline = parsedBaseline.data;
    const position = input.positions.find(p => p.market_id === baseline.market_id && p.asset_id === XLM.id
      && p.pool_contract_id === baseline.pool_contract_id && p.reserve_contract_id === baseline.reserve_contract_id);
    const balance = input.balances.find(b => b.asset_id === XLM.id && b.source === 'stellar_horizon_testnet');
    if (!position || !balance || position.as_of_ledger < input.confirmedLedger || position.as_of_ledger < baseline.position_ledger
      || !freshObservation(position.as_of, 30_000, now) || !freshObservation(balance.as_of, 15_000, now)
      || Date.parse(position.as_of) < Date.parse(baseline.position_as_of) || Date.parse(balance.as_of) < Date.parse(baseline.as_of)) {
      return reject('POST_CHAIN_OBSERVATION_STALE');
    }
    const requested = toAtomic(parsedRequest.data.amount, 7);
    const beforeCollateral = observedAtomic(baseline.collateral, 7);
    const afterCollateral = observedAtomic(position.collateral, 7);
    const beforeWallet = toAtomic(baseline.wallet_amount, 7);
    const afterWallet = toAtomic(balance.wallet_amount, 7);
    const collateralDecrease = beforeCollateral - afterCollateral;
    const walletNetCredit = afterWallet - beforeWallet;
    const fee = BigInt(input.feeStroops);
    if (requested <= 0n || requested > beforeCollateral || collateralDecrease <= 0n
      || walletNetCredit <= 0n || walletNetCredit + fee < requested) return reject('WITHDRAW_POSITION_OR_WALLET_DELTA_MISSING');
    return { verified: true, result: { blend_withdraw_verification: {
      verified: true, asset_id: XLM.id, market_id: baseline.market_id,
      pool_contract_id: baseline.pool_contract_id, reserve_contract_id: baseline.reserve_contract_id,
      requested_atomic: requested.toString(), collateral_before: baseline.collateral,
      collateral_after: position.collateral, collateral_decrease: fromAtomic(collateralDecrease, 7),
      wallet_before: baseline.wallet_amount,
      wallet_after: balance.wallet_amount, wallet_net_credit: fromAtomic(walletNetCredit, 7), fee_stroops: fee.toString(),
      confirmed_ledger: input.confirmedLedger, observed_ledger: position.as_of_ledger,
      position_as_of: position.as_of, wallet_as_of: balance.as_of, observed_at: new Date(now).toISOString(),
    } } };
  } catch { return reject('INVALID_WITHDRAW_OBSERVATION'); }
}
