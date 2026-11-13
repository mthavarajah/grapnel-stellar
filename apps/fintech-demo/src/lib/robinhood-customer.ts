/** Browser-owned static reconstruction. No API key, server adapter or broadcast capability. */
import { fromAtomic, toAtomic, formatTokenAmount } from '@grapnel/contracts';
import { decodeFunctionData, encodeFunctionData, parseAbi, parseTransaction, recoverTransactionAddress, type Hex } from 'viem';
import { z } from 'zod';
export const ROBINHOOD_CUSTOMER = { chainId: 46630, network: 'robinhood-testnet', rpc: 'https://rpc.testnet.chain.robinhood.com', router: '0x3ce954107b1a675826b33bf23060dd655e3758fe', settlement: '0x7e955252e15c84f5768b83c41a71f9eba181802f', fee: 3000, stocks: { TSLA: { address: '0xc9f9c86933092bbbfff3ccb4b105a4a94bf3bd4e', pool: '0x33130082660ad87a99ad6120269f91329c82f7c2' }, AMZN: { address: '0x5884ad2f920c162cfbbacc88c9c51aa75ec09e02', pool: '0x6c0a5ef3c4e0d29a56d3ab463f9c28f18482c047' }, PLTR: { address: '0x1fbe1a0e43594b3455993b5de5fd0a7a266298d0', pool: '0x5c82380e87db94f55dda0b1443eb046437158969' }, NFLX: { address: '0x3b8262a63d25f0477c4dde23f83cfe22cb768c93', pool: '0x81eda513eb0f5fdaf3903220432ebdb0a5fc6b02' }, AMD: { address: '0x71178bac73cbeb415514eb542a8995b82669778d', pool: '0xe3abea804606228c89cc3196ecd2fedf27d2a586' } } } as const;
export const ROBINHOOD_CUSTOMER_ABI = parseAbi(['function approve(address spender,uint256 amount) returns(bool)', 'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns(uint256 amountOut)', 'function multicall(uint256 deadline,bytes[] data) payable returns(bytes[] results)']);
export type RobinhoodSymbol = keyof typeof ROBINHOOD_CUSTOMER.stocks;
export type RobinhoodScope = {
    customerId: string;
    walletId: string;
    businessId?: string;
};
export type RobinhoodDraft = {
    symbol: RobinhoodSymbol;
    kind: 'approval' | 'swap';
    side: 'buy' | 'sell';
    amount: string;
    slippageBps: number;
};
export type RobinhoodProvider = {
    request(input: {
        method: string;
        params?: unknown[];
    }): Promise<unknown>;
};
export type RobinhoodSigner = (input: {
    chainId: 46630;
    type: 2;
    from: Hex;
    to: Hex;
    data: Hex;
    value: bigint;
    nonce: number;
    gasLimit: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
}) => Promise<Hex>;
const P = ROBINHOOD_CUSTOMER, address = z.string().regex(/^0x[a-f0-9]{40}$/i), integer = z.string().regex(/^(0|[1-9]\d{0,77})$/), decimal = z.string().regex(/^(0|[1-9]\d*)(\.\d{1,18})?$/), hex = z.string().max(100000).regex(/^0x(?:[a-f0-9]{2})*$/i), hash = z.string().regex(/^0x[a-f0-9]{64}$/i), symbol = z.enum(['TSLA', 'AMZN', 'PLTR', 'NFLX', 'AMD']), scope = z.object({ business_id: z.string().min(1), customer_id: z.string().min(1), wallet_id: z.string().min(1) }).strict();
const quote = z.object({ amountOutBaseUnits: integer, minimumOutBaseUnits: integer, slippageBps: z.number().int().min(0).max(100), observedAt: z.string().datetime(), expiresAt: z.string().datetime(), blockNumber: integer }).passthrough();
const intent = z.object({ kind: z.enum(['approval', 'swap']), chainId: z.literal(46630), from: address, to: address, value: z.literal('0'), data: hex, tokenIn: address, tokenOut: address.nullable(), amountInBaseUnits: integer, minimumOutBaseUnits: integer.nullable(), symbol: z.enum(['USDG', 'TSLA', 'AMZN', 'PLTR', 'NFLX', 'AMD']), observedAt: z.string().datetime(), expiresAt: z.string().datetime(), deadlineSeconds: integer.nullable(), executionStatus: z.literal('discovery_only'), price_basis: z.literal('testnet_pool_quote').nullable() }).strict();
const transaction = z.object({ chainId: z.literal(46630), type: z.literal('eip1559'), to: address, data: hex, value: z.literal('0'), nonce: integer, gas: integer, maxFeePerGas: integer, maxPriorityFeePerGas: integer }).strict();
const status = z.object({ scope, account_address: address.nullable(), network: z.literal('robinhood-testnet'), chain_id: z.literal(46630), settlement_balance: decimal.nullable(), stock_balance: decimal.nullable(), native_balance: decimal.nullable(), settlement_allowance: decimal.nullable(), stock_allowance: decimal.nullable(), execution_available: z.boolean(), reason: z.string().nullable().optional() }).passthrough();
const request = z.object({ id: z.string().uuid(), business_id: z.string(), customer_id: z.string(), wallet_id: z.string(), account_address: address, kind: z.enum(['approval', 'swap']), market_id: z.string(), state: z.enum(['prepared', 'sending', 'confirming', 'completed', 'reverted', 'unknown', 'cancelled']), expires_at: z.string().datetime(), intent, transaction, quote: quote.nullable().optional(), tx_hash: hash.nullable(), proof: z.record(z.unknown()).nullable() }).passthrough();
export type RobinhoodStatus = z.infer<typeof status>;
export type RobinhoodRequest = z.infer<typeof request>;
const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const fail = (message = 'This request differs from the account, stock or amount you reviewed.'): never => { throw Error(message); };
function freeze<T>(v: T): T { if (v && typeof v === 'object') {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
} return v; }
function checkScope(value: z.infer<typeof scope>, expected: RobinhoodScope) { if (value.customer_id !== expected.customerId || value.wallet_id !== expected.walletId || expected.businessId && value.business_id !== expected.businessId)
    return fail(); }
