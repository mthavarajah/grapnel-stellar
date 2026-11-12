/** Testnet-only unsigned preparation and actual chain reconciliation. Never signs or sends. */
import { GrapnelError } from '@grapnel/contracts';
import { z } from 'zod';
import { decodeEventLog, decodeFunctionData, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, parseTransaction, recoverTransactionAddress, serializeTransaction, zeroAddress, zeroHash, type Abi, type Hex, type TransactionSerialized } from 'viem';
import { GMX_TESTNET as P } from './registry.js';
import { EXCHANGE_ABI, READER_ABI, EVENT_ABI } from './abi.js';
import type { GmxReadTransport, GmxPosition, GmxStatus, GmxBaseIntent, GmxTokenIntent, GmxTradeIntent, GmxOpenIntent, GmxPrepared, GmxCreationProof, GmxTokenProof, GmxExecutionResult, GmxSymbol } from './contracts.js';
export type * from './contracts.js';
export { GMX_TESTNET } from './registry.js';
const ERC = parseAbi(['function mint(address,uint256)', 'function approve(address,uint256) returns(bool)', 'function allowance(address,address) view returns(uint256)', 'function balanceOf(address) view returns(uint256)', 'function decimals() view returns(uint8)', 'function symbol() view returns(string)', 'event Transfer(address indexed from,address indexed to,uint256 value)', 'event Approval(address indexed owner,address indexed spender,uint256 value)']);
const DATA = parseAbi(['function hasRole(address,bytes32) view returns(bool)', 'function getBool(bytes32) view returns(bool)', 'function getUint(bytes32) view returns(uint256)']);
const fail = (reason: string): never => { throw new GrapnelError(409, 'EXECUTION_UNAVAILABLE', 'GMX Testnet needs exact current chain evidence', false, { reason }); };
const address = (v: string): Hex => { if (!/^0x[0-9a-f]{40}$/i.test(v) || v.toLowerCase() === zeroAddress)
    return fail('GMX_ADDRESS_INVALID'); return v.toLowerCase() as Hex; };
const dec = (v: string, max?: bigint): bigint => { if (!/^(0|[1-9]\d{0,77})$/.test(v))
    return fail('GMX_AMOUNT_INVALID'); const n = BigInt(v); if (max !== undefined && n > max)
    return fail('GMX_AMOUNT_LIMIT'); return n; };
const quantity = (v: unknown) => { if (typeof v !== 'string' || !/^0x[0-9a-f]+$/i.test(v))
    return fail('GMX_RPC_QUANTITY_INVALID'); return BigInt(v); };
const q = (n: bigint) => `0x${n.toString(16)}`;
const digestKey = (name: string) => keccak256(encodeAbiParameters([{ type: 'string' }], [name]));
const boundKey = (name: string, types: ('address' | 'uint256')[], values: any[]) => keccak256(encodeAbiParameters([{ type: 'bytes32' }, ...types.map(type => ({ type }))], [digestKey(name), ...values]));
const A = P.pins;
export function createGmxReadTransport(fetcher: typeof fetch = fetch): GmxReadTransport { const allowed = new Set(['eth_chainId', 'eth_getCode', 'eth_getBlockByNumber', 'eth_blockNumber', 'eth_call', 'eth_getBalance', 'eth_getTransactionCount', 'eth_estimateGas', 'eth_gasPrice', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getLogs']); let id = 0; return { async request(method, params) { if (!allowed.has(method))
        return fail('GMX_WRITE_TRANSPORT_FORBIDDEN'); const requestId = ++id, response = await fetcher(P.rpc, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }), signal: AbortSignal.timeout(15000) }); if (!response.ok)
        return fail('GMX_RPC_UNAVAILABLE'); const text = await response.text(); if (text.length > 2097152)
        return fail('GMX_RPC_TOO_LARGE'); const body = JSON.parse(text); if (body.jsonrpc !== '2.0' || body.id !== requestId || body.error || body.result === undefined)
        return fail('GMX_RPC_INVALID'); return body.result; } }; }
