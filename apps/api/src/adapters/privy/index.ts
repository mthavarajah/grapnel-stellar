import { PrivyClient } from '@privy-io/node';
import { createHash } from 'node:crypto';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { GrapnelError, type IdentityVerifier, type PreparedAction, type VerifiedIdentity, type WalletSigner } from '@grapnel/contracts';
import { verifySignedAction } from '../stellar/index.js';

export function createPrivyClient(env:NodeJS.ProcessEnv=process.env):PrivyClient|null {
  if(!env.PRIVY_APP_ID || !env.PRIVY_APP_SECRET) return null;
  return new PrivyClient({appId:env.PRIVY_APP_ID,appSecret:env.PRIVY_APP_SECRET});
}
export function validateStellarPublicKey(address:string,publicKey?:string):string {
  if(!StrKey.isValidEd25519PublicKey(address)) throw new GrapnelError(502,'PROVIDER_INVALID','Privy returned an invalid Stellar address');
  let raw=publicKey?.replace(/^0x/i,'');
  // Current Privy Stellar responses encode Ed25519 as 00 + the 32-byte key.
  // Accept only that exact prefix/length; still compare every key byte to G-address.
  if(raw && /^00[a-fA-F0-9]{64}$/.test(raw))raw=raw.slice(2);
  if(raw && (!/^[a-fA-F0-9]{64}$/.test(raw) || StrKey.encodeEd25519PublicKey(Buffer.from(raw,'hex'))!==address)) {
    if(publicKey!==address) throw new GrapnelError(502,'PROVIDER_INVALID','Privy Stellar public key and address do not match');
  }
  return Keypair.fromPublicKey(address).rawPublicKey().toString('hex');
}
export class PrivyIdentityVerifier implements IdentityVerifier {
  // Instance-scoped to this configured app/client. Keys contain no raw token.
  // Only current user_can_sign + exact wallet bindings are reused, for at most
  // 10s and never past signed exp. JWT acceptance itself is never cached.
  // https://docs.privy.io/user-management/users/identity-tokens.md
  private readonly bindings=new Map<string,{until:number;identity:VerifiedIdentity}>();
  private readonly pending=new Map<string,Promise<VerifiedIdentity>>();
  constructor(readonly client:PrivyClient|null=createPrivyClient()) {}
  async verify(token:string):Promise<VerifiedIdentity> {
    if(!this.client) throw new GrapnelError(503,'PROVIDER_ACCESS_REQUIRED','Privy app credentials are not configured');
    if(!token || token.length>32768) throw new GrapnelError(401,'CUSTOMER_IDENTITY_REQUIRED','A current Privy identity token is required');
    let identity;let expiration:number;
    try {
      // SDK0.38 verifies ES256, issuer privy.io, app audience and expiry using
      // its cached JWKS on EVERY call, including before any binding-cache hit.
      identity=await this.client.users().get({id_token:token});
      // Read only the expiration after signature/issuer/audience verification;
      // no decoded identity/wallet claim is ever used as an authorization proof.
      const claims=JSON.parse(Buffer.from(token.split('.')[1]??'','base64url').toString('utf8')) as {exp?:unknown};
      if(typeof identity.id!=='string'||!identity.id.startsWith('did:privy:')||typeof claims.exp!=='number'||!Number.isSafeInteger(claims.exp*1000)||claims.exp<=Date.now()/1000)throw Error('Invalid identity expiration');
      expiration=claims.exp*1000;
    } catch { throw new GrapnelError(401,'INVALID_CUSTOMER_IDENTITY','Privy identity could not be verified'); }
    const key=createHash('sha256').update(JSON.stringify(['stellar-testnet',identity.id,token])).digest('hex'),now=Date.now();
    for(const [entry,value] of this.bindings)if(value.until<=now)this.bindings.delete(entry);
    const hit=this.bindings.get(key);if(hit&&hit.until>now)return structuredClone(hit.identity);
    const existing=this.pending.get(key);if(existing)return structuredClone(await existing);
    if(this.pending.size>=128)throw new GrapnelError(503,'PROVIDER_UNAVAILABLE','Identity verification is busy; please try again',true);
    const validUntil=Math.min(expiration,now+10000);
    const task=this.readCurrentBinding(identity.id).then(value=>{
      if(expiration<=Date.now())throw new GrapnelError(401,'INVALID_CUSTOMER_IDENTITY','Privy identity could not be verified');
      if(validUntil>Date.now()){
        if(this.bindings.size>=128)this.bindings.delete(this.bindings.keys().next().value!);
        this.bindings.set(key,{until:validUntil,identity:structuredClone(value)});
      }
      return value;
    }).finally(()=>{this.pending.delete(key);});
    this.pending.set(key,task);
    return structuredClone(await task);
  }
  private async readCurrentBinding(userId:string):Promise<VerifiedIdentity>{
    let user;
    try {
      // Identity tokens omit user_can_sign. Query the current user before treating an associated
      // entity wallet as a user-controlled wallet. A linked wallet alone is insufficient.
      user=await this.client!.users()._get(userId);
      if(user.id!==userId) throw new Error('Identity mismatch');
    } catch { throw new GrapnelError(401,'INVALID_CUSTOMER_IDENTITY','Privy identity could not be verified'); }
    const wallets:VerifiedIdentity['wallets']=[];
    for(const account of user.linked_accounts) {
      if(account.type!=='wallet' || !('chain_type' in account) || account.chain_type!=='stellar' || !('id' in account) || typeof account.id!=='string' || !('user_can_sign' in account) || account.user_can_sign!==true || !('wallet_client_type' in account) || account.wallet_client_type!=='privy') continue;
      const wallet=await this.client!.wallets().get(account.id);
      if(wallet.id!==account.id || wallet.chain_type!=='stellar' || wallet.address!==account.address || wallet.archived_at) throw new GrapnelError(403,'WALLET_MISMATCH','Current user wallet association is invalid');
      wallets.push({id:wallet.id,address:wallet.address,publicKey:validateStellarPublicKey(wallet.address,wallet.public_key)});
    }
    return {userId:user.id,wallets};
  }
}
export class PrivyWalletSigner implements WalletSigner {
  constructor(readonly client:PrivyClient|null=createPrivyClient(),readonly verifyBinding?:(customerId:string,userId:string)=>Promise<boolean>) {}
  async provisionForCustomer(customerId:string,privyUserId:string):Promise<{privyWalletId:string;stellarAddress:string;publicKey:string}> {
    if(!this.client) throw new GrapnelError(503,'PROVIDER_ACCESS_REQUIRED','Privy app credentials are not configured');
    if(!privyUserId.startsWith('did:privy:')) throw new GrapnelError(403,'INVALID_CUSTOMER_IDENTITY','Verified Privy user is required');
    if(!this.verifyBinding || !await this.verifyBinding(customerId,privyUserId)) throw new GrapnelError(403,'CUSTOMER_IDENTITY_MISMATCH','Customer is not bound to this Privy identity');
    // Explicit owner is mandatory. entity attribution would NOT give this customer signing authority.
    const wallet=await this.client.wallets().create({chain_type:'stellar',owner:{user_id:privyUserId},idempotency_key:`grapnel-wallet-${customerId}`});
    return {privyWalletId:wallet.id,stellarAddress:wallet.address,publicKey:validateStellarPublicKey(wallet.address,wallet.public_key)};
  }
  async verifyClientSignedAction(action:PreparedAction,signedXdr:string,customerIdentity:string):Promise<void> {
    if(!this.verifyBinding || !await this.verifyBinding(action.customerId,customerIdentity)) throw new GrapnelError(403,'CUSTOMER_IDENTITY_MISMATCH','Action belongs to another customer');
    verifySignedAction(action,signedXdr);
  }
}