export function robinhoodMarketSymbol(id: string): RobinhoodSymbol { const parsed = symbol.safeParse(id.replace(/^robinhood-testnet:stocks:/, '')); if (!parsed.success || id !== `robinhood-testnet:stocks:${parsed.data}`)
    return fail(); return parsed.data; }
export function inspectRobinhoodStatus(value: unknown, expected: RobinhoodScope, account: string | null, stock: RobinhoodSymbol): RobinhoodStatus { const s = status.parse(structuredClone(value)); checkScope(s.scope, expected); if (account ? (!s.account_address || !eq(account, s.account_address)) : s.account_address !== null)
    return fail(); if ('market_id' in s && s.market_id !== `robinhood-testnet:stocks:${stock}`)
    return fail(); return freeze(s); }
export function inspectRobinhoodRecord(value: unknown, expected: RobinhoodScope, account: string, stock?: RobinhoodSymbol, id?: string): RobinhoodRequest { const r = request.parse(structuredClone(value)); checkScope(r, expected); const s = robinhoodMarketSymbol(r.market_id); if (id && r.id !== id || stock && s !== stock || !eq(account, r.account_address) || !eq(account, r.intent.from) || r.kind !== r.intent.kind || r.expires_at !== r.intent.expiresAt || !eq(r.transaction.to, r.intent.to) || !eq(r.transaction.data, r.intent.data) || r.transaction.value !== r.intent.value)
    return fail(); return freeze(r); }
