import {afterEach,describe,expect,it,vi} from 'vitest';
import {createIdentityTokenResolver} from './identity-token.js';
const NOW=Date.parse('2026-11-12T05:00:00Z'),context={appId:'offline-app',userId:'did:privy:alice'};
const token=(patch:Record<string,unknown>={})=>{const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');return `${encode({typ:'JWT',alg:'ES256'})}.${encode({iss:'privy.io',aud:context.appId,sub:context.userId,exp:NOW/1000+3600,...patch})}.not-a-signature`;};
function setup(){const resolver=createIdentityTokenResolver();resolver.setIdentity(context);return resolver;}
afterEach(()=>{vi.useRealTimers();});
describe('Client identity-token refresh coordination, never authentication proof',()=>{
 it('reuses the current hook token without fetching users/me; does not claim to verify its signature',async()=>{
  vi.useFakeTimers();vi.setSystemTime(NOW);const resolver=setup(),refresh=vi.fn(),jwt=token();expect(await resolver.resolve({currentToken:jwt,refresh})).toBe(jwt);expect(refresh).not.toHaveBeenCalled();
 });
 it.each([null,'malformed',token({exp:NOW/1000+15}),token({aud:'wrong-app'}),token({sub:'did:privy:other'}),token({iss:'wrong-issuer'})])('refreshes missing/expiring/mismatched current token %s',async currentToken=>{
  vi.useFakeTimers();vi.setSystemTime(NOW);const resolver=setup(),refresh=vi.fn(async()=>token());expect(await resolver.resolve({currentToken,refresh})).toBe(token());expect(refresh).toHaveBeenCalledTimes(1);
 });
 it('shares simultaneous refreshes and never stores a successful token for later reuse',async()=>{
  vi.useFakeTimers();vi.setSystemTime(NOW);const resolver=setup(),refresh=vi.fn(async()=>token());await Promise.all([resolver.resolve({currentToken:null,refresh}),resolver.resolve({currentToken:null,refresh})]);expect(refresh).toHaveBeenCalledTimes(1);await resolver.resolve({currentToken:null,refresh});expect(refresh).toHaveBeenCalledTimes(2);
 });
 it('invalidates in-flight token results on account change and logout',async()=>{
  vi.useFakeTimers();vi.setSystemTime(NOW);for(const userId of ['did:privy:bob',null]){
   const resolver=setup();let complete!:(token:string)=>void;const pending=resolver.resolve({currentToken:null,refresh:()=>new Promise(resolve=>{complete=resolve;})});await Promise.resolve();resolver.setIdentity({...context,userId});complete(token());await expect(pending).rejects.toMatchObject({code:'IDENTITY_CHANGED'});
  }
 });
 it('rejects a refreshed token for the wrong account or expired token without retrying',async()=>{
  vi.useFakeTimers();vi.setSystemTime(NOW);for(const jwt of [token({sub:'did:privy:other'}),token({exp:1}),null]){const resolver=setup(),refresh=vi.fn(async()=>jwt);await expect(resolver.resolve({currentToken:null,refresh})).rejects.toMatchObject({code:'TOKEN_UNAVAILABLE'});expect(refresh).toHaveBeenCalledTimes(1);}
 });
 it('honors a sixty-second429 cooldown without blind retries, even across account changes',async()=>{
  vi.useFakeTimers();vi.setSystemTime(NOW);const resolver=setup(),refresh=vi.fn(async()=>{throw {status:429,opaque:'never exposed'};});await expect(resolver.resolve({currentToken:null,refresh})).rejects.toMatchObject({code:'REFRESH_COOLDOWN'});
  resolver.setIdentity({...context,userId:'did:privy:bob'});await expect(resolver.resolve({currentToken:null,refresh})).rejects.toMatchObject({code:'REFRESH_COOLDOWN'});await vi.advanceTimersByTimeAsync(60001);expect(refresh).toHaveBeenCalledTimes(1);refresh.mockResolvedValueOnce(token({sub:'did:privy:bob'}) as never);await resolver.resolve({currentToken:null,refresh});expect(refresh).toHaveBeenCalledTimes(2);
 });
 it('times out hanging refresh once and ignores late completion',async()=>{
  vi.useFakeTimers();vi.setSystemTime(NOW);const resolver=setup();let complete!:(value:string)=>void;const refresh=vi.fn(()=>new Promise<string>(resolve=>{complete=resolve;}));const result=resolver.resolve({currentToken:null,refresh});const assertion=expect(result).rejects.toMatchObject({code:'REFRESH_TIMEOUT'});await vi.advanceTimersByTimeAsync(15001);await assertion;complete(token());await Promise.resolve();await expect(resolver.resolve({currentToken:null,refresh})).rejects.toMatchObject({code:'REFRESH_COOLDOWN'});expect(refresh).toHaveBeenCalledTimes(1);
 });
 it('requires authenticated identity and rejects token subject reuse after logout',async()=>{
  vi.useFakeTimers();vi.setSystemTime(NOW);const resolver=setup(),refresh=vi.fn(async()=>token());resolver.setIdentity({...context,userId:null});await expect(resolver.resolve({currentToken:token(),refresh})).rejects.toMatchObject({code:'IDENTITY_REQUIRED'});expect(refresh).not.toHaveBeenCalled();
 });
});
