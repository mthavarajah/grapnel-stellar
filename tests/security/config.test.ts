import {describe,it,expect} from 'vitest';
import {validateEnvironment} from '../../scripts/check-env.js';
import {NETWORK_PASSPHRASE} from '../../packages/contracts/src/index.js';
describe('deployment environment boundaries',()=>{
 const valid={STELLAR_NETWORK:'testnet',STELLAR_NETWORK_PASSPHRASE:NETWORK_PASSPHRASE,DATABASE_URL:'postgres://localhost/grapnel_test',ADMIN_LOGIN_SECRET:'test-owner-secret-1234',SESSION_SECRET:'test-only-session-secret-minimum-32-characters'};
 it('rejects public secret variable names',()=>expect(validateEnvironment({...valid,NEXT_PUBLIC_GRAPNEL_API_KEY:'test-only'})).toContain('NEXT_PUBLIC_GRAPNEL_API_KEY must never be public'));
 it('rejects mainnet and production non-HTTPS origins',()=>{expect(validateEnvironment({...valid,STELLAR_NETWORK:'public'}).length).toBeGreaterThan(0);expect(validateEnvironment(valid,true)).toHaveLength(2);});
 it('accepts explicit Testnet server config without provider execution claim',()=>expect(validateEnvironment(valid)).toEqual([]));
});