export function inspectRobinhoodApproval(value: unknown, expected: RobinhoodScope, account: string, draft: RobinhoodDraft, now = Date.now()): RobinhoodRequest {
    if (!expected.businessId)
        return fail('Refresh the stock account before reviewing.');
    const r = inspectRobinhoodRecord(value, expected, account, draft.symbol), i = r.intent, t = r.transaction, stock = P.stocks[draft.symbol], decimals = draft.side === 'buy' ? 6 : 18, amount = toAtomic(draft.amount, decimals), tokenIn = draft.side === 'buy' ? P.settlement : stock.address, tokenOut = draft.side === 'buy' ? stock.address : P.settlement;
    if (r.kind !== draft.kind || r.state !== 'prepared' || Date.parse(r.expires_at) <= now || Date.parse(r.expires_at) > now + 90000 || Date.parse(i.expiresAt) - Date.parse(i.observedAt) > 90000 || Date.parse(i.observedAt) > now + 1000 || now - Date.parse(i.observedAt) > 90000 || amount <= 0n || amount > (draft.side === 'buy' ? 20000000n : 10n * 10n ** 18n) || i.amountInBaseUnits !== amount.toString() || !eq(i.tokenIn, tokenIn) || !Number.isInteger(draft.slippageBps) || draft.slippageBps < 0 || draft.slippageBps > 100)
        return fail('This review changed or expired. Check its status before continuing.');
    const gas = BigInt(t.gas), fee = BigInt(t.maxFeePerGas), tip = BigInt(t.maxPriorityFeePerGas);
    if (gas <= 0n || gas > 2000000n || fee <= 0n || fee > 1000000000n || tip !== 0n || gas * fee > 1000000000000000n || BigInt(t.nonce) > BigInt(Number.MAX_SAFE_INTEGER))
        return fail('The network fee or nonce is outside the reviewed limit.');
    let expectedData: Hex;
    if (draft.kind === 'approval') {
        if (i.symbol !== (draft.side === 'buy' ? 'USDG' : draft.symbol) || !eq(i.to, tokenIn) || i.tokenOut !== null || i.minimumOutBaseUnits !== null || i.deadlineSeconds !== null || i.price_basis !== null || r.quote != null)
            return fail();
        expectedData = encodeFunctionData({ abi: ROBINHOOD_CUSTOMER_ABI, functionName: 'approve', args: [P.router, amount] });
    }
    else {
        const q = r.quote;
        if (!q || i.symbol !== draft.symbol || !eq(i.to, P.router) || !i.tokenOut || !eq(i.tokenOut, tokenOut) || i.price_basis !== 'testnet_pool_quote' || !i.minimumOutBaseUnits || !i.deadlineSeconds || q.slippageBps !== draft.slippageBps || q.observedAt !== i.observedAt || q.expiresAt !== i.expiresAt || q.minimumOutBaseUnits !== i.minimumOutBaseUnits || BigInt(q.blockNumber) <= 0n)
            return fail('A verified pool quote is required before approval.');
        const min = BigInt(q.amountOutBaseUnits) * BigInt(10000 - draft.slippageBps) / 10000n, deadline = BigInt(Math.floor(Date.parse(i.expiresAt) / 1000));
        if (min <= 0n || min.toString() !== i.minimumOutBaseUnits || i.deadlineSeconds !== deadline.toString())
            return fail();
        const inner = encodeFunctionData({ abi: ROBINHOOD_CUSTOMER_ABI, functionName: 'exactInputSingle', args: [{ tokenIn, tokenOut, fee: 3000, recipient: account as Hex, amountIn: amount, amountOutMinimum: min, sqrtPriceLimitX96: 0n }] });
        expectedData = encodeFunctionData({ abi: ROBINHOOD_CUSTOMER_ABI, functionName: 'multicall', args: [deadline, [inner]] });
        const decoded = decodeFunctionData({ abi: ROBINHOOD_CUSTOMER_ABI, data: i.data as Hex });
        if (decoded.functionName !== 'multicall' || decoded.args[1].length !== 1)
            return fail();
    }
    if (!eq(i.data, expectedData) || !eq(t.data, expectedData))
        return fail();
    return r;
}
export async function signRobinhoodApproval(value: unknown, expected: RobinhoodScope, account: string, draft: RobinhoodDraft, provider: RobinhoodProvider, sign: RobinhoodSigner, isCurrent: () => boolean = () => true): Promise<Hex> { const r = inspectRobinhoodApproval(value, expected, account, draft), t = r.transaction; const verify = async () => { if (!isCurrent())
    return fail('Your account or stock changed. Review again.'); const [chain, accounts, nonce] = await Promise.all([provider.request({ method: 'eth_chainId' }), provider.request({ method: 'eth_accounts' }), provider.request({ method: 'eth_getTransactionCount', params: [account, 'pending'] })]); if (!isCurrent()) return fail('Your account or stock changed. Review again.');
    if(typeof chain !== 'string'||!/^0x[0-9a-f]+$/i.test(chain)||BigInt(chain)!==46630n)return fail('Your wallet has not switched to the stock network yet. Try again.');
    if(!Array.isArray(accounts)||!accounts.some(a=>typeof a==='string'&&eq(a,account)))return fail('The connected stock wallet changed. Reload your account.');
    if(typeof nonce!=='string'||!/^0x[0-9a-f]+$/i.test(nonce)||BigInt(nonce)!==BigInt(t.nonce))return fail('The wallet transaction count changed. Prepare a fresh stock request.'); }; await verify(); if (!isCurrent())
    return fail(); const raw = await sign({ chainId: 46630, type: 2, from: account as Hex, to: t.to as Hex, data: t.data as Hex, value: 0n, nonce: Number(t.nonce), gasLimit: BigInt(t.gas), maxFeePerGas: BigInt(t.maxFeePerGas), maxPriorityFeePerGas: BigInt(t.maxPriorityFeePerGas) }); if (!/^0x02[a-f0-9]+$/i.test(raw))
    return fail(); const tx = parseTransaction(raw as `0x02${string}`); if (!isCurrent() || tx.chainId !== 46630 || tx.type !== 'eip1559' || tx.to?.toLowerCase() !== t.to.toLowerCase() || tx.data?.toLowerCase() !== t.data.toLowerCase() || (tx.value ?? 0n) !== 0n || tx.nonce !== Number(t.nonce) || tx.gas !== BigInt(t.gas) || tx.maxFeePerGas !== BigInt(t.maxFeePerGas) || (tx.maxPriorityFeePerGas ?? 0n) !== BigInt(t.maxPriorityFeePerGas) || tx.accessList && tx.accessList.length || !eq(await recoverTransactionAddress({ serializedTransaction: raw as `0x02${string}` }), account) || Date.parse(r.expires_at) <= Date.now())
    return fail(); await verify(); return raw; }
