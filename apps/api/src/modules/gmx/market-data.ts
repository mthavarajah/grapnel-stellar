import type { Pool } from 'pg';
import { GrapnelError, fromAtomic } from '@grapnel/contracts';
import { createGmxTestnetAdapter, GMX_TESTNET, type GmxTestnetAdapter, type GmxSymbol } from '../../adapters/gmx/index.js';
import { HISTORY_RANGES, MarketDataService, priceChange, type HistoryRange, type MarketHistory } from '../market-data/service.js';
const P = GMX_TESTNET, PREFIX = 'gmx-testnet:perps:', SYMBOLS = ['ETH', 'BTC'] as const, NAMES = { ETH: 'Ethereum', BTC: 'Bitcoin' };
const WINDOWS: Record<Exclude<HistoryRange, 'all'>, number> = { live: 3600000, '1d': 86400000, '1w': 604800000, '1m': 2592000000, '1y': 31536000000 };
type Quote = Awaited<ReturnType<GmxTestnetAdapter['readMarket']>>;
const unavailable = (): never => { throw new GrapnelError(503, 'MARKET_PRICE_UNAVAILABLE', 'An exact current GMX Testnet oracle observation is required', true); };
/** GMX API v1 prices are USD per whole index token, scaled by 10^30.
 * This differs from order acceptablePrice, which additionally divides by 10^indexDecimals. */
export function gmxHumanPrice30(value: string): string { if (typeof value !== 'string' || !/^[1-9]\d{0,77}$/.test(value))
    return unavailable(); const [whole, fraction = ''] = fromAtomic(BigInt(value), 30).split('.'), tail = fraction.replace(/0+$/, ''); return whole + (tail ? '.' + tail : ''); }
