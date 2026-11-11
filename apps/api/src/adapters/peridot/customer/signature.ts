import {Keypair,Transaction,TransactionBuilder} from '@stellar/stellar-sdk';
import {NETWORK,NETWORK_PASSPHRASE,type CustomerContext,type PreparedAction} from '@grapnel/contracts';
import {canonicalJson} from '../../../lib/crypto.js';
import {invalid} from './policy.js';
export function assertSamePrepared(actual:PreparedAction,expected:PreparedAction):void {
 if(canonicalJson(actual)!==canonicalJson(expected))return invalid('DURABLE_PREPARED_ACTION');
}
/** Privy uses the same Stellar Ed25519 envelope format. This is signature validation, not customer execution proof. */
export function inspectCustomerSignature(prepared:PreparedAction,signedXdr:string,customer:CustomerContext):Transaction {
 const tx=TransactionBuilder.fromXDR(signedXdr,NETWORK_PASSPHRASE);
 if(!(tx instanceof Transaction)||prepared.network!==NETWORK||prepared.authorization.method!=='privy_stellar'||prepared.customerId!==customer.customerId||prepared.walletAddress!==customer.walletAddress||tx.source!==customer.walletAddress||tx.hash().toString('hex')!==prepared.signingHashHex||tx.signatures.length!==1||!customer.privyUserId.startsWith('did:privy:'))return invalid('CUSTOMER_SOURCE_OR_HASH');
 const key=Keypair.fromPublicKey(customer.walletAddress),signature=tx.signatures[0]!;
 if(!signature.hint().equals(key.signatureHint())||!key.verify(tx.hash(),signature.signature()))return invalid('CUSTOMER_SIGNATURE');
 return tx;
}