export function createGmxTestnetAdapter(d: {
    transport?: GmxReadTransport;
    fetcher?: typeof fetch;
    now?: () => number;
} = {}) { return new GmxTestnetAdapter(d); }
export class GmxTestnetAdapter {
    private t: GmxReadTransport;
    private now: () => number;
    private fetcher: typeof fetch;
    constructor(d: {
        transport?: GmxReadTransport;
        fetcher?: typeof fetch;
        now?: () => number;
    } = {}) { this.fetcher = d.fetcher ?? fetch; this.t = d.transport ?? createGmxReadTransport(this.fetcher); this.now = d.now ?? Date.now; }
    private async call(to: Hex, abi: Abi, functionName: string, args: readonly unknown[] = [], block = 'latest'): Promise<any> { const data = encodeFunctionData({ abi, functionName, args }), result = await this.t.request('eth_call', [{ to, data }, block]); if (typeof result !== 'string')
        return fail('GMX_CALL_INVALID'); return decodeFunctionResult({ abi, functionName, data: result as Hex }); }
    private base(i: GmxBaseIntent) { z.string().uuid().parse(i.id); address(i.account); const at = Date.parse(i.expiresAt); if (!Number.isFinite(at) || at <= this.now() || at > this.now() + 120000)
        return fail('GMX_INTENT_EXPIRED'); }
    async verifyRegistry() { if (await this.t.request('eth_chainId', []) !== '0x66eee')
        return fail('GMX_TESTNET_CHAIN_REQUIRED'); const head = await this.t.request('eth_getBlockByNumber', ['latest', false]) as any, stamp = Number(quantity(head?.timestamp)) * 1000; if (stamp > this.now() + 1000 || this.now() - stamp > 120000)
        return fail('GMX_HEAD_STALE'); await Promise.all(Object.values(A).map(async (p) => { const code = await this.t.request('eth_getCode', [p.address, 'latest']); if (typeof code !== 'string' || code === '0x' || keccak256(code as Hex) !== p.codeHash)
        return fail('GMX_CODE_PIN_CHANGED'); })); for (const [name, expected] of [['dataStore', A.dataStore.address], ['roleStore', A.roleStore.address], ['router', A.router.address], ['orderHandler', A.handler.address]])
        if (address(await this.call(A.exchange.address, EXCHANGE_ABI, name!)) !== expected)
            return fail('GMX_ROUTER_BINDING_CHANGED'); for (const a of [A.exchange.address, A.handler.address])
        if (await this.call(A.roleStore.address, DATA, 'hasRole', [a, digestKey('CONTROLLER')]) !== true)
            return fail('GMX_CONTROLLER_MISSING'); if (await this.call(A.collateral.address, ERC, 'decimals') !== 6 || await this.call(A.collateral.address, ERC, 'symbol') !== 'USDC')
        return fail('GMX_COLLATERAL_IDENTITY_CHANGED'); return { network: P.network, chainId: P.chainId, blockNumber: quantity(head.number).toString(), observedAt: new Date(stamp).toISOString(), router: A.exchange.address, handler: A.handler.address, collateral: A.collateral.address }; }
    async readStatus(account: string): Promise<GmxStatus> { const a = address(account); await this.verifyRegistry(); const block = await this.t.request('eth_getBlockByNumber', ['latest', false]) as any; const [native, collateral, allowance] = await Promise.all([this.t.request('eth_getBalance', [a, 'latest']), this.call(A.collateral.address, ERC, 'balanceOf', [a]), this.call(A.collateral.address, ERC, 'allowance', [a, A.router.address])]); return { nativeWei: quantity(native).toString(), collateralAtomic6: collateral.toString(), allowanceAtomic6: allowance.toString(), blockNumber: quantity(block.number).toString(), observedAt: new Date(Number(quantity(block.timestamp)) * 1000).toISOString() }; }
    async readPositions(account: string): Promise<GmxPosition[]> { const a = address(account); const rows = await this.call(A.reader.address, READER_ABI, 'getAccountPositions', [A.dataStore.address, a, 0n, 100n]); if (!Array.isArray(rows) || rows.length >= 100)
        return fail('GMX_POSITION_READ_AMBIGUOUS'); return rows.map((p: any) => { if (address(p.addresses.account) !== a)
        return fail('GMX_POSITION_SCOPE_MISMATCH'); const market = address(p.addresses.market), collateralToken = address(p.addresses.collateralToken); if (typeof p.flags.isLong !== 'boolean')
        return fail('GMX_POSITION_INVALID'); return { account: a, market, collateralToken, isLong: p.flags.isLong, sizeUsd30: p.numbers.sizeInUsd.toString(), sizeTokens: p.numbers.sizeInTokens.toString(), collateralAtomic6: p.numbers.collateralAmount.toString(), key: keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'bool' }], [a, market, collateralToken, p.flags.isLong])) }; }); }
    private async market(symbol: GmxSymbol) { const m = P.markets[symbol]; if (!m)
        return fail('GMX_MARKET_UNSUPPORTED'); const rows = await this.call(A.reader.address, READER_ABI, 'getMarkets', [A.dataStore.address, 0n, 100n]); const found = rows.find((r: any) => r.marketToken.toLowerCase() === m.market); if (!found || found.indexToken.toLowerCase() !== m.indexToken || found.shortToken.toLowerCase() !== A.collateral.address || await this.call(A.dataStore.address, DATA, 'getBool', [boundKey('IS_MARKET_DISABLED', ['address'], [m.market])]))
        return fail('GMX_MARKET_UNAVAILABLE'); return m; }
    private async prices(symbol: GmxSymbol) { const response = await this.fetcher(P.prices, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000) }); if (!response.ok)
        return fail('GMX_PRICES_UNAVAILABLE'); const text = await response.text(); if (text.length > 262144)
        return fail('GMX_PRICES_TOO_LARGE'); const p = z.object({ originTs: z.number().int().safe(), prices: z.record(z.object({ minPrice: z.string(), maxPrice: z.string() }).strict()) }).strict().parse(JSON.parse(text)), m = P.markets[symbol]; if (p.originTs > this.now() + 1000 || this.now() - p.originTs > 30000)
        return fail('GMX_PRICE_STALE'); const row = Object.entries(p.prices).find(([key]) => key.toLowerCase() === m.indexToken)?.[1]; if (!row)
        return fail('GMX_INDEX_PRICE_REQUIRED'); const min = dec(row.minPrice), max = dec(row.maxPrice); if (min <= 0n || max < min)
        return fail('GMX_PRICE_INVALID'); return { min, max, observedAt: new Date(p.originTs).toISOString() }; }
    async readMarket(symbol: GmxSymbol) { await this.verifyRegistry(); const market = await this.market(symbol), price = await this.prices(symbol); return { market_id: `gmx-testnet:perps:${symbol}`, symbol, market_address: market.market, index_token: market.indexToken, index_decimals: market.decimals, price_min30: price.min.toString(), price_max30: price.max.toString(), quote_observed_at: price.observedAt }; }
    private async prepare(i: GmxBaseIntent, kind: GmxPrepared['kind'], to: Hex, data: Hex, value: bigint, intent: GmxPrepared['intent'], baseline: GmxPrepared['baseline']): Promise<GmxPrepared> { this.base(i); const account = address(i.account), [latest, pending, gasPrice, estimate] = await Promise.all([this.t.request('eth_getTransactionCount', [account, 'latest']), this.t.request('eth_getTransactionCount', [account, 'pending']), this.t.request('eth_gasPrice', []), this.t.request('eth_estimateGas', [{ from: account, to, data, value: q(value) }])]); const n = quantity(latest), price = quantity(gasPrice); if (n !== quantity(pending) || n > BigInt(Number.MAX_SAFE_INTEGER))
        return fail('GMX_PENDING_NONCE'); const gas = (quantity(estimate) * 125n + 99n) / 100n, fee = price * 2n; if (gas <= 0n || gas > 3000000n || fee <= 0n || gas * fee + value > 1500000000000000n)
        return fail('GMX_QA_FEE_BUDGET'); const result = await this.t.request('eth_call', [{ from: account, to, data, value: q(value) }, 'latest']); if (typeof result !== 'string')
        return fail('GMX_SIMULATION_INVALID'); const transaction = { chainId: 421614 as const, type: 'eip1559' as const, to, data, value, nonce: Number(n), gas, maxFeePerGas: fee, maxPriorityFeePerGas: 0n }; this.base(i); return { id: i.id, network: 'arbitrum-sepolia', kind, account, expiresAt: i.expiresAt, transaction, signingHash: keccak256(serializeTransaction(transaction)), intent, baseline }; }
    async prepareMint(i: GmxTokenIntent) { this.base(i); const n = dec(i.amountAtomic6, 100000000n); if (n <= 0n)
        return fail('GMX_MINT_AMOUNT_INVALID'); const status = await this.readStatus(i.account); return this.prepare(i, 'mint', A.collateral.address, encodeFunctionData({ abi: ERC, functionName: 'mint', args: [address(i.account), n] }), 0n, { amountAtomic6: i.amountAtomic6 }, { status, positions: [] }); }
    async prepareApproval(i: GmxTokenIntent) { this.base(i); const n = dec(i.amountAtomic6, 20000000n); if (n <= 0n)
        return fail('GMX_APPROVAL_AMOUNT_INVALID'); const status = await this.readStatus(i.account); if (BigInt(status.collateralAtomic6) < n)
        return fail('GMX_COLLATERAL_BALANCE_TOO_LOW'); return this.prepare(i, 'approve', A.collateral.address, encodeFunctionData({ abi: ERC, functionName: 'approve', args: [A.router.address, n] }), 0n, { amountAtomic6: i.amountAtomic6 }, { status, positions: [] }); }
    private async trade(i: GmxTradeIntent, open?: GmxOpenIntent): Promise<GmxPrepared> {
        this.base(i);
        if (!Number.isInteger(i.slippageBps) || i.slippageBps < 1 || i.slippageBps > 100 || typeof i.isLong !== 'boolean')
            return fail('GMX_SLIPPAGE_INVALID');
        const fee = dec(i.executionFeeWei, 1000000000000000n);
        if (fee <= 0n)
            return fail('GMX_EXECUTION_FEE_REQUIRED');
        const status = await this.readStatus(i.account), m = await this.market(i.symbol), positions = await this.readPositions(i.account), matching = positions.filter(p => p.market === m.market && p.collateralToken === A.collateral.address && p.isLong === i.isLong);
        if (matching.length > 1)
            return fail('GMX_POSITION_AMBIGUOUS');
        const previous = matching[0] ?? null;
        let size: bigint, collateral: bigint;
        if (open) {
            size = dec(open.sizeUsd30, 40n * 10n ** 30n);
            collateral = dec(open.collateralAtomic6, 20000000n);
            if (previous && BigInt(previous.sizeUsd30) > 0n || size <= 0n || collateral <= 0n || size < collateral * 10n ** 24n || size > collateral * 10n ** 24n * 20n)
                return fail('GMX_OPEN_POSITION_BOUND');
            if (BigInt(status.collateralAtomic6) < collateral || BigInt(status.allowanceAtomic6) < collateral)
                return fail('GMX_EXACT_COLLATERAL_APPROVAL_REQUIRED');
        }
        else {
            if (!previous || BigInt(previous.sizeUsd30) <= 0n)
                return fail('GMX_POSITION_REQUIRED');
            size = BigInt(previous.sizeUsd30);
            collateral = 0n;
        }
        const orderType = open ? 2 : 4;
        for (const name of ['CREATE_ORDER_FEATURE_DISABLED', 'EXECUTE_ORDER_FEATURE_DISABLED'])
            if (await this.call(A.dataStore.address, DATA, 'getBool', [boundKey(name, ['address', 'uint256'], [A.handler.address, BigInt(orderType)])]))
                return fail('GMX_ORDER_FEATURE_DISABLED');
        const price = await this.prices(i.symbol), payMore = open ? i.isLong : !i.isLong;
        const bound = payMore ? (price.max * BigInt(10000 + i.slippageBps) + 9999n) / 10000n : price.min * BigInt(10000 - i.slippageBps) / 10000n, acceptable = payMore ? (bound + 10n ** BigInt(m.decimals) - 1n) / 10n ** BigInt(m.decimals) : bound / 10n ** BigInt(m.decimals);
        const params = { addresses: { receiver: address(i.account), cancellationReceiver: zeroAddress, callbackContract: zeroAddress, uiFeeReceiver: zeroAddress, market: m.market, initialCollateralToken: A.collateral.address, swapPath: [] }, numbers: { sizeDeltaUsd: size, initialCollateralDeltaAmount: 0n, triggerPrice: 0n, acceptablePrice: acceptable, executionFee: fee, callbackGasLimit: 0n, minOutputAmount: 0n, validFromTime: 0n }, orderType, decreasePositionSwapType: 0, isLong: i.isLong, shouldUnwrapNativeToken: false, autoCancel: false, referralCode: zeroHash, dataList: [] };
        const calls = [encodeFunctionData({ abi: EXCHANGE_ABI, functionName: 'sendWnt', args: [A.orderVault.address, fee] }), ...open ? [encodeFunctionData({ abi: EXCHANGE_ABI, functionName: 'sendTokens', args: [A.collateral.address, A.orderVault.address, collateral] })] : [], encodeFunctionData({ abi: EXCHANGE_ABI, functionName: 'createOrder', args: [params] })];
        return this.prepare(i, open ? 'open' : 'close', A.exchange.address, encodeFunctionData({ abi: EXCHANGE_ABI, functionName: 'multicall', args: [calls] }), fee, { symbol: i.symbol, market: m.market, isLong: i.isLong, collateralAtomic6: collateral.toString(), sizeUsd30: size.toString(), acceptablePrice: acceptable.toString(), executionFeeWei: fee.toString(), slippageBps: i.slippageBps, quoteMinPrice30: price.min.toString(), quoteMaxPrice30: price.max.toString(), quoteObservedAt: price.observedAt, indexDecimals: m.decimals }, { status, positions });
    }
    async prepareOpen(i: GmxOpenIntent) { return this.trade(i, i); }
    async prepareClose(i: GmxTradeIntent) { return this.trade(i); }
    async verifySigned(p: GmxPrepared, raw: Hex): Promise<Hex> { this.base(p); this.inspectPrepared(p); const tx = parseTransaction(raw as TransactionSerialized), t = p.transaction, signer = address(await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerialized })); if (tx.type !== 'eip1559' || tx.chainId !== 421614 || signer !== p.account || tx.to?.toLowerCase() !== t.to || tx.data !== t.data || (tx.value ?? 0n) !== t.value || tx.nonce !== t.nonce || tx.gas !== t.gas || tx.maxFeePerGas !== t.maxFeePerGas || (tx.maxPriorityFeePerGas ?? 0n) !== t.maxPriorityFeePerGas || tx.accessList && tx.accessList.length)
        return fail('GMX_SIGNED_BODY_MISMATCH'); return keccak256(raw); }
    private inspectPrepared(p: GmxPrepared) { z.enum(['mint', 'approve', 'open', 'close']).parse(p.kind); address(p.account); if (!Number.isSafeInteger(p.transaction.nonce) || p.transaction.nonce < 0 || p.transaction.gas <= 0n || p.transaction.gas > 3000000n || p.transaction.maxFeePerGas <= 0n || p.transaction.gas * p.transaction.maxFeePerGas + p.transaction.value > 1500000000000000n || Object.keys(p.transaction).sort().join(',') !== 'chainId,data,gas,maxFeePerGas,maxPriorityFeePerGas,nonce,to,type,value')
        return fail('GMX_FEE_BODY_INVALID'); if (p.network !== 'arbitrum-sepolia' || p.transaction.chainId !== 421614 || p.transaction.type !== 'eip1559' || p.transaction.maxPriorityFeePerGas !== 0n || keccak256(serializeTransaction(p.transaction)) !== p.signingHash)
        return fail('GMX_PREPARED_INVALID'); const t = p.transaction; if (p.kind === 'mint' || p.kind === 'approve') {
        const amount = dec(p.intent.amountAtomic6!, p.kind === 'mint' ? 100000000n : 20000000n), expected = encodeFunctionData({ abi: ERC, functionName: p.kind === 'mint' ? 'mint' : 'approve', args: [p.kind === 'mint' ? p.account : A.router.address, amount] });
        if (t.to !== A.collateral.address || t.value !== 0n || t.data !== expected)
            return fail('GMX_TOKEN_INTENT_MISMATCH');
    }
    else {
        const symbol = p.intent.symbol!, market = P.markets[symbol];
        if (!market || p.intent.market !== market.market || p.intent.indexDecimals !== market.decimals || !Number.isInteger(p.intent.slippageBps) || p.intent.slippageBps! < 1 || p.intent.slippageBps! > 100 || typeof p.intent.isLong !== 'boolean')
            return fail('GMX_ORDER_MARKET_MISMATCH');
        const min = dec(p.intent.quoteMinPrice30!), max = dec(p.intent.quoteMaxPrice30!), at = Date.parse(p.intent.quoteObservedAt!);
        if (min <= 0n || max < min || !Number.isFinite(at) || at > this.now() + 1000 || Date.parse(p.expiresAt) - at > 150000)
            return fail('GMX_QUOTE_MISMATCH');
        const more = p.kind === 'open' ? p.intent.isLong : !p.intent.isLong, bound = more ? (max * BigInt(10000 + p.intent.slippageBps!) + 9999n) / 10000n : min * BigInt(10000 - p.intent.slippageBps!) / 10000n, scale = 10n ** BigInt(market.decimals), expected = more ? (bound + scale - 1n) / scale : bound / scale;
        if (dec(p.intent.acceptablePrice!) !== expected || dec(p.intent.executionFeeWei!, 1000000000000000n) <= 0n)
            return fail('GMX_ORDER_PRICE_MISMATCH');
        if (p.kind === 'open' && (dec(p.intent.sizeUsd30!, 40n * 10n ** 30n) <= 0n || dec(p.intent.collateralAtomic6!, 20000000n) <= 0n))
            return fail('GMX_QA_SIZE_LIMIT');
        if (t.to !== A.exchange.address || t.value !== BigInt(p.intent.executionFeeWei!))
            return fail('GMX_ORDER_INTENT_MISMATCH');
        const decoded = decodeFunctionData({ abi: EXCHANGE_ABI, data: t.data });
        if (decoded.functionName !== 'multicall')
            return fail('GMX_ORDER_INTENT_MISMATCH');
        const calls = decoded.args[0];
        if (calls.length !== (p.kind === 'open' ? 3 : 2))
            return fail('GMX_ORDER_INTENT_MISMATCH');
        const wnt = encodeFunctionData({ abi: EXCHANGE_ABI, functionName: 'sendWnt', args: [A.orderVault.address, t.value] });
        if (calls[0] !== wnt)
            return fail('GMX_EXECUTION_FEE_MISMATCH');
        if (p.kind === 'open' && calls[1] !== encodeFunctionData({ abi: EXCHANGE_ABI, functionName: 'sendTokens', args: [A.collateral.address, A.orderVault.address, BigInt(p.intent.collateralAtomic6!)] }))
            return fail('GMX_COLLATERAL_INTENT_MISMATCH');
        const order = decodeFunctionData({ abi: EXCHANGE_ABI, data: calls.at(-1)! });
        if (order.functionName !== 'createOrder')
            return fail('GMX_ORDER_INTENT_MISMATCH');
        const v = order.args[0];
        if (v.addresses.receiver.toLowerCase() !== p.account || v.addresses.market.toLowerCase() !== p.intent.market || v.addresses.initialCollateralToken.toLowerCase() !== A.collateral.address || v.addresses.callbackContract !== zeroAddress || v.addresses.uiFeeReceiver !== zeroAddress || v.addresses.cancellationReceiver !== zeroAddress || v.addresses.swapPath.length || v.numbers.sizeDeltaUsd !== BigInt(p.intent.sizeUsd30!) || v.numbers.initialCollateralDeltaAmount !== 0n || v.numbers.acceptablePrice !== BigInt(p.intent.acceptablePrice!) || v.numbers.executionFee !== t.value || v.numbers.triggerPrice || v.numbers.callbackGasLimit || v.numbers.minOutputAmount || v.numbers.validFromTime || v.orderType !== (p.kind === 'open' ? 2 : 4) || v.decreasePositionSwapType !== 0 || v.isLong !== p.intent.isLong || v.shouldUnwrapNativeToken || v.autoCancel || v.referralCode !== zeroHash || v.dataList.length)
            return fail('GMX_ORDER_INTENT_MISMATCH');
    } }
    private async receipt(hash: Hex) { if (!/^0x[a-f0-9]{64}$/.test(hash))
        return fail('GMX_HASH_INVALID'); if (await this.t.request('eth_chainId', []) !== '0x66eee')
        return fail('GMX_TESTNET_CHAIN_REQUIRED'); const r = await this.t.request('eth_getTransactionReceipt', [hash]) as any; if (!r || r.transactionHash?.toLowerCase() !== hash || r.status !== '0x1' || !Array.isArray(r.logs) || r.logs.length > 200)
        return fail('GMX_RECEIPT_UNCONFIRMED'); const block = quantity(r.blockNumber), [canonical, head] = await Promise.all([this.t.request('eth_getBlockByNumber', [r.blockNumber, false]), this.t.request('eth_blockNumber', [])]); if (block <= 0n || (canonical as any)?.hash?.toLowerCase() !== r.blockHash?.toLowerCase() || quantity(head) < block + 1n)
        return fail('GMX_CONFIRMATIONS_REQUIRED'); return r; }
    private events(receipt: any) { const result: {
        name: string;
        data: any;
    }[] = []; for (const l of receipt.logs) {
        if (l.address?.toLowerCase() !== A.eventEmitter.address)
            continue;
        if (l.removed || l.transactionHash?.toLowerCase() !== receipt.transactionHash.toLowerCase() || l.blockHash?.toLowerCase() !== receipt.blockHash.toLowerCase())
            return fail('GMX_EVENT_INVALID');
        try {
            const e = decodeEventLog({ abi: EVENT_ABI, data: l.data, topics: l.topics, strict: true });
            result.push({ name: e.args.eventName, data: e.args.eventData });
        }
        catch (e) {
            if (e instanceof GrapnelError)
                throw e;
        }
    } return result; }
    private value(data: any, group: string, key: string): any { const rows = data?.[group]?.items?.filter((v: any) => v.key === key); if (!Array.isArray(rows) || rows.length !== 1)
        return fail('GMX_EVENT_FIELD_REQUIRED'); return rows[0].value; }
    private scopedEvent(p: GmxPrepared, e: any) { return address(this.value(e, 'addressItems', 'account')) === p.account && address(this.value(e, 'addressItems', 'market')) === p.intent.market && address(this.value(e, 'addressItems', p.kind === 'open' || p.kind === 'close' ? 'collateralToken' : 'initialCollateralToken')) === A.collateral.address; }
    async confirmTransaction(p: GmxPrepared, txHash: Hex): Promise<GmxTokenProof | GmxCreationProof> {
        this.inspectPrepared(p);
        await this.verifyRegistry();
        const receipt = await this.receipt(txHash), tx = await this.t.request('eth_getTransactionByHash', [txHash]) as any, t = p.transaction;
        if (!tx || tx.hash?.toLowerCase() !== txHash || tx.blockHash?.toLowerCase() !== receipt.blockHash?.toLowerCase() || tx.from?.toLowerCase() !== p.account || tx.to?.toLowerCase() !== t.to || tx.input?.toLowerCase() !== t.data || quantity(tx.value) !== t.value || quantity(tx.nonce) !== BigInt(t.nonce) || quantity(tx.chainId) !== 421614n || quantity(tx.gas) !== t.gas || quantity(tx.maxFeePerGas) !== t.maxFeePerGas || quantity(tx.maxPriorityFeePerGas) !== 0n)
            return fail('GMX_MINED_BODY_MISMATCH');
        const block = quantity(receipt.blockNumber);
        if (p.kind === 'mint' || p.kind === 'approve') {
            const n = BigInt(p.intent.amountAtomic6!);
            let matched = 0;
            for (const l of receipt.logs) {
                if (l.address?.toLowerCase() !== A.collateral.address)
                    continue;
                if (l.removed || l.transactionHash?.toLowerCase() !== txHash || l.blockHash?.toLowerCase() !== receipt.blockHash.toLowerCase())
                    return fail('GMX_TOKEN_LOG_INVALID');
                try {
                    const e = decodeEventLog({ abi: ERC, data: l.data, topics: l.topics, strict: true });
                    if (p.kind === 'mint' && e.eventName === 'Transfer' && e.args.from === zeroAddress && e.args.to.toLowerCase() === p.account) {
                        if (e.args.value !== n)
                            return fail('GMX_TOKEN_DELTA_MISMATCH');
                        matched++;
                    }
                    if (p.kind === 'approve' && e.eventName === 'Approval' && e.args.owner.toLowerCase() === p.account && e.args.spender.toLowerCase() === A.router.address) {
                        if (e.args.value !== n)
                            return fail('GMX_ALLOWANCE_MISMATCH');
                        matched++;
                    }
                }
                catch (e) {
                    if (e instanceof GrapnelError)
                        throw e;
                }
            }
            if (matched !== 1)
                return fail('GMX_EXACT_TOKEN_EVENT_REQUIRED');
            const functionName = p.kind === 'mint' ? 'balanceOf' : 'allowance', args = p.kind === 'mint' ? [p.account] : [p.account, A.router.address], before = await this.call(A.collateral.address, ERC, functionName, args, q(block - 1n)), after = await this.call(A.collateral.address, ERC, functionName, args, q(block));
            if (p.kind === 'mint' ? BigInt(after) - BigInt(before) !== n : after !== n)
                return fail('GMX_TOKEN_DELTA_MISMATCH');
            return { network: P.network, account: p.account, txHash, blockNumber: block.toString(), kind: p.kind, amountAtomic6: n.toString(), beforeAtomic6: before.toString(), afterAtomic6: after.toString(), confirmed: true };
        }
        const rows = this.events(receipt).filter(e => e.name === 'OrderCreated');
        if (rows.length !== 1)
            return fail('GMX_EXACT_ORDER_CREATED_REQUIRED');
        const v = rows[0]!.data, addr = (key: string) => address(this.value(v, 'addressItems', key)), uint = (key: string) => BigInt(this.value(v, 'uintItems', key)), bool = (key: string) => this.value(v, 'boolItems', key);
        if (addr('account') !== p.account || addr('receiver') !== p.account || addr('market') !== p.intent.market || addr('initialCollateralToken') !== A.collateral.address || uint('orderType') !== BigInt(p.kind === 'open' ? 2 : 4) || uint('sizeDeltaUsd') !== BigInt(p.intent.sizeUsd30!) || uint('executionFee') !== BigInt(p.intent.executionFeeWei!) || uint('acceptablePrice') !== BigInt(p.intent.acceptablePrice!) || bool('isLong') !== p.intent.isLong || p.kind === 'open' && uint('initialCollateralDeltaAmount') !== BigInt(p.intent.collateralAtomic6!))
            return fail('GMX_CREATED_ORDER_INTENT_MISMATCH');
        const orderKey = this.value(v, 'bytes32Items', 'key');
        if (!/^0x[a-f0-9]{64}$/.test(orderKey))
            return fail('GMX_ORDER_KEY_INVALID');
        return { network: P.network, account: p.account, creationTxHash: txHash, creationBlock: block.toString(), orderKey, kind: p.kind };
    }
    async readOrder(orderKey: Hex) { if (!/^0x[a-f0-9]{64}$/.test(orderKey))
        return fail('GMX_ORDER_KEY_INVALID'); return this.call(A.reader.address, READER_ABI, 'getOrder', [A.dataStore.address, orderKey]); }
    async reconcileOrder(p: GmxPrepared, creation: GmxCreationProof): Promise<GmxExecutionResult> {
        this.inspectPrepared(p);
        if (p.kind !== 'open' && p.kind !== 'close' || creation.network !== P.network || creation.account !== p.account || creation.kind !== p.kind)
            return fail('GMX_ORDER_SCOPE_MISMATCH');
        await this.verifyRegistry();
        const checked = await this.confirmTransaction(p, creation.creationTxHash);
        if (!('orderKey' in checked) || checked.orderKey !== creation.orderKey || checked.creationBlock !== creation.creationBlock)
            return fail('GMX_ORDER_PROOF_MISMATCH');
        const head = quantity(await this.t.request('eth_blockNumber', [])), start = dec(creation.creationBlock);
        if (head < start || head - start > 20000n)
            return fail('GMX_ORDER_SCAN_WINDOW_EXCEEDED');
        let found: {
            name: string;
            data: any;
            tx: Hex;
        }[] = [];
        for (let from = start; from <= head; from += 1000n) {
            const to = from + 999n < head ? from + 999n : head, logs = await this.t.request('eth_getLogs', [{ address: A.eventEmitter.address, fromBlock: q(from), toBlock: q(to) }]) as any[];
            if (!Array.isArray(logs) || logs.length > 5000)
                return fail('GMX_ORDER_LOGS_AMBIGUOUS');
            for (const l of logs) {
                try {
                    const e = decodeEventLog({ abi: EVENT_ABI, data: l.data, topics: l.topics, strict: true });
                    if (!['OrderExecuted', 'OrderCancelled', 'OrderFrozen'].includes(e.args.eventName))
                        continue;
                    if (this.value(e.args.eventData, 'bytes32Items', 'key') === creation.orderKey)
                        found.push({ name: e.args.eventName, data: e.args.eventData, tx: l.transactionHash });
                }
                catch (e) {
                    if (e instanceof GrapnelError)
                        throw e;
                }
            }
        }
        if (!found.length)
            return { state: 'pending', scannedToBlock: head.toString() };
        if (found.length !== 1)
            return fail('GMX_ORDER_TERMINAL_AMBIGUOUS');
        const terminal = found[0]!, receipt = await this.receipt(terminal.tx), events = this.events(receipt), same = events.filter(e => e.name === terminal.name && this.value(e.data, 'bytes32Items', 'key') === creation.orderKey);
        if (same.length !== 1 || address(this.value(same[0]!.data, 'addressItems', 'account')) !== p.account)
            return fail('GMX_ORDER_EXECUTION_SCOPE_MISMATCH');
        if (terminal.name !== 'OrderExecuted')
            return { state: 'cancelled', orderKey: creation.orderKey, executionTxHash: terminal.tx, reason: terminal.name };
        const changed = events.filter(e => e.name === (p.kind === 'open' ? 'PositionIncrease' : 'PositionDecrease') && this.value(e.data, 'bytes32Items', 'orderKey') === creation.orderKey);
        if (changed.length !== 1)
            return fail('GMX_POSITION_EVENT_REQUIRED');
        const data = changed[0]!.data;
        if (!this.scopedEvent(p, data) || this.value(data, 'boolItems', 'isLong') !== p.intent.isLong || BigInt(this.value(data, 'uintItems', 'sizeDeltaUsd')) !== BigInt(p.intent.sizeUsd30!))
            return fail('GMX_POSITION_EVENT_MISMATCH');
        const before = p.baseline.positions.find(v => v.market === p.intent.market && v.collateralToken === A.collateral.address && v.isLong === p.intent.isLong) ?? null, positions = await this.readPositions(p.account), after = positions.find(v => v.market === p.intent.market && v.collateralToken === A.collateral.address && v.isLong === p.intent.isLong) ?? null, expected = p.kind === 'open' ? BigInt(before?.sizeUsd30 ?? '0') + BigInt(p.intent.sizeUsd30!) : BigInt(before?.sizeUsd30 ?? '0') - BigInt(p.intent.sizeUsd30!);
        if (expected < 0n || BigInt(after?.sizeUsd30 ?? '0') !== expected || BigInt(this.value(data, 'uintItems', 'sizeInUsd')) !== expected)
            return fail('GMX_ACTUAL_POSITION_DELTA_REQUIRED');
        const balance = await this.call(A.collateral.address, ERC, 'balanceOf', [p.account]);
        return { state: 'executed', execution_status: 'testnet_verified', orderKey: creation.orderKey, creationTxHash: creation.creationTxHash, executionTxHash: terminal.tx, positionBefore: before, positionAfter: after, collateralBalanceAtomic6: balance.toString(), event: JSON.parse(JSON.stringify(data, (_, v) => typeof v === 'bigint' ? v.toString() : v)) };
    }
}
