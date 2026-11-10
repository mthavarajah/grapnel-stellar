import { describe, expect, it } from 'vitest';
import {
  Account, Address, Asset, Contract, Keypair, SorobanDataBuilder, StrKey,
  TransactionBuilder, nativeToScVal, rpc, xdr,
} from '@stellar/stellar-sdk';
import { NETWORK, NETWORK_PASSPHRASE, XLM, type ChainAction, type PreparedAction } from '@grapnel/contracts';
import { buildBlendOperation, type BlendIntent } from '../blend/index.js';
import {
  BlendSorobanPreparer, inspectBlendSupplyAuthorization, inspectBlendSupplyFootprint,
  inspectPreparedBlendSupplyTransaction, type VerifiedBlendRegistry,
} from './blend-soroban.js';

// Cryptographic fixture only. No fixture signs or submits a network transaction.
const fixtureSigner = Keypair.random();
const wallet = fixtureSigner.publicKey();
const stranger = Keypair.random().publicKey();
const pool = StrKey.encodeContract(Buffer.alloc(32, 1));
const reserve = Asset.native().contractId(NETWORK_PASSPHRASE);
const registry: VerifiedBlendRegistry = { poolId: pool, reserveId: reserve, poolWasmHash: 'a'.repeat(64), reserveIndex: 0 };
const intent: BlendIntent = { action: 'supply', poolId: pool, reserveId: reserve, walletAddress: wallet, amountAtomic: 10_000_000n };
const address = (v: string) => Address.fromString(v).toScVal();
const symbol = (v: string) => nativeToScVal(v, { type: 'symbol' });
const vector = (...values: xdr.ScVal[]) => xdr.ScVal.scvVec(values);
function dataKey(id: string, key: xdr.ScVal, temporary = false): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({ contract: Address.fromString(id).toScAddress(), key,
    durability: temporary ? xdr.ContractDataDurability.temporary() : xdr.ContractDataDurability.persistent() }));
}
const accountKey = (id: string) => xdr.LedgerKey.account(new xdr.LedgerKeyAccount({
  accountId: xdr.PublicKey.publicKeyTypeEd25519(StrKey.decodeEd25519PublicKey(id)),
}));
function footprint() {
  return new SorobanDataBuilder().setResourceFee('10000').setResources(2_000_000, 144, 1024)
    .setReadOnly([
      dataKey(pool, xdr.ScVal.scvLedgerKeyContractInstance()),
      dataKey(reserve, xdr.ScVal.scvLedgerKeyContractInstance()),
      dataKey(pool, vector(symbol('ResConfig'), address(reserve))),
      dataKey(pool, vector(symbol('EmisData'), nativeToScVal(1, { type: 'u32' }))),
      xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash: Buffer.from(registry.poolWasmHash, 'hex') })),
    ]).setReadWrite([
      accountKey(wallet), dataKey(pool, vector(symbol('Positions'), address(wallet))),
      dataKey(pool, vector(symbol('ResData'), address(reserve))), dataKey(reserve, vector(symbol('Balance'), address(pool))),
    ]);
}
function auth(changed: Partial<BlendIntent> = {}): xdr.SorobanAuthorizationEntry[] {
  const details = { ...intent, ...changed };
  const root = xdr.Operation.fromXDR(buildBlendOperation(details), 'base64').body().invokeHostFunctionOp().hostFunction().invokeContract();
  const child = new Contract(details.reserveId).call('transfer', address(details.walletAddress), address(details.poolId), nativeToScVal(details.amountAtomic, { type: 'i128' }))
    .body().invokeHostFunctionOp().hostFunction().invokeContract();
  const fn = xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn;
  return [new xdr.SorobanAuthorizationEntry({ credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(), rootInvocation: new xdr.SorobanAuthorizedInvocation({
    function: fn(root), subInvocations: [new xdr.SorobanAuthorizedInvocation({ function: fn(child), subInvocations: [] })],
  }) })];
}
function input(): ChainAction {
  return { operationId: '00000000-0000-4000-8000-000000000001', customerId: '00000000-0000-4000-8000-000000000002', walletAddress: wallet,
    operationXdr: buildBlendOperation(intent), allowedContracts: [pool, reserve], summary: {
      action: 'blend.supply', fromAssetId: XLM.id, amount: '1.0000000', recipient: wallet, contractId: pool,
      expiresAt: new Date(Math.floor(Date.now() / 1000) * 1000 + 90_000).toISOString(),
    } };
}
function success(data = footprint(), entries = auth()): rpc.Api.SimulateTransactionSuccessResponse {
  return { id: 'offline-fixture', latestLedger: 100, _parsed: true, events: [], minResourceFee: '10000', transactionData: data,
    result: { auth: entries, retval: xdr.ScVal.scvVoid() } };
}
function mockDependencies() {
  const simulation = success();
  const symbolMap = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: symbol('decimals'), val: nativeToScVal(7, { type: 'u32' }) }),
    new xdr.ScMapEntry({ key: symbol('enabled'), val: xdr.ScVal.scvBool(true) }),
    new xdr.ScMapEntry({ key: symbol('index'), val: nativeToScVal(0, { type: 'u32' }) }),
  ]);
  const contractValue = (val: unknown) => ({ val: { contractData: () => ({ val: () => val }) } }) as unknown as rpc.Api.LedgerEntryResult;
  const instance = (executable: xdr.ContractExecutable) => ({ instance: () => ({ executable: () => executable }) });
  const server = {
    getNetwork: async () => ({ passphrase: NETWORK_PASSPHRASE, protocolVersion: '30' }),
    getAccount: async () => new Account(wallet, '12'),
    getContractData: async (id: unknown, key: xdr.ScVal) => key.switch().name === 'scvLedgerKeyContractInstance'
      ? contractValue(instance(id === pool ? xdr.ContractExecutable.contractExecutableWasm(Buffer.from(registry.poolWasmHash, 'hex')) : xdr.ContractExecutable.contractExecutableStellarAsset()))
      : contractValue(symbolMap),
    simulateTransaction: async () => simulation,
  };
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ ids: { TestnetV2: pool, XLM: reserve }, hashes: { lendingPoolV2: registry.poolWasmHash } }));
  return { server, fetcher, simulation };
}
const config = { network: 'testnet', passphrase: NETWORK_PASSPHRASE, gate1Passed: true };

