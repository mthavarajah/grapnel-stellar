import {afterEach,describe,expect,it,vi} from 'vitest';
import {Asset,StrKey} from '@stellar/stellar-sdk';
import {NETWORK_PASSPHRASE,type AssetIdentity} from '@grapnel/contracts';
import {CommodityDiscovery,type ApprovedCommodityCandidate,type CommodityDiscoveryReads} from './discovery.js';
const token=StrKey.encodeContract(Buffer.alloc(32,23)),other=StrKey.encodeContract(Buffer.alloc(32,24));
const native=Asset.native().contractId(NETWORK_PASSPHRASE);const now=Date.now();
const a:AssetIdentity={id:`stellar-testnet:soroban:${token}`,network:'stellar-testnet',kind:'soroban',code:'QA_GOLD',contractId:token,decimals:7,verified:true,sourceUrl:'https://issuer.example.invalid/testnet-registry'};
const candidate:ApprovedCommodityCandidate={asset:a,issuerProvenanceUrl:'https://issuer.example.invalid/rights',issuerRightsDescription:'Isolated fixture only; no real commodity claim',expectedWasmHash:'1'.repeat(64),allowedRouteContracts:[token]};
function reads():CommodityDiscoveryReads{return {readNetworkPassphrase:vi.fn(async()=>NETWORK_PASSPHRASE),readContract:vi.fn(async()=>({contractId:token,code:'QA_GOLD',decimals:7,executableType:'wasm' as const,wasmHash:'1'.repeat(64),ledger:123,observedAt:new Date(now).toISOString()})),quoteExactIn:vi.fn(async()=>({inputContract:native,outputContract:token,amountInAtomic:'10000000',expectedOutAtomic:'1000000',minOutAtomic:'995000',routeContracts:[native,token],observedAt:new Date(now).toISOString(),expiresAt:new Date(now+30000).toISOString()}))};}
describe('approved commodity registry read-only discovery — isolated fixtures',()=>{
 afterEach(()=>vi.restoreAllMocks());
 it('queries nothing when no first-party Testnet candidates are approved',async()=>{const r=reads();expect(await new CommodityDiscovery().discover(r,now)).toEqual([]);expect(r.readNetworkPassphrase).not.toHaveBeenCalled();});
 it('requires exact chain identity, provenance and executable before querying a provider',()=>{
  for(const patch of [{asset:{...a,network:'mainnet'}},{asset:{...a,id:'symbol-only:GOLD'}},{issuerProvenanceUrl:''},{expectedWasmHash:undefined},{allowedRouteContracts:[]}])expect(()=>new CommodityDiscovery([{...candidate,...patch} as ApprovedCommodityCandidate])).toThrow();
  expect(()=>new CommodityDiscovery([candidate,candidate])).toThrow();
 });
 it('fails closed on RPC network mismatch before contract/quote reads',async()=>{const r=reads();r.readNetworkPassphrase=vi.fn(async()=>'Public Global Stellar Network ; September 2015');await expect(new CommodityDiscovery([candidate]).discover(r,now)).rejects.toMatchObject({code:'NETWORK_MISMATCH'});expect(r.readContract).not.toHaveBeenCalled();});
 it('reports valid fresh contract and strict liquidity only as discovery, never executable',async()=>{const r=reads();expect(await new CommodityDiscovery([candidate]).discover(r,now)).toEqual([expect.objectContaining({execution_status:'discovery_only',executable:false,reason:'COMMODITY_EXECUTION_INSPECTION_AND_CHAIN_PROOF_REQUIRED',live_ledger:123})]);expect(r.quoteExactIn).toHaveBeenCalledWith({assetIn:native,assetOut:token,amountAtomic:'10000000',slippageBps:50});});
 it('rejects mismatched or stale live contracts before quote requests',async()=>{for(const patch of [{contractId:other},{wasmHash:'2'.repeat(64)},{decimals:9},{code:'OTHER'},{observedAt:new Date(now-20000).toISOString()}]){const r=reads(),original=await r.readContract(token);r.readContract=vi.fn(async()=>({...original,...patch}));expect((await new CommodityDiscovery([candidate]).discover(r,now))[0]?.reason).toBe('COMMODITY_LIVE_CONTRACT_OR_IDENTITY_MISMATCH');expect(r.quoteExactIn).not.toHaveBeenCalled();}});
 it('rejects wrong amount, insufficient minimum, foreign route and expired quote',async()=>{for(const patch of [{amountInAtomic:'2'},{minOutAtomic:'994999'},{routeContracts:[native,other,token]},{expiresAt:new Date(now-1).toISOString()},{expectedOutAtomic:'0'}]){const r=reads(),original=await r.quoteExactIn({assetIn:native,assetOut:token,amountAtomic:'10000000',slippageBps:50});r.quoteExactIn=vi.fn(async()=>({...original,...patch}));expect((await new CommodityDiscovery([candidate]).discover(r,now))[0]?.reason).toBe('COMMODITY_EXACT_TESTNET_LIQUIDITY_UNVERIFIED');}});
 it('checks freshness when slow provider responses arrive, not when discovery starts',async()=>{
  let clock=now;vi.spyOn(Date,'now').mockImplementation(()=>clock);
  const r=reads(),contract=await r.readContract(token),quote=await r.quoteExactIn({assetIn:native,assetOut:token,amountAtomic:'10000000',slippageBps:50});
  r.readNetworkPassphrase=vi.fn(async()=>{clock+=3000;return NETWORK_PASSPHRASE;});
  r.readContract=vi.fn(async()=>{clock+=3000;return {...contract,observedAt:new Date(clock).toISOString()};});
  r.quoteExactIn=vi.fn(async()=>{clock+=3000;return {...quote,observedAt:new Date(clock).toISOString(),expiresAt:new Date(clock+30000).toISOString()};});
  expect((await new CommodityDiscovery([candidate]).discover(r))[0]?.execution_status).toBe('discovery_only');
 });
 it('does not accept a quote that expires while the provider request is in flight',async()=>{
  let clock=now;vi.spyOn(Date,'now').mockImplementation(()=>clock);
  const r=reads(),quote=await r.quoteExactIn({assetIn:native,assetOut:token,amountAtomic:'10000000',slippageBps:50});
  r.quoteExactIn=vi.fn(async()=>{clock+=40000;return quote;});
  expect((await new CommodityDiscovery([candidate]).discover(r))[0]?.reason).toBe('COMMODITY_EXACT_TESTNET_LIQUIDITY_UNVERIFIED');
 });
 it('keeps its reviewed registry unchanged when a caller mutates returned asset metadata',async()=>{
  const discovery=new CommodityDiscovery([candidate]);const first=await discovery.discover(reads(),now);
  first[0]!.asset.contractId=other;first[0]!.asset.code='MUTATED';
  expect((await discovery.discover(reads(),now))[0]).toMatchObject({asset:{contractId:token,code:'QA_GOLD'},execution_status:'discovery_only'});
 });
 it('turns provider failure into blocked availability without inventing a market or price',async()=>{const r=reads();r.readContract=vi.fn(async()=>{throw Error('provider secret must not escape');});const result=await new CommodityDiscovery([candidate]).discover(r,now);expect(result[0]).toMatchObject({execution_status:'blocked',executable:false,reason:'COMMODITY_PROVIDER_READ_UNAVAILABLE'});expect(JSON.stringify(result)).not.toContain('secret');});
});
