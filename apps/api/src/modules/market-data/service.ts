import type { Pool, PoolClient, QueryResultRow } from "pg";
import { GrapnelError } from "@grapnel/contracts";
import { lock, transaction } from "../../db/index.js";

export const HISTORY_RANGES = ["live", "1d", "1w", "1m", "1y", "all"] as const;
export type HistoryRange = (typeof HISTORY_RANGES)[number];
export interface MarketPriceObservation {
  market_id: string;
  price: string;
  quote_symbol: string;
  observed_at: string;
  source: string;
}
export type MarketPriceReader = (
  marketId: string,
) => Promise<MarketPriceObservation>;
export interface MarketHistory {
  market_id: string;
  quote_symbol: string;
  latest_price: string | null;
  as_of: string | null;
  points: { timestamp: string; price: string }[];
  change_absolute: string | null;
  change_percent: string | null;
}
const scale = 10n ** 18n;
const durations: Record<Exclude<HistoryRange, "all">, number> = {
  live: 3600000,
  "1d": 86400000,
  "1w": 604800000,
  "1m": 2592000000,
  "1y": 31536000000,
};
const fail = (code: string, message: string, status = 422): never => {
  throw new GrapnelError(status, code, message);
};
function identifier(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 200 ||
    value.trim() !== value ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    fail("INVALID_MARKET_ID", "A bounded public market identifier is required");
}
export function normalizePrice(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d{0,59})(?:\.\d{1,18})?$/.test(value)
  )
    return fail(
      "INVALID_MARKET_PRICE",
      "Price must be a positive decimal string with at most 60 integer and 18 fractional digits",
    );
  const [whole, fraction = ""] = value.split(".");
  if (BigInt(whole! + fraction) === 0n)
    return fail(
      "INVALID_MARKET_PRICE",
      "A positive observed price is required",
    );
  const tail = fraction.replace(/0+$/, "");
  return whole! + (tail ? "." + tail : "");
}
function scaled(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * scale + BigInt(fraction.padEnd(18, "0"));
}
function decimal(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const digits = (value < 0n ? -value : value).toString().padStart(19, "0");
  const tail = digits.slice(-18).replace(/0+$/, "");
  return sign + digits.slice(0, -18) + (tail ? "." + tail : "");
}
export function priceChange(
  first: string,
  last: string,
): { change_absolute: string; change_percent: string | null } {
  const baseline = scaled(normalizePrice(first));
  const difference = scaled(normalizePrice(last)) - baseline;
  const percent = (difference * 100n * scale) / baseline;
  return {
    change_absolute: decimal(difference),
    change_percent:
      percent === 0n && difference !== 0n ? null : decimal(percent),
  };
}
function validateObservation(
  marketId: string,
  value: MarketPriceObservation,
  now: number,
): MarketPriceObservation {
  if (!value || value.market_id !== marketId)
    fail(
      "MARKET_PRICE_PROVIDER_MISMATCH",
      "Provider observation does not match the requested market",
      502,
    );
  const price = normalizePrice(value.price);
  if (
    typeof value.quote_symbol !== "string" ||
    !/^[A-Za-z][A-Za-z0-9._:-]{0,31}$/.test(value.quote_symbol)
  )
    fail("INVALID_PRICE_OBSERVATION", "A canonical quote symbol is required");
  if (
    typeof value.source !== "string" ||
    value.source.length < 1 ||
    value.source.length > 512 ||
    value.source.trim() !== value.source ||
    /[\x00-\x1f\x7f]/.test(value.source)
  )
    fail("INVALID_PRICE_OBSERVATION", "A bounded canonical source is required");
  if (
    typeof value.observed_at !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(
      value.observed_at,
    )
  )
    fail(
      "INVALID_PRICE_OBSERVATION",
      "An actual UTC observation timestamp is required",
    );
  const date = new Date(value.observed_at);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 19) !== value.observed_at.slice(0, 19) ||
    date.getTime() > now + 5000
  )
    fail(
      "INVALID_PRICE_OBSERVATION",
      "Observation timestamp is invalid or in the future",
    );
  return {
    market_id: marketId,
    price,
    quote_symbol: value.quote_symbol,
    source: value.source,
    observed_at: date.toISOString(),
  };
}
function stored(row: QueryResultRow): MarketPriceObservation {
  return {
    market_id: row.market_id,
    price: normalizePrice(row.price),
    quote_symbol: row.quote_symbol,
    source: row.source,
    observed_at: new Date(row.observed_at).toISOString(),
  };
}
const historySql = `WITH ranked AS (
 SELECT observed_at, observed_bucket, price::text AS price,
  row_number() OVER (ORDER BY observed_at, observed_bucket) AS row_index,
  count(*) OVER () AS total
 FROM market_price_observations
 WHERE market_id=$1 AND ($2::timestamptz IS NULL OR observed_at >= $2)
  AND observed_at <= $3::timestamptz
), sampled AS (
 SELECT observed_at, observed_bucket, price FROM ranked
 WHERE total <= 1000 OR row_index=1 OR row_index=total
  OR mod(row_index-1,GREATEST(1,ceil((total-1)::numeric/999)::bigint))=0
)
SELECT observed_at, price FROM sampled ORDER BY observed_at, observed_bucket LIMIT 1000`;

