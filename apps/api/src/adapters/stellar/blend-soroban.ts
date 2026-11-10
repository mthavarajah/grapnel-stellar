import {
  Address, Asset, Operation, StrKey, Transaction, TransactionBuilder,
  nativeToScVal, rpc, scValToNative, xdr,
} from '@stellar/stellar-sdk';
import {
  GrapnelError, NETWORK, NETWORK_PASSPHRASE, PreparedActionSchema, XLM, toAtomic,
  type ChainAction, type PreparedAction,
} from '@grapnel/contracts';
import { BLEND_REGISTRY_URL, buildBlendOperation, inspectBlendOperation, type BlendIntent } from '../blend/index.js';
import { assertTestnet, parseTestnetTransaction, verifySignedAction } from './index.js';

/** Narrow, source-account-only native XLM collateral supply. Never accepts arbitrary venue XDR. */
export interface BlendSorobanConfig {
  network: string; passphrase: string; rpcUrl?: string; gate1Passed: boolean;
  maxFeeStroops?: string;
}
export interface VerifiedBlendRegistry {
  poolId: string; reserveId: string; poolWasmHash: string; reserveIndex: number;
}
export interface BlendSorobanDependencies {
  fetcher?: typeof fetch;
  server?: Pick<rpc.Server, 'getNetwork' | 'getAccount' | 'getContractData' | 'simulateTransaction'>;
}
export interface BlendInspectionReport {
  mode: 'read_only_simulation'; broadcast: false; signable: false;
  ledger: number; resource_fee_stroops: string; total_fee_stroops: string;
  source_account_auth_entries: number; read_only_entries: number; read_write_entries: number;
  pool_contract_id: string; reserve_contract_id: string;
}
function fail(code: string, message: string, status = 403): never { throw new GrapnelError(status, code, message); }
function unavailable(reason: string): never { throw new GrapnelError(409, 'EXECUTION_UNAVAILABLE', 'Blend Soroban execution is unavailable', false, { reason }); }
const MAX_INSTRUCTIONS = 20_000_000;
const MAX_READ_BYTES = 1_048_576;
const MAX_WRITE_BYTES = 131_072;
const MAX_FOOTPRINT_ENTRIES = 32;
const DEFAULT_FEE_CEILING = 10_000_000n; // One Testnet XLM, including resource fee.
const API_TIMEOUT = 15_000;
const checkedFee = (value: string): bigint => {
  if (!/^\d{1,12}$/.test(value)) return fail('SOROBAN_FEE_INVALID', 'Invalid exact Soroban fee');
  return BigInt(value);
};
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new GrapnelError(503, 'STELLAR_UNAVAILABLE', 'Soroban inspection timed out', true)), API_TIMEOUT);
    })]);
  } catch (error) {
    if (error instanceof GrapnelError) throw error;
    throw new GrapnelError(503, 'STELLAR_UNAVAILABLE', 'Cannot inspect current Stellar Testnet state', true);
  } finally { clearTimeout(timer!); }
}
const encodeKey = (key: xdr.LedgerKey): string => key.toXDR('base64');
const sortedKeys = (keys: xdr.LedgerKey[]): string => keys.map(encodeKey).sort().join(':');
const contractId = (value: xdr.ScAddress): string => Address.fromScAddress(value).toString();
const symbolKey = (name: string, address: string): xdr.ScVal => xdr.ScVal.scvVec([
  nativeToScVal(name, { type: 'symbol' }), Address.fromString(address).toScVal(),
]);
function sameObjectKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === keys.slice().sort().join(',');
}
function intentFor(input: ChainAction, registry: VerifiedBlendRegistry): BlendIntent {
  if (input.summary.action === 'blend.withdraw') return unavailable('WITHDRAW_AUTH_FOOTPRINT_PROOF_REQUIRED');
  if (input.summary.action !== 'blend.supply' || input.summary.fromAssetId !== XLM.id
    || input.summary.toAssetId !== undefined || input.summary.minReceive !== undefined
    || input.summary.recipient !== input.walletAddress || input.summary.contractId !== registry.poolId
    || !StrKey.isValidEd25519PublicKey(input.walletAddress)
    || new Set(input.allowedContracts).size !== 2 || input.allowedContracts.length !== 2
    || !input.allowedContracts.includes(registry.poolId) || !input.allowedContracts.includes(registry.reserveId)) {
    return fail('BLEND_INTENT_MISMATCH', 'Only the exact native XLM collateral supply intent is supported');
  }
  let amountAtomic: bigint;
  try { amountAtomic = toAtomic(input.summary.amount ?? '', 7); }
  catch { return fail('INVALID_AMOUNT', 'A positive native XLM amount with seven-decimal precision is required', 422); }
  const expires = Date.parse(input.summary.expiresAt);
  if (!Number.isFinite(expires) || expires <= Date.now() || expires > Date.now() + 120_000) {
    return fail('ACTION_EXPIRED', 'Soroban approval must expire within two minutes');
  }
  const intent: BlendIntent = { action: 'supply', poolId: registry.poolId, reserveId: registry.reserveId, walletAddress: input.walletAddress, amountAtomic };
  inspectBlendOperation(input.operationXdr, intent);
  return intent;
}
function requireSupply(intent: BlendIntent): void {
  if (intent.action !== 'supply') unavailable('WITHDRAW_AUTH_FOOTPRINT_PROOF_REQUIRED');
}
/** Each source authorization grants one exact submit plus one exact customer -> pool transfer. */
export function inspectBlendSupplyAuthorization(auth: xdr.SorobanAuthorizationEntry[], intent: BlendIntent): void {
  requireSupply(intent);
  try {
    if (auth.length !== 1 || auth[0]!.credentials().switch().name !== 'sorobanCredentialsSourceAccount') throw new Error();
    const root = auth[0]!.rootInvocation();
    if (root.function().switch().name !== 'sorobanAuthorizedFunctionTypeContractFn') throw new Error();
    const expected = xdr.Operation.fromXDR(buildBlendOperation(intent), 'base64').body().invokeHostFunctionOp().hostFunction().invokeContract();
    if (root.function().contractFn().toXDR('base64') !== expected.toXDR('base64') || root.subInvocations().length !== 1) throw new Error();
    const transfer = root.subInvocations()[0]!;
    if (transfer.function().switch().name !== 'sorobanAuthorizedFunctionTypeContractFn' || transfer.subInvocations().length !== 0) throw new Error();
    const fn = transfer.function().contractFn();
    if (contractId(fn.contractAddress()) !== intent.reserveId || fn.functionName().toString() !== 'transfer') throw new Error();
    const args = fn.args().map(scValToNative);
    if (args.length !== 3 || args[0] !== intent.walletAddress || args[1] !== intent.poolId || args[2] !== intent.amountAtomic) throw new Error();
  } catch { fail('SOROBAN_AUTH_MISMATCH', 'Soroban authorization differs from the approved source-only supply'); }
}
/** No arbitrary accounts/contracts, admin keys, restore/TTL ops, upgrades, or other users' positions. */
export function inspectBlendSupplyFootprint(data: xdr.SorobanTransactionData, intent: BlendIntent, registry: VerifiedBlendRegistry, ceiling: bigint): void {
  requireSupply(intent);
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
          sourceAccount = true; continue;
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
          poolBalance = true; continue;
        }
        if (name === 'Auction' && !writable && cd.durability().name === 'temporary'
          && sameObjectKeys(target, ['auct_type', 'user']) && target.auct_type === 0 && target.user === intent.walletAddress) continue;
        if (cd.durability().name !== 'persistent') throw new Error();
        if (name === 'ResConfig' && !writable && target === intent.reserveId) continue;
        if (name === 'ResData' && writable && target === intent.reserveId) { reserveData = true; continue; }
        if (name === 'Positions' && writable && target === intent.walletAddress) { positions = true; continue; }
        const emissionId = registry.reserveIndex * 2 + 1;
        if (name === 'EmisData' && target === emissionId) continue;
        if (name === 'UserEmis' && sameObjectKeys(target, ['reserve_id', 'user'])
          && target.reserve_id === emissionId && target.user === intent.walletAddress) continue;
        throw new Error();
      }
    }
    if (!sourceAccount || !positions || !reserveData || !poolBalance) throw new Error();
  } catch { fail('SOROBAN_FOOTPRINT_MISMATCH', 'Soroban footprint or resource budget exceeds the reviewed supply scope'); }
}
function inspectSimulation(sim: rpc.Api.SimulateTransactionResponse, intent: BlendIntent, registry: VerifiedBlendRegistry, ceiling: bigint): asserts sim is rpc.Api.SimulateTransactionSuccessResponse {
  if (!rpc.Api.isSimulationSuccess(sim) || rpc.Api.isSimulationRestore(sim) || !sim.result) unavailable('SOROBAN_SIMULATION_OR_RESTORE_FAILED');
  const fee = checkedFee(sim.minResourceFee);
  if (fee <= 0n || fee + 100n > ceiling || sim.transactionData.build().resourceFee().toString() !== fee.toString()) fail('SOROBAN_FEE_LIMIT', 'Resource fee exceeds the exact approved limit');
  inspectBlendSupplyAuthorization(sim.result.auth, intent);
  inspectBlendSupplyFootprint(sim.transactionData.build(), intent, registry, ceiling);
}
function inspectPreparedTransaction(tx: Transaction, input: ChainAction, intent: BlendIntent, registry: VerifiedBlendRegistry, ceiling: bigint): void {
  const expires = Date.parse(input.summary.expiresAt);
  if (tx.networkPassphrase !== NETWORK_PASSPHRASE || tx.source !== intent.walletAddress || BigInt(tx.sequence) <= 0n
    || tx.operations.length !== 1 || tx.memo.type !== 'none' || tx.extraSigners?.length
    || !tx.timeBounds || tx.timeBounds.minTime !== '0' || tx.timeBounds.maxTime === '0'
    || BigInt(tx.timeBounds.maxTime) * 1000n > BigInt(expires) || expires <= Date.now()
    || checkedFee(tx.fee) > ceiling || checkedFee(tx.fee) <= 100n) fail('SOROBAN_TRANSACTION_MISMATCH', 'Transaction source, bounds, sequence or fee differs from the approved supply');
  const op = tx.operations[0];
  if (op?.type !== 'invokeHostFunction' || op.source || op.func.switch().name !== 'hostFunctionTypeInvokeContract') fail('SOROBAN_TRANSACTION_MISMATCH', 'Unexpected operation or sponsorship');
  const expected = xdr.Operation.fromXDR(buildBlendOperation(intent), 'base64').body().invokeHostFunctionOp().hostFunction();
  if (op.func.toXDR('base64') !== expected.toXDR('base64')) fail('BLEND_INTENT_MISMATCH', 'Submitted invocation differs from the approved supply');
  inspectBlendSupplyAuthorization(op.auth ?? [], intent);
  const envelope = tx.toEnvelope().v1().tx();
  if (envelope.ext().switch() !== 1) fail('SOROBAN_FOOTPRINT_MISMATCH', 'Missing Soroban transaction data');
  const data = envelope.ext().sorobanData();
  inspectBlendSupplyFootprint(data, intent, registry, ceiling);
  if (checkedFee(tx.fee) < BigInt(data.resourceFee().toString()) + 100n) fail('SOROBAN_FEE_LIMIT', 'Declared fee does not cover resources');
}
function requireCoveredResources(tx: Transaction, sim: rpc.Api.SimulateTransactionSuccessResponse): void {
  const declared = tx.toEnvelope().v1().tx().ext().sorobanData();
  const observed = sim.transactionData.build();
  const a = declared.resources(), b = observed.resources();
  if (a.instructions() < b.instructions() || a.diskReadBytes() < b.diskReadBytes() || a.writeBytes() < b.writeBytes()
    || checkedFee(tx.fee) < checkedFee(sim.minResourceFee) + 100n
    || sortedKeys(a.footprint().readOnly()) !== sortedKeys(b.footprint().readOnly())
    || sortedKeys(a.footprint().readWrite()) !== sortedKeys(b.footprint().readWrite())) {
    unavailable('SOROBAN_RESOURCES_CHANGED_REAPPROVAL_REQUIRED');
  }
}

