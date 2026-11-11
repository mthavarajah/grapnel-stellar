import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPool } from "../../apps/api/src/db/index.js";
import { migrate } from "../../apps/api/src/db/migrate.js";
import {
  MarketDataService,
  type MarketPriceObservation,
  type HistoryRange,
} from "../../apps/api/src/modules/market-data/index.js";
const url =
  process.env.MARKET_DATA_TEST_DATABASE_URL ??
  process.env.API_TEST_DATABASE_URL;
const now = Date.parse("2026-11-11T18:00:00.000Z");
const suiteId = randomUUID();
const markets = new Set<string>();
const market = () => {
  const id = `test-only-price-history:${suiteId}:${randomUUID()}`;
  markets.add(id);
  return id;
};
const observation = (
  id: string,
  price = "1",
  observedAt = now,
): MarketPriceObservation => ({
  market_id: id,
  price,
  quote_symbol: "USD",
  observed_at: new Date(observedAt).toISOString(),
  source: "test-fixture-no-provider-requests",
});
// Actual PostgreSQL storage/query tests, with explicit synthetic observation fixtures.
// No external price request, financial execution or historical price evidence is claimed.
describe.skipIf(!url)("Public market price history on PostgreSQL", () => {
  let pool: ReturnType<typeof createPool>;
  let schemaReady = false;
  beforeAll(async () => {
    pool = createPool(url!);
    const name = (await pool.query("SELECT current_database() AS name")).rows[0]
      .name;
    if (!name.endsWith("_test"))
      throw Error("Market history tests require a disposable _test database");
    await migrate(pool);
    schemaReady = true;
  });
  afterAll(async () => {
    if (pool) {
      try {
        if (schemaReady)
          await pool.query(
            "DELETE FROM market_price_observations WHERE market_id=ANY($1::text[])",
            [[...markets]],
          );
      } finally {
        await pool.end();
      }
    }
  });
  it("persists one actual observation without inventing history or a change", async () => {
    const id = market();
    const read = vi.fn(async () =>
      observation(id, "9007199254740993.000000000000000001"),
    );
    const service = new MarketDataService(pool, read, { now: () => now });
    const history = await service.history(id, "live");
    expect(read).toHaveBeenCalledExactlyOnceWith(id);
    expect(history).toEqual({
      market_id: id,
      quote_symbol: "USD",
      latest_price: "9007199254740993.000000000000000001",
      as_of: new Date(now).toISOString(),
      points: [
        {
          timestamp: new Date(now).toISOString(),
          price: "9007199254740993.000000000000000001",
        },
      ],
      change_absolute: null,
      change_percent: null,
    });
    const stored = (
      await pool.query(
        "SELECT count(*)::text AS count FROM market_price_observations WHERE market_id=$1",
        [id],
      )
    ).rows[0];
    expect(stored.count).toBe("1");
  });
  it("keeps the latest real observation in a bucket without overwriting metadata", async () => {
    const id = market();
    let current = observation(id, "1.1", now - 14000);
    const service = new MarketDataService(pool, async () => current, {
      now: () => now,
    });
    await service.observe(id);
    current = observation(id, "1.2", now - 1000);
    await service.observe(id);
    current = observation(id, "1.05", now - 13000);
    await service.observe(id);
    const rows = (
      await pool.query(
        "SELECT price::text AS price,observed_at FROM market_price_observations WHERE market_id=$1",
        [id],
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].price).toBe("1.200000000000000000");
    expect(new Date(rows[0].observed_at).toISOString()).toBe(
      new Date(now - 1000).toISOString(),
    );
  });
  it("is idempotent at an identical timestamp and rejects a contradictory value", async () => {
    const id = market();
    let current = observation(id, "2.5000");
    const service = new MarketDataService(pool, async () => current, {
      now: () => now,
    });
    await service.observe(id);
    current = observation(id, "2.5");
    await service.observe(id);
    current = observation(id, "2.6");
    await expect(service.observe(id)).rejects.toMatchObject({
      code: "MARKET_PRICE_OBSERVATION_CONFLICT",
    });
    expect(
      (
        await pool.query(
          "SELECT count(*)::text AS count FROM market_price_observations WHERE market_id=$1",
          [id],
        )
      ).rows[0].count,
    ).toBe("1");
  });
  it.each(["quote_symbol", "source"] as const)(
    "rejects changing %s for a public market series",
    async (field) => {
      const id = market();
      let current = observation(id);
      const service = new MarketDataService(pool, async () => current, {
        now: () => now,
      });
      await service.observe(id);
      current = {
        ...observation(id, "2", now + 1000),
        [field]:
          field === "quote_symbol" ? "XLM" : "different-test-fixture-source",
      };
      await expect(service.observe(id)).rejects.toMatchObject({
        code: "MARKET_PRICE_METADATA_CHANGED",
      });
    },
  );
  it("serializes concurrent writers with conflicting quote units", async () => {
    const id = market();
    const a = new MarketDataService(pool, async () => observation(id), {
      now: () => now,
    });
    const b = new MarketDataService(
      pool,
      async () => ({ ...observation(id), quote_symbol: "XLM" }),
      { now: () => now },
    );
    const result = await Promise.allSettled([a.observe(id), b.observe(id)]);
    expect(result.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(
      (
        result.find(
          (item) => item.status === "rejected",
        ) as PromiseRejectedResult
      ).reason.code,
    ).toBe("MARKET_PRICE_METADATA_CHANGED");
  });
  it("deduplicates simultaneous provider reads in one service instance", async () => {
    const id = market();
    const read = vi.fn(async () => observation(id));
    const service = new MarketDataService(pool, read, { now: () => now });
    await Promise.all([service.observe(id), service.observe(id)]);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("samples no more than 1000 real rows deterministically while retaining both endpoints", async () => {
    const id = market();
    const total = 2005;
    const start = now - (total - 1) * 15000;
    await pool.query(
      `INSERT INTO market_price_observations(market_id,observed_bucket,observed_at,price,quote_symbol,source)
    SELECT $1,to_timestamp(($2::bigint+point*15000)/1000.0),to_timestamp(($2::bigint+point*15000)/1000.0),(point+1)::numeric,'USD','test-fixture-no-provider-requests' FROM generate_series(0,$3::int-1) AS point`,
      [id, start, total],
    );
    const service = new MarketDataService(
      pool,
      async () => observation(id, String(total)),
      { now: () => now },
    );
    const first = await service.history(id, "all"),
      second = await service.history(id, "all");
    expect(first.points.length).toBeLessThanOrEqual(1000);
    expect(first.points).toEqual(second.points);
    expect(first.points[0]).toEqual({
      timestamp: new Date(start).toISOString(),
      price: "1",
    });
    expect(first.points.at(-1)).toEqual({
      timestamp: new Date(now).toISOString(),
      price: String(total),
    });
    expect(first.change_absolute).toBe("2004");
    expect(first.change_percent).toBe("200400");
    for (const point of first.points)
      expect(point.price).toBe(
        String((Date.parse(point.timestamp) - start) / 15000 + 1),
      );
  });
  it.each([
    ["live", 3600000],
    ["1d", 86400000],
    ["1w", 604800000],
    ["1m", 2592000000],
    ["1y", 31536000000],
  ] as const)(
    "uses the actual %s range and does not extend old observations",
    async (range, duration) => {
      const id = market();
      let current = observation(id, "2", now - duration - 15000);
      const service = new MarketDataService(pool, async () => current, {
        now: () => now,
      });
      await service.observe(id);
      current = observation(id, "3");
      const result = await service.history(id, range);
      expect(result.points).toEqual([
        { timestamp: new Date(now).toISOString(), price: "3" },
      ]);
      expect(result.change_absolute).toBeNull();
      expect(result.change_percent).toBeNull();
    },
  );
  it("returns an empty selected range with its real series unit and no invented latest price", async () => {
    const id = market();
    const service = new MarketDataService(
      pool,
      async () => observation(id, "2", now - 7200000),
      { now: () => now },
    );
    const result = await service.history(id, "live");
    expect(result).toMatchObject({
      quote_symbol: "USD",
      points: [],
      latest_price: null,
      as_of: null,
      change_absolute: null,
      change_percent: null,
    });
  });
  it("does not persist invalid provider identity, precision or future timestamp", async () => {
    const id = market();
    for (const current of [
      { ...observation(id), market_id: market() },
      { ...observation(id), price: "0.0000000000000000001" },
      observation(id, "2", now + 6000),
    ]) {
      const service = new MarketDataService(pool, async () => current, {
        now: () => now,
      });
      await expect(service.observe(id)).rejects.toBeInstanceOf(Error);
    }
    expect(
      (
        await pool.query(
          "SELECT count(*)::text AS count FROM market_price_observations WHERE market_id=$1",
          [id],
        )
      ).rows[0].count,
    ).toBe("0");
  });
  it("validates market and range bounds before calling a provider", async () => {
    const read = vi.fn();
    const service = new MarketDataService(pool, read, { now: () => now });
    await expect(
      service.history("x".repeat(201), "live"),
    ).rejects.toMatchObject({ code: "INVALID_MARKET_ID" });
    await expect(
      service.history("valid", "invalid" as HistoryRange),
    ).rejects.toMatchObject({ code: "INVALID_HISTORY_RANGE" });
    expect(read).not.toHaveBeenCalled();
  });
  it("keeps SQL-looking identifiers as bound data and sanitizes provider failures", async () => {
    const id = `test-${suiteId}'); DROP TABLE market_price_observations; --`;
    markets.add(id);
    const service = new MarketDataService(pool, async () => observation(id), {
      now: () => now,
    });
    expect((await service.history(id, "live")).market_id).toBe(id);
    const failing = new MarketDataService(pool, async () => {
      throw Error("private provider transport detail");
    });
    await expect(failing.history(market(), "all")).rejects.toMatchObject({
      code: "MARKET_PRICE_UNAVAILABLE",
      message: "A real market observation could not be read",
    });
  });
});
