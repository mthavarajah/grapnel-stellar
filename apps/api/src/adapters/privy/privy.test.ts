import {describe,expect,it} from 'vitest';
import {Keypair} from '@stellar/stellar-sdk';
import {PrivyIdentityVerifier,PrivyWalletSigner,validateStellarPublicKey} from './index.js';
describe('Privy custody boundary',()=>{
 it('fails closed when provider app is not configured',async()=>{await expect(new PrivyIdentityVerifier(null).verify('forged')).rejects.toThrow('not configured');});
 it('does not provision customer wallets with unverified user identity',async()=>{const client={wallets:()=>({create:()=>{throw new Error('must not create');}})};await expect(new PrivyWalletSigner(client as never).provisionForCustomer('c','did:privy:alice')).rejects.toThrow('not bound');});
 it('validates Ed25519 public key against G-address',()=>{const wallet=Keypair.random();expect(validateStellarPublicKey(wallet.publicKey(),wallet.rawPublicKey().toString('hex'))).toBe(wallet.rawPublicKey().toString('hex'));expect(()=>validateStellarPublicKey(wallet.publicKey(),Keypair.random().rawPublicKey().toString('hex'))).toThrow('do not match');});
 it('accepts the live Privy zero-prefixed Ed25519 encoding only when all key bytes match',()=>{const w=Keypair.random(),raw=w.rawPublicKey().toString('hex');for(const encoded of ['00'+raw,'0x00'+raw])expect(validateStellarPublicKey(w.publicKey(),encoded)).toBe(raw);expect(()=>validateStellarPublicKey(w.publicKey(),'00'+Keypair.random().rawPublicKey().toString('hex'))).toThrow('do not match');for(const encoded of ['01'+raw,'0000'+raw,'00'+raw.slice(2)])expect(()=>validateStellarPublicKey(w.publicKey(),encoded)).toThrow('do not match');});

});
