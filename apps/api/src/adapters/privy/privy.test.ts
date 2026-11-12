import {describe,expect,it,vi,afterEach} from 'vitest';
import {generateKeyPairSync,sign} from 'node:crypto';
import {PrivyClient} from '@privy-io/node';
import {Keypair} from '@stellar/stellar-sdk';
import {PrivyIdentityVerifier,PrivyWalletSigner,validateStellarPublicKey} from './index.js';
describe('Privy custody boundary',()=>{
 it('fails closed when provider app is not configured',async()=>{await expect(new PrivyIdentityVerifier(null).verify('forged')).rejects.toThrow('not configured');});
 it('does not provision customer wallets with unverified user identity',async()=>{const client={wallets:()=>({create:()=>{throw new Error('must not create');}})};await expect(new PrivyWalletSigner(client as never).provisionForCustomer('c','did:privy:alice')).rejects.toThrow('not bound');});
 it('validates Ed25519 public key against G-address',()=>{const wallet=Keypair.random();expect(validateStellarPublicKey(wallet.publicKey(),wallet.rawPublicKey().toString('hex'))).toBe(wallet.rawPublicKey().toString('hex'));expect(()=>validateStellarPublicKey(wallet.publicKey(),Keypair.random().rawPublicKey().toString('hex'))).toThrow('do not match');});
 it('accepts the live Privy zero-prefixed Ed25519 encoding only when all key bytes match',()=>{const w=Keypair.random(),raw=w.rawPublicKey().toString('hex');for(const encoded of ['00'+raw,'0x00'+raw])expect(validateStellarPublicKey(w.publicKey(),encoded)).toBe(raw);expect(()=>validateStellarPublicKey(w.publicKey(),'00'+Keypair.random().rawPublicKey().toString('hex'))).toThrow('do not match');for(const encoded of ['01'+raw,'0000'+raw,'00'+raw.slice(2)])expect(()=>validateStellarPublicKey(w.publicKey(),encoded)).toThrow('do not match');});

});
const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),verificationKey=keys.publicKey.export({type:'spki',format:'pem'}).toString();
const token=(patch:Record<string,unknown>={},app='offline-app')=>{
 const header=Buffer.from(JSON.stringify({typ:'JWT',alg:'ES256'})).toString('base64url');
 const body=Buffer.from(JSON.stringify({iss:'privy.io',aud:app,sub:'did:privy:fixture',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+60,cr:'1',linked_accounts:'[]',...patch})).toString('base64url'),input=`${header}.${body}`;
 return `${input}.${sign('sha256',Buffer.from(input),{key:keys.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url')}`;
};
function verifier(app='offline-app'){
 const wallet=Keypair.random(),client=new PrivyClient({appId:app,appSecret:'offline-secret',jwtVerificationKey:verificationKey});
 const current=vi.spyOn(client.users(),'_get').mockResolvedValue({id:'did:privy:fixture',linked_accounts:[{type:'wallet',chain_type:'stellar',id:'wallet-id',address:wallet.publicKey(),user_can_sign:true,wallet_client_type:'privy'}]} as never);
 const readWallet=vi.spyOn(client.wallets(),'get').mockResolvedValue({id:'wallet-id',chain_type:'stellar',address:wallet.publicKey(),public_key:wallet.rawPublicKey().toString('hex'),archived_at:null} as never);
 const verifyLocal=vi.spyOn(client.users(),'get');return {instance:new PrivyIdentityVerifier(client),current,readWallet,verifyLocal,wallet};
}
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
describe('Actual SDK cryptographic verification with bounded current-wallet proof reuse',()=>{
 it('verifies every JWT, coalesces current proof reads, and clones cached wallet bindings',async()=>{
  const {instance,current,readWallet,verifyLocal,wallet}=verifier(),jwt=token();const [a,b]=await Promise.all([instance.verify(jwt),instance.verify(jwt)]);
  expect(current).toHaveBeenCalledTimes(1);expect(readWallet).toHaveBeenCalledTimes(1);expect(verifyLocal).toHaveBeenCalledTimes(2);expect(b.wallets[0]?.address).toBe(wallet.publicKey());
  a.wallets[0]!.address='changed';b.wallets.length=0;expect((await instance.verify(jwt)).wallets[0]?.address).toBe(wallet.publicKey());expect(verifyLocal).toHaveBeenCalledTimes(3);
 });
 it('refreshes revoked signing association after at most ten seconds',async()=>{
  vi.useFakeTimers();const {instance,current}=verifier(),jwt=token();expect((await instance.verify(jwt)).wallets).toHaveLength(1);current.mockResolvedValue({id:'did:privy:fixture',linked_accounts:[]} as never);
  vi.advanceTimersByTime(10001);expect((await instance.verify(jwt)).wallets).toHaveLength(0);expect(current).toHaveBeenCalledTimes(2);
 });
 it('never accepts expired JWTs through a previously successful proof cache',async()=>{
  vi.useFakeTimers();const {instance,current}=verifier(),jwt=token({exp:Math.floor(Date.now()/1000)+2});await instance.verify(jwt);vi.advanceTimersByTime(3000);
  await expect(instance.verify(jwt)).rejects.toMatchObject({code:'INVALID_CUSTOMER_IDENTITY'});expect(current).toHaveBeenCalledTimes(1);
 });
 it('rejects expiration crossed while awaiting current provider proof',async()=>{
  vi.useFakeTimers();const {instance,current}=verifier(),jwt=token({exp:Math.floor(Date.now()/1000)+2});
  current.mockImplementationOnce(()=>{vi.advanceTimersByTime(3000);return Promise.resolve({id:'did:privy:fixture',linked_accounts:[]}) as unknown as ReturnType<ReturnType<PrivyClient['users']>['_get']>;});
  await expect(instance.verify(jwt)).rejects.toMatchObject({code:'INVALID_CUSTOMER_IDENTITY'});
 });
 it.each([{id:'different-wallet'},{archived_at:1}])('rejects wrong or archived current wallet %j',async patch=>{
  const {instance,readWallet,wallet}=verifier();readWallet.mockResolvedValue({id:'wallet-id',chain_type:'stellar',address:wallet.publicKey(),public_key:wallet.rawPublicKey().toString('hex'),archived_at:null,...patch} as never);
  await expect(instance.verify(token())).rejects.toMatchObject({code:'WALLET_MISMATCH'});
 });
 it.each([{iss:'wrong-issuer'},{aud:'wrong-app'},{exp:1},{exp:undefined}])('rejects actual signed JWT claims %j before remote proof reads',async claims=>{
  const {instance,current}=verifier();await expect(instance.verify(token(claims))).rejects.toMatchObject({code:'INVALID_CUSTOMER_IDENTITY'});expect(current).not.toHaveBeenCalled();
 });
 it('rejects tampering and tokens from a different configured app despite prior cache entries',async()=>{
  const {instance,current}=verifier(),jwt=token();await instance.verify(jwt);const parts=jwt.split('.');parts[1]=Buffer.from(JSON.stringify({sub:'did:privy:attacker'})).toString('base64url');await expect(instance.verify(parts.join('.'))).rejects.toMatchObject({code:'INVALID_CUSTOMER_IDENTITY'});
  const other=verifier('other-app');await expect(other.instance.verify(jwt)).rejects.toMatchObject({code:'INVALID_CUSTOMER_IDENTITY'});expect(other.current).not.toHaveBeenCalled();expect(current).toHaveBeenCalledTimes(1);
 });
 it('does not cache rejected provider reads as valid and checks current exact wallet association',async()=>{
  const {instance,current,readWallet}=verifier(),jwt=token();current.mockRejectedValueOnce(Error('opaque provider error'));
  await expect(instance.verify(jwt)).rejects.toMatchObject({code:'INVALID_CUSTOMER_IDENTITY'});await instance.verify(jwt);expect(current).toHaveBeenCalledTimes(2);
  const mismatch=verifier();mismatch.readWallet.mockResolvedValue({id:'wallet-id',chain_type:'stellar',address:Keypair.random().publicKey()} as never);await expect(mismatch.instance.verify(jwt)).rejects.toMatchObject({code:'WALLET_MISMATCH'});await expect(mismatch.instance.verify(jwt)).rejects.toMatchObject({code:'WALLET_MISMATCH'});expect(mismatch.readWallet).toHaveBeenCalledTimes(2);expect(readWallet).toHaveBeenCalledTimes(1);
 });
});
