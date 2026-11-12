import {describe,expect,it} from 'vitest';
import {Account,Address,Contract,Operation,TransactionBuilder,nativeToScVal,xdr,type Transaction} from '@stellar/stellar-sdk';
import {NETWORK_PASSPHRASE,type PreparedAction} from '@grapnel/contracts';
import {inspectMarginApproval,isMarginApprovalAction} from './margin-approval';
const W='GCWFA4FRYPQZDIG3WVEDCUQ2EJP67AF2HDNHV3YK6YW3AP3D3WRB2JY2',OTHER='GAE2LMU74DRUAA3ZIQKJ2SI4ZQX7E4FK4ZLIGNDC35X6VXPLUREOIVPJ';
const M='CAKKHUGHP67UA4F42QOYPKNGRSBJEOE62MGDXA2UURTEYFOQGSMIRUFO',TOKEN='CDPXNHHVSLX3HFAHV7XOISM23MZH36WSXTO45RNDOBIDFZBGTSOVD4OY',V='CCEW6NSPCV7XUEQV75ZMII5HK5DGXK5JP2QOTGLV4UFLDBPEKRGO4Y4B',N='CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',P='CCMNSENXDBNJSY72BDIPH5CCXLLHBKZ4LXTRKDLKZN4UI2NJFQLWTLD6';
const ID='9ac7a9cde23ac2ada11105eeaa42e43c2ea8332ca0aa8f41f58d7160274d718e',X='stellar-testnet:native:XLM',T=`stellar-testnet:soroban:${TOKEN}`,R=`stellar-testnet:soroban:${V}`;
const addr=(v:string)=>new Address(v).toScVal(),n=(v:bigint,type:'u128'|'u64'|'i128'='u128')=>nativeToScVal(v,{type});
const fn=(c:string,m:string,a:xdr.ScVal[])=>new Contract(c).call(m,...a).body().invokeHostFunctionOp().hostFunction().invokeContract();
const node=(f:xdr.InvokeContractArgs,sub:xdr.SorobanAuthorizedInvocation[]=[])=>new xdr.SorobanAuthorizedInvocation({function:xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(f),subInvocations:sub});
const actions=['collateral_swap','vault_deposit','transfer','open_begin','open_swap','open_activate','open_cancel','close_atomic','return','vault_withdraw'] as const;
function fixture(step:typeof actions[number]='open_begin'){
 let c=M,m:string,a:xdr.ScVal[],child:xdr.InvokeContractArgs|undefined;
 const s:PreparedAction['summary']={action:`margin.${step}`,contractId:M,recipient:W,maxFeeStroops:'1000',expiresAt:new Date(Date.now()+60000).toISOString()};
 switch(step){
  case 'collateral_swap':c=P;m='swap';a=[addr(W),nativeToScVal(0,{type:'u32'}),nativeToScVal(1,{type:'u32'}),n(10000000n),n(1500000n)];Object.assign(s,{fromAssetId:X,toAssetId:T,amount:'1',minReceive:'0.15'});child=fn(N,'transfer',[addr(W),addr(P),n(10000000n,'i128')]);break;
  case 'vault_deposit':c=V;m='deposit';a=[addr(W),n(10000000n)];Object.assign(s,{fromAssetId:T,toAssetId:R,amount:'1',recipient:V});child=fn(TOKEN,'transfer',[addr(W),addr(V),n(10000000n,'i128')]);break;
  case 'transfer':m='transfer_spot_to_margin';a=[addr(W),addr(TOKEN),n(999999n)];Object.assign(s,{fromAssetId:R,amount:'0.999999',recipient:M});child=fn(V,'transfer',[addr(W),addr(M),n(999999n,'i128')]);break;
  case 'open_begin':m='begin_open_position_v3';a=[addr(W),addr(TOKEN),addr(N),n(999999n),n(2n),xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Long')]),xdr.ScVal.scvVec([addr(N),addr(TOKEN)]),nativeToScVal(Uint8Array.from(ID.match(/../g)!.map(v=>parseInt(v,16)))),addr(P),n(10000000n)];Object.assign(s,{fromAssetId:R,toAssetId:X,amount:'0.999999',minReceive:'1',recipient:M});break;
  case 'open_swap':case 'open_cancel':m=step==='open_swap'?'swap_open_position_v3':'cancel_pending_open_v3';a=[addr(W),n(13844n,'u64')];Object.assign(s,{fromAssetId:R,amount:'0.999999',positionId:'13844',...(step==='open_swap'?{toAssetId:X,recipient:M}:{})});break;
  case 'open_activate':m='activate_open_position_v3';a=[addr(W),n(13844n,'u64')];s.positionId='13844';break;
  case 'close_atomic':m='close_position_v3';a=[addr(W),n(13844n,'u64'),n(19780780n)];Object.assign(s,{positionId:'13844',fromAssetId:X,toAssetId:T,minReceive:'1.9780780',recipient:M});break;
  case 'return':m='transfer_margin_to_spot';a=[addr(W),addr(TOKEN),n(999999n)];Object.assign(s,{fromAssetId:R,amount:'0.999999'});break;
  case 'vault_withdraw':c=V;m='withdraw';a=[addr(W),n(999999n)];Object.assign(s,{fromAssetId:R,toAssetId:T,amount:'0.999999'});break;
 }
 s.contractId=c;const root=node(fn(c,m,a),child?[node(child)]:[]),auth=new xdr.SorobanAuthorizationEntry({credentials:xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),rootInvocation:root});
 const data=new xdr.SorobanTransactionData({ext:new xdr.SorobanTransactionDataExt(0),resources:new xdr.SorobanResources({footprint:new xdr.LedgerFootprint({readOnly:[],readWrite:[]}),instructions:1,diskReadBytes:0,writeBytes:0}),resourceFee:xdr.Int64.fromString('100')});
 const tx=new TransactionBuilder(new Account(W,'1'),{fee:'1000',networkPassphrase:NETWORK_PASSPHRASE,sorobanData:data}).addOperation(Operation.invokeHostFunction({func:xdr.HostFunction.hostFunctionTypeInvokeContract(fn(c,m,a)),auth:[auth]})).setTimeout(60).build();
 const action:PreparedAction={operationId:'offline-op',customerId:'offline-customer',walletAddress:W,network:'stellar-testnet',unsignedXdr:tx.toXDR(),signingHashHex:tx.hash().toString('hex'),summary:s,authorization:{method:'privy_stellar',expiresAt:s.expiresAt}};
 return{action,op:tx.operations[0]!,tx,root,data};
}
function invoke(op:Transaction['operations'][number]){if(op.type!=='invokeHostFunction')throw Error();return op;}
describe('Exact Peridot browser intent approval; SDK fixtures only, no signing or network',()=>{
 it.each(actions)('accepts canonical %s source-only auth and exact summary',step=>{const f=fixture(step);expect(()=>inspectMarginApproval(f.action,f.op)).not.toThrow();});
 it.each(['margin.close_prepare','margin.close_swap','margin.close_finish','margin.arbitrary','blend.borrow'])('does not recognize unreviewed %s',action=>{expect(isMarginApprovalAction(action)).toBe(false);const f=fixture();f.action.summary.action=action;expect(()=>inspectMarginApproval(f.action,f.op)).toThrow();});
 it.each(actions)('rejects an extra authorization child for %s',step=>{const f=fixture(step),root=invoke(f.op).auth![0]!.rootInvocation();root.subInvocations([...root.subInvocations(),node(root.function().contractFn())]);expect(()=>inspectMarginApproval(f.action,f.op)).toThrow();});
 it.each(['contract','method','owner','asset','leverage','direction','poolId','pool','minimum','amount','path'] as const)('rejects changed open invocation %s even if auth matches it',fault=>{
  const f=fixture(),op=invoke(f.op),call=op.func.invokeContract(),a=call.args();
  if(fault==='contract')call.contractAddress(new Address(P).toScAddress());if(fault==='method')call.functionName('begin_close_position_v3');
  const index={owner:0,asset:1,amount:3,leverage:4,direction:5,path:6,poolId:7,pool:8,minimum:9}[fault as 'owner'];
  if(index!==undefined){a[index]=fault==='owner'?addr(OTHER):fault==='asset'||fault==='pool'?addr(V):fault==='direction'?xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Short')]):fault==='path'?xdr.ScVal.scvVec([addr(TOKEN),addr(N)]):fault==='poolId'?nativeToScVal(new Uint8Array(32)):n(fault==='leverage'?3n:1n);call.args(a);}
  op.auth![0]!.rootInvocation().function(xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(call));expect(()=>inspectMarginApproval(f.action,op)).toThrow();
 });
 it.each(['network','wallet','source','contractId','recipient','fromAssetId','toAssetId','amount','minReceive','fee','positionId'] as const)('rejects changed envelope/summary %s',fault=>{const f=fixture();if(fault==='network')(f.action as any).network='stellar-mainnet';else if(fault==='wallet')f.action.walletAddress=OTHER;else if(fault==='source')invoke(f.op).source=W;else if(fault==='fee')f.action.summary.maxFeeStroops='10000001';else(f.action.summary as any)[fault]=fault==='amount'?'0.1':fault==='minReceive'?'0.1':'changed';expect(()=>inspectMarginApproval(f.action,f.op)).toThrow();});
 it.each(['open_swap','open_activate','open_cancel','close_atomic']as const)('requires exact positionId for %s',step=>{for(const id of [undefined,'13845','0','18446744073709551616']){const f=fixture(step);f.action.summary.positionId=id;expect(()=>inspectMarginApproval(f.action,f.op)).toThrow();}});
 it.each(['collateral_swap','vault_deposit','transfer']as const)('rejects alternate child amount, recipient or nested grandchild: %s',step=>{for(const fault of ['amount','recipient','nested','type']){const f=fixture(step),child=invoke(f.op).auth![0]!.rootInvocation().subInvocations()[0]!,c=child.function().contractFn(),args=c.args();if(fault==='amount')args[2]=n(1n,'i128');if(fault==='recipient')args[1]=addr(OTHER);if(fault==='type')args[2]=n(BigInt(step==='transfer'?999999:10000000),'u128');c.args(args);if(fault==='nested')child.subInvocations([node(c)]);expect(()=>inspectMarginApproval(f.action,f.op)).toThrow();}});
 it('rejects duplicated or absent auth and address credentials',()=>{for(const kind of ['duplicate','absent','address']){const f=fixture(),op=invoke(f.op);if(kind==='duplicate')op.auth=[...op.auth!,...op.auth!];if(kind==='absent')op.auth=[];if(kind==='address')op.auth![0]!.credentials(xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({address:new Address(W).toScAddress(),nonce:xdr.Int64.fromString('1'),signatureExpirationLedger:1,signature:xdr.ScVal.scvVoid()})));expect(()=>inspectMarginApproval(f.action,op)).toThrow();}});
 it('rejects excessive funding or initial deposit amounts',()=>{for(const step of ['collateral_swap','vault_deposit']as const){const f=fixture(step);f.action.summary.amount=step==='collateral_swap'?'10.0000001':'1.0000001';expect(()=>inspectMarginApproval(f.action,f.op)).toThrow();}});
 it('limits the exceptional deposit fee to exact approved nonempty archived entries',()=>{
  const configure=(f:ReturnType<typeof fixture>,keys:xdr.LedgerKey[],indices:number[])=>{f.data.resources().footprint().readWrite(keys);f.data.ext(new xdr.SorobanTransactionDataExt(1,new xdr.SorobanResourcesExtV0({archivedSorobanEntries:indices})));const tx=TransactionBuilder.cloneFrom(f.tx,{fee:f.tx.fee,sorobanData:f.data}).build();f.action.unsignedXdr=tx.toXDR();f.action.summary.maxFeeStroops='80000000';};
  const exact=xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({contract:new Address(V).toScAddress(),key:xdr.ScVal.scvLedgerKeyContractInstance(),durability:xdr.ContractDataDurability.persistent()}));
  const good=fixture('vault_deposit');configure(good,[exact],[0]);expect(()=>inspectMarginApproval(good.action,good.op)).not.toThrow();
  for(const fault of ['empty','unknown','range','duplicate','overcap','noCold']){const f=fixture('vault_deposit'),wrong=xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({contract:new Address(M).toScAddress(),key:xdr.ScVal.scvLedgerKeyContractInstance(),durability:xdr.ContractDataDurability.persistent()}));configure(f,[fault==='unknown'?wrong:exact],fault==='empty'?[]:fault==='range'?[1]:fault==='duplicate'?[0,0]:[0]);if(fault==='overcap')f.action.summary.maxFeeStroops='80000001';if(fault==='noCold')f.action.unsignedXdr=f.tx.toXDR();expect(()=>inspectMarginApproval(f.action,f.op)).toThrow();}
 });
 it('rejects a fabricated atomic-close amount and altered minimum',()=>{for(const key of ['amount','minReceive']as const){const f=fixture('close_atomic');f.action.summary[key]='1';expect(()=>inspectMarginApproval(f.action,f.op)).toThrow();}});

 it('accepts captured actual Testnet atomic-close auth with exact public summary binding',()=>{
  // Public unsigned record simulation at ledger5683494; not a customer signature or new execution.
  const auth=xdr.SorobanAuthorizationEntry.fromXDR('AAAAAAAAAAAAAAABFKPQx3+/QHC81B2HqaaMgpI4ntMMO4NUpGZMFdA0mIgAAAARY2xvc2VfcG9zaXRpb25fdjMAAAAAAAADAAAAEgAAAAAAAAAAE568hBGKHnoXUW2oTtG58L5JwZdqTSRmTyY6IBSxAHUAAAAFAAAAAAAANhQAAAAJAAAAAAAAAAAAAAAAAS3UrAAAAAA=','base64'),f=fixture('close_atomic');
  f.action.walletAddress='GAJZ5PEECGFB46QXKFW2QTWRXHYL4SOBS5VE2JDGJ4TDUIAUWEAHKV34';f.action.summary.positionId='13844';f.action.summary.minReceive='1.9780780';
  const op=Operation.invokeHostFunction({func:xdr.HostFunction.hostFunctionTypeInvokeContract(auth.rootInvocation().function().contractFn()),auth:[auth]});
  const tx=new TransactionBuilder(new Account('GAJZ5PEECGFB46QXKFW2QTWRXHYL4SOBS5VE2JDGJ4TDUIAUWEAHKV34','1'),{fee:'1000',networkPassphrase:NETWORK_PASSPHRASE}).addOperation(op).setTimeout(60).build();
  expect(()=>inspectMarginApproval(f.action,tx.operations[0]!)).not.toThrow();
  f.action.summary.positionId='13845';expect(()=>inspectMarginApproval(f.action,tx.operations[0]!)).toThrow();
 });

});
