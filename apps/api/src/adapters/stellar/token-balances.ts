import { createHash } from 'node:crypto';
import { Account, Address, Contract, StrKey, TransactionBuilder, rpc, scValToNative } from '@stellar/stellar-sdk';
import { GrapnelError, NETWORK_PASSPHRASE, fromAtomic, type AssetIdentity, type WalletBalance } from '@grapnel/contracts';

const TESTNET_RPC = 'https://soroban-testnet.stellar.org';
const unavailable = (message: string, code = 'SOROBAN_BALANCE_UNAVAILABLE'): never => {
  throw new GrapnelError(503, code, message, true);
};

export interface SorobanTokenBalanceDependencies {
  server?: Pick<rpc.Server, 'getNetwork' | 'getAccount' | 'getContractWasmByContractId' | 'simulateTransaction'>;
  now?: () => string;
}

/**
 * Reads balances only for explicitly supplied, live-registry-verified Soroban assets.
 * No signing, transaction submission, minting or balance substitution is performed.
 */
export class SorobanTokenBalanceReader {
  private readonly server: Pick<rpc.Server, 'getNetwork' | 'getAccount' | 'getContractWasmByContractId' | 'simulateTransaction'>;
  private readonly now: () => string;

  constructor(
    private readonly rpcUrl: string,
    private readonly expectedWasmHashes: Readonly<Record<string, string>>,
    deps: SorobanTokenBalanceDependencies = {},
  ) {
    if (rpcUrl !== TESTNET_RPC) throw new GrapnelError(400, 'NETWORK_MISMATCH', 'Token balances are restricted to the official Stellar Testnet RPC');
    this.server = deps.server ?? new rpc.Server(TESTNET_RPC);
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async getBalances(walletG: string, assets: readonly AssetIdentity[]): Promise<WalletBalance[]> {
    if (!StrKey.isValidEd25519PublicKey(walletG)) throw new GrapnelError(422, 'INVALID_WALLET', 'Expected a Stellar G-address');
    await this.verifyNetwork();
    const unique = new Map<string, AssetIdentity>();
    for (const asset of assets) {
      this.validateAsset(asset);
      unique.set(asset.id, asset);
    }
    const results: WalletBalance[] = [];
    for (const asset of unique.values()) results.push(await this.getBalance(walletG, asset));
    return results;
  }

  private async verifyNetwork(): Promise<void> {
    try {
      if ((await this.server.getNetwork()).passphrase !== NETWORK_PASSPHRASE) {
        throw new GrapnelError(503, 'NETWORK_MISMATCH', 'Soroban RPC does not report Stellar Testnet');
      }
    } catch (error) {
      if (error instanceof GrapnelError) throw error;
      unavailable('Cannot verify the live Stellar Testnet RPC network');
    }
  }

  private validateAsset(asset: AssetIdentity): void {
    const expectedId = `stellar-testnet:soroban:${asset.contractId ?? ''}`;
    if (asset.network !== 'stellar-testnet' || asset.kind !== 'soroban' || asset.decimals !== 7 || asset.verified !== true ||
        !asset.contractId || asset.id !== expectedId || !StrKey.isValidContract(asset.contractId)) {
      throw new GrapnelError(422, 'UNVERIFIED_SOROBAN_ASSET', 'Asset must be an exact verified 7-decimal Soroban Testnet identity');
    }
    const pinnedHash = this.expectedWasmHashes[asset.contractId];
    if (!pinnedHash || !/^[a-f0-9]{64}$/.test(pinnedHash)) {
      unavailable('No official executable hash is pinned for this Soroban token', 'SOROBAN_ASSET_UNAVAILABLE');
    }
  }

  private async getBalance(walletG: string, asset: AssetIdentity): Promise<WalletBalance> {
    const contractId = asset.contractId!;
    const expectedHash = this.expectedWasmHashes[contractId]!;
    try {
      const wasm = await this.server.getContractWasmByContractId(contractId);
      const actualHash = createHash('sha256').update(wasm).digest('hex');
      if (actualHash !== expectedHash) unavailable('Soroban token executable hash does not match the official pin', 'SOROBAN_ASSET_UNAVAILABLE');

      // A fresh source-account sequence makes this a current read-only simulation; it is never sent.
      const account = await this.server.getAccount(walletG);
      const tx = new TransactionBuilder(new Account(walletG, account.sequenceNumber()), {
        fee: '100', networkPassphrase: NETWORK_PASSPHRASE,
      }).addOperation(new Contract(contractId).call('balance', Address.fromString(walletG).toScVal())).setTimeout(30).build();
      const simulation = await this.server.simulateTransaction(tx);
      if (!rpc.Api.isSimulationSuccess(simulation) || !simulation.result || simulation.result.auth.length !== 0) {
        unavailable('Soroban token balance simulation failed or requested authorization');
      }
      const successfulSimulation = simulation as rpc.Api.SimulateTransactionSuccessResponse;
      const result = successfulSimulation.result;
      if (!result) unavailable('Soroban token balance simulation returned no result');
      const value = scValToNative(result!.retval);
      if (typeof value !== 'bigint' || value < 0n || value >= (1n << 127n)) {
        unavailable('Soroban token returned an invalid i128 balance');
      }
      const balance = fromAtomic(value, 7);
      return {
        asset_id: asset.id, wallet_amount: balance, reserved: '0.0000000', spendable: balance,
        as_of: this.now(), source: 'stellar_rpc_testnet',
      };
    } catch (error) {
      if (error instanceof GrapnelError) throw error;
      return unavailable('Cannot verify the Soroban token instance or read its current balance');
    }
  }
}