/** Synchronous callback for canonical exact-envelope verification after fresh registry resolution.
 * A registry value is trusted only when obtained from live official registry+contract validation below. */
export function inspectPreparedBlendSupplyTransaction(action: PreparedAction, tx: Transaction, registry: VerifiedBlendRegistry, feeCeiling: bigint = DEFAULT_FEE_CEILING): void {
  PreparedActionSchema.parse(action);
  const intent: BlendIntent = { action: 'supply', poolId: registry.poolId, reserveId: registry.reserveId,
    walletAddress: action.walletAddress, amountAtomic: toAtomic(action.summary.amount ?? '', 7) };
  const input: ChainAction = { operationId: action.operationId, customerId: action.customerId, walletAddress: action.walletAddress,
    operationXdr: buildBlendOperation(intent), allowedContracts: [registry.poolId, registry.reserveId], summary: action.summary };
  intentFor(input, registry);
  if (action.network !== NETWORK || action.authorization.method !== 'privy_stellar'
    || action.summary.expiresAt !== action.authorization.expiresAt || action.summary.maxFeeStroops !== tx.fee
    || tx.hash().toString('hex') !== action.signingHashHex) fail('SOROBAN_TRANSACTION_MISMATCH', 'Approved summary, fee or digest differs from the transaction');
  inspectPreparedTransaction(tx, input, intent, registry, feeCeiling);
}

