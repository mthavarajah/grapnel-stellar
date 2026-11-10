import { Asset, Horizon, Keypair, NotFoundError, Operation, StrKey, Transaction, TransactionBuilder, rpc } from '@stellar/stellar-sdk';
import { GrapnelError, NETWORK, NETWORK_PASSPHRASE, PreparedActionSchema, XLM, fromAtomic, toAtomic, type AssetIdentity, type ChainAction, type NetworkExecutor, type PreparedAction, type WalletBalance } from '@grapnel/contracts';

export interface StellarConfig { network:string; passphrase:string; rpcUrl?:string; horizonUrl?:string; maxFeeStroops?:string; }
export interface PaymentInput { operationId:string; customerId:string; walletAddress:string; recipient:string; asset:AssetIdentity; amount:string; action?:string; }
const fail = (code:string,message:string,status=422):never => {throw new GrapnelError(status,code,message);};
export function assertTestnet(config:StellarConfig):void {
  if(config.network !== 'testnet' || config.passphrase !== NETWORK_PASSPHRASE) fail('NETWORK_MISMATCH','Only the explicit Stellar Testnet network is permitted',400);
  // Fail closed: never allow a configurable URL to redirect a test signature to another chain.
  if(config.rpcUrl && config.rpcUrl !== 'https://soroban-testnet.stellar.org') fail('NETWORK_MISMATCH','RPC must be the official Stellar Testnet endpoint',400);
  if(config.horizonUrl && config.horizonUrl !== 'https://horizon-testnet.stellar.org') fail('NETWORK_MISMATCH','Horizon must be the official Stellar Testnet endpoint',400);
}
export function parseTestnetTransaction(envelope:string):Transaction {
  try { const tx=TransactionBuilder.fromXDR(envelope,NETWORK_PASSPHRASE); if(!(tx instanceof Transaction)) fail('INVALID_TRANSACTION','Fee-bump envelopes are unsupported'); return tx as Transaction; }
  catch(error) {if(error instanceof GrapnelError) throw error;return fail('INVALID_TRANSACTION','Invalid Stellar transaction envelope');}
}
function checkCommon(tx:Transaction,address:string,expiresAt:string,maxFee:string):void {
  if(!StrKey.isValidEd25519PublicKey(address) || tx.source!==address) fail('WALLET_MISMATCH','Transaction source must be the approved wallet',403);
  if(!tx.timeBounds || BigInt(tx.timeBounds.maxTime)===0n || Date.parse(expiresAt)<=Date.now() || BigInt(tx.timeBounds.maxTime)*1000n>BigInt(Date.parse(expiresAt))) fail('ACTION_EXPIRED','Transaction requires live bounded authorization',403);
  if(BigInt(tx.timeBounds!.minTime)*1000n>BigInt(Date.now())) fail('ACTION_NOT_YET_VALID','Transaction is not valid yet',403);
  if(BigInt(tx.fee)>BigInt(maxFee) || BigInt(tx.fee)<=0n) fail('FEE_LIMIT','Transaction exceeds approved fee ceiling',403);
  if(BigInt(tx.sequence)<=0n || tx.operations.length!==1 || tx.memo.type!=='none' || tx.extraSigners?.length) fail('INVALID_TRANSACTION','Only one approved operation without additional signers or memo is supported');
  if(tx.operations[0]?.source && tx.operations[0].source!==address) fail('WALLET_MISMATCH','Operation source differs from approved wallet',403);
}
export function verifySignedAction(action:PreparedAction,signedXdr:string):void {
  PreparedActionSchema.parse(action);
  if(action.network!==NETWORK || action.authorization.method!=='privy_stellar') fail('NETWORK_MISMATCH','Invalid signing network',400);
  if(Date.parse(action.authorization.expiresAt)<=Date.now()) fail('ACTION_EXPIRED','Customer authorization has expired',403);
  const unsigned=parseTestnetTransaction(action.unsignedXdr);const signed=parseTestnetTransaction(signedXdr);
  checkCommon(signed,action.walletAddress,action.summary.expiresAt,action.summary.maxFeeStroops??'1000000');
  const expected=unsigned.hash().toString('hex');
  if(unsigned.signatures.length || expected!==action.signingHashHex || signed.hash().toString('hex')!==expected) fail('INTENT_MISMATCH','Signed transaction differs from the exact prepared intent',403);
  if(signed.signatures.length!==1 || !Keypair.fromPublicKey(action.walletAddress).verify(signed.hash(),signed.signatures[0]!.signature())) fail('INVALID_CUSTOMER_SIGNATURE','A signature from the approved customer wallet is required',403);
}
/** The browser may use the same SDK calls after Privy useSignRawHash returns 0x + 64-byte Ed25519 signature. */
export function attachRawSignature(action:PreparedAction,signatureHex:string):string {
  if(!/^0x[0-9a-fA-F]{128}$/.test(signatureHex)) fail('INVALID_CUSTOMER_SIGNATURE','Expected a 64-byte hex Ed25519 signature',403);
  const tx=parseTestnetTransaction(action.unsignedXdr);const key=Keypair.fromPublicKey(action.walletAddress);
  const signature=Buffer.from(signatureHex.slice(2),'hex');
  if(!key.verify(tx.hash(),signature)) fail('INVALID_CUSTOMER_SIGNATURE','Privy signature does not match the approved Testnet digest',403);
  tx.addSignature(action.walletAddress,signature.toString('base64'));
  const envelope=tx.toXDR();verifySignedAction(action,envelope);return envelope;
}
export class StellarTestnetExecutor implements NetworkExecutor {
  readonly horizon:Horizon.Server;readonly server:rpc.Server;readonly maxFeeStroops:string;
  constructor(readonly config:StellarConfig) {
    assertTestnet(config);this.horizon=new Horizon.Server(config.horizonUrl??'https://horizon-testnet.stellar.org');this.server=new rpc.Server(config.rpcUrl??'https://soroban-testnet.stellar.org');this.maxFeeStroops=config.maxFeeStroops??'1000000';
  }
  async verifyLiveNetwork():Promise<void> { const net=await this.server.getNetwork();if(net.passphrase!==NETWORK_PASSPHRASE) fail('NETWORK_MISMATCH','RPC does not report Stellar Testnet',400); }
  async preparePayment(input:PaymentInput):Promise<PreparedAction> {
    if(input.asset.network!==NETWORK || !input.asset.verified || input.asset.kind==='soroban') fail('ASSET_UNAVAILABLE','Only verified native/classic payment assets are supported');
    if(input.asset.kind==='native' && input.asset.id!==XLM.id) fail('ASSET_MISMATCH','Native asset must be canonical XLM');
    if(input.asset.kind==='classic' && (!input.asset.issuer || !StrKey.isValidEd25519PublicKey(input.asset.issuer) || input.asset.id!==`stellar-testnet:classic:${input.asset.code}:${input.asset.issuer}`)) fail('ASSET_MISMATCH','Exact classic issuer identity is required');
    if(input.asset.decimals!==7 || !StrKey.isValidEd25519PublicKey(input.recipient)) fail('INVALID_ASSET_OR_RECIPIENT','Classic payments require seven decimals and G-address recipient');
    toAtomic(input.amount,7); await this.verifyLiveNetwork();
    const spendable=(await this.getClassicBalances(input.walletAddress)).find(b=>b.asset_id===input.asset.id)?.spendable??'0';
    if(decimalAllowZero(spendable,7)<toAtomic(input.amount,7)) fail('INSUFFICIENT_BALANCE','Amount would spend reserve, fees or unavailable tokens',409);
    const account=await this.horizon.loadAccount(input.walletAddress);
    const expires=Math.floor(Date.now()/1000)+120;
    const asset=input.asset.kind==='native'?Asset.native():new Asset(input.asset.code,input.asset.issuer!);
    const tx=new TransactionBuilder(account,{fee:'100',networkPassphrase:NETWORK_PASSPHRASE,timebounds:{minTime:0,maxTime:expires}}).addOperation(Operation.payment({destination:input.recipient,asset,amount:input.amount})).build();
    const action:PreparedAction={operationId:input.operationId,customerId:input.customerId,network:NETWORK,walletAddress:input.walletAddress,unsignedXdr:tx.toXDR(),signingHashHex:tx.hash().toString('hex'),summary:{action:input.action??'payment',fromAssetId:input.asset.id,amount:input.amount,recipient:input.recipient,maxFeeStroops:'100',expiresAt:new Date(expires*1000).toISOString()},authorization:{method:'privy_stellar',expiresAt:new Date(expires*1000).toISOString()}};
    checkCommon(tx,input.walletAddress,action.summary.expiresAt,'100');return action;
  }
  async prepareAndSimulate(_input:ChainAction):Promise<PreparedAction> {
    // A contract allowlist alone cannot establish intent. Adapter-specific argument/authorization inspectors
    // must first be integrated and proved; reject rather than sign opaque provider operations.
    return fail('EXECUTION_UNAVAILABLE','Soroban preparation requires a verified adapter-specific invocation and authorization inspector',409);
  }
  verifySignedAction(action:PreparedAction,signedXdr:string):void {verifySignedAction(action,signedXdr);}
  async submit(signedXdr:string,_operationId:string):Promise<{txHash:string;state:'submitted'}> {
    await this.verifyLiveNetwork();const tx=parseTestnetTransaction(signedXdr);
    if(tx.operations.some(op=>op.type!=='payment')) fail('EXECUTION_UNAVAILABLE','Only inspected classic payments may currently be submitted',409);
    checkCommon(tx,tx.source,new Date(Number(tx.timeBounds?.maxTime??0)*1000).toISOString(),this.maxFeeStroops);
    if(tx.signatures.length!==1 || !Keypair.fromPublicKey(tx.source).verify(tx.hash(),tx.signatures[0]!.signature())) fail('INVALID_CUSTOMER_SIGNATURE','Missing or invalid Testnet envelope signature',403);
    const txHash=tx.hash().toString('hex');
    // The durable caller MUST persist txHash + envelope before this call. Uncertain send errors reconcile
    // this hash; never build or automatically rebroadcast a replacement transaction.
    try { const response=await this.server.sendTransaction(tx); if(response.hash!==txHash) fail('PROVIDER_INVALID','RPC transaction hash mismatch',502);if(response.status==='ERROR') fail('CHAIN_REJECTED','Stellar rejected transaction',409); }
    catch(error) {if(error instanceof GrapnelError)throw error;throw new GrapnelError(503,'SUBMISSION_UNCERTAIN','Reconcile the persisted transaction hash before any retry',true,{tx_hash:txHash});}
    return {txHash,state:'submitted'};
  }
  async reconcile(txHash:string):Promise<'completed'|'failed'|'pending'> {
    if(!/^[0-9a-f]{64}$/.test(txHash)) fail('INVALID_TRANSACTION_HASH','Expected a Stellar transaction hash');
    await this.verifyLiveNetwork();const response=await this.server.getTransaction(txHash);
    return response.status==='SUCCESS'?'completed':response.status==='FAILED'?'failed':'pending';
  }
  async activateAccount(address:string):Promise<{activation_status:'active';stellar_address:string}> {
    if(!StrKey.isValidEd25519PublicKey(address)) fail('INVALID_WALLET','Expected a Stellar G-address');
    await this.verifyLiveNetwork();
    try {await this.horizon.loadAccount(address);return {activation_status:'active',stellar_address:address};}
    catch(error) {if(!(error instanceof NotFoundError))throw new GrapnelError(503,'CHAIN_UNAVAILABLE','Cannot verify account activation',true);}
    const response=await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(address)}`,{signal:AbortSignal.timeout(30000)});
    if(!response.ok) throw new GrapnelError(503,'TESTNET_FAUCET_UNAVAILABLE','Friendbot could not activate the Testnet account',true);
    await this.horizon.loadAccount(address);return {activation_status:'active',stellar_address:address};
  }
  async getClassicBalances(address:string):Promise<WalletBalance[]> {
    if(!StrKey.isValidEd25519PublicKey(address)) fail('INVALID_WALLET','Expected a Stellar G-address');
    await this.verifyLiveNetwork();const account=await this.horizon.loadAccount(address);
    const ledger=await this.horizon.ledgers().order('desc').limit(1).call();
    const reserve=BigInt(ledger.records[0]!.base_reserve_in_stroops);
    const minimum=reserve*BigInt(2+account.subentry_count+(account.num_sponsoring??0)-(account.num_sponsored??0));
    const now=new Date().toISOString();
    return account.balances.filter(balance=>balance.asset_type!=='liquidity_pool_shares').map(balance=>{
      const native=balance.asset_type==='native';
      const atomic=decimalAllowZero(balance.balance,7);const selling=decimalAllowZero(balance.selling_liabilities??'0',7);
      const authorized=!(('is_authorized' in balance) && balance.is_authorized===false);
      const available=authorized?atomic-selling-(native?minimum+BigInt(this.maxFeeStroops):0n):0n;
      const id=native?XLM.id:`stellar-testnet:classic:${'asset_code' in balance?balance.asset_code:''}:${'asset_issuer' in balance?balance.asset_issuer:''}`;
      return {asset_id:id,wallet_amount:fromAtomic(atomic,7),reserved:'0.0000000',spendable:fromAtomic(available>0n?available:0n,7),as_of:now,source:'stellar_horizon_testnet'};
    });
  }
}
function decimalAllowZero(value:string,decimals:number):bigint {if(/^0(?:\.0+)?$/.test(value)) return 0n;return toAtomic(value,decimals);}
