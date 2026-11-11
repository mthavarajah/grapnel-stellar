import { describe, expect, it } from "vitest";
import {
  environmentFindings,
  artifactFindings,
  readinessReport,
  parseCommandLine,
} from "./preflight.js";
const api = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://operator:fixture@database.internal/grapnel",
  STELLAR_NETWORK: "testnet",
  STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  ADMIN_LOGIN_SECRET: "test-fixture-owner-secret",
  SESSION_SECRET: "test-fixture-session-secret-at-least-32-characters",
  DASHBOARD_ORIGIN: "https://dashboard.grapnel.app",
  FINTECH_ORIGIN: "https://fintech.grapnel.app",
  PRIVY_APP_ID: "fixture-app-id",
  PRIVY_APP_SECRET: "must-never-print-secret-value",
  TESTNET_FUNDING_ENABLED: "false",
};
describe("offline deployment preflight", () => {
  it("validates the current explicit container sources and runtime commands", () =>
    expect(artifactFindings()).toEqual([]));
  it("accepts core production API names with disabled funding without treasury credentials", () =>
    expect(environmentFindings("api", api)).toEqual([]));
  it("reports only names for missing values and wrong network", () => {
    const findings = environmentFindings("worker", {
      ...api,
      DATABASE_URL: undefined,
      STELLAR_NETWORK: "public",
    });
    expect(findings).toEqual(["DATABASE_URL", "STELLAR_NETWORK"]);
  });
  it("requires explicit treasury and quota names only when funding is enabled", () =>
    expect(
      environmentFindings("api", { ...api, TESTNET_FUNDING_ENABLED: "true" }),
    ).toEqual([
      "DEMO_TREASURY_SECRET",
      "TESTNET_FUNDING_MAX_GLOBAL_ATOMIC",
      "TESTNET_FUNDING_MAX_PER_CUSTOMER_ATOMIC",
      "TESTNET_FUNDING_MAX_PER_TENANT_ATOMIC",
    ]));
  it("rejects local and credential-bearing public API URLs", () => {
    for (const GRAPNEL_API_URL of [
      "https://localhost",
      "https://127.0.0.1",
      "http://api.grapnel.app",
      "https://operator:secret@api.grapnel.app",
      "https://api.grapnel.app/path",
      "https://api.invalid",
    ])
      expect(
        environmentFindings("dashboard", {
          NODE_ENV: "production",
          GRAPNEL_API_URL,
        }),
      ).toEqual(["GRAPNEL_API_URL"]);
  });
  it("catches mismatched Privy apps, short sessions and public secret names without disclosing values", () => {
    const env = {
      NODE_ENV: "production",
      GRAPNEL_API_URL: "https://api.grapnel.app",
      GRAPNEL_API_KEY: "gr_test_fixture-long-enough-business-key",
      PRIVY_APP_ID: "server-app",
      PRIVY_APP_SECRET: "must-never-print-secret-value",
      NEXT_PUBLIC_PRIVY_APP_ID: "different-client-app",
      FINTECH_SESSION_SECRET: "short",
      NEXT_PUBLIC_GRAPNEL_NETWORK: "stellar-testnet",
      NEXT_PUBLIC_PRIVY_APP_SECRET: "must-never-print-secret-value",
    };
    const report = readinessReport("fintech", env);
    expect(report.missing_or_invalid_env).toEqual([
      "FINTECH_SESSION_SECRET",
      "NEXT_PUBLIC_PRIVY_APP_ID",
      "NEXT_PUBLIC_PRIVY_APP_SECRET",
    ]);
    expect(JSON.stringify(report)).not.toContain(
      "must-never-print-secret-value",
    );
  });
  it("fails closed on unknown or conflicting command arguments", () => {
    expect(parseCommandLine(["--static"])).toEqual({
      service: undefined,
      envFile: undefined,
    });
    for (const args of [
      ["--service", "unknown"],
      ["--static", "--service", "api"],
      ["--env-file", "ignored.env"],
      ["--servcie", "api"],
    ])
      expect(() => parseCommandLine(args)).toThrow();
  });
});
