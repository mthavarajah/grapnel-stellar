import { StrKey } from '@stellar/stellar-sdk';

const ORIGIN = 'https://ztellar-edge.vercel.app';
const ARTIFACTS = [
  { name: 'circuit_wasm', path: '/zk/tier_proof.wasm', magic: [0, 97, 115, 109] },
  { name: 'proving_key', path: '/zk/tier_proof_0001.zkey', magic: [122, 107, 101, 121] },
] as const;

/** Public normal-user prerequisite discovery only. Never refreshes an oracle,
 * signs, generates a tier, posts a proof or constructs a financial transaction.
 * An artifact header establishes availability, not circuit/deployment equivalence.
 */
export async function readZtellarAccess(wallet: string, request: typeof fetch = fetch) {
  if (!StrKey.isValidEd25519PublicKey(wallet)) throw new Error('INVALID_CUSTOMER_ADDRESS');
  const options: RequestInit = { method: 'GET', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(8_000) };
  const artifacts = await Promise.all(ARTIFACTS.map(async (artifact) => {
    const url = ORIGIN + artifact.path;
    try {
      const response = await request(url, options);
      if (!response.ok) {
        await response.body?.cancel();
        return { name: artifact.name, url, httpStatus: response.status, status: response.status === 404 ? 'missing' as const : 'unavailable' as const };
      }
      const reader = response.body?.getReader();
      const prefix: number[] = [];
      try {
        while (reader && prefix.length < artifact.magic.length) {
          const chunk = await reader.read();
          if (chunk.done) break;
          prefix.push(...chunk.value.slice(0, artifact.magic.length - prefix.length));
        }
      } finally { await reader?.cancel(); }
      return { name: artifact.name, url, httpStatus: response.status,
        status: artifact.magic.every((byte, index) => prefix[index] === byte) ? 'present_unverified' as const : 'unexpected_format' as const };
    } catch {
      return { name: artifact.name, url, httpStatus: null, status: 'unavailable' as const };
    }
  }));
  const blockers: string[] = [];
  for (const artifact of artifacts) {
    if (artifact.status !== 'present_unverified') blockers.push(artifact.name === 'proving_key' ? 'PROVING_KEY_UNAVAILABLE' : 'CIRCUIT_WASM_UNAVAILABLE');
  }
  // Public account heuristic and a valid Groth16 computation are not verified
  // KYC/credit nor a cryptographic binding of wallet ownership or score provenance.
  blockers.push('PROVING_KEY_DEPLOYMENT_MATCH_REQUIRED', 'VERIFIED_ELIGIBILITY_BINDING_REQUIRED', 'VERIFIED_ORACLE_UPDATE_REQUIRED');
  return { observedAt: new Date().toISOString(), wallet, mode: 'read_only_access_discovery' as const,
    executionStatus: 'blocked' as const, executable: false as const, artifacts, blockers,
    providerPostPerformed: false, onchainWritesPerformed: false, txHash: null };
}
