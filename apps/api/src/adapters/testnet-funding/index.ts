import { Account, Asset, Keypair, Operation, StrKey, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import { GrapnelError, NETWORK, NETWORK_PASSPHRASE, XLM, fromAtomic, toAtomic, type CustomerContext, type PreparedAction } from '@grapnel/contracts';

export interface FundingConfig {
  network: string;
  networkPassphrase: string;
  horizonUrl?: string;
  treasurySecret?: string;
  enabled?: boolean;
  /** Lead supplies a persisted, verified Gate 1 decision; credentials alone never pass the gate. */
  gate1Passed: boolean;
  maxPerCustomerAtomic?: bigint;
  maxPerTenantAtomic?: bigint;
  maxGlobalAtomic?: bigint;
  maxFeeStroops?: bigint;
}
export interface NativeAccountSnapshot {
  address: string; sequence: string; balanceAtomic: bigint; spendableAtomic: bigint;
  reserveAtomic: bigint; sellingLiabilitiesAtomic: bigint; observedAt: string; ledger: number;
}
export interface PreparedTreasuryTransfer {
  unsignedXdr: string; signedXdr: string; txHash: string; source: string; recipient: string;
  amountAtomic: bigint; feeAtomic: bigint; beforeRecipientAtomic: bigint; expiresAt: string;
}
export interface FundingAssetView {
  asset_id: string; asset: typeof XLM; network: typeof NETWORK; treasury_address: string | null;
  treasury_available: string | null; available: boolean; execution_status: 'blocked' | 'discovery_only';
  reason: string; max_per_customer: string; max_per_tenant: string; max_global: string;
  provider_compatibility: never[]; as_of: string | null;
}

const fail = (code: string, message: string, status = 409): never => { throw new GrapnelError(status,code,message); };
const nonnegative = (value: string): bigint => value === '0' || /^0\.0+$/.test(value) ? 0n : toAtomic(value,7);
const address = (value: string): string => StrKey.isValidEd25519PublicKey(value) ? value : fail('INVALID_WALLET','Invalid Stellar account',422);
const integer = (value: unknown, label: string): bigint => {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^\d+$/.test(String(value))) return fail('PROVIDER_INVALID_RESPONSE',`Invalid ${label}`,502);
  return BigInt(value);
};