describe('exact source-only Blend supply authorization', () => {
  it('accepts one exact submit and one customer-to-pool transfer', () => expect(() => inspectBlendSupplyAuthorization(auth(), intent)).not.toThrow());
  it.each([
    ['amount', { amountAtomic: 20_000_000n }], ['customer', { walletAddress: stranger }],
    ['pool', { poolId: StrKey.encodeContract(Buffer.alloc(32, 2)) }], ['token', { reserveId: StrKey.encodeContract(Buffer.alloc(32, 3)) }],
  ] as const)('rejects substituted %s', (_name, changed) => expect(() => inspectBlendSupplyAuthorization(auth(changed), intent)).toThrow('authorization differs'));
  it('rejects a second auth grant and extra child invocation', () => {
    expect(() => inspectBlendSupplyAuthorization([...auth(), ...auth()], intent)).toThrow();
    const changed = auth(); changed[0]!.rootInvocation().subInvocations().push(changed[0]!.rootInvocation().subInvocations()[0]!);
    expect(() => inspectBlendSupplyAuthorization(changed, intent)).toThrow();
  });
  it('rejects address credentials and deeper nested grants', () => {
    const changed = auth(); changed[0]!.credentials(xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({
      address: Address.fromString(wallet).toScAddress(), nonce: xdr.Int64.fromString('1'), signatureExpirationLedger: 200, signature: xdr.ScVal.scvVoid(),
    })));
    expect(() => inspectBlendSupplyAuthorization(changed, intent)).toThrow();
    const deeper = auth(); deeper[0]!.rootInvocation().subInvocations()[0]!.subInvocations().push(deeper[0]!.rootInvocation().subInvocations()[0]!);
    expect(() => inspectBlendSupplyAuthorization(deeper, intent)).toThrow();
  });
  it('keeps withdrawal unavailable pending live auth/footprint proof', () => expect(() => inspectBlendSupplyAuthorization(auth(), { ...intent, action: 'withdraw' })).toThrow('unavailable'));
});

