import { readFileSync, existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv, parseArgs } from "node:util";

type Environment = Record<string, string | undefined>;
export type Service = "api" | "worker" | "dashboard" | "fintech";
const root = fileURLToPath(new URL("../../", import.meta.url));
const passphrase = "Test SDF Network ; September 2015";
const required: Record<Service, string[]> = {
  api: [
    "NODE_ENV",
    "DATABASE_URL",
    "STELLAR_NETWORK",
    "STELLAR_NETWORK_PASSPHRASE",
    "ADMIN_LOGIN_SECRET",
    "SESSION_SECRET",
    "DASHBOARD_ORIGIN",
    "FINTECH_ORIGIN",
    "PRIVY_APP_ID",
    "PRIVY_APP_SECRET",
    "TESTNET_FUNDING_ENABLED",
  ],
  worker: [
    "NODE_ENV",
    "DATABASE_URL",
    "STELLAR_NETWORK",
    "STELLAR_NETWORK_PASSPHRASE",
    "ADMIN_LOGIN_SECRET",
    "SESSION_SECRET",
    "DASHBOARD_ORIGIN",
    "FINTECH_ORIGIN",
    "PRIVY_APP_ID",
    "PRIVY_APP_SECRET",
    "TESTNET_FUNDING_ENABLED",
  ],
  dashboard: ["NODE_ENV", "GRAPNEL_API_URL"],
  fintech: [
    "NODE_ENV",
    "GRAPNEL_API_URL",
    "GRAPNEL_API_KEY",
    "PRIVY_APP_ID",
    "PRIVY_APP_SECRET",
    "NEXT_PUBLIC_PRIVY_APP_ID",
    "FINTECH_SESSION_SECRET",
    "NEXT_PUBLIC_GRAPNEL_NETWORK",
  ],
};
const localHost = (host: string) =>
  host === "localhost" ||
  host.endsWith(".localhost") ||
  host === "[::1]" ||
  /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
