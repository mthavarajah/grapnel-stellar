import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { hasFundingRoundTripProof } from './readiness.js';
const pool=(rows:unknown[])=>({query:async()=>({rows})}) as unknown as Pool;
const fund={direction:'fund',tx_hash:'a'.repeat(64),amount_atomic:'10000000',stellar_address:'customer'};
const returned={direction:'return',tx_hash:'b'.repeat(64),amount_atomic:'5000000',stellar_address:'customer'};
describe('funding evidence promotion',()=>{
 it('requires both completed directions, not a treasury activation',async()=>{expect(await hasFundingRoundTripProof(pool([fund]),'treasury',async()=>true)).toBe(false);});
 it('binds the chain proof to exact treasury/customer direction and amount',async()=>{
  const proofs:unknown[]=[];expect(await hasFundingRoundTripProof(pool([fund,returned]),'treasury',async p=>{proofs.push(p);return true;})).toBe(true);
  expect(proofs).toEqual([{txHash:fund.tx_hash,source:'treasury',recipient:'customer',amountAtomic:10000000n},{txHash:returned.tx_hash,source:'customer',recipient:'treasury',amountAtomic:5000000n}]);
 });
 it('never promotes partial, failed or unavailable chain verification',async()=>{expect(await hasFundingRoundTripProof(pool([fund,returned]),'treasury',async p=>p.txHash===fund.tx_hash)).toBe(false);expect(await hasFundingRoundTripProof(pool([fund,returned]),'treasury',async()=>{throw Error('RPC unavailable');})).toBe(false);});
});