describe('bounded reviewed supply footprint', () => {
  it('accepts the explicitly scoped storage/resource set', () => expect(() => inspectBlendSupplyFootprint(footprint().build(), intent, registry, 100000n)).not.toThrow());
  it.each([
    ['foreign account', () => accountKey(stranger)],
    ['foreign position', () => dataKey(pool, vector(symbol('Positions'), address(stranger)))],
    ['other token balance', () => dataKey(reserve, vector(symbol('Balance'), address(stranger)))],
    ['pool admin', () => dataKey(pool, symbol('Admin'))],
    ['unknown contract', () => dataKey(StrKey.encodeContract(Buffer.alloc(32, 4)), vector(symbol('Positions'), address(wallet)))],
    ['writable code', () => xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash: Buffer.from(registry.poolWasmHash, 'hex') }))],
  ] as const)('rejects %s mutation', (_name, key) => {
    const changed = footprint(); changed.setReadWrite([...changed.getReadWrite(), key()]);
    expect(() => inspectBlendSupplyFootprint(changed.build(), intent, registry, 100000n)).toThrow('footprint');
  });
  it('rejects excessive fees/resources and duplicate ledger entries', () => {
    for (const changed of [footprint().setResourceFee('100001'), footprint().setResources(20_000_001, 0, 0), footprint().setResources(100, 1_048_577, 0), footprint().setResources(100, 0, 131_073)]) {
      expect(() => inspectBlendSupplyFootprint(changed.build(), intent, registry, 100000n)).toThrow();
    }
    const changed = footprint(); changed.setReadOnly([...changed.getReadOnly(), changed.getReadWrite()[0]!]);
    expect(() => inspectBlendSupplyFootprint(changed.build(), intent, registry, 100000n)).toThrow();
  });
  it('rejects missing source-account/position/reserve/balance mutation', () => {
    for (let i = 0; i < 4; i++) { const changed = footprint(); changed.setReadWrite(changed.getReadWrite().filter((_, n) => n !== i)); expect(() => inspectBlendSupplyFootprint(changed.build(), intent, registry, 100000n)).toThrow(); }
  });
});

