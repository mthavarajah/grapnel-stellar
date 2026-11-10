import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require=createRequire(new URL('../../apps/api/package.json',import.meta.url));
const {Account,Asset,Keypair,Operation,TransactionBuilder}=require('@stellar/stellar-sdk');
import { NETWORK, NETWORK_PASSPHRASE, XLM, type PreparedAction } from '../../packages/contracts/src/index.js';
import { verifySignedAction } from '../../apps/api/src/adapters/stellar/index.js';

/** Offline cryptographic fixtures only. Nothing in these tests reaches a network or signer provider. */
function payment() {
 const wallet=Keypair.random();const recipient=Keypair.random().publicKey();
 const expires=Math.floor(Date.now()/1000)+120;
 const tx=new TransactionBuilder(new Account(wallet.publicKey(),'1'),{fee:'100',networkPassphrase:NETWORK_PASSPHRASE,timebounds:{minTime:0,maxTime:expires}}).addOperation(Operation.payment({destination:recipient,asset:Asset.native(),amount:'1.0000000'})).build();
 const action:PreparedAction={operationId:'offline-operation',customerId:'offline-customer',network:NETWORK,walletAddress:wallet.publicKey(),unsignedXdr:tx.toXDR(),signingHashHex:tx.hash().toString('hex'),summary:{action:'testnet.return',fromAssetId:XLM.id,amount:'1.0000000',recipient,maxFeeStroops:'100',expiresAt:new Date(expires*1000).toISOString()},authorization:{method:'privy_stellar',expiresAt:new Date(expires*1000).toISOString()}};
 tx.sign(wallet);return {action,envelope:tx.toXDR()};
}
describe('independent approval summary binding',()=>{
 it('accepts the exact approved native payment',()=>{const {action,envelope}=payment();expect(()=>verifySignedAction(action,envelope)).not.toThrow();});
 it('rejects a validly signed envelope whose recipient differs from displayed approval',()=>{const {action,envelope}=payment();action.summary.recipient=Keypair.random().publicKey();expect(()=>verifySignedAction(action,envelope)).toThrow();});
 it('rejects a validly signed envelope whose amount differs from displayed approval',()=>{const {action,envelope}=payment();action.summary.amount='0.1000000';expect(()=>verifySignedAction(action,envelope)).toThrow();});
 it('rejects a native payment displayed as another asset identity',()=>{const {action,envelope}=payment();action.summary.fromAssetId='stellar-testnet:classic:USDC:'+Keypair.random().publicKey();expect(()=>verifySignedAction(action,envelope)).toThrow();});
});
