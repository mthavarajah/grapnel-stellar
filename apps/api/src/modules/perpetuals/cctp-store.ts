import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { StrKey } from '@stellar/stellar-sdk';
import { GrapnelError, PreparedActionSchema, toAtomic } from '@grapnel/contracts';
import { decodeFunctionData, encodeFunctionData, keccak256, parseTransaction, recoverTransactionAddress, type TransactionSerialized, type Hex } from 'viem';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { transaction, lock } from '../../db/index.js';
import { CCTP_TESTNET as P } from '../../adapters/cctp/registry.js';
import { CCTP_EVM_ABI, decodeCctpV2Message, inspectAttestationAgainstSource, inspectStellarToEvmMessage, inspectUnsignedCctpEvmAction, assertSourceBurn, type CctpEvmRequest, type UnsignedCctpEvmAction } from '../../adapters/cctp/destination.js';
import type { PerpetualScope } from './workflow-contract.js';
import type { CctpFundingStore, CctpFundingRecord, CctpStageRecord } from './cctp-contract.js';
export interface CctpStoreValidators {
    /** Mandatory trusted RPC/event readers; never browser proof flags. */
    verifyProof(record: CctpFundingRecord, patch: Parameters<CctpFundingStore['saveProof']>[2]): Promise<void>;
    verifyStageResult(record: CctpFundingRecord, stage: CctpStageRecord, state: 'confirmed' | 'reverted', proof: Record<string, unknown>): Promise<void>;
}
const uuid = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), hexHash = z.string().regex(/^0x[a-f0-9]{64}$/), evm = z.string().regex(/^0x[0-9a-f]{40}$/), bytes = z.string().regex(/^0x(?:[a-f0-9]{2})+$/);
const scopeSchema = z.object({ businessId: uuid, customerId: uuid, walletId: uuid, stellarAddress: z.string().refine(StrKey.isValidEd25519PublicKey) }).strict();
const args = (s: PerpetualScope) => [s.businessId, s.customerId, s.walletId, s.stellarAddress];
const scoped = (a: string) => `${a}.business_id=$1 AND ${a}.customer_id=$2 AND ${a}.wallet_id=$3 AND ${a}.stellar_address=$4`;
const joins = (a: string) => `JOIN wallets w ON w.business_id=${a}.business_id AND w.customer_id=${a}.customer_id AND w.id=${a}.wallet_id AND w.stellar_address=${a}.stellar_address AND w.network='stellar-testnet' AND w.status='active' JOIN perpetual_accounts a ON a.id=${a}.account_id AND a.business_id=${a}.business_id AND a.customer_id=${a}.customer_id AND a.wallet_id=${a}.wallet_id AND a.stellar_address=${a}.stellar_address AND a.account_address=${a}.account_address`;
const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
const equal = (a: unknown, b: unknown) => stable(a) === stable(b);
const fail = (code: string, message: string): never => { throw new GrapnelError(409, code, message); };
function copy<T>(v: T): T { const encoded = stable(v); if (encoded.length > 262144 || /"(?:privateKey|secret|seed|mnemonic|accessToken)":/i.test(encoded))
    fail('CCTP_RECORD_INVALID', 'Oversized or secret-bearing workflow record'); return structuredClone(v); }
function amount(v: string) { if (!/^[1-9]\d{0,10}$/.test(v) || BigInt(v) > 10000000000n || BigInt(v) % 10n)
    fail('CCTP_AMOUNT_INVALID', 'Exact bounded Circle USDC amount required'); return BigInt(v); }
