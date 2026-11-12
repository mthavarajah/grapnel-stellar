import { describe, expect, it, vi } from 'vitest';
import { readZtellarAccess } from './ztellar-access.js';

const WALLET = 'GB4PC65ZHBPVEZMAHY2K2KYMS3RFBIN2FQIE3LGTLEHT2DEWVMTD7JYQ';
const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const zkey = new Uint8Array([122, 107, 101, 121, 1, 0, 0, 0]);

describe('ordinary Ztellar customer proving artifacts', () => {
  it('identifies the missing exact public proving key without invoking an oracle or proof POST', async () => {
    const request = vi.fn<typeof fetch>(async (url) => String(url).endsWith('.wasm')
      ? new Response(wasm) : new Response('Not found', { status: 404 }));
    const report = await readZtellarAccess(WALLET, request);
    expect(report.artifacts.map((row) => row.status)).toEqual(['present_unverified', 'missing']);
    expect(report.blockers).toContain('PROVING_KEY_UNAVAILABLE');
    expect(report.executable).toBe(false);
    expect(report.txHash).toBeNull();
    for (const [url, options] of request.mock.calls) {
      expect(String(url)).toMatch(/^https:\/\/ztellar-edge\.vercel\.app\/zk\//);
      expect(options?.method).toBe('GET');
      expect(options?.credentials).toBe('omit');
    }
  });
  it('does not accept a successful HTML fallback as a proving key', async () => {
    const report = await readZtellarAccess(WALLET, async () => new Response('<html>404</html>'));
    expect(report.artifacts.every((row) => row.status === 'unexpected_format')).toBe(true);
  });
  it('never treats available artifacts as valid eligibility or executed stock proof', async () => {
    const report = await readZtellarAccess(WALLET, async (url) => new Response(String(url).endsWith('.wasm') ? wasm : zkey));
    expect(report.blockers).not.toContain('PROVING_KEY_UNAVAILABLE');
    expect(report.blockers).toContain('PROVING_KEY_DEPLOYMENT_MATCH_REQUIRED');
    expect(report.blockers).toContain('VERIFIED_ELIGIBILITY_BINDING_REQUIRED');
    expect(report.executable).toBe(false);
  });
  it('fails closed on transport failure', async () => {
    const report = await readZtellarAccess(WALLET, async () => { throw new Error('timeout'); });
    expect(report.artifacts.every((row) => row.status === 'unavailable')).toBe(true);
    expect(report.blockers).toContain('PROVING_KEY_UNAVAILABLE');
  });
  it('rejects invalid customer addresses before any request', async () => {
    const request = vi.fn<typeof fetch>();
    await expect(readZtellarAccess('not-a-wallet', request)).rejects.toThrow('INVALID_CUSTOMER_ADDRESS');
    expect(request).not.toHaveBeenCalled();
  });
});
