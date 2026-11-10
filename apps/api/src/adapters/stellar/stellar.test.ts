import { describe,expect,it,vi } from 'vitest';
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { NETWORK, NETWORK_PASSPHRASE, type PreparedAction } from '@grapnel/contracts';
import { StellarTestnetExecutor,assertTestnet,attachRawSignature,verifySignedAction } from './index.js';
const wallet=Keypair.random();const recipient=Keypair.random();
function fixture(network=NETWORK_PASSPHRASE as string):PreparedAction {
 const expires=Math.floor(Date.now()/1000)+120;
 const tx=new TransactionBuilder(new Account(wallet.publicKey(),'1'),{fee:'100',networkPassphrase:network,timebounds:{minTime:0,maxTime:expires}}).addOperation(Operation.payment({destination:recipient.publicKey(),asset:Asset.native(),amount:'1.0000000'})).build();
 return {operationId:'op-test',customerId:'customer-test',network:NETWORK,walletAddress:wallet.publicKey(),unsignedXdr:tx.toXDR(),signingHashHex:tx.hash().toString('hex'),summary:{action:'testnet.return',fromAssetId:'stellar-testnet:native:XLM',amount:'1.0000000',recipient:recipient.publicKey(),maxFeeStroops:'100',expiresAt:new Date(expires*1000).toISOString()},authorization:{method:'privy_stellar',expiresAt:new Date(expires*1000).toISOString()}};
}
describe('exact Testnet customer signature boundary',()=>{
 it('attaches valid raw Ed25519 signature to exact approved envelope',()=>{const action=fixture();const signature=wallet.sign(Buffer.from(action.signingHashHex,'hex'));const signed=attachRawSignature(action,'0x'+signature.toString('hex'));expect(()=>verifySignedAction(action,signed)).not.toThrow();});
 it('rejects business key alone / unsigned envelope',()=>{const action=fixture();expect(()=>verifySignedAction(action,action.unsignedXdr)).toThrow('signature');});
 it('rejects another wallet signature',()=>{const action=fixture();expect(()=>attachRawSignature(action,'0x'+recipient.sign(Buffer.from(action.signingHashHex,'hex')).toString('hex'))).toThrow('does not match');});
 it('rejects a mainnet signing hash',()=>{const action=fixture(Networks.PUBLIC);expect(()=>attachRawSignature(action,'0x'+wallet.sign(Buffer.from(action.signingHashHex,'hex')).toString('hex'))).toThrow('does not match');});
 it('rejects XDR substitution with a valid signer',()=>{const action=fixture();const altered=TransactionBuilder.fromXDR(action.unsignedXdr,NETWORK_PASSPHRASE);altered.sign(wallet);const other=fixture();other.signingHashHex='0'.repeat(64);expect(()=>verifySignedAction(other,altered.toXDR())).toThrow('differs');});
 it('rejects expired authorization',()=>{const action=fixture();action.authorization.expiresAt=new Date(Date.now()-1000).toISOString();expect(()=>attachRawSignature(action,'0x'+wallet.sign(Buffer.from(action.signingHashHex,'hex')).toString('hex'))).toThrow('expired');});
 it('rejects extra signatures',()=>{const action=fixture();const tx=TransactionBuilder.fromXDR(action.unsignedXdr,NETWORK_PASSPHRASE);tx.sign(wallet,recipient);expect(()=>verifySignedAction(action,tx.toXDR())).toThrow('signature');});
 it('rejects configured mainnet and unknown network destinations',()=>{expect(()=>assertTestnet({network:'public',passphrase:Networks.PUBLIC})).toThrow('Testnet');expect(()=>assertTestnet({network:'testnet',passphrase:NETWORK_PASSPHRASE,rpcUrl:'https://mainnet.stellar.org'})).toThrow('Testnet');});
 it('rejects opaque Soroban preparation until adapter-specific inspection exists',async()=>{const executor=new StellarTestnetExecutor({network:'testnet',passphrase:NETWORK_PASSPHRASE});await expect(executor.prepareAndSimulate({operationId:'op',customerId:'c',walletAddress:wallet.publicKey(),operationXdr:'untrusted',summary:fixture().summary,allowedContracts:[]})).rejects.toThrow('inspector');});
 it('retains pending chain status rather than fabricating finality',async()=>{const executor=new StellarTestnetExecutor({network:'testnet',passphrase:NETWORK_PASSPHRASE});vi.spyOn(executor,'verifyLiveNetwork').mockResolvedValue();vi.spyOn(executor.server,'getTransaction').mockResolvedValue({status:'NOT_FOUND'} as never);expect(await executor.reconcile('a'.repeat(64))).toBe('pending');});
});