/** Catalog observations never establish a customer trading capability or position. */
export class GmxMarketData {
    private readonly now: () => number;
    private readonly persistent: MarketDataService | null;
    private readonly quotes = new Map<string, Quote>();
    private readonly observed = new Map<string, {
        timestamp: string;
        price: string;
    }[]>();
    private readonly truncated = new Set<string>();
    constructor(pool?: Pool, private readonly adapter: Pick<GmxTestnetAdapter, 'readMarket'> = createGmxTestnetAdapter(), options: {
        now?: () => number;
    } = {}) { this.now = options.now ?? Date.now; this.persistent = pool ? new MarketDataService(pool, async (id) => { const q = await this.read(id); return { market_id: id, price: gmxHumanPrice30(q.price_min30), quote_symbol: 'USD', observed_at: q.quote_observed_at, source: P.prices + '#oracle-min-usd30' }; }, { now: this.now }) : null; }
    private resolve(id: string): GmxSymbol { const symbol = SYMBOLS.find(s => id === PREFIX + s); if (!symbol)
        throw new GrapnelError(404, 'NOT_FOUND', 'GMX market not found'); return symbol; }
    private async read(id: string) { const symbol = this.resolve(id), market = P.markets[symbol], q = await this.adapter.readMarket(symbol); const at = Date.parse(q.quote_observed_at); if (q.market_id !== id || q.symbol !== symbol || q.market_address !== market.market || q.index_token !== market.indexToken || q.index_decimals !== market.decimals || !Number.isFinite(at) || at > this.now() + 1000 || this.now() - at > 30000)
        return unavailable(); gmxHumanPrice30(q.price_min30); gmxHumanPrice30(q.price_max30); if (BigInt(q.price_max30) < BigInt(q.price_min30))
        return unavailable(); this.quotes.set(id, structuredClone(q)); const rows = this.observed.get(id) ?? [], old = rows.find(p => p.timestamp === q.quote_observed_at), price = gmxHumanPrice30(q.price_min30); if (old && old.price !== price)
        return unavailable(); if (!old) {
        rows.push({ timestamp: q.quote_observed_at, price });
        rows.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        if (rows.length > 10000) {
            rows.splice(0, rows.length - 10000);
            this.truncated.add(id);
        }
        this.observed.set(id, rows);
    } return q; }
    private async observe(id: string) { if (this.persistent) {
        await this.persistent.observe(id);
        const q = this.quotes.get(id);
        if (!q)
            return unavailable();
        return q;
    } return this.read(id); }
    private metadata(symbol: GmxSymbol) {
        const market = P.markets[symbol], collateral = P.pins.collateral.address, settlementId = `arbitrum-sepolia:erc20:${collateral}`;
        return {
            id: PREFIX + symbol, market_id: PREFIX + symbol, label: `${symbol} / USDC`, asset_class: 'perps' as const, asset_category: 'crypto' as const, module: 'trade.perps' as const, provider: 'gmx' as const, network: P.network, chain_id: P.chainId, instrument_type: 'perpetual_futures' as const,
            provider_symbol: symbol, provider_dex: 'gmx-v2', underlying: { symbol, name: NAMES[symbol], display_decimals: market.decimals }, base_asset_id: `arbitrum-sepolia:underlying:${symbol}`, market_address: market.market, index_token: market.indexToken, index_decimals: market.decimals,
            quote_symbol: 'USDC', reference_quote_symbol: 'USD', reference_currency: 'USD', price_basis: 'provider_oracle_reference' as const, reference_price_type: 'oracle_min' as const,
            min_leverage: 1, max_leverage: 20, only_isolated: true,
            settlement_asset: { id: settlementId, code: 'USDC', symbol: 'USDC.SG', name: 'USDC.SG', decimals: 6, transfer_decimals: 6, address: collateral, contract_id: collateral, token_id: collateral, network: P.network, chain_id: P.chainId, compatibility: 'usdc' as const, circle_usdc: false },
            source_category: 'crypto', source_classification: 'gmx_official_testnet_index_oracle', source_url: P.prices, registry_source: 'https://github.com/gmx-io/gmx-interface/blob/master/sdk/src/configs/contracts.ts', history_available: true,
            execution_status: 'discovery_only' as const, executable: false, execution_available: false, preparation_available: false, actions: [], reason: 'GMX_CUSTOMER_EXECUTION_PROOF_REQUIRED', reason_message: 'Trading setup is being verified.',
        };
    }
    private priced(id: string, q: Quote) { const symbol = this.resolve(id), min = gmxHumanPrice30(q.price_min30), max = gmxHumanPrice30(q.price_max30); return { ...this.metadata(symbol), reference_price: min, reference_price_atomic: q.price_min30, reference_price_decimals: 30, reference_bid: min, reference_ask: max, reference_midpoint: null, price_min30: q.price_min30, price_max30: q.price_max30, price_status: 'current' as const, price_availability: 'source_context' as const, as_of: q.quote_observed_at, oracle_timestamp: q.quote_observed_at, quote_observed_at: q.quote_observed_at, observed_at: q.quote_observed_at, price_timestamp_basis: 'provider_origin_timestamp', perpetuals_stats: { mark_price: null, oracle_price: min, oracle_price_min: min, oracle_price_max: max, mid_price: null, previous_day_price: null, funding_rate: null, open_interest: null, day_notional_volume: null, day_base_volume: null, premium: null } }; }
    async markets() { return Promise.all(SYMBOLS.map(async (symbol) => { const id = PREFIX + symbol; return this.priced(id, await this.observe(id)); })); }
    async detail(id: string) { this.resolve(id); return this.priced(id, await this.observe(id)); }
    async history(id: string, range: HistoryRange) { const symbol = this.resolve(id); if (!HISTORY_RANGES.includes(range))
        throw new GrapnelError(422, 'INVALID_HISTORY_RANGE', 'Unsupported GMX history range'); let history: MarketHistory; if (this.persistent)
        history = await this.persistent.history(id, range);
    else {
        await this.read(id);
        const since = range === 'all' ? null : this.now() - WINDOWS[range], points = (this.observed.get(id) ?? []).filter(p => (since === null || Date.parse(p.timestamp) >= since) && Date.parse(p.timestamp) <= this.now() + 1000).map(p => ({ ...p })), first = points[0], last = points.at(-1);
        history = { market_id: id, quote_symbol: 'USD', latest_price: last?.price ?? null, as_of: last?.timestamp ?? null, points, ...(first && last && points.length > 1 ? priceChange(first.price, last.price) : { change_absolute: null, change_percent: null }) };
    } return { ...history, base_symbol: symbol, base_asset_id: `arbitrum-sepolia:underlying:${symbol}`, reference_symbol: symbol, settlement_quote_symbol: 'USDC', settlement_token_address: P.pins.collateral.address, price_basis: 'provider_oracle_reference' as const, reference_price_type: 'oracle_min' as const, price_scale: 30, source: 'gmx_official_testnet_oracle', source_url: P.prices, requested_range: range, candles: [] as never[], coverage: { kind: 'observed_only' as const, historical_ohlc_available: false, complete_requested_range: false, observation_count: history.points.length, first_generated_at: history.points[0]?.timestamp ?? null, last_generated_at: history.points.at(-1)?.timestamp ?? null, persisted: this.persistent !== null, truncated: this.truncated.has(id) } }; }
}
