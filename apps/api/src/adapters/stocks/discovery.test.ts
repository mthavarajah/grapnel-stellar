import { describe, expect, it } from 'vitest';
import { Asset, Keypair, Networks } from '@stellar/stellar-sdk';
import { parseStockDiscovery, readStockDiscovery, SODAX_CONFIG_URL, SODAX_TOKENS_URL } from './discovery.js';
const issuer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9)).publicKey();
function fixture(testnet = false) {
  const address = new Asset('AAPL', issuer).contractId(testnet ? Networks.TESTNET : Networks.PUBLIC);
  return { config: { version: 27, supportedChains: ['stellar'], spokeChainConfig: { stellar: {
    horizonRpcUrl: testnet ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org',
    trustlineConfigs: [{ assetCode: 'AAPL', assetIssuer: issuer, contractId: address }]
  } } }, tokens: { stellar: [{ symbol: 'AAPL', name: 'Apple', decimals: 7, address, chainKey: 'stellar', isRwa: true }] } };
}
const asOf = '2026-11-11T12:00:00.000Z';
describe('SODAX exact stock candidate identity', () => {
  it('retains real mainnet identities as discovery only', () => {
    const f = fixture(); const r = parseStockDiscovery(f.config, f.tokens, asOf);
    expect(r.candidates[0]).toMatchObject({ issuer, network: 'mainnet', executable: false, readiness_reason: 'MAINNET_ONLY' });
  });
  it('never treats a verified Testnet asset identity as execution proof', () => {
    const f = fixture(true);
    expect(parseStockDiscovery(f.config, f.tokens, asOf).candidates[0]).toMatchObject({ network: 'testnet', executable: false, readiness_reason: 'TESTNET_ROUTE_AND_ELIGIBILITY_UNVERIFIED' });
  });
  it('rejects a mainnet contract relabeled as Testnet', () => {
    const f = fixture(); f.config.spokeChainConfig.stellar.horizonRpcUrl = 'https://horizon-testnet.stellar.org';
    expect(() => parseStockDiscovery(f.config, f.tokens, asOf)).toThrow('does not match');
  });
  it.each(['https://evil.example', 'https://horizon.stellar.org.attacker.example'])('rejects ambiguous network %s', url => {
    const f = fixture(); f.config.spokeChainConfig.stellar.horizonRpcUrl = url;
    expect(() => parseStockDiscovery(f.config, f.tokens, asOf)).toThrow('network binding');
  });
  it('rejects missing issuer, duplicates, precision changes and invalid observation time', () => {
    const f = fixture(); f.config.spokeChainConfig.stellar.trustlineConfigs = [];
    expect(() => parseStockDiscovery(f.config, f.tokens, asOf)).toThrow('issuer');
    const d = fixture(); d.tokens.stellar.push(d.tokens.stellar[0]!);
    expect(() => parseStockDiscovery(d.config, d.tokens, asOf)).toThrow('Duplicate');
    const p = fixture(); p.tokens.stellar[0]!.decimals = 18;
    expect(() => parseStockDiscovery(p.config, p.tokens, asOf)).toThrow('precision');
    expect(() => parseStockDiscovery(p.config, p.tokens, 'invalid')).toThrow('timestamp');
  });
  it('does not infer RWA classification from an equity-looking symbol', () => {
    const f = fixture(); f.tokens.stellar[0]!.isRwa = false;
    expect(parseStockDiscovery(f.config, f.tokens, asOf).candidates).toEqual([]);
  });
  it('fetches fixed official endpoints without credentials and fails closed on errors', async () => {
    const f = fixture(); const calls: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input); calls.push(url);
      expect(init).toMatchObject({ method: 'GET', redirect: 'error' }); expect(init?.headers).toBeUndefined();
      return new Response(JSON.stringify(url === SODAX_CONFIG_URL ? f.config : f.tokens));
    };
    expect((await readStockDiscovery({ fetch: fetcher, now: () => new Date(asOf) })).candidates).toHaveLength(1);
    expect(calls).toEqual([SODAX_CONFIG_URL, SODAX_TOKENS_URL]);
    await expect(readStockDiscovery({ fetch: async () => new Response('{}', { status: 403 }) })).rejects.toThrow('HTTP 403');
  });
});
