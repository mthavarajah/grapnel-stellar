import {describe,expect,it} from 'vitest';
import {screenCommodityCatalog} from './catalog.js';
const xaum='CC2RBGYNCFBCVENIDL5BFBWPH4OUZM2UA3OD2K2N54GLMWCC4KWPVAGO';
describe('commodity catalog screening never substitutes mainnet or ticker claims for Testnet proof',()=>{
 it('keeps actual-shaped mainnet XAUM excluded even when a provider labels it verified',()=>{
  expect(screenCommodityCatalog({network:'mainnet',assets:[{code:'XAUM',contract:xaum,verified:true,price:'4000'}]})).toEqual([{code:'XAUM',contract_id:xaum,source_network:'mainnet',executable:false,reason:'MAINNET_ASSET_NOT_TESTNET'}]);
 });
 it('refuses to infer Testnet from a networkless catalog or surrounding environment',()=>{
  expect(screenCommodityCatalog({assets:[{code:'PAXG',contract:xaum}]})).toEqual([expect.objectContaining({source_network:'unverified',executable:false,reason:'ASSET_LIST_NETWORK_UNVERIFIED'})]);
 });
 it('still requires issuer provenance and a live route for an explicit Testnet ticker',()=>{
  expect(screenCommodityCatalog({network:'testnet',assets:[{code:'GOLD',contract:xaum,verified:true}]})).toEqual([expect.objectContaining({executable:false,reason:'ISSUER_AND_LIVE_TESTNET_ROUTE_PROOF_REQUIRED'})]);
 });
 it('does not treat unrelated coins as commodities or malformed IDs as verified identities',()=>{
  expect(screenCommodityCatalog({network:'testnet',assets:[{code:'BTC',contract:xaum},{code:'USDC',contract:xaum}]})).toEqual([]);
  expect(screenCommodityCatalog({network:'testnet',assets:[{code:'XAU',contract:'0x-not-stellar'}]})[0]?.contract_id).toBeNull();
 });
 it.each([null,[],{assets:{}},{network:'testnet'}])('rejects malformed catalogs %j',body=>expect(()=>screenCommodityCatalog(body)).toThrow('explicit network and asset list'));
});