describe('inspected preparation and enforce simulation', () => {
  it('requires explicit Testnet and a bounded configured fee', () => {
    expect(() => new BlendSorobanPreparer({ ...config, network: 'public' })).toThrow('Testnet');
    expect(() => new BlendSorobanPreparer({ ...config, rpcUrl: 'https://soroban.stellar.org' })).toThrow('Testnet');
    expect(() => new BlendSorobanPreparer({ ...config, maxFeeStroops: '10000001' })).toThrow('Fee ceiling');
  });
  it('blocks signable output before Gate 1 while allowing a non-signable diagnostic', async () => {
    const deps = mockDependencies(); const preparer = new BlendSorobanPreparer({ ...config, gate1Passed: false }, deps);
    await expect(preparer.prepare(input())).rejects.toMatchObject({ details: { reason: 'GATE_1_SIGNING_PROOF_REQUIRED' } });
    const report = await preparer.inspectReadOnly(input()); expect(report).toMatchObject({ mode: 'read_only_simulation', signable: false, broadcast: false });
    expect(report).not.toHaveProperty('unsignedXdr');
  });
  it('prepares only an unsigned exact transaction with source auth and actual fee summary', async () => {
    const modes: unknown[] = []; const deps = mockDependencies();
    deps.server.simulateTransaction = async (...args: unknown[]) => { modes.push(args[2]); return deps.simulation; };
    const result = await new BlendSorobanPreparer(config, deps).prepare(input());
    expect(result.network).toBe(NETWORK); expect(result.summary.maxFeeStroops).toBe('10100'); expect(modes).toEqual(['record', 'enforce']);
    const tx = TransactionBuilder.fromXDR(result.unsignedXdr, NETWORK_PASSPHRASE);
    expect(tx.signatures).toHaveLength(0);
    if ('innerTransaction' in tx) throw new Error('unexpected fee bump');
    expect(tx.source).toBe(wallet);
    expect(() => inspectPreparedBlendSupplyTransaction(result, tx, registry)).not.toThrow();
    expect(() => inspectPreparedBlendSupplyTransaction({ ...result, summary: { ...result.summary, amount: '2' } }, tx, registry)).toThrow();
  });
  it('rechecks an exact offline-signed approved envelope without broadcasting', async () => {
    const preparer = new BlendSorobanPreparer(config, mockDependencies());
    const prepared = await preparer.prepare(input());
    const tx = TransactionBuilder.fromXDR(prepared.unsignedXdr, NETWORK_PASSPHRASE);
    if ('innerTransaction' in tx) throw new Error('unexpected fee bump');
    tx.sign(fixtureSigner);
    await expect(preparer.verifyForSubmission(prepared, tx.toXDR())).resolves.toBeUndefined();
    await expect(preparer.verifyForSubmission({ ...prepared, summary: { ...prepared.summary, recipient: stranger } }, tx.toXDR())).rejects.toBeDefined();
  });
  it('rejects a mismatched live registry hash and wrong RPC network', async () => {
    const wrongHash = mockDependencies();
    wrongHash.fetcher = async () => new Response(JSON.stringify({ ids: { TestnetV2: pool, XLM: reserve }, hashes: { lendingPoolV2: 'b'.repeat(64) } }));
    await expect(new BlendSorobanPreparer(config, wrongHash).prepare(input())).rejects.toMatchObject({ details: { reason: 'BLEND_LIVE_CONTRACT_OR_RESERVE_MISMATCH' } });
    const wrongNetwork = mockDependencies(); wrongNetwork.server.getNetwork = async () => ({ passphrase: 'Public Global Stellar Network ; September 2015' as typeof NETWORK_PASSPHRASE, protocolVersion: '30' });
    await expect(new BlendSorobanPreparer(config, wrongNetwork).prepare(input())).rejects.toMatchObject({ code: 'NETWORK_MISMATCH' });
  });
  it('rejects operation, recipient, asset and expiry substitutions', async () => {
    const preparer = new BlendSorobanPreparer(config, mockDependencies());
    const original = input();
    for (const changed of [
      { ...original, operationXdr: buildBlendOperation({ ...intent, amountAtomic: 2n }) },
      { ...original, summary: { ...original.summary, recipient: stranger } },
      { ...original, summary: { ...original.summary, fromAssetId: 'USDC' } },
      { ...original, summary: { ...original.summary, expiresAt: new Date(Date.now() + 300000).toISOString() } },
      { ...original, allowedContracts: [pool, reserve, StrKey.encodeContract(Buffer.alloc(32, 3))] },
    ]) await expect(preparer.prepare(changed)).rejects.toBeDefined();
  });
  it('rejects failed, restore and changed enforce simulations', async () => {
    const deps = mockDependencies();
    deps.server.simulateTransaction = async () => ({ id: 'fixture', latestLedger: 1, _parsed: true, events: [], error: 'fixture failure' }) as unknown as rpc.Api.SimulateTransactionSuccessResponse;
    await expect(new BlendSorobanPreparer(config, deps).prepare(input())).rejects.toMatchObject({ code: 'EXECUTION_UNAVAILABLE' });
    const restore = mockDependencies();
    restore.server.simulateTransaction = async () => ({ ...restore.simulation, restorePreamble: { minResourceFee: '1000', transactionData: footprint() } });
    await expect(new BlendSorobanPreparer(config, restore).prepare(input())).rejects.toMatchObject({ code: 'EXECUTION_UNAVAILABLE' });
    const changed = mockDependencies(); let calls = 0;
    changed.server.simulateTransaction = async () => ++calls === 1 ? changed.simulation : success(footprint(), auth({ amountAtomic: 2n }));
    await expect(new BlendSorobanPreparer(config, changed).prepare(input())).rejects.toMatchObject({ code: 'SOROBAN_AUTH_MISMATCH' });
  });
});
