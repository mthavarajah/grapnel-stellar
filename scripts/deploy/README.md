# Offline deployment preflight

Run static path/command checks without hosting credentials:

```sh
pnpm exec tsx scripts/deploy/preflight.ts --static
```

Check one service's production environment from platform-injected variables or an ignored environment file:

```sh
pnpm exec tsx scripts/deploy/preflight.ts --service api --env-file /path/to/ignored/api.env
pnpm exec tsx scripts/deploy/preflight.ts --service worker --env-file /path/to/ignored/api.env
pnpm exec tsx scripts/deploy/preflight.ts --service dashboard --env-file /path/to/ignored/dashboard.env
pnpm exec tsx scripts/deploy/preflight.ts --service fintech --env-file /path/to/ignored/fintech.env
```

No provider requests, CLI installation, database connections, signing or external writes occur. Output lists only missing/invalid variable names and local path/field names; secret values are never printed. Existing process environment takes precedence over the supplied file. A failure exits 1; usage errors exit 2. Managed Next hosting normally supplies NODE_ENV itself.

The static check covers explicit Docker COPY paths, API runtime dependency and workspace startup/migration commands, Railway config references, and required source/config presence. It does not replace Render Blueprint schema validation, a container build or the existing CI checks. Service checks reject local/public-placeholder origins, wrong Stellar networks, exposed browser secrets, and mismatched Privy app IDs. Funding credentials/quotas are required only when its switch is true. Soroswap execution additionally needs SOROSWAP_API_KEY and actual route/signing proof; that optional provider key is not required to boot a degraded API.

`ready: true` means local configuration shape passed. It does not establish a hosting account/project, validate provider credentials, prove public reachability, or pass chain acceptance gates.

Hosting inputs still needed by the lead: selected provider and existing account/team/workspace, existing project/service/environment identifiers, managed DATABASE_URL, public API/dashboard/fintech origins, and permission to deploy to that target. Do not create resources or infer spending authority from a successful preflight. Deploy specs remain in `deploy/` and the authoritative runbook is `deploy/README.md`.
