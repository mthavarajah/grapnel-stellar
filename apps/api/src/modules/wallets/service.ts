import type { Pool } from 'pg';
import { GrapnelError, fromAtomic, toAtomic, type IdentityVerifier, type WalletBalance } from '@grapnel/contracts';
import { PrivyWalletSigner } from '../../adapters/privy/index.js';
import { StellarTestnetExecutor } from '../../adapters/stellar/index.js';

export class WalletService {
  constructor(readonly pool:Pool,readonly identityVerifier:IdentityVerifier,readonly chain:StellarTestnetExecutor,readonly signer:PrivyWalletSigner,readonly additionalBalances?:(address:string)=>Promise<WalletBalance[]>) {}
  async provision(businessId:string,customerId:string,identityProof:string) {
    const identity=await this.identityVerifier.verify(identityProof);
    const client=await this.pool.connect();
    let row: {id:string;privy_wallet_id:string;stellar_address:string};
    try {
      await client.query('BEGIN');
      const result=await client.query('SELECT * FROM customers WHERE business_id=$1 AND id=$2 FOR UPDATE',[businessId,customerId]);
      const customer=result.rows[0];
      if(!customer)throw new GrapnelError(404,'NOT_FOUND','Customer not found');
      if(customer.external_customer_id!==identity.userId || (customer.privy_user_id && customer.privy_user_id!==identity.userId)) throw new GrapnelError(403,'CUSTOMER_IDENTITY_MISMATCH','Verified identity does not own this customer');
      await client.query('UPDATE customers SET privy_user_id=$3 WHERE business_id=$1 AND id=$2 AND (privy_user_id IS NULL OR privy_user_id=$3)',[businessId,customerId,identity.userId]);
      const existing=await client.query('SELECT * FROM wallets WHERE business_id=$1 AND customer_id=$2',[businessId,customerId]);
      row=existing.rows[0];
      if(!row) {
        // Reuse only a currently verified user-controlled Stellar wallet; otherwise create one with
        // explicit user ownership. Provisioning callback sees this transaction's uncommitted binding.
        const linked=identity.wallets[0];
        const provisioner=new PrivyWalletSigner(this.signer.client,async(cid,uid)=>cid===customerId && uid===identity.userId);
        const wallet=linked?{privyWalletId:linked.id,stellarAddress:linked.address,publicKey:linked.publicKey}:await provisioner.provisionForCustomer(customerId,identity.userId);
        const inserted=await client.query('INSERT INTO wallets(business_id,customer_id,privy_wallet_id,stellar_address,public_key) VALUES ($1,$2,$3,$4,$5) RETURNING *',[businessId,customerId,wallet.privyWalletId,wallet.stellarAddress,wallet.publicKey]);
        row=inserted.rows[0];
      } else if(!identity.wallets.some(w=>w.id===row.privy_wallet_id && w.address===row.stellar_address)) throw new GrapnelError(403,'WALLET_MISMATCH','Stored wallet is no longer controlled by this user');
      await client.query('COMMIT');
    } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
    // Activation persists wallet linkage even when Friendbot is unavailable; retry safely on same wallet.
    await this.chain.activateAccount(row.stellar_address);
    await this.pool.query("UPDATE wallets SET status='active' WHERE business_id=$1 AND id=$2",[businessId,row.id]);
    return {wallet_id:row.id,customer_id:customerId,stellar_address:row.stellar_address,activation_status:'active',network:'stellar-testnet'};
  }
  async get(businessId:string,walletId:string) {
    const result=await this.pool.query('SELECT id,customer_id,stellar_address,status,network FROM wallets WHERE business_id=$1 AND id=$2',[businessId,walletId]);
    const row=result.rows[0];if(!row)throw new GrapnelError(404,'NOT_FOUND','Wallet not found');
    return {wallet_id:row.id,customer_id:row.customer_id,stellar_address:row.stellar_address,activation_status:row.status,network:row.network};
  }
  async balances(businessId:string,walletId:string) {
    const wallet=await this.get(businessId,walletId);
    const [classic,additional]=await Promise.all([this.chain.getClassicBalances(wallet.stellar_address),this.additionalBalances?.(wallet.stellar_address)??Promise.resolve([])]);
    const balances=[...classic,...additional];
    if(new Set(balances.map(balance=>balance.asset_id)).size!==balances.length)throw new GrapnelError(503,'ASSET_REGISTRY_INVALID','Balance readers returned a duplicate asset identity');
    const reservations=await this.pool.query("SELECT asset_id,SUM(amount_atomic)::text AS amount FROM balance_reservations WHERE business_id=$1 AND wallet_id=$2 AND state='active' GROUP BY asset_id",[businessId,walletId]);
    return balances.map(balance=>{
      const reserved=BigInt(reservations.rows.find(r=>r.asset_id===balance.asset_id)?.amount??'0');
      const available=/^0(?:\.0+)?$/.test(balance.spendable)?0n:toAtomic(balance.spendable,7);
      return {...balance,reserved:fromAtomic(reserved,7),spendable:fromAtomic(available>reserved?available-reserved:0n,7)};
    });
  }
}