function stageRow(r: QueryResultRow): CctpStageRecord { return { id: r.id, fundingId: r.funding_id, step: r.step, action: r.action, baseline: r.baseline, signedTransaction: r.signed_transaction, txHash: r.tx_hash, state: r.state, proof: r.proof }; }
/** No signing, broadcasting or synthetic credits. Validators must independently read actual chain evidence. */
export class PgCctpFundingStore implements CctpFundingStore {
    constructor(private pool: Pool, private validators: Partial<CctpStoreValidators> = {}) { }
    private async write<T>(fn: (c: PoolClient) => Promise<T>) { try {
        return await transaction(this.pool, fn);
    }
    catch (e) {
        if ((e as {
            code?: string;
        }).code === '23505')
            fail('CCTP_UNIQUENESS_CONFLICT', 'Funding, transaction or account nonce already reserved');
        throw e;
    } }
    private async record(c: PoolClient, s: PerpetualScope, id: string, locked = true) { scopeSchema.parse(s); uuid.parse(id); const row = (await c.query(`SELECT f.* FROM cctp_customer_funding f ${joins('f')} WHERE ${scoped('f')} AND f.id=$5 ${locked ? 'FOR UPDATE OF f' : ''}`, [...args(s), id])).rows[0]; if (!row)
        fail('NOT_FOUND', 'Customer funding not found'); const r = row.record as CctpFundingRecord; if (!equal(r.scope, s) || r.id !== id || r.accountId !== row.account_id || r.accountAddress !== row.account_address || r.amountAtomic7 !== String(row.amount_atomic7) || r.state !== row.state)
        fail('CCTP_RECORD_INVALID', 'Stored funding scope is inconsistent'); return r; }
    private request(r: CctpFundingRecord, action?: UnsignedCctpEvmAction): CctpEvmRequest { return { operationId: r.id, customer: { businessId: r.scope.businessId, customerId: r.scope.customerId, walletId: r.scope.walletId, walletAddress: r.scope.stellarAddress, privyUserId: 'trusted-persisted-customer' }, evmAccount: r.accountAddress, amountCctpAtomic: (amount(r.amountAtomic7) / 10n).toString(), expiresAt: action?.expiresAt ?? new Date(Date.now() + 60000).toISOString(), maxGas: '3000000', maxFeePerGasWei: '1000000000000', maxPriorityFeePerGasWei: action?.transaction.maxFeePerGas ?? '1000000000000', maxTotalFeeWei: '1000000000000000000' }; }
    private async verified<K extends keyof CctpStoreValidators>(key: K, ...values: Parameters<CctpStoreValidators[K]>) { const fn = this.validators[key]; if (!fn)
        fail('CCTP_PROOF_READER_REQUIRED', 'Trusted chain proof reader is required'); await (fn as (...v: unknown[]) => Promise<void>)(...values); }
    async create(c: PoolClient, input: CctpFundingRecord) {
        const r = copy(input), s = scopeSchema.parse(r.scope);
        uuid.parse(r.id);
        uuid.parse(r.accountId);
        evm.parse(r.accountAddress);
        amount(r.amountAtomic7);
        const source = PreparedActionSchema.parse(r.source);
        if (r.state !== 'awaiting_source' || r.sourceTxHash !== null || r.sourceProof !== null || r.messageHex !== null || r.attestationHex !== null || r.mintProof !== null || r.depositProof !== null || r.coreProof !== null || source.operationId !== r.id || source.customerId !== s.customerId || source.walletAddress !== s.stellarAddress || source.summary.action !== 'perps.fund_cctp' || source.summary.recipient !== r.accountAddress || source.summary.fromAssetId !== `stellar-testnet:classic:USDC:${P.stellar.issuer}` || source.summary.contractId !== P.stellar.messenger || toAtomic(source.summary.amount ?? '', 7) !== amount(r.amountAtomic7))
            fail('CCTP_RECORD_INVALID', 'Initial source action must match the exact Circle USDC burn');
        const op = (await c.query(`SELECT o.* FROM operations o JOIN wallets w ON w.id=o.wallet_id AND w.business_id=o.business_id AND w.customer_id=o.customer_id JOIN perpetual_accounts a ON a.business_id=o.business_id AND a.customer_id=o.customer_id AND a.wallet_id=o.wallet_id WHERE o.id=$5 AND o.business_id=$1 AND o.customer_id=$2 AND o.wallet_id=$3 AND w.stellar_address=$4 AND a.stellar_address=$4 AND w.network='stellar-testnet' AND w.status='active' AND a.id=$6 AND a.account_address=$7 AND o.network='stellar-testnet' AND o.module_code='trade.perps' FOR UPDATE OF o`, [...args(s), r.id, r.accountId, r.accountAddress])).rows[0];
        if (!op || !op.prepared_action || !equal(op.prepared_action, source))
            fail('CCTP_SOURCE_OPERATION_REQUIRED', 'Exact bound source operation required');
        const old = (await c.query('SELECT record FROM cctp_customer_funding WHERE id=$1', [r.id])).rows[0];
        if (old) {
            if (!equal(old.record, r))
                fail('CCTP_RECORD_IMMUTABLE', 'Funding record cannot be replaced');
            return;
        }
        await c.query('INSERT INTO cctp_customer_funding(id,business_id,customer_id,wallet_id,stellar_address,account_id,account_address,amount_atomic7,state,record) VALUES($5,$1,$2,$3,$4,$6,$7,$8,$9,$10)', [...args(s), r.id, r.accountId, r.accountAddress, r.amountAtomic7, r.state, JSON.stringify(r)]);
    }
    async get(s: PerpetualScope, id: string) { scopeSchema.parse(s); uuid.parse(id); const row = (await this.pool.query(`SELECT f.id FROM cctp_customer_funding f ${joins('f')} WHERE ${scoped('f')} AND f.id=$5`, [...args(s), id])).rows[0]; return row ? this.write(c => this.record(c, s, id, false)) : null; }
    async pending(s: PerpetualScope) { scopeSchema.parse(s); const row = (await this.pool.query(`SELECT f.id FROM cctp_customer_funding f ${joins('f')} WHERE ${scoped('f')} AND f.state<>'completed' ORDER BY f.created_at DESC LIMIT 1`, args(s))).rows[0]; return row ? this.write(c => this.record(c, s, row.id, false)) : null; }
    private validateProof(r: CctpFundingRecord) { const request = this.request(r); if (r.sourceTxHash)
        hash.parse(r.sourceTxHash); if (r.sourceProof) {
        if (!r.sourceTxHash)
            fail('CCTP_SOURCE_PROOF_REQUIRED', 'Source hash required');
        assertSourceBurn(r.sourceProof, request, r.sourceTxHash!);
    } if (r.messageHex || r.attestationHex) {
        if (!r.sourceProof || !r.messageHex || !r.attestationHex)
            fail('CCTP_SOURCE_PROOF_REQUIRED', 'Source burn and full attestation required');
        if (!/^0x(?:[a-f0-9]{130}){1,20}$/.test(r.attestationHex!))
            fail('CCTP_ATTESTATION_INVALID', 'Malformed attestation');
        const m = decodeCctpV2Message(r.messageHex!);
        inspectStellarToEvmMessage(m, request);
        inspectAttestationAgainstSource(m, r.sourceProof!.sourceMessageHex);
    } if (r.mintProof) {
        const p = r.mintProof;
        if (!r.messageHex || p.network !== 'hyperevm-testnet' || p.chainId !== 998 || p.confirmed !== true || p.operationId !== r.id || p.businessId !== r.scope.businessId || p.customerId !== r.scope.customerId || p.walletId !== r.scope.walletId || p.evmAccount !== r.accountAddress || p.sourceTxHash !== r.sourceTxHash || p.messageHash !== keccak256(r.messageHex) || p.amountCctpAtomic !== request.amountCctpAtomic || BigInt(p.balanceAfterAtomic) - BigInt(p.balanceBeforeAtomic) < BigInt(request.amountCctpAtomic))
            fail('CCTP_MINT_PROOF_INVALID', 'Exact destination mint evidence required');
        hexHash.parse(p.destinationTxHash);
        hexHash.parse(p.blockHash);
    } if (r.depositProof) {
        const p = r.depositProof;
        if (!r.mintProof || p.network !== 'hyperevm-testnet' || p.chainId !== 998 || p.operationId !== r.id || p.businessId !== r.scope.businessId || p.customerId !== r.scope.customerId || p.walletId !== r.scope.walletId || p.evmAccount !== r.accountAddress || p.sourceTxHash !== r.sourceTxHash || p.mintTxHash !== r.mintProof.destinationTxHash || p.amountCctpAtomic !== request.amountCctpAtomic || p.evmDepositConfirmed !== true || p.hyperCoreCreditConfirmed !== false || BigInt(p.balanceBeforeAtomic) - BigInt(p.balanceAfterAtomic) !== BigInt(request.amountCctpAtomic))
            fail('CCTP_DEPOSIT_PROOF_INVALID', 'Exact custody transfer evidence required');
        hexHash.parse(p.depositTxHash);
        hexHash.parse(p.blockHash);
    } if (r.coreProof) {
        const p = r.coreProof;
        if (!r.depositProof || p.network !== 'hyperliquid-testnet' || p.operationId !== r.id || p.businessId !== r.scope.businessId || p.customerId !== r.scope.customerId || p.walletId !== r.scope.walletId || p.accountAddress !== r.accountAddress || p.depositTxHash !== r.depositProof.depositTxHash || p.amountAtomic6 !== request.amountCctpAtomic || p.confirmed !== true || !/^\d{1,40}$/.test(p.balanceBeforeAtomic6) || !/^\d{1,40}$/.test(p.balanceAfterAtomic6) || BigInt(p.balanceAfterAtomic6) - BigInt(p.balanceBeforeAtomic6) !== BigInt(request.amountCctpAtomic))
            fail('CCTP_CORE_PROOF_REQUIRED', 'Exact real HyperCore cash credit required');
        hexHash.parse(p.ledgerHash);
    } if (r.state === 'completed' && (!r.sourceProof || !r.mintProof || !r.depositProof || !r.coreProof))
        fail('CCTP_CORE_PROOF_REQUIRED', 'Actual HyperCore credit proof required for completion'); }
    async saveProof(s: PerpetualScope, id: string, input: Parameters<CctpFundingStore['saveProof']>[2]) { const patch = copy(input); z.object({ state: z.enum(['awaiting_source', 'source_pending', 'attesting', 'destination_pending', 'core_pending', 'completed', 'recovery_required']).optional(), sourceTxHash: hash.nullable().optional(), sourceProof: z.unknown().optional(), messageHex: bytes.nullable().optional(), attestationHex: bytes.nullable().optional(), mintProof: z.unknown().optional(), depositProof: z.unknown().optional(), coreProof: z.unknown().optional() }).strict().parse(patch); await this.write(async (c) => { const r = await this.record(c, s, id); for (const [k, v] of Object.entries(patch)) {
        const old = r[k as keyof CctpFundingRecord];
        if (k !== 'state' && old !== null && !equal(old, v))
            fail('CCTP_PROOF_IMMUTABLE', 'Confirmed evidence cannot be replaced');
    } const next = { ...r, ...patch }; const ranks = { awaiting_source: 0, source_pending: 1, attesting: 2, destination_pending: 3, core_pending: 4, completed: 5, recovery_required: 6 }; if (next.state !== 'recovery_required' && r.state !== 'recovery_required' && ranks[next.state] < ranks[r.state])
        fail('CCTP_STATE_INVALID', 'Confirmed workflow stages cannot be rewound'); if (next.state === 'attesting' && !next.sourceProof || next.state === 'destination_pending' && (!next.sourceProof || !next.messageHex || !next.attestationHex) || next.state === 'core_pending' && !next.mintProof)
        fail('CCTP_STAGE_PROOF_REQUIRED', 'Stage requires its actual prerequisite evidence'); if (r.state === 'completed' && !equal(r, next))
        fail('CCTP_PROOF_IMMUTABLE', 'Completed funding cannot be changed'); this.validateProof(next); if (equal(r, next))
        return; if (next.sourceProof) {
        const op = (await c.query('SELECT tx_hash FROM operations WHERE id=$1 AND business_id=$2 AND customer_id=$3 AND wallet_id=$4', [id, s.businessId, s.customerId, s.walletId])).rows[0];
        if (op?.tx_hash !== next.sourceTxHash)
            fail('CCTP_SOURCE_PROOF_REQUIRED', 'Burn evidence must match the exact signed source operation');
    } if (next.mintProof) {
        const st = (await c.query("SELECT tx_hash FROM cctp_customer_stages WHERE funding_id=$1 AND step='cctp.receive' AND state='confirmed'", [id])).rows[0];
        if (st?.tx_hash !== next.mintProof.destinationTxHash)
            fail('CCTP_MINT_PROOF_REQUIRED', 'Mint must match the confirmed receive stage');
    } if (next.depositProof) {
        const st = (await c.query("SELECT tx_hash,baseline FROM cctp_customer_stages WHERE funding_id=$1 AND step='core.deposit' AND state='confirmed'", [id])).rows[0];
        if (st?.tx_hash !== next.depositProof.depositTxHash || next.coreProof && st.baseline?.rawUsdAtomic6 !== next.coreProof.balanceBeforeAtomic6)
            fail('CCTP_DEPOSIT_PROOF_INVALID', 'Deposit and collateral baseline must match the confirmed stage');
    } for (const [field, value] of [['sourceTxHash', next.sourceTxHash], ['coreLedgerHash', next.coreProof?.ledgerHash]] as const) {
        if (!value)
            continue;
        await lock(c, `cctp-evidence:${field}:${value}`);
        const found = await c.query(`SELECT id FROM cctp_customer_funding WHERE id<>$1 AND ${field === 'sourceTxHash' ? "record->>'sourceTxHash'" : "record->'coreProof'->>'ledgerHash'"}=$2 LIMIT 1`, [id, value]);
        if (found.rowCount)
            fail('CCTP_UNIQUENESS_CONFLICT', 'Chain evidence already belongs to another funding request');
    } await this.verified('verifyProof', r, patch); await c.query('UPDATE cctp_customer_funding SET record=$6,state=$7,updated_at=now() WHERE business_id=$1 AND customer_id=$2 AND wallet_id=$3 AND stellar_address=$4 AND id=$5', [...args(s), id, JSON.stringify(next), next.state]); }); }
    async stages(s: PerpetualScope, id: string) { return this.write(async (c) => { await this.record(c, s, id); return (await c.query('SELECT * FROM cctp_customer_stages WHERE business_id=$1 AND customer_id=$2 AND wallet_id=$3 AND funding_id=$4 ORDER BY created_at', [s.businessId, s.customerId, s.walletId, id])).rows.map(stageRow); }); }
    private async stage(c: PoolClient, s: PerpetualScope, id: string, stageId: string) { uuid.parse(stageId); const row = (await c.query('SELECT * FROM cctp_customer_stages WHERE business_id=$1 AND customer_id=$2 AND wallet_id=$3 AND funding_id=$4 AND id=$5 FOR UPDATE', [s.businessId, s.customerId, s.walletId, id, stageId])).rows[0]; if (!row)
        fail('NOT_FOUND', 'Customer funding stage not found'); return row; }
    private async prerequisites(c: PoolClient, r: CctpFundingRecord, a: UnsignedCctpEvmAction) { this.validateProof(r); const request = this.request(r, a); let to: Hex, data: Hex; if (a.step === 'cctp.receive') {
        if (!r.sourceProof || !r.messageHex || !r.attestationHex)
            fail('CCTP_SOURCE_PROOF_REQUIRED', 'Source confirmation and attestation required');
        to = P.hyperEvm.transmitter.toLowerCase() as Hex;
        data = encodeFunctionData({ abi: CCTP_EVM_ABI, functionName: 'receiveMessage', args: [r.messageHex!, r.attestationHex!] });
    }
    else if (a.step === 'core.approve') {
        if (!r.mintProof)
            fail('CCTP_MINT_PROOF_REQUIRED', 'Actual destination mint required');
        to = P.hyperEvm.usdc.toLowerCase() as Hex;
        data = encodeFunctionData({ abi: CCTP_EVM_ABI, functionName: 'approve', args: [P.hyperEvm.coreDepositWallet, BigInt(request.amountCctpAtomic)] });
    }
    else if (a.step === 'core.deposit') {
        if (!r.mintProof || (await c.query("SELECT id FROM cctp_customer_stages WHERE funding_id=$1 AND step='core.approve' AND state='confirmed' AND proof IS NOT NULL", [r.id])).rowCount !== 1)
            fail('CCTP_APPROVAL_PROOF_REQUIRED', 'Confirmed exact approval required');
        to = P.hyperEvm.coreDepositWallet.toLowerCase() as Hex;
        data = encodeFunctionData({ abi: CCTP_EVM_ABI, functionName: 'deposit', args: [BigInt(request.amountCctpAtomic), 0] });
    }
    else
        return fail('CCTP_STAGE_INVALID', 'Unsupported funding stage'); inspectUnsignedCctpEvmAction(a, { request, step: a.step, to, data, sourceTxHash: r.sourceTxHash ?? undefined, messageHash: r.messageHex ? keccak256(r.messageHex) : undefined, expectedNonce: a.transaction.nonce }); }
    async prepareStage(s: PerpetualScope, id: string, input: UnsignedCctpEvmAction, baseline?: Record<string, unknown>) { const action = copy(input), before = baseline ? copy(baseline) : null; return this.write(async (c) => { const r = await this.record(c, s, id); const old = (await c.query('SELECT * FROM cctp_customer_stages WHERE funding_id=$1 AND step=$2', [id, action.step])).rows[0]; if (old) {
        if (!equal(old.action, action) || !equal(old.baseline, before))
            fail('CCTP_STAGE_IMMUTABLE', 'Uncertain stage cannot be replaced');
        return stageRow(old);
    } await this.prerequisites(c, r, action); if (action.step === 'core.deposit') {
        if (!before || before.accountAddress !== r.accountAddress || typeof before.rawUsdAtomic6 !== 'string' || !/^\d{1,40}$/.test(before.rawUsdAtomic6) || typeof before.observedAt !== 'string' || !Number.isFinite(Date.parse(before.observedAt)) || Date.parse(before.observedAt) > Date.now() + 1000 || Date.now() - Date.parse(before.observedAt) > 15000)
            fail('CCTP_BASELINE_REQUIRED', 'Current exact HyperCore cash observation required');
    }
    else if (before)
        fail('CCTP_BASELINE_INVALID', 'Only core deposits have a collateral baseline'); const row = (await c.query("INSERT INTO cctp_customer_stages(id,funding_id,business_id,customer_id,wallet_id,account_address,nonce,step,action,baseline,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'prepared') RETURNING *", [randomUUID(), id, s.businessId, s.customerId, s.walletId, r.accountAddress, action.transaction.nonce, action.step, JSON.stringify(action), before ? JSON.stringify(before) : null])).rows[0]; return stageRow(row); }); }
    private async inspectSigned(a: UnsignedCctpEvmAction, signed: Hex) { bytes.parse(signed); const tx = parseTransaction(signed as TransactionSerialized), t = a.transaction, signer = (await recoverTransactionAddress({ serializedTransaction: signed as TransactionSerialized })).toLowerCase(); if (tx.type !== 'eip1559' || tx.chainId !== 998 || signer !== a.evmAccount || tx.to?.toLowerCase() !== t.to || tx.data !== t.data || (tx.value ?? 0n) !== 0n || String(tx.nonce) !== t.nonce || tx.gas !== BigInt(t.gas) || tx.maxFeePerGas !== BigInt(t.maxFeePerGas) || (tx.maxPriorityFeePerGas ?? 0n) !== BigInt(t.maxPriorityFeePerGas) || tx.accessList && tx.accessList.length)
        fail('CCTP_SIGNATURE_MISMATCH', 'Signed EIP1559 body or signer differs from the exact approved transaction'); return keccak256(signed); }
    async signStage(s: PerpetualScope, id: string, stageId: string, signed: Hex) { return this.write(async (c) => { const r = await this.record(c, s, id), row = await this.stage(c, s, id, stageId), a = row.action as UnsignedCctpEvmAction, txHash = await this.inspectSigned(a, signed); if (row.signed_transaction) {
        if (row.signed_transaction !== signed || row.tx_hash !== txHash)
            fail('CCTP_SIGNATURE_IMMUTABLE', 'A signed transaction cannot be replaced');
        return stageRow(row);
    } if (row.state !== 'prepared')
        fail('CCTP_STATE_INVALID', 'Stage cannot be signed'); await this.prerequisites(c, r, a); return stageRow((await c.query("UPDATE cctp_customer_stages SET signed_transaction=$2,tx_hash=$3,state='signed',updated_at=now() WHERE id=$1 RETURNING *", [stageId, signed, txHash])).rows[0]); }); }
    async claimSend(s: PerpetualScope, id: string, stageId: string) { return this.write(async (c) => { const r = await this.record(c, s, id), row = await this.stage(c, s, id, stageId); if (row.send_claimed_at)
        return false; if (row.state !== 'signed' || !row.signed_transaction || !row.tx_hash)
        fail('CCTP_SIGNATURE_REQUIRED', 'Persist exact signed transaction before send'); await this.prerequisites(c, r, row.action); if (await this.inspectSigned(row.action, row.signed_transaction) !== row.tx_hash)
        fail('CCTP_SIGNATURE_MISMATCH', 'Stored transaction hash mismatch'); await c.query("UPDATE cctp_customer_stages SET send_claimed_at=now(),state='sending',updated_at=now() WHERE id=$1", [stageId]); return true; }); }
    async stageResult(s: PerpetualScope, id: string, stageId: string, state: 'unknown' | 'confirmed' | 'reverted', input: Record<string, unknown> | null) { z.enum(['unknown', 'confirmed', 'reverted']).parse(state); const proof = copy(input); await this.write(async (c) => { const r = await this.record(c, s, id), row = await this.stage(c, s, id, stageId); if (['confirmed', 'reverted'].includes(row.state)) {
        if (state === 'unknown' || row.state === state && equal(row.proof, proof))
            return;
        fail('CCTP_PROOF_IMMUTABLE', 'Terminal transaction evidence cannot be changed');
    } if (!row.send_claimed_at)
        fail('CCTP_SEND_CLAIM_REQUIRED', 'Outcome requires recorded send claim'); if (state !== 'unknown') {
        if (!proof)
            fail('CCTP_RECEIPT_PROOF_REQUIRED', 'Actual confirmed receipt required');
        await this.verified('verifyStageResult', r, stageRow(row), state, proof!);
    } await c.query('UPDATE cctp_customer_stages SET state=$2,proof=$3,updated_at=now() WHERE id=$1', [stageId, state, JSON.stringify(proof)]); }); }
}