/** Preparation/verification only: this class has no signer and no broadcasting method. */
export class BlendSorobanPreparer {
  private readonly server: NonNullable<BlendSorobanDependencies['server']>;
  private readonly fetcher: typeof fetch;
  private readonly ceiling: bigint;
  constructor(readonly config: BlendSorobanConfig, deps: BlendSorobanDependencies = {}) {
    assertTestnet(config);
    this.server = deps.server ?? new rpc.Server(config.rpcUrl ?? 'https://soroban-testnet.stellar.org');
    this.fetcher = deps.fetcher ?? fetch;
    this.ceiling = checkedFee(config.maxFeeStroops ?? DEFAULT_FEE_CEILING.toString());
    if (this.ceiling <= 100n || this.ceiling > DEFAULT_FEE_CEILING) fail('SOROBAN_FEE_LIMIT', 'Fee ceiling must be positive and at most one Testnet XLM', 422);
  }
  private async registry(): Promise<VerifiedBlendRegistry> {
    if ((await bounded(this.server.getNetwork())).passphrase !== NETWORK_PASSPHRASE) fail('NETWORK_MISMATCH', 'RPC does not report Stellar Testnet', 400);
    let response: Response;
    try { response = await this.fetcher(BLEND_REGISTRY_URL, { signal: AbortSignal.timeout(API_TIMEOUT) }); }
    catch { return unavailable('BLEND_REGISTRY_UNAVAILABLE'); }
    if (!response.ok) return unavailable('BLEND_REGISTRY_UNAVAILABLE');
    let body: { ids?: Record<string, string>; hashes?: Record<string, string> };
    try { body = await response.json() as typeof body; } catch { return unavailable('BLEND_REGISTRY_INVALID'); }
    const poolId = body.ids?.TestnetV2, reserveId = body.ids?.XLM, poolWasmHash = body.hashes?.lendingPoolV2;
    if (!poolId || !StrKey.isValidContract(poolId) || reserveId !== Asset.native().contractId(NETWORK_PASSPHRASE)
      || !poolWasmHash || !/^[a-f0-9]{64}$/.test(poolWasmHash)) return unavailable('BLEND_REGISTRY_INVALID');
    const [pool, token, reserve] = await Promise.all([
      bounded(this.server.getContractData(poolId, xdr.ScVal.scvLedgerKeyContractInstance())),
      bounded(this.server.getContractData(reserveId, xdr.ScVal.scvLedgerKeyContractInstance())),
      bounded(this.server.getContractData(poolId, symbolKey('ResConfig', reserveId))),
    ]);
    try {
      const executable = pool.val.contractData().val().instance().executable();
      const tokenExecutable = token.val.contractData().val().instance().executable();
      const cfg = scValToNative(reserve.val.contractData().val()) as Record<string, unknown>;
      if (executable.switch().name !== 'contractExecutableWasm' || executable.wasmHash().toString('hex') !== poolWasmHash
        || tokenExecutable.switch().name !== 'contractExecutableStellarAsset' || cfg.decimals !== 7 || cfg.enabled !== true
        || !Number.isInteger(cfg.index) || Number(cfg.index) < 0 || Number(cfg.index) > 63) throw new Error();
      return { poolId, reserveId, poolWasmHash, reserveIndex: Number(cfg.index) };
    } catch { return unavailable('BLEND_LIVE_CONTRACT_OR_RESERVE_MISMATCH'); }
  }
  async getVerifiedRegistry(): Promise<VerifiedBlendRegistry> { return this.registry(); }
  private async simulate(input: ChainAction): Promise<{ action: PreparedAction; report: BlendInspectionReport }> {
    const registry = await this.registry();
    const intent = intentFor(input, registry);
    const ceiling = input.summary.maxFeeStroops === undefined ? this.ceiling : checkedFee(input.summary.maxFeeStroops);
    if (ceiling > this.ceiling) fail('SOROBAN_FEE_LIMIT', 'Intent fee ceiling exceeds configured maximum');
    const account = await bounded(this.server.getAccount(intent.walletAddress));
    const expectedSequence = BigInt(account.sequenceNumber()) + 1n;
    const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: NETWORK_PASSPHRASE,
      timebounds: { minTime: 0, maxTime: Math.floor(Date.parse(input.summary.expiresAt) / 1000) } })
      .addOperation(xdr.Operation.fromXDR(input.operationXdr, 'base64')).build();
    const recorded = await bounded(this.server.simulateTransaction(tx, { cpuInstructions: 500_000 }, 'record'));
    inspectSimulation(recorded, intent, registry, ceiling);
    // SDK14 TransactionBuilder adds Soroban resourceFee during build. Its rpc.assembleTransaction
    // also pre-adds minResourceFee, so assemble explicitly to avoid charging that fee twice.
    const invocation = tx.operations[0];
    if (invocation?.type !== 'invokeHostFunction') fail('BLEND_INTENT_MISMATCH', 'Unexpected operation');
    const prepared = TransactionBuilder.cloneFrom(tx, { fee: '100', networkPassphrase: NETWORK_PASSPHRASE,
      sorobanData: recorded.transactionData.build() }).clearOperations()
      .addOperation(Operation.invokeHostFunction({ func: invocation.func, auth: recorded.result!.auth })).build();
    inspectPreparedTransaction(prepared, input, intent, registry, ceiling);
    if (BigInt(prepared.sequence) !== expectedSequence || prepared.signatures.length) fail('SOROBAN_TRANSACTION_MISMATCH', 'Unexpected sequence or preexisting signature');
    const enforced = await bounded(this.server.simulateTransaction(prepared, undefined, 'enforce'));
    inspectSimulation(enforced, intent, registry, ceiling);
    if (recorded.result!.auth[0]!.toXDR('base64') !== enforced.result!.auth[0]!.toXDR('base64')) fail('SOROBAN_AUTH_MISMATCH', 'Authorization changed during enforce simulation');
    requireCoveredResources(prepared, enforced);
    const expiresAt = new Date(Number(prepared.timeBounds!.maxTime) * 1000).toISOString();
    const action = PreparedActionSchema.parse({ operationId: input.operationId, customerId: input.customerId,
      network: NETWORK, walletAddress: intent.walletAddress, unsignedXdr: prepared.toXDR(), signingHashHex: prepared.hash().toString('hex'),
      summary: { ...input.summary, maxFeeStroops: prepared.fee, expiresAt }, authorization: { method: 'privy_stellar', expiresAt } });
    const footprint = prepared.toEnvelope().v1().tx().ext().sorobanData().resources().footprint();
    return { action, report: { mode: 'read_only_simulation', broadcast: false, signable: false,
      ledger: enforced.latestLedger, resource_fee_stroops: recorded.minResourceFee, total_fee_stroops: prepared.fee,
      source_account_auth_entries: 1, read_only_entries: footprint.readOnly().length, read_write_entries: footprint.readWrite().length,
      pool_contract_id: registry.poolId, reserve_contract_id: registry.reserveId } };
  }
  async inspectReadOnly(input: ChainAction): Promise<BlendInspectionReport> { return (await this.simulate(input)).report; }
  async prepare(input: ChainAction): Promise<PreparedAction> {
    if (!this.config.gate1Passed) return unavailable('GATE_1_SIGNING_PROOF_REQUIRED');
    return (await this.simulate(input)).action;
  }
  /** Verify approved exact envelope then enforce-simulate again without changing a single signed byte. */
  async verifyForSubmission(action: PreparedAction, signedXdr: string): Promise<void> {
    if (!this.config.gate1Passed) return unavailable('GATE_1_SIGNING_PROOF_REQUIRED');
    const registry = await this.registry();
    // The optional callback is accepted by the canonical verifier after lead integration.
    // On the current two-argument implementation it is ignored; the inspector also runs explicitly below.
    const verify = verifySignedAction as (action: PreparedAction, signed: string, inspect?: (action: PreparedAction, tx: Transaction) => void) => void;
    verify(action, signedXdr, (approved, transaction) => inspectPreparedBlendSupplyTransaction(approved, transaction, registry, this.ceiling));
    const tx = parseTestnetTransaction(signedXdr);
    const intent: BlendIntent = { action: 'supply', poolId: registry.poolId, reserveId: registry.reserveId,
      walletAddress: action.walletAddress, amountAtomic: toAtomic(action.summary.amount ?? '', 7) };
    const input: ChainAction = { operationId: action.operationId, customerId: action.customerId, walletAddress: action.walletAddress,
      operationXdr: buildBlendOperation(intent), allowedContracts: [registry.poolId, registry.reserveId], summary: action.summary };
    intentFor(input, registry);
    inspectPreparedBlendSupplyTransaction(action, tx, registry, this.ceiling);
    const sim = await bounded(this.server.simulateTransaction(tx, undefined, 'enforce'));
    inspectSimulation(sim, intent, registry, this.ceiling);
    requireCoveredResources(tx, sim);
  }
}
