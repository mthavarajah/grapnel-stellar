import { createHash } from 'node:crypto';
import { Address, Contract, Networks, StrKey, TransactionBuilder, nativeToScVal, rpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import { assessZtellarCandidate, ZTELLAR_CANDIDATE as ids, type ZtellarObservation } from './ztellar-readiness.js';

const TICKERS = ['AAPL', 'TSLA', 'NVDA', 'MSFT', 'AMZN', 'GOOG', 'META', 'NFLX', 'AMD', 'JPM', 'SPY', 'PFE'] as const;

/** Fixed public Testnet reader. Never signs, prepares, sends, funds or updates prices. */
export class ZtellarReadinessReader {
  constructor(private readonly server = new rpc.Server('https://soroban-testnet.stellar.org')) {}

  async read(wallet: string) {
    if (!StrKey.isValidEd25519PublicKey(wallet)) throw new Error('INVALID_CUSTOMER_ADDRESS');
    const network = await this.server.getNetwork();
    if (network.passphrase !== Networks.TESTNET) throw new Error('NETWORK_MISMATCH');

    const deployments = await Promise.all([ids.vault, ids.tier, ids.verifier].map(async (address) => {
      const result = await this.server.getLedgerEntries(new Contract(address).getFootprint());
      const entry = result.entries[0];
      if (result.entries.length !== 1 || !entry || typeof entry.lastModifiedLedgerSeq !== 'number') throw new Error('ZTELLAR_DEPLOYMENT_ABSENT');
      const instance = entry.val.contractData().val().instance();
      if (instance.executable().switch().name !== 'contractExecutableWasm') throw new Error('ZTELLAR_EXECUTABLE_MISMATCH');
      const wasmHash = instance.executable().wasmHash().toString('hex');
      const expected = address === ids.vault ? ids.vaultWasm : address === ids.tier ? ids.tierWasm : ids.verifierWasm;
      if (wasmHash !== expected) throw new Error('ZTELLAR_DEPLOYMENT_CHANGED');
      const code = await this.server.getLedgerEntries(xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash: Buffer.from(wasmHash, 'hex') })));
      if (code.entries.length !== 1 || createHash('sha256').update(code.entries[0]!.val.contractCode().code()).digest('hex') !== expected)
        throw new Error('ZTELLAR_CODE_HASH_MISMATCH');
      return { wasmHash, lastModified: entry.lastModifiedLedgerSeq, latestLedger: result.latestLedger,
        storage: (instance.storage() ?? []).map((row) => ({ key: scValToNative(row.key()) as unknown, value: scValToNative(row.val()) as unknown })) };
    }));
    const [vault, tier, verifier] = deployments;
    if (!vault || !tier || !verifier) throw new Error('ZTELLAR_DEPLOYMENT_ABSENT');
    const configured = (deployment: typeof vault, key: string) => deployment.storage.find((row) => Array.isArray(row.key) && row.key.length === 1 && row.key[0] === key)?.value;
    if (configured(vault, 'TierManager') !== ids.tier || configured(vault, 'UsdcToken') !== ids.usdc
      || configured(tier, 'Verifier') !== ids.verifier || configured(verifier, 'TierManager') !== ids.tier) throw new Error('ZTELLAR_DEPENDENCY_CHANGED');
    const account = await this.server.getAccount(wallet);
    const view = async (address: string, method: string, args: xdr.ScVal[]) => {
      const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: Networks.TESTNET })
        .addOperation(new Contract(address).call(method, ...args)).setTimeout(30).build();
      const result = await this.server.simulateTransaction(tx);
      if (!rpc.Api.isSimulationSuccess(result)) {
        // Distinguish a missing exact SAC trustline from a zero customer balance.
        if (address === ids.usdc && args[0]?.toXDR('base64') === new Address(wallet).toScVal().toXDR('base64')
            && result.error?.includes('trustline entry is missing for account')) return null;
        throw new Error(`ZTELLAR_READ_FAILED:${method}`);
      }
      if (!result.result || result.result.auth.length !== 0) throw new Error('ZTELLAR_READ_REQUIRES_AUTH');
      return scValToNative(result.result.retval) as unknown;
    };
    const walletSc = new Address(wallet).toScVal();
    const [vaultBalance, walletBalance, leverage, positions, ...prices] = await Promise.all([
      view(ids.usdc, 'balance', [new Address(ids.vault).toScVal()]),
      view(ids.usdc, 'balance', [walletSc]),
      view(ids.tier, 'get_max_leverage', [walletSc]),
      view(ids.vault, 'get_wallet_positions', [walletSc]),
      ...TICKERS.map((_ticker, index) => view(ids.vault, 'get_price', [nativeToScVal(index, { type: 'u32' })])),
    ]);
    if (typeof vaultBalance !== 'bigint' || (walletBalance !== null && typeof walletBalance !== 'bigint')
        || typeof leverage !== 'number' || !Array.isArray(positions) || positions.some((id) => typeof id !== 'bigint')
        || prices.some((price) => typeof price !== 'bigint' || price <= 0n)) throw new Error('ZTELLAR_INVALID_VIEW_RESULT');
    const observation: ZtellarObservation = {
      networkPassphrase: network.passphrase, vault: ids.vault, vaultWasm: vault.wasmHash,
      tier: ids.tier, tierWasm: tier.wasmHash, verifier: ids.verifier, verifierWasm: verifier.wasmHash, usdc: ids.usdc, vaultUsdcUnits: vaultBalance.toString(),
      walletUsdcUnits: walletBalance === null ? null : walletBalance.toString(), walletMaxLeverage: leverage,
      vaultLastModifiedLedger: vault.lastModified, observedLedger: Math.min(vault.latestLedger, tier.latestLedger, verifier.latestLedger),
    };
    return { observedAt: new Date().toISOString(), observation, assessment: assessZtellarCandidate(observation),
      positionIds: positions.map(String),
      prices: TICKERS.map((ticker, assetId) => ({ ticker, assetId, microUsd: String(prices[assetId]), oracleTimestamp: null })),
    };
  }
}
