import { PrivyClient } from '@privy-io/node';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { GrapnelError, type IdentityVerifier, type PreparedAction, type VerifiedIdentity, type WalletSigner } from '@grapnel/contracts';
import { verifySignedAction } from '../stellar/index.js';

export function createPrivyClient(env:NodeJS.ProcessEnv=process.env):PrivyClient|null {
  if(!env.PRIVY_APP_ID || !env.PRIVY_APP_SECRET) return null;
  return new PrivyClient({appId:env.PRIVY_APP_ID,appSecret:env.PRIVY_APP_SECRET});
}
export function validateStellarPublicKey(address:string,publicKey?:string):string {
  if(!StrKey.isValidEd25519PublicKey(address)) throw new GrapnelError(502,'PROVIDER_INVALID','Privy returned an invalid Stellar address');
  const raw=publicKey?.replace(/^0x/,'');
  if(raw && (!/^[a-fA-F0-9]{64}$/.test(raw) || StrKey.encodeEd25519PublicKey(Buffer.from(raw,'hex'))!==address)) {
    if(publicKey!==address) throw new GrapnelError(502,'PROVIDER_INVALID','Privy Stellar public key and address do not match');
  }
  return Keypair.fromPublicKey(address).rawPublicKey().toString('hex');
}
export class PrivyIdentityVerifier implements IdentityVerifier {
  constructor(readonly client:PrivyClient|null=createPrivyClient()) {}
  async verify(token:string):Promise<VerifiedIdentity> {
    if(!this.client) throw new GrapnelError(503,'PROVIDER_ACCESS_REQUIRED','Privy app credentials are not configured');
    if(!token || token.length>32768) throw new GrapnelError(401,'CUSTOMER_IDENTITY_REQUIRED','A current Privy identity token is required');
    let user;
    try {
      const identity=await this.client.users().get({id_token:token});
      // Identity tokens omit user_can_sign. Query the current user before treating an associated
      // entity wallet as a user-controlled wallet. A linked wallet alone is insufficient.
      user=await this.client.users()._get(identity.id);
      if(user.id!==identity.id) throw new Error('Identity mismatch');
    } catch { throw new GrapnelError(401,'INVALID_CUSTOMER_IDENTITY','Privy identity could not be verified'); }
    const wallets:VerifiedIdentity['wallets']=[];
    for(const account of user.linked_accounts) {
      if(account.type!=='wallet' || !('chain_type' in account) || account.chain_type!=='stellar' || !('id' in account) || typeof account.id!=='string' || !('user_can_sign' in account) || account.user_can_sign!==true || !('wallet_client_type' in account) || account.wallet_client_type!=='privy') continue;
      const wallet=await this.client.wallets().get(account.id);
      if(wallet.chain_type!=='stellar' || wallet.address!==account.address || wallet.archived_at) throw new GrapnelError(403,'WALLET_MISMATCH','Current user wallet association is invalid');
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
