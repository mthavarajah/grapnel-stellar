import {describe,it,expect,vi} from 'vitest';
import {StrKey} from '@stellar/stellar-sdk';
import {parseBridgeUsdcAmount,stellarAtomicToCctp,cctpAtomicToStellar,evmRecipientBytes32,stellarAccountForwarding} from './encoding.js';
import {CCTP_TESTNET,assertCircleStellarUsdc} from './registry.js';
import {validateStellarRegistry,validateEvmRegistry,readEvmRegistry} from './reader.js';
import evidence from './research/testnet-registry-read.json' with {type:'json'};
const owner='GB4PC65ZHBPVEZMAHY2K2KYMS3RFBIN2FQIE3LGTLEHT2DEWVMTD7JYQ';
const copy=<T>(value:T):T=>structuredClone(value);
describe('exact USDC identity and precision',()=>{
 it('accepts exact six-decimal bridge value while preserving Stellar reviewed debit',()=>{expect(parseBridgeUsdcAmount('1.1234560')).toEqual({stellarAtomic:11234560n,cctpAtomic:1123456n});expect(cctpAtomicToStellar(stellarAtomicToCctp(900719925474099300n))).toBe(900719925474099300n);});
 it.each(['0','-1','1e2','NaN',' 1','01','0.0000001','1.1234567','1.00000001'])('rejects lossy or malformed amount %s',value=>expect(()=>parseBridgeUsdcAmount(value)).toThrow());
 it('rejects direct zero/negative/out-of-range base units without rounding',()=>{for(const n of [0n,-1n,1n,(1n<<127n)])expect(()=>stellarAtomicToCctp(n)).toThrow();for(const n of [0n,-1n,(1n<<127n)/10n+1n])expect(()=>cctpAtomicToStellar(n)).toThrow();});
 it('requires the Circle issuer/SAC pair, network and decimals; does not reuse existing demo USDC',()=>{
  const asset={network:'stellar-testnet',code:'USDC',issuer:CCTP_TESTNET.stellar.issuer,contractId:CCTP_TESTNET.stellar.usdc,decimals:7};expect(()=>assertCircleStellarUsdc(asset)).not.toThrow();
  for(const patch of [{issuer:'GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56'},{network:'stellar-mainnet'},{decimals:6},{contractId:CCTP_TESTNET.stellar.messenger},{code:'usdc'}])expect(()=>assertCircleStellarUsdc({...asset,...patch})).toThrow('ASSET_MISMATCH');
 });
});
describe('CCTP recipient encoding',()=>{
 it('left-pads a nonzero EVM account to exactly32 bytes',()=>expect(evmRecipientBytes32('0x1234567890abcdef1234567890ABCDEF12345678')).toBe('0x0000000000000000000000001234567890abcdef1234567890abcdef12345678'));
 it.each(['0x'+'0'.repeat(40),'0x12','0x'+'1'.repeat(64),'0x'+'x'.repeat(40)])('rejects malformed EVM recipient',value=>expect(()=>evmRecipientBytes32(value)).toThrow());
 it('uses pinned Stellar forwarder as mintRecipient, not the G account bytes',()=>{
  const out=stellarAccountForwarding(owner),hook=Buffer.from(out.hookData.slice(2),'hex');expect(out.mintRecipient).toBe('0x'+Buffer.from(StrKey.decodeContract(CCTP_TESTNET.stellar.forwarder)).toString('hex'));expect(out.destinationCaller).toBe(out.mintRecipient);expect(hook.subarray(0,28)).toEqual(Buffer.alloc(28));expect(hook.readUInt32BE(28)).toBe(56);expect(hook.subarray(32).toString('utf8')).toBe(owner);
 });
 it('does not encode a caller-controlled contract as a customer account',()=>expect(()=>stellarAccountForwarding(CCTP_TESTNET.stellar.forwarder)).toThrow());
});
describe('read-only live registry evidence',()=>{
 it('validates independently captured Testnet ledger/config and proxy implementation pins',()=>{expect(evidence.execution_status).toBe('discovery_only');expect(evidence.bridge_execution_verified).toBe(false);expect(evidence.tx_hash).toBeNull();expect(()=>validateStellarRegistry(evidence.stellar)).not.toThrow();expect(()=>validateEvmRegistry(evidence.hyperEvm,Date.parse(evidence.observed_at))).not.toThrow();});
 it('rejects wrong Stellar passphrase, code, domain, transmitter or USDC metadata',()=>{
  for(const mutate of [(s:typeof evidence.stellar)=>{s.passphrase='Public Global Stellar Network ; September 2015'},(s:typeof evidence.stellar)=>{s.contracts.messenger.codeHash='0'.repeat(64)},(s:typeof evidence.stellar)=>{s.contracts.transmitter.storage.LocalDomain=19},(s:typeof evidence.stellar)=>{s.contracts.messenger.storage.LocalMessageTransmitter=CCTP_TESTNET.stellar.forwarder},(s:typeof evidence.stellar)=>{s.contracts.usdc.storage.METADATA.decimal=6},(s:typeof evidence.stellar)=>{s.contracts.usdc.storage.METADATA.name='USDC:WRONG'}]){const s=copy(evidence.stellar);mutate(s);expect(()=>validateStellarRegistry(s)).toThrow();}
 });
 it('rejects mainnet, wrong domain/USDC decimals, implementation upgrade, missing code and stale block',()=>{
  for(const mutate of [(s:typeof evidence.hyperEvm)=>{s.chainId='0x3e7'},(s:typeof evidence.hyperEvm)=>{s.domain='0x'+'0'.repeat(63)+'1'},(s:typeof evidence.hyperEvm)=>{s.decimals='0x'+'0'.repeat(63)+'7'},(s:typeof evidence.hyperEvm)=>{s.contracts.messenger.implementation='0x'+'1'.repeat(40)},(s:typeof evidence.hyperEvm)=>{s.contracts.usdc.sha256='0'.repeat(64)},(s:typeof evidence.hyperEvm)=>{s.blockTimestamp-=121}]){const s=copy(evidence.hyperEvm);mutate(s);expect(()=>validateEvmRegistry(s,Date.parse(evidence.observed_at))).toThrow();}
 });
 it('fails before any further RPC calls if chain998 is not returned, with no configurable host',async()=>{
  const fetcher=vi.fn(async(url:unknown,init?:RequestInit)=>{expect(url).toBe(CCTP_TESTNET.hyperEvm.rpc);const q=JSON.parse(String(init?.body));expect(q.method).toBe('eth_chainId');expect(init?.redirect).toBe('error');return new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,result:'0x3e7'}));}) as unknown as typeof fetch;
  await expect(readEvmRegistry(fetcher)).rejects.toThrow('NETWORK_MISMATCH');expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('rejects oversized RPC data before parsing',async()=>{
  const fetcher=vi.fn(async()=>new Response(' '.repeat(262145))) as unknown as typeof fetch;await expect(readEvmRegistry(fetcher)).rejects.toThrow('RESPONSE_TOO_LARGE');
 });
});