/** XLM-only initial allowlist. No symbol-only classic or Soroban token substitution. */
export class TestnetFundingAdapter {
  readonly limits: {customer: bigint; tenant: bigint; global: bigint};
  readonly maxFee: bigint;
  readonly treasuryAddress: string | null;
  private readonly signer: Keypair | null = null;
  private readonly horizonUrl: string;
  constructor(private readonly config: FundingConfig, private readonly fetcher: typeof fetch = fetch) {
    if (config.network !== 'testnet' || config.networkPassphrase !== NETWORK_PASSPHRASE) fail('NETWORK_MISMATCH','Only Stellar Testnet is supported',400);
    this.horizonUrl = (config.horizonUrl ?? 'https://horizon-testnet.stellar.org').replace(/\/$/,'');
    if (new URL(this.horizonUrl).protocol !== 'https:') fail('NETWORK_MISMATCH','Horizon must use HTTPS',400);
    try { this.signer = config.treasurySecret ? Keypair.fromSecret(config.treasurySecret) : null; }
    catch { fail('TREASURY_CONFIGURATION_INVALID','Invalid Testnet treasury configuration',503); }
    this.treasuryAddress = this.signer?.publicKey() ?? null;
    this.limits = {customer:config.maxPerCustomerAtomic ?? 250000000n,tenant:config.maxPerTenantAtomic ?? 1000000000n,global:config.maxGlobalAtomic ?? 2000000000n};
    this.maxFee = config.maxFeeStroops ?? 10000n;
    if (Object.values(this.limits).some(value => value <= 0n) || this.maxFee <= 0n || this.maxFee > 1000000n) fail('TREASURY_CONFIGURATION_INVALID','Invalid funding limits',503);
  }
  blockedReason(): string | null {
    if (!this.config.gate1Passed) return 'GATE_1_SIGNING_PROOF_REQUIRED';
    if (!this.config.enabled) return 'TESTNET_FUNDING_DISABLED';
    if (!this.signer) return 'TESTNET_TREASURY_NOT_CONFIGURED';
    return null;
  }
  assertExecutionReady(): void {
    const reason = this.blockedReason();
    if (reason) throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Testnet funding execution is unavailable',false,{reason});
  }
  assertAsset(assetId: string): void {
    if (assetId !== XLM.id) fail('FUNDING_ASSET_UNAVAILABLE','This exact Testnet asset is not allowlisted',422);
  }
  parseAmount(value: string): bigint {
    try { return toAtomic(value,7); } catch { return fail('INVALID_AMOUNT','Amount must be positive XLM with at most seven decimals',422); }
  }
  private async json(path: string): Promise<Record<string,any>> {
    let response: Response;
    try { response = await this.fetcher(`${this.horizonUrl}${path}`,{signal:AbortSignal.timeout(12000)}); }
    catch { throw new GrapnelError(503,'STELLAR_UNAVAILABLE','Stellar Testnet read timed out',true); }
    if (response.status === 404) fail('ACCOUNT_NOT_ACTIVATED','Stellar Testnet account has not been activated',409);
    if (!response.ok) throw new GrapnelError(503,'STELLAR_UNAVAILABLE','Stellar Testnet read failed',true);
    try { return await response.json(); } catch { return fail('PROVIDER_INVALID_RESPONSE','Invalid Stellar response',502); }
  }
  async assertLiveNetwork(): Promise<void> {
    const root = await this.json('');
    if (root.network_passphrase !== NETWORK_PASSPHRASE) fail('NETWORK_MISMATCH','Horizon network does not match Testnet',400);
  }
  async accountSnapshot(accountAddress: string): Promise<NativeAccountSnapshot> {
    address(accountAddress);
    await this.assertLiveNetwork();
    const [account, ledgers] = await Promise.all([this.json(`/accounts/${accountAddress}`),this.json('/ledgers?order=desc&limit=1')]);
    const ledger = ledgers._embedded?.records?.[0];
    if (!ledger || account.account_id !== accountAddress || !/^\d+$/.test(account.sequence ?? '')) fail('PROVIDER_INVALID_RESPONSE','Invalid Stellar account snapshot',502);
    const native = account.balances?.find((balance: {asset_type:string}) => balance.asset_type === 'native');
    if (!native) fail('PROVIDER_INVALID_RESPONSE','Native balance missing',502);
    let balanceAtomic: bigint; let sellingLiabilitiesAtomic: bigint;
    try { balanceAtomic = nonnegative(native.balance); sellingLiabilitiesAtomic = nonnegative(native.selling_liabilities ?? '0'); }
    catch { return fail('PROVIDER_INVALID_RESPONSE','Invalid Stellar balance',502); }
    const reserveCount = 2n + integer(account.subentry_count,'subentry count') + integer(account.num_sponsoring ?? 0,'sponsoring count') - integer(account.num_sponsored ?? 0,'sponsored count');
    if (reserveCount < 0n) fail('PROVIDER_INVALID_RESPONSE','Invalid reserve count',502);
    const reserveAtomic = reserveCount * integer(ledger.base_reserve_in_stroops,'base reserve');
    const spendable = balanceAtomic - reserveAtomic - sellingLiabilitiesAtomic;
    return {address:accountAddress,sequence:account.sequence,balanceAtomic,spendableAtomic:spendable > 0n ? spendable : 0n,reserveAtomic,sellingLiabilitiesAtomic,observedAt:new Date().toISOString(),ledger:Number(ledger.sequence)};
  }
  async discoverAssets(): Promise<FundingAssetView[]> {
    let snapshot: NativeAccountSnapshot | null = null;
    let reason = this.blockedReason();
    if (this.treasuryAddress) {
      try { snapshot = await this.accountSnapshot(this.treasuryAddress); }
      catch (error) { reason = error instanceof GrapnelError ? error.code : 'STELLAR_UNAVAILABLE'; }
    }
    const availableAtomic = snapshot ? snapshot.spendableAtomic - this.maxFee : null;
    return [{asset_id:XLM.id,asset:XLM,network:NETWORK,treasury_address:this.treasuryAddress,treasury_available:availableAtomic === null ? null : fromAtomic(availableAtomic > 0n ? availableAtomic : 0n,7),available:!reason && availableAtomic !== null && availableAtomic > 0n,execution_status:reason ? 'blocked' : 'discovery_only',reason:reason ?? 'FUNDING_TRANSFER_CHAIN_PROOF_REQUIRED',max_per_customer:fromAtomic(this.limits.customer,7),max_per_tenant:fromAtomic(this.limits.tenant,7),max_global:fromAtomic(this.limits.global,7),provider_compatibility:[],as_of:snapshot?.observedAt ?? null}];
  }
  /** Call while holding the durable global quota lock and treasury sequence lock. No broadcast occurs here. */
  async prepareFund(input: {assetId:string; amount:string; customer:CustomerContext; reservedTreasuryAtomic:bigint}): Promise<PreparedTreasuryTransfer> {
    this.assertExecutionReady(); this.assertAsset(input.assetId);
    const amountAtomic = this.parseAmount(input.amount);
    address(input.customer.walletAddress);
    if (input.customer.walletAddress === this.treasuryAddress) fail('INVALID_RECIPIENT','Treasury cannot fund itself',422);
    const [treasury, recipient] = await Promise.all([this.accountSnapshot(this.treasuryAddress!),this.accountSnapshot(input.customer.walletAddress)]);
    if (treasury.spendableAtomic - input.reservedTreasuryAtomic - this.maxFee < amountAtomic) fail('INSUFFICIENT_TESTNET_TREASURY','Treasury has insufficient unreserved XLM');
    const expiresAt = new Date(Date.now()+120000).toISOString();
    const transaction = this.payment(treasury,input.customer.walletAddress,amountAtomic,expiresAt);
    const unsignedXdr = transaction.toXDR();
    transaction.sign(this.signer!);
    return {unsignedXdr,signedXdr:transaction.toXDR(),txHash:transaction.hash().toString('hex'),source:treasury.address,recipient:recipient.address,amountAtomic,feeAtomic:BigInt(transaction.fee),beforeRecipientAtomic:recipient.balanceAtomic,expiresAt};
  }
  async prepareReturn(input: {operationId:string;assetId:string;amount:string;customer:CustomerContext;reservedCustomerAtomic:bigint}): Promise<PreparedAction> {
    this.assertExecutionReady(); this.assertAsset(input.assetId);
    const amountAtomic = this.parseAmount(input.amount);
    address(input.customer.walletAddress);
    if (input.customer.walletAddress === this.treasuryAddress) fail('INVALID_RECIPIENT','Treasury is not a customer wallet',422);
    const customer = await this.accountSnapshot(input.customer.walletAddress);
    await this.accountSnapshot(this.treasuryAddress!);
    if (customer.spendableAtomic - input.reservedCustomerAtomic - this.maxFee < amountAtomic) fail('INSUFFICIENT_BALANCE','Return would spend reserved XLM or network reserve');
    const expiresAt = new Date(Date.now()+120000).toISOString();
    const transaction = this.payment(customer,this.treasuryAddress!,amountAtomic,expiresAt);
    return {operationId:input.operationId,customerId:input.customer.customerId,network:NETWORK,walletAddress:customer.address,unsignedXdr:transaction.toXDR(),signingHashHex:transaction.hash().toString('hex'),summary:{action:'testnet.return',fromAssetId:XLM.id,amount:fromAtomic(amountAtomic,7),recipient:this.treasuryAddress!,maxFeeStroops:this.maxFee.toString(),expiresAt},authorization:{method:'privy_stellar',expiresAt}};
  }
  private payment(source: NativeAccountSnapshot, recipient: string, amountAtomic: bigint, expiresAt: string): Transaction {
    return new TransactionBuilder(new Account(source.address,source.sequence),{fee:this.maxFee.toString(),networkPassphrase:NETWORK_PASSPHRASE,timebounds:{minTime:0,maxTime:Math.floor(new Date(expiresAt).getTime()/1000)}}).addOperation(Operation.payment({destination:address(recipient),asset:Asset.native(),amount:fromAtomic(amountAtomic,7)})).build();
  }
}
