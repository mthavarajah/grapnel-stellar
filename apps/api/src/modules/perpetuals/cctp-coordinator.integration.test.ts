import { createCctpRuntime } from './cctp-runtime.js';
import type { OperationService } from '../operations/service.js';
const recorded = vi.hoisted(() => ({ mint: new Map<string, unknown>(), deposit: new Map<string, unknown>(), core: new Map<string, unknown>(), mintReads: 0, failMintOnce: false, failCoreOnce: false }));
vi.mock('../../adapters/cctp/destination.js', async (importOriginal) => { const actual = await importOriginal<typeof import('../../adapters/cctp/destination.js')>(); return { ...actual, confirmDestinationMint: vi.fn(async (...p: Parameters<typeof actual.confirmDestinationMint>) => { recorded.mintReads++; if (recorded.failMintOnce && recorded.mintReads === 3)
        throw Error('fixture interrupted parent-proof save'); const v = recorded.mint.get(p[3]); if (!v)
        throw Error('missing offline mint fixture'); return structuredClone(v) as Awaited<ReturnType<typeof actual.confirmDestinationMint>>; }), confirmCoreDepositTransfer: vi.fn(async (...p: Parameters<typeof actual.confirmCoreDepositTransfer>) => { const v = recorded.deposit.get(p[2]); if (!v)
        throw Error('missing offline deposit fixture'); return structuredClone(v) as Awaited<ReturnType<typeof actual.confirmCoreDepositTransfer>>; }) }; });