function publicOrigin(value: string | undefined): boolean {
  try {
    const url = new URL(value ?? "");
    return (
      url.protocol === "https:" &&
      !localHost(url.hostname) &&
      !/\.(invalid|test|example)$/.test(url.hostname) &&
      !["example.com", "example.org", "example.net"].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
/** Returns names only. Values and provider responses are never included in a report. */
export function environmentFindings(
  service: Service,
  env: Environment,
): string[] {
  const missing = new Set(
    required[service].filter((name) => !env[name]?.trim()),
  );
  if (env.NODE_ENV !== "production") missing.add("NODE_ENV");
  const check = (name: string, valid: boolean) => {
    if (!valid) missing.add(name);
  };
  for (const name of Object.keys(env))
    if (
      name.startsWith("NEXT_PUBLIC_") &&
      /(SECRET|API_KEY|DATABASE|TOKEN|PASSWORD)/.test(name)
    )
      missing.add(/^[A-Z0-9_]{1,128}$/.test(name) ? name : "PUBLIC_ENV_NAME");
  if (service === "api" || service === "worker") {
    check("STELLAR_NETWORK", env.STELLAR_NETWORK === "testnet");
    check(
      "STELLAR_NETWORK_PASSPHRASE",
      env.STELLAR_NETWORK_PASSPHRASE === passphrase,
    );
    check("ADMIN_LOGIN_SECRET", (env.ADMIN_LOGIN_SECRET?.length ?? 0) >= 16);
    check("SESSION_SECRET", (env.SESSION_SECRET?.length ?? 0) >= 32);
    for (const name of ["DASHBOARD_ORIGIN", "FINTECH_ORIGIN"])
      check(name, publicOrigin(env[name]));
    try {
      const db = new URL(env.DATABASE_URL ?? "");
      check(
        "DATABASE_URL",
        ["postgres:", "postgresql:"].includes(db.protocol) &&
          !!db.hostname &&
          !localHost(db.hostname) &&
          db.pathname.length > 1,
      );
    } catch {
      missing.add("DATABASE_URL");
    }
    for (const [name, value] of [
      ["STELLAR_HORIZON_URL", "https://horizon-testnet.stellar.org"],
      ["STELLAR_RPC_URL", "https://soroban-testnet.stellar.org"],
    ])
      if (env[name]) check(name, env[name] === value);
    check(
      "TESTNET_FUNDING_ENABLED",
      ["true", "false"].includes(env.TESTNET_FUNDING_ENABLED ?? ""),
    );
    if (env.TESTNET_FUNDING_ENABLED === "true") {
      check(
        "DEMO_TREASURY_SECRET",
        /^S[A-Z2-7]{55}$/.test(env.DEMO_TREASURY_SECRET ?? ""),
      );
      for (const name of [
        "TESTNET_FUNDING_MAX_PER_CUSTOMER_ATOMIC",
        "TESTNET_FUNDING_MAX_PER_TENANT_ATOMIC",
        "TESTNET_FUNDING_MAX_GLOBAL_ATOMIC",
      ])
        check(name, /^[1-9]\d*$/.test(env[name] ?? ""));
    }
  } else {
    check("GRAPNEL_API_URL", publicOrigin(env.GRAPNEL_API_URL));
    if (env.DASHBOARD_ORIGIN)
      check("DASHBOARD_ORIGIN", publicOrigin(env.DASHBOARD_ORIGIN));
    if (service === "fintech") {
      check(
        "GRAPNEL_API_KEY",
        /^gr_test_[A-Za-z0-9_-]{20,}$/.test(env.GRAPNEL_API_KEY ?? ""),
      );
      check(
        "FINTECH_SESSION_SECRET",
        (env.FINTECH_SESSION_SECRET?.length ?? 0) >= 32,
      );
      check(
        "NEXT_PUBLIC_PRIVY_APP_ID",
        !!env.PRIVY_APP_ID && env.NEXT_PUBLIC_PRIVY_APP_ID === env.PRIVY_APP_ID,
      );
      check(
        "NEXT_PUBLIC_GRAPNEL_NETWORK",
        env.NEXT_PUBLIC_GRAPNEL_NETWORK === "stellar-testnet",
      );
    }
  }
  return [...missing].sort();
}
/** Local paths/commands only; this is not a provider schema, account or deployment check. */
export function artifactFindings(directory = root): string[] {
  const issues = new Set<string>();
  const files = [
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "packages/contracts/src/index.ts",
    "apps/api/src/server.ts",
    "apps/api/src/worker.ts",
    "apps/api/src/db/migrate.ts",
    "openapi/grapnel.json",
    "evidence/testnet.json",
    "deploy/Dockerfile.api",
    "deploy/render.yaml",
    ".dockerignore",
  ];
  for (const name of files)
    if (!existsSync(resolve(directory, name))) issues.add(name);
  const json = (name: string): any => {
    try {
      return JSON.parse(readFileSync(resolve(directory, name), "utf8"));
    } catch {
      issues.add(name);
      return {};
    }
  };
  const api = json("apps/api/package.json");
  for (const command of ["start", "worker", "db:migrate"])
    if (!api.scripts?.[command])
      issues.add(`apps/api/package.json#scripts.${command}`);
  if (!api.dependencies?.tsx)
    issues.add("apps/api/package.json#dependencies.tsx");
  for (const name of [
    "apps/dashboard/package.json",
    "apps/fintech-demo/package.json",
  ]) {
    const app = json(name);
    if (!app.dependencies?.next || !app.scripts?.build)
      issues.add(`${name}#next.build`);
  }
  for (const [name, command] of [
    ["deploy/railway-api.json", "start"],
    ["deploy/railway-worker.json", "worker"],
  ]) {
    const config = json(name);
    if (config.build?.dockerfilePath !== "deploy/Dockerfile.api")
      issues.add(`${name}#build.dockerfilePath`);
    if (config.deploy?.startCommand !== `pnpm --filter ${api.name} ${command}`)
      issues.add(`${name}#deploy.startCommand`);
    if (
      command === "start" &&
      (!config.deploy?.preDeployCommand?.includes(
        `pnpm --filter ${api.name} db:migrate`,
      ) ||
        config.deploy?.healthcheckPath !== "/health")
    )
      issues.add(`${name}#deploy.migration.health`);
  }
  if (existsSync(resolve(directory, "deploy/Dockerfile.api"))) {
    for (const line of readFileSync(
      resolve(directory, "deploy/Dockerfile.api"),
      "utf8",
    )
      .split("\n")
      .filter((line) => /^COPY\s/.test(line))) {
      const sources = line.trim().split(/\s+/).slice(1, -1);
      for (const source of sources) {
        const path = resolve(directory, source);
        if (
          !path.startsWith(resolve(directory) + sep) ||
          /[\*?\[]|(?:^|\/)(?:\.env(?:\.|$)|\.git(?:\/|$))/.test(source)
        )
          issues.add("deploy/Dockerfile.api#COPY.explicit_public_sources");
        else if (!existsSync(path))
          issues.add(`deploy/Dockerfile.api#COPY.${source}`);
      }
    }
  }
  return [...issues].sort();
}
export function readinessReport(
  service: Service | undefined,
  env: Environment,
  directory = root,
) {
  const environment = service ? environmentFindings(service, env) : [];
  const artifacts = artifactFindings(directory);
  return {
    ready: environment.length === 0 && artifacts.length === 0,
    service: service ?? "static",
    missing_or_invalid_env: environment,
    missing_or_invalid_files: artifacts,
  };
}
export function parseCommandLine(args: string[]): {
  service?: Service;
  envFile?: string;
} {
  const { values } = parseArgs({
    args,
    options: {
      static: { type: "boolean" },
      service: { type: "string" },
      "env-file": { type: "string" },
    },
    strict: true,
  });
  if (
    (values.service && !Object.hasOwn(required, values.service)) ||
    (values.static && values.service) ||
    (values["env-file"] && !values.service)
  )
    throw new Error("Invalid preflight arguments");
  return {
    service: values.service as Service | undefined,
    envFile: values["env-file"],
  };
}
if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    const selected = parseCommandLine(process.argv.slice(2));
    let env: Environment = process.env;
    try {
      if (selected.envFile)
        env = {
          ...parseEnv(readFileSync(resolve(selected.envFile), "utf8")),
          ...process.env,
        };
    } catch {
      console.error(
        JSON.stringify({ ready: false, missing_or_invalid_env: ["ENV_FILE"] }),
      );
      process.exitCode = 1;
    }
    if (!process.exitCode) {
      const report = readinessReport(selected.service, env);
      console.log(JSON.stringify(report, null, 2));
      if (!report.ready) process.exitCode = 1;
    }
  } catch {
    console.error(
      JSON.stringify({
        ready: false,
        missing_or_invalid_env: ["CLI_ARGUMENTS"],
      }),
    );
    process.exitCode = 2;
  }
}
