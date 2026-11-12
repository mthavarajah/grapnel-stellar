import {describe,it,expect,vi,afterEach} from 'vitest';
import {Account,Address,Asset,Contract,Keypair,Memo,Operation,SorobanDataBuilder,TransactionBuilder,nativeToScVal,rpc,xdr,type Transaction} from '@stellar/stellar-sdk';
import {NETWORK_PASSPHRASE,type PreparedAction} from '@grapnel/contracts';
import {CCTP_CUSTOMER_PINS as P} from './cctp-customer-pins';
import {CctpBurnPreparer} from '../../../api/src/adapters/cctp/preparer';
import {buildCctpBurnOperation,cctpBurnIntent,inspectCctpBurnAuthorization,inspectCctpBurnFootprint,inspectPreparedCctpBurn,type CctpBurnRequest,type CctpRecipientBinding,type CctpBurnIntent} from './cctp-customer-source';

const walletKey=Keypair.random();
import {signCustomerCctpSource,type CustomerCctpFunding,type CustomerCctpReview} from './cctp-customer';
const now=Date.parse('2026-11-12T04:50:00Z'),wallet=walletKey.publicKey(),stranger=Keypair.random().publicKey();
const customer={businessId:'00000000-0000-4000-8000-000000000001',customerId:'00000000-0000-4000-8000-000000000002',walletId:'00000000-0000-4000-8000-000000000003',walletAddress:wallet,privyUserId:'did:privy:fixture'};
const request=():CctpBurnRequest=>({operationId:'00000000-0000-4000-8000-000000000004',customer:{...customer},amountStellarAtomic:'10000000',evmRecipient:'0x1234567890123456789012345678901234567890',destinationDomain:19,expiresAt:new Date(now+90000).toISOString(),maxFeeStroops:'10000000'});
const binding=():CctpRecipientBinding=>({...customer,evmRecipient:request().evmRecipient,network:'hyperevm-testnet',chainId:998});
const intent=()=>cctpBurnIntent(request(),binding(),now),address=(s:string)=>new Address(s).toScVal(),symbol=(s:string)=>nativeToScVal(s,{type:'symbol'}),vec=(...v:xdr.ScVal[])=>xdr.ScVal.scvVec(v);
const dataKey=(id:string,k:xdr.ScVal,temporary=false)=>xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({contract:new Address(id).toScAddress(),key:k,durability:temporary?xdr.ContractDataDurability.temporary():xdr.ContractDataDurability.persistent()}));
const allowance=(owner=wallet,spender:string=P.stellar.messenger)=>vec(symbol('Allowance'),xdr.ScVal.scvMap([new xdr.ScMapEntry({key:symbol('from'),val:address(owner)}),new xdr.ScMapEntry({key:symbol('spender'),val:address(spender)})]));
function footprint(){return new SorobanDataBuilder().setResourceFee('10000').setResources(2_000_000,1000,1000).setReadOnly([
 ...[P.stellar.messenger,P.stellar.transmitter,P.stellar.usdc].map(id=>dataKey(id,xdr.ScVal.scvLedgerKeyContractInstance())),
 ...['a04c09f4bf064cfafb7e4e931752de15a216af1d59373bdd9d53908e7d29a9fe','8927f7389410044b35b1d3d0d7d42ea4ed0677dea18cb1bd89be4a980566c614'].map(hash=>xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({hash:Buffer.from(hash,'hex')}))),
 dataKey(P.stellar.messenger,vec(symbol('RemoteTokenMessenger'),nativeToScVal(19,{type:'u32'}))),
 dataKey(P.stellar.messenger,vec(symbol('MinFeeByBurnToken'),address(P.stellar.usdc))),
 dataKey(P.stellar.messenger,vec(symbol('TokenDecimalConfig'),address(P.stellar.usdc))),
 dataKey(P.stellar.messenger,vec(symbol('BurnLimit'),address(P.stellar.usdc))),
 dataKey(P.stellar.messenger,vec(symbol('Denylist'),address(wallet))),
 ]).setReadWrite([
 xdr.LedgerKey.trustline(new xdr.LedgerKeyTrustLine({accountId:new Address(wallet).toScAddress().accountId(),asset:new Asset('USDC',P.stellar.issuer).toTrustLineXDRObject()})),
 dataKey(P.stellar.usdc,vec(symbol('Balance'),address(P.stellar.messenger))),
 dataKey(P.stellar.usdc,allowance(),true),
 ]);}