vi.mock('../../adapters/cctp/core-proof.js', async (importOriginal) => { const actual = await importOriginal<typeof import('../../adapters/cctp/core-proof.js')>(); return { ...actual, confirmHyperCoreCredit: vi.fn(async (...p: Parameters<typeof actual.confirmHyperCoreCredit>) => { if (recorded.failCoreOnce) {
        recorded.failCoreOnce = false;
        throw Error('fixture credit not indexed yet');
    } const v = recorded.core.get(p[1].depositTxHash); if (!v)
        throw Error('missing offline credit fixture'); return structuredClone(v) as Awaited<ReturnType<typeof actual.confirmHyperCoreCredit>>; }) }; });
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg, { type Pool } from 'pg';
import { Keypair } from '@stellar/stellar-sdk';
import { encodeFunctionData, keccak256, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { transaction } from '../../db/index.js';
import { migrate } from '../../db/migrate.js';
import { CCTP_TESTNET as P } from '../../adapters/cctp/registry.js';
import { evmRecipientBytes32 } from '../../adapters/cctp/encoding.js';
import { CCTP_EVM_ABI, unsignedCctpEvmDigest, stellarPayload, type UnsignedCctpEvmAction } from '../../adapters/cctp/destination.js';
import { PgCctpFundingStore, type CctpStoreValidators } from './cctp-store.js';
import type { CctpFundingRecord, CctpStageRecord } from './cctp-contract.js';
const url = process.env.CCTP_STORE_TEST_DATABASE_URL;
const validators: CctpStoreValidators = { verifyProof: async () => { }, verifyStageResult: async (_r, s, _state, p) => {
        if (!p.fixture || p.transactionHash !== s.txHash)
            throw Error('fixture receipt mismatch');
    } };
const h = (n: number, size: number) => BigInt(n).toString(16).padStart(size * 2, '0'), raw = (s: string) => s.slice(2), hex = (): Hex => '0x' + randomUUID().replaceAll('-', '').repeat(2) as Hex;
describe.skipIf(!url)('CCTP coordinator with actual PostgreSQL store', () => {
    let admin: Pool, pool: Pool, store: PgCctpFundingStore;
    const schema = 'cctp_' + randomUUID().replaceAll('-', '');
    beforeAll(async () => {
        admin = new pg.Pool({ connectionString: url });
        if (!(await admin.query('SELECT current_database() AS name')).rows[0].name.endsWith('_test'))
            throw Error('Only disposable _test database permitted');
        await admin.query(`CREATE SCHEMA ${schema}`);
        pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema},public`, max: 8 });
        await migrate(pool);
        store = new PgCctpFundingStore(pool, validators);
    });
    afterAll(async () => {
        await pool?.end();
        if (admin) {
            await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
            await admin.end();
        }
    });
    async function fixture() {
        const stellar = Keypair.random(), account = privateKeyToAccount(generatePrivateKey()), scope = { businessId: randomUUID(), customerId: randomUUID(), walletId: randomUUID(), stellarAddress: stellar.publicKey() }, id = randomUUID(), accountId = randomUUID(), address = account.address.toLowerCase() as Hex;
        await pool.query("INSERT INTO businesses(id,name) VALUES($1,'cctp fixture')", [scope.businessId]);
        await pool.query("INSERT INTO customers(id,business_id,external_customer_id,privy_user_id) VALUES($1,$2,'fixture','did:privy:fixture')", [scope.customerId, scope.businessId]);
        await pool.query("INSERT INTO wallets(id,business_id,customer_id,privy_wallet_id,stellar_address,public_key,status) VALUES($1,$2,$3,'privy-fixture',$4,$4,'active')", [scope.walletId, scope.businessId, scope.customerId, scope.stellarAddress]);
        await pool.query("INSERT INTO perpetual_accounts(id,business_id,customer_id,wallet_id,stellar_address,account_address,signing_key_ref) VALUES($1,$2,$3,$4,$5,$6,'browser-fixture')", [accountId, scope.businessId, scope.customerId, scope.walletId, scope.stellarAddress, address]);
        const expiry = new Date(Date.now() + 90000).toISOString(), source = { operationId: id, customerId: scope.customerId, network: 'stellar-testnet' as const, walletAddress: scope.stellarAddress, unsignedXdr: 'source-inspected-by-existing-operations-service', signingHashHex: 'a'.repeat(64), summary: { action: 'perps.fund_cctp', recipient: address, fromAssetId: `stellar-testnet:classic:USDC:${P.stellar.issuer}`, contractId: P.stellar.messenger, amount: '1', expiresAt: expiry }, authorization: { method: 'privy_stellar' as const, expiresAt: expiry } };
        const record: CctpFundingRecord = { id, scope, accountId, accountAddress: address, amountAtomic7: '10000000', state: 'awaiting_source', source, sourceTxHash: null, sourceProof: null, messageHex: null, attestationHex: null, mintProof: null, depositProof: null, coreProof: null, createdAt: new Date().toISOString() };
        await pool.query("INSERT INTO operations(id,business_id,customer_id,wallet_id,module_code,type,state,request_json,prepared_action,provider) VALUES($1,$2,$3,$4,'trade.perps','perps.fund_cctp','awaiting_customer_authorization','{}',$5,'cctp')", [id, scope.businessId, scope.customerId, scope.walletId, JSON.stringify(source)]);
        await transaction(pool, c => store.create(c, record));
        return { record, scope, account };
    }
    type F = Awaited<ReturnType<typeof fixture>>;
    function message(f: F): Hex { return `0x${h(1, 4)}${h(27, 4)}${h(19, 4)}${'d'.repeat(64)}${raw(stellarPayload(P.stellar.messenger, true))}${raw(evmRecipientBytes32(P.hyperEvm.messenger))}${'0'.repeat(64)}${h(2000, 4)}${h(2000, 4)}${h(1, 4)}${raw(stellarPayload(P.stellar.usdc, true))}${raw(evmRecipientBytes32(f.record.accountAddress))}${h(1000000, 32)}${raw(stellarPayload(f.scope.stellarAddress))}${h(0, 32)}${h(0, 32)}${h(0, 32)}`; }
    async function source(f: F) { const sourceTxHash = randomUUID().replaceAll('-', '').repeat(2), m = message(f); await pool.query("UPDATE operations SET tx_hash=$2,state='completed' WHERE id=$1", [f.record.id, sourceTxHash]); await store.saveProof(f.scope, f.record.id, { sourceTxHash, sourceProof: { operationId: f.record.id, businessId: f.scope.businessId, customerId: f.scope.customerId, walletId: f.scope.walletId, walletAddress: f.scope.stellarAddress, evmAccount: f.record.accountAddress, amountStellarAtomic: '10000000', sourceTxHash, sourceLedger: 100, sourceMessageHex: m, confirmed: true, network: 'stellar-testnet' }, messageHex: m, attestationHex: ('0x' + 'e'.repeat(130)) as Hex, state: 'destination_pending' }); return (await store.get(f.scope, f.record.id))!; }
    function action(f: F, r: CctpFundingRecord, step: 'cctp.receive' | 'core.approve' | 'core.deposit', nonce = 0): UnsignedCctpEvmAction { const data = step === 'cctp.receive' ? encodeFunctionData({ abi: CCTP_EVM_ABI, functionName: 'receiveMessage', args: [r.messageHex!, r.attestationHex!] }) : step === 'core.approve' ? encodeFunctionData({ abi: CCTP_EVM_ABI, functionName: 'approve', args: [P.hyperEvm.coreDepositWallet, 1000000n] }) : encodeFunctionData({ abi: CCTP_EVM_ABI, functionName: 'deposit', args: [1000000n, 0] }); const t = { chainId: 998 as const, type: 'eip1559' as const, from: r.accountAddress, to: (step === 'cctp.receive' ? P.hyperEvm.transmitter : step === 'core.approve' ? P.hyperEvm.usdc : P.hyperEvm.coreDepositWallet).toLowerCase() as Hex, data, value: '0' as const, nonce: String(nonce), gas: '120000', maxFeePerGas: '1000000000', maxPriorityFeePerGas: '0' }; return { operationId: r.id, businessId: f.scope.businessId, customerId: f.scope.customerId, walletId: f.scope.walletId, stellarWallet: f.scope.stellarAddress, evmAccount: r.accountAddress, network: 'hyperevm-testnet', expiresAt: new Date(Date.now() + 90000).toISOString(), step, amountCctpAtomic: '1000000', sourceTxHash: r.sourceTxHash, messageHash: r.messageHex ? keccak256(r.messageHex) : null, expiryEnforcement: 'application_only', transaction: t, signingHash: unsignedCctpEvmDigest(t) }; }
    async function rawSigned(f: F, a: UnsignedCctpEvmAction, patch: Record<string, unknown> = {}) { const t = a.transaction; return f.account.signTransaction({ chainId: 998, type: 'eip1559', to: t.to, data: t.data, value: 0n, nonce: Number(t.nonce), gas: BigInt(t.gas), maxFeePerGas: BigInt(t.maxFeePerGas), maxPriorityFeePerGas: BigInt(t.maxPriorityFeePerGas), ...patch }); }
    async function confirmed(f: F, r: CctpFundingRecord, step: 'cctp.receive' | 'core.approve' | 'core.deposit', nonce = 0) { const a = action(f, r, step, nonce), baseline = step === 'core.deposit' ? { accountAddress: r.accountAddress, rawUsdAtomic6: '0', observedAt: new Date().toISOString() } : undefined; let stage = await store.prepareStage(f.scope, r.id, a, baseline); stage = await store.signStage(f.scope, r.id, stage.id, await rawSigned(f, a)); expect(await store.claimSend(f.scope, r.id, stage.id)).toBe(true); await store.stageResult(f.scope, r.id, stage.id, 'confirmed', { fixture: true, transactionHash: stage.txHash }); return stage; }
    async function minted(f: F) { const r = await source(f), stage = await confirmed(f, r, 'cctp.receive'); await store.saveProof(f.scope, r.id, { mintProof: { network: 'hyperevm-testnet', chainId: 998, operationId: r.id, businessId: f.scope.businessId, customerId: f.scope.customerId, walletId: f.scope.walletId, evmAccount: r.accountAddress, sourceTxHash: r.sourceTxHash!, destinationTxHash: stage.txHash!, messageHash: keccak256(r.messageHex!), nonce: ('0x' + 'd'.repeat(64)) as Hex, blockNumber: '100', blockHash: hex(), amountCctpAtomic: '1000000', balanceBeforeAtomic: '0', balanceAfterAtomic: '1000000', confirmed: true }, state: 'core_pending' }); return (await store.get(f.scope, r.id))!; }
    it('reconciles real store constraints, retries confirmed receipt after interruption and waits for separate Core credit', async () => {
        // Explicit offline RPC proof fixtures; this is persistence integration, never onchain acceptance evidence.
        const f = await fixture(), r = await source(f), receive = action(f, r, 'cctp.receive');
        let stage = await store.prepareStage(f.scope, r.id, receive);
        stage = await store.signStage(f.scope, r.id, stage.id, await rawSigned(f, receive));
        await store.claimSend(f.scope, r.id, stage.id);
        await store.stageResult(f.scope, r.id, stage.id, 'unknown', null);
        const mint = { network: 'hyperevm-testnet' as const, chainId: 998 as const, operationId: r.id, businessId: f.scope.businessId, customerId: f.scope.customerId, walletId: f.scope.walletId, evmAccount: r.accountAddress, sourceTxHash: r.sourceTxHash!, destinationTxHash: stage.txHash!, messageHash: keccak256(r.messageHex!), nonce: ('0x' + 'd'.repeat(64)) as Hex, blockNumber: '100', blockHash: hex(), amountCctpAtomic: '1000000', balanceBeforeAtomic: '0', balanceAfterAtomic: '1000000', confirmed: true as const };
        recorded.mint.set(stage.txHash!, mint);
        recorded.mintReads = 0;
        recorded.failMintOnce = true;
        const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => { const body = JSON.parse(String(init?.body)); if (body.method !== 'eth_getTransactionReceipt')
            throw Error('Unexpected offline RPC ' + body.method); return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { status: '0x1' } })); });
        vi.stubGlobal('fetch', fetcher);
        try {
            const operations = { pool, get: async () => ({ tx_hash: r.sourceTxHash }) } as unknown as OperationService;
            const runtime = createCctpRuntime({ pool, operations, chain: { server: {} } as never, setup: {} as never, verifyGate1: async () => true, accessApproved: async () => true });
            await runtime.coordinator.get(f.scope, r.id);
            expect((await store.stages(f.scope, r.id))[0]?.state).toBe('confirmed');
            expect((await store.get(f.scope, r.id))?.mintProof).toBeNull();
            await runtime.coordinator.get(f.scope, r.id);
            let current = (await store.get(f.scope, r.id))!;
            expect(current.mintProof).toEqual(mint);
            expect(current.state).toBe('core_pending');
            await confirmed(f, current, 'core.approve', 1);
            const a = action(f, current, 'core.deposit', 2);
            let depositStage = await store.prepareStage(f.scope, r.id, a, { accountAddress: r.accountAddress, rawUsdAtomic6: '0', observedAt: new Date().toISOString() });
            depositStage = await store.signStage(f.scope, r.id, depositStage.id, await rawSigned(f, a));
            await store.claimSend(f.scope, r.id, depositStage.id);
            await store.stageResult(f.scope, r.id, depositStage.id, 'unknown', null);
            const deposit = { network: 'hyperevm-testnet' as const, chainId: 998 as const, operationId: r.id, businessId: f.scope.businessId, customerId: f.scope.customerId, walletId: f.scope.walletId, evmAccount: r.accountAddress, sourceTxHash: r.sourceTxHash!, mintTxHash: mint.destinationTxHash, depositTxHash: depositStage.txHash!, blockNumber: '102', blockHash: hex(), amountCctpAtomic: '1000000', balanceBeforeAtomic: '1000000', balanceAfterAtomic: '0', evmDepositConfirmed: true as const, hyperCoreCreditConfirmed: false as const, execution_status: 'blocked' as const, reason: 'CCTP_MATCHING_HYPERCORE_LEDGER_CREDIT_REQUIRED' as const };
            recorded.deposit.set(depositStage.txHash!, deposit);
            const credit = { network: 'hyperliquid-testnet' as const, operationId: r.id, businessId: f.scope.businessId, customerId: f.scope.customerId, walletId: f.scope.walletId, accountAddress: r.accountAddress, depositTxHash: depositStage.txHash!, amountAtomic6: '1000000', ledgerHash: hex(), balanceBeforeAtomic6: '0', balanceAfterAtomic6: '1000000', confirmed: true as const };
            recorded.core.set(depositStage.txHash!, credit);
            recorded.failCoreOnce = true;
            await runtime.coordinator.get(f.scope, r.id);
            current = (await store.get(f.scope, r.id))!;
            expect(current.depositProof).toEqual(deposit);
            expect(current.coreProof).toBeNull();
            expect(current.state).toBe('core_pending');
            expect((await store.stages(f.scope, r.id)).find(x => x.step === 'core.deposit')?.state).toBe('confirmed');
            const completed = await runtime.coordinator.get(f.scope, r.id);
            expect(completed?.state).toBe('completed');
            expect((await store.get(f.scope, r.id))?.coreProof).toEqual(credit);
            expect(fetcher.mock.calls.length).toBe(4);
            expect(await store.pending(f.scope)).toBeNull();
        }
        finally {
            vi.unstubAllGlobals();
        }
    }, 15000);
});