/** Public market observations only; entitlement/authentication belongs to the caller. */
export class MarketDataService {
  private readonly now: () => number;
  private readonly pending = new Map<string, Promise<MarketPriceObservation>>();
  constructor(
    private readonly pool: Pool,
    private readonly readPrice: MarketPriceReader,
    options: { now?: () => number } = {},
  ) {
    this.now = options.now ?? Date.now;
  }
  async observe(marketId: string): Promise<MarketPriceObservation> {
    identifier(marketId);
    const inFlight = this.pending.get(marketId);
    if (inFlight) return inFlight;
    const task = (async () => {
      let raw: MarketPriceObservation;
      try {
        raw = await this.readPrice(marketId);
      } catch (error) {
        if (error instanceof GrapnelError) throw error;
        throw new GrapnelError(
          503,
          "MARKET_PRICE_UNAVAILABLE",
          "A real market observation could not be read",
          true,
        );
      }
      const observation = validateObservation(marketId, raw, this.now());
      return transaction(this.pool, async (client) =>
        this.persist(client, observation),
      );
    })();
    this.pending.set(marketId, task);
    try {
      return await task;
    } finally {
      if (this.pending.get(marketId) === task) this.pending.delete(marketId);
    }
  }
  private async persist(
    client: PoolClient,
    observation: MarketPriceObservation,
  ): Promise<MarketPriceObservation> {
    await lock(client, `market-price:${observation.market_id}`);
    const metadata = (
      await client.query(
        "SELECT DISTINCT quote_symbol, source FROM market_price_observations WHERE market_id=$1 LIMIT 2",
        [observation.market_id],
      )
    ).rows;
    if (
      metadata.length > 1 ||
      (metadata[0] &&
        (metadata[0].quote_symbol !== observation.quote_symbol ||
          metadata[0].source !== observation.source))
    )
      fail(
        "MARKET_PRICE_METADATA_CHANGED",
        "Stored market quote symbol and source are immutable",
        409,
      );
    const bucket = new Date(
      Math.floor(Date.parse(observation.observed_at) / 15000) * 15000,
    ).toISOString();
    const existing = (
      await client.query(
        "SELECT market_id, observed_at, price::text AS price, quote_symbol, source FROM market_price_observations WHERE market_id=$1 AND observed_bucket=$2 FOR UPDATE",
        [observation.market_id, bucket],
      )
    ).rows[0];
    if (existing) {
      const previous = stored(existing);
      if (
        previous.observed_at === observation.observed_at &&
        previous.price !== observation.price
      )
        fail(
          "MARKET_PRICE_OBSERVATION_CONFLICT",
          "The same source timestamp returned conflicting prices",
          409,
        );
      if (previous.observed_at >= observation.observed_at) return previous;
      await client.query(
        "UPDATE market_price_observations SET observed_at=$3, price=$4 WHERE market_id=$1 AND observed_bucket=$2",
        [
          observation.market_id,
          bucket,
          observation.observed_at,
          observation.price,
        ],
      );
    } else {
      await client.query(
        "INSERT INTO market_price_observations (market_id,observed_bucket,observed_at,price,quote_symbol,source) VALUES($1,$2,$3,$4,$5,$6)",
        [
          observation.market_id,
          bucket,
          observation.observed_at,
          observation.price,
          observation.quote_symbol,
          observation.source,
        ],
      );
    }
    return observation;
  }
  async history(marketId: string, range: HistoryRange): Promise<MarketHistory> {
    identifier(marketId);
    if (!HISTORY_RANGES.includes(range))
      fail("INVALID_HISTORY_RANGE", "Unsupported market history range");
    const observation = await this.observe(marketId);
    const now = this.now();
    const since =
      range === "all" ? null : new Date(now - durations[range]).toISOString();
    const rows = (
      await this.pool.query(historySql, [
        marketId,
        since,
        new Date(now + 5000).toISOString(),
      ])
    ).rows;
    const points = rows.map((row) => ({
      timestamp: new Date(row.observed_at).toISOString(),
      price: normalizePrice(row.price),
    }));
    const latest = points.at(-1);
    const changes =
      points.length > 1
        ? priceChange(points[0]!.price, latest!.price)
        : { change_absolute: null, change_percent: null };
    return {
      market_id: marketId,
      quote_symbol: observation.quote_symbol,
      latest_price: latest?.price ?? null,
      as_of: latest?.timestamp ?? null,
      points,
      ...changes,
    };
  }
}
