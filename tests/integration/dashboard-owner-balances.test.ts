import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { createPool } from "../../apps/api/src/db/index.js";
import { migrate } from "../../apps/api/src/db/migrate.js";
import { digest } from "../../apps/api/src/lib/crypto.js";
import type { ApiConfig } from "../../apps/api/src/lib/config.js";
import {
  GrapnelError,
  NETWORK_PASSPHRASE,
  type WalletBalance,
} from "../../packages/contracts/src/index.js";

const require = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const { Keypair } = require("@stellar/stellar-sdk");
const databaseUrl = process.env.API_TEST_DATABASE_URL;

// Explicit disposable Postgres only. Balance observations below are interface fixtures;
// this suite performs no provider requests, signing, or chain execution.
describe.skipIf(!databaseUrl)(
  "Dashboard owner balances tenant boundary",
  () => {
    let pool: ReturnType<typeof createPool>;
    let app: Awaited<ReturnType<typeof buildApp>>;
    let unavailableApp: Awaited<ReturnType<typeof buildApp>>;
    let ownerCookie: string;
    let schemaReady = false;
    const businessA = randomUUID();
    const businessB = randomUUID();
    const customerA = randomUUID();
    const customerB = randomUUID();
    const customerWithoutWallet = randomUUID();
    const customerPendingWallet = randomUUID();
    const walletA = randomUUID();
    const walletB = randomUUID();
    const keyA = `gr_test_${randomUUID()}${randomUUID()}`;
    const keyB = `gr_test_${randomUUID()}${randomUUID()}`;
    const origin = "http://localhost:3000";
    const observed: WalletBalance[] = [
      {
        asset_id: "stellar-testnet:native:XLM",
        wallet_amount: "20.1234567",
        reserved: "1.0000000",
        spendable: "18.1234467",
        as_of: "2026-11-11T12:00:00.000Z",
        source: "test_fixture_no_chain_reads",
      },
    ];
    const readBalances = vi.fn(
      async (_businessId: string, _walletId: string) => observed,
    );
    const endpoint = (customerId: string) =>
      `/v1/dashboard/customers/${customerId}/balances`;
    const config: ApiConfig = {
      databaseUrl: databaseUrl!,
      network: "testnet",
      networkPassphrase: NETWORK_PASSPHRASE,
      dashboardOrigin: origin,
      fintechOrigin: "http://localhost:3002",
      adminLoginSecret: "owner-balances-test-only-secret",
      sessionSecret:
        "owner-balances-test-only-session-secret-at-least-32-bytes",
      production: false,
      port: 0,
      demoBusinessId: businessA,
    };

    beforeAll(async () => {
      pool = createPool(databaseUrl!);
      const name = (await pool.query("SELECT current_database() AS name"))
        .rows[0].name;
      if (!name.endsWith("_test"))
        throw new Error(
          "Owner balances tests require a disposable database ending in _test",
        );
      await migrate(pool);
      schemaReady = true;
      for (const [businessId, key, customerId, walletId] of [
        [businessA, keyA, customerA, walletA],
        [businessB, keyB, customerB, walletB],
      ]) {
        await pool.query("INSERT INTO businesses(id,name) VALUES($1,$2)", [
          businessId,
          "Owner balances test tenant",
        ]);
        await pool.query(
          "INSERT INTO api_keys(business_id,prefix,last_four,key_hash,name) VALUES($1,'test-only-key',$2,$3,'Owner balances test fixture')",
          [businessId, key!.slice(-4), digest(key!)],
        );
        await pool.query(
          "INSERT INTO customers(id,business_id,external_customer_id) VALUES($1,$2,$3)",
          [customerId, businessId, `owner-balances-fixture-${customerId}`],
        );
        const address = Keypair.random().publicKey();
        await pool.query(
          "INSERT INTO wallets(id,business_id,customer_id,privy_wallet_id,stellar_address,public_key,status) VALUES($1,$2,$3,$4,$5,$5,'active')",
          [
            walletId,
            businessId,
            customerId,
            `test-only-wallet-${walletId}`,
            address,
          ],
        );
      }
      for (const customerId of [customerWithoutWallet, customerPendingWallet]) {
        await pool.query(
          "INSERT INTO customers(id,business_id,external_customer_id) VALUES($1,$2,$3)",
          [customerId, businessA, `owner-balances-fixture-${customerId}`],
        );
      }
      const pendingAddress = Keypair.random().publicKey();
      await pool.query(
        "INSERT INTO wallets(business_id,customer_id,privy_wallet_id,stellar_address,public_key,status) VALUES($1,$2,'test-only-pending-wallet',$3,$3,'pending')",
        [businessA, customerPendingWallet, pendingAddress],
      );
      app = await buildApp({
        pool,
        config,
        dashboardCustomerBalances: readBalances,
      });
      unavailableApp = await buildApp({ pool, config });
      const login = await app.inject({
        method: "POST",
        url: "/v1/dashboard/login",
        headers: { origin },
        payload: { secret: config.adminLoginSecret },
      });
      expect(login.statusCode).toBe(200);
      expect(login.headers["set-cookie"]).toContain("HttpOnly");
      ownerCookie = `${login.cookies[0]!.name}=${login.cookies[0]!.value}`;
    });

    beforeEach(() => readBalances.mockClear());

    afterAll(async () => {
      await app?.close();
      await unavailableApp?.close();
      if (pool) {
        try {
          if (schemaReady) {
            // Delete only this suite's random tenant fixtures; never reset a shared schema.
            for (const table of [
              "api_request_logs",
              "owner_sessions",
              "wallets",
              "customers",
              "api_keys",
              "businesses",
            ]) {
              await pool.query(
                `DELETE FROM ${table} WHERE ${table === "businesses" ? "id" : "business_id"} = ANY($1::uuid[])`,
                [[businessA, businessB]],
              );
            }
          }
        } finally {
          await pool.end();
        }
      }
    });

    it("rejects a missing owner cookie before any balance callback", async () => {
      const response = await app.inject(endpoint(customerA));
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe("OWNER_SESSION_REQUIRED");
      expect(readBalances).not.toHaveBeenCalled();
    });

    it("does not elevate a valid business API key to an owner session", async () => {
      const headers = { authorization: `Bearer ${keyA}` };
      expect(
        (await app.inject({ url: "/v1/capabilities", headers })).statusCode,
      ).toBe(200);
      const response = await app.inject({ url: endpoint(customerA), headers });
      expect(response.statusCode).toBe(401);
      expect(readBalances).not.toHaveBeenCalled();
    });

    it("returns observed balances from the actual tenant-scoped active wallet", async () => {
      const response = await app.inject({
        url: endpoint(customerA),
        headers: { cookie: ownerCookie },
      });
      expect(response.statusCode).toBe(200);
      expect(readBalances).toHaveBeenCalledExactlyOnceWith(businessA, walletA);
      expect(response.json().data).toMatchObject({
        customer_id: customerA,
        wallet_id: walletA,
        balances: observed,
      });
      expect(Number.isNaN(Date.parse(response.json().data.as_of))).toBe(false);
      expect(response.json().meta.network).toBe("stellar-testnet");
    });

    it("hides a foreign customer even when a foreign business key accompanies the owner cookie", async () => {
      const response = await app.inject({
        url: endpoint(customerB),
        headers: { cookie: ownerCookie, authorization: `Bearer ${keyB}` },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("NOT_FOUND");
      expect(response.json().data).toBeUndefined();
      expect(response.body).not.toContain(customerB);
      expect(response.body).not.toContain(walletB);
      expect(readBalances).not.toHaveBeenCalled();
    });

    it("returns 404 for a nonexistent customer without invoking the reader", async () => {
      const response = await app.inject({
        url: endpoint(randomUUID()),
        headers: { cookie: ownerCookie },
      });
      expect(response.statusCode).toBe(404);
      expect(readBalances).not.toHaveBeenCalled();
    });

    it.each([
      ["absent", customerWithoutWallet],
      ["pending", customerPendingWallet],
    ])(
      "returns an empty balance list when the customer wallet is %s",
      async (_label, customerId) => {
        const response = await app.inject({
          url: endpoint(customerId),
          headers: { cookie: ownerCookie },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().data).toMatchObject({
          customer_id: customerId,
          wallet_id: null,
          balances: [],
        });
        expect(readBalances).not.toHaveBeenCalled();
      },
    );

    it("reports an unavailable balance reader instead of fabricating empty balances", async () => {
      const response = await unavailableApp.inject({
        url: endpoint(customerA),
        headers: { cookie: ownerCookie },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe("BALANCE_UNAVAILABLE");
      expect(response.json().data).toBeUndefined();
    });

    it("preserves a structured provider-read failure without returning balance data", async () => {
      readBalances.mockRejectedValueOnce(
        new GrapnelError(
          503,
          "BALANCE_UNAVAILABLE",
          "Test fixture observation unavailable",
          true,
        ),
      );
      const response = await app.inject({
        url: endpoint(customerA),
        headers: { cookie: ownerCookie },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe("BALANCE_UNAVAILABLE");
      expect(response.json().error.retryable).toBe(true);
      expect(response.json().data).toBeUndefined();
      expect(readBalances).toHaveBeenCalledExactlyOnceWith(businessA, walletA);
    });
  },
);
