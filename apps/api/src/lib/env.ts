import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Node's environment loader preserves variables already injected by the host.
const rootEnv=fileURLToPath(new URL('../../../../.env',import.meta.url));
if(existsSync(rootEnv))process.loadEnvFile(rootEnv);