export function robinhoodRequestDraft(r: RobinhoodRequest): RobinhoodDraft { const stock = robinhoodMarketSymbol(r.market_id), side = eq(r.intent.tokenIn, P.settlement) ? 'buy' : 'sell'; return { symbol: stock, kind: r.kind, side, amount: fromAtomic(BigInt(r.intent.amountInBaseUnits), side === 'buy' ? 6 : 18), slippageBps: r.quote?.slippageBps ?? 50 }; }
export function robinhoodRequestLabel(r: RobinhoodRequest): string { if (r.state !== 'completed')
    return ({ prepared: 'Needs approval', sending: 'Submitting', confirming: 'Confirming', unknown: 'Checking transaction', cancelled: r.tx_hash?'Cancelled':'Expired before submission', reverted: 'Reverted' } as Record<string, string>)[r.state] ?? 'Check status'; const p = r.proof; if (!p || p.state !== 'confirmed' || typeof p.txHash !== 'string' || p.txHash !== r.tx_hash || !integer.safeParse(p.blockNumber).success || BigInt(String(p.blockNumber)) <= 0n || typeof p.confirmations !== 'string' || !integer.safeParse(p.confirmations).success || BigInt(p.confirmations) < 2n)
    return 'Checking execution'; if (r.kind === 'approval')
    return p.allowanceBaseUnits === r.intent.amountInBaseUnits ? 'Approved' : 'Checking execution'; if (p.price_basis !== 'testnet_pool_quote' || p.amountInBaseUnits !== r.intent.amountInBaseUnits || !integer.safeParse(p.amountOutBaseUnits).success || BigInt(String(p.amountOutBaseUnits)) < BigInt(r.intent.minimumOutBaseUnits!))
    return 'Checking execution'; if(p.balance_basis==='canonical_transfer_events'){if(!Array.isArray(p.balanceDeltas)||p.balanceDeltas.length!==2)return 'Checking execution';for(const[token,delta]of [[r.intent.tokenIn,-BigInt(r.intent.amountInBaseUnits)],[r.intent.tokenOut!,BigInt(String(p.amountOutBaseUnits))]]as const){const rows=p.balanceDeltas.filter((v:any)=>typeof v?.token==='string'&&eq(v.token,token));if(rows.length!==1||rows[0].deltaBaseUnits!==delta.toString())return 'Checking execution';}}else{if(!Array.isArray(p.balances)||p.balances.length!==2)return 'Checking execution';for (const [token, delta] of [[r.intent.tokenIn, -BigInt(r.intent.amountInBaseUnits)], [r.intent.tokenOut!, BigInt(String(p.amountOutBaseUnits))]] as const) {
    const rows = p.balances.filter((v: any) => typeof v?.token === 'string' && eq(v.token, token));
    if (rows.length !== 1)
        return 'Checking execution';
    const b = rows[0];
    if (!integer.safeParse(b.beforeBaseUnits).success || !integer.safeParse(b.afterBaseUnits).success || BigInt(b.afterBaseUnits) - BigInt(b.beforeBaseUnits) !== delta || b.deltaBaseUnits !== delta.toString())
        return 'Checking execution';
}} const s = robinhoodMarketSymbol(r.market_id), buy = eq(r.intent.tokenIn, P.settlement), shares = buy ? String(p.amountOutBaseUnits) : r.intent.amountInBaseUnits; return `${buy ? 'Bought' : 'Sold'} ${formatTokenAmount(fromAtomic(BigInt(shares), 18))} ${s}`; }