function auth(i=intent()) {return [new xdr.SorobanAuthorizationEntry({credentials:xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),rootInvocation:new xdr.SorobanAuthorizedInvocation({function:xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(buildCctpBurnOperation(i).body().invokeHostFunctionOp().hostFunction().invokeContract()),subInvocations:[]})})];}
function success():rpc.Api.SimulateTransactionSuccessResponse{return{_parsed:true,id:'offline-fixture',latestLedger:100,events:[],minResourceFee:'10000',transactionData:footprint(),result:{auth:auth(),retval:xdr.ScVal.scvVoid()}};}
function dependencies(){return {now:()=>now,readRecipientBinding:vi.fn(async()=>binding()),verifyRegistry:vi.fn(async()=>{}),readAvailability:vi.fn(async()=>({balanceAtomic:10_000_000n,allowanceAtomic:10_000_000n})),server:{getNetwork:vi.fn(async()=>({passphrase:NETWORK_PASSPHRASE as string,protocolVersion:'30'})),getAccount:vi.fn(async()=>new Account(wallet,'12')),simulateTransaction:vi.fn(async()=>success())}};}
async function prepared(){const deps=dependencies(),action=await new CctpBurnPreparer(deps).prepare(request());return{deps,action,tx:TransactionBuilder.fromXDR(action.unsignedXdr,NETWORK_PASSPHRASE) as Transaction};}
describe('customer browser burn review — offline recorded simulations',()=>{
 it('accepts the adapter canonical exact operation and resources',async()=>{const {action,tx}=await prepared();expect(()=>inspectPreparedCctpBurn(action,tx,intent(),13n,now)).not.toThrow();});
 it.each(['recipient','amount','issuer','scope','network','digest'])("rejects source %s before signing",async field=>{const {action,tx}=await prepared();const v=structuredClone(action);if(field==='recipient')v.summary.recipient='0x'+'1'.repeat(40);if(field==='amount')v.summary.amount='2';if(field==='issuer')v.summary.fromAssetId='stellar-testnet:native:XLM';if(field==='scope')v.customerId='other';if(field==='network')v.network='mainnet' as any;if(field==='digest')v.signingHashHex='0'.repeat(64);expect(()=>inspectPreparedCctpBurn(v,tx,intent(),13n,now)).toThrow();});
 it('rejects expanded auth and foreign writes',()=>{const a=auth();a[0]!.rootInvocation().subInvocations([a[0]!.rootInvocation()]);expect(()=>inspectCctpBurnAuthorization(a,intent())).toThrow();const f=footprint(),rw=f.build().resources().footprint().readWrite();f.setReadWrite([...rw,dataKey(P.stellar.usdc,vec(symbol('Balance'),address(stranger)))]);expect(()=>inspectCctpBurnFootprint(f.build(),intent())).toThrow();});
});

afterEach(()=>vi.useRealTimers());
describe('exact Privy Stellar burn signature',()=>{
 it('checks full source envelope before signing and verifies returned customer Ed25519 signature',async()=>{vi.useFakeTimers();vi.setSystemTime(now);const {action}=await prepared();const review:CustomerCctpReview={businessId:customer.businessId,customerId:customer.customerId,walletId:customer.walletId,stellarAddress:wallet,accountAddress:request().evmRecipient,amount:'1'};const f:CustomerCctpFunding={id:request().operationId,state:'awaiting_source',...review,amountAtomic7:'10000000',expiresAt:request().expiresAt,source:action,source_customer_action_token:'offline-single-use-token',next_step:null,stage_id:null,stage:null,evmAction:null,sourceTxHash:null,messageHex:null,attestationHex:null,proof:null};const sign=vi.fn(async(input:{hash:`0x${string}`})=>({signature:('0x'+walletKey.sign(Buffer.from(input.hash.slice(2),'hex')).toString('hex'))as `0x${string}`}));const signed=await signCustomerCctpSource(f,review,sign,now);expect((TransactionBuilder.fromXDR(signed,NETWORK_PASSPHRASE)as Transaction).signatures).toHaveLength(1);expect(sign).toHaveBeenCalledTimes(1);const bad={...f,source:{...action,summary:{...action.summary,amount:'2'}}};sign.mockClear();await expect(signCustomerCctpSource(bad,review,sign,now)).rejects.toThrow();expect(sign).not.toHaveBeenCalled();});
});
