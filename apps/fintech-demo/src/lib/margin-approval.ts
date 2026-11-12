"use client";
import {Address,Contract,StrKey,Transaction,TransactionBuilder,nativeToScVal,xdr} from '@stellar/stellar-sdk';
import {NETWORK,NETWORK_PASSPHRASE,toAtomic,type PreparedAction} from '@grapnel/contracts';
// Reviewed Testnet deployment pins. Never import server adapters into the browser.
const MARGIN='CAKKHUGHP67UA4F42QOYPKNGRSBJEOE62MGDXA2UURTEYFOQGSMIRUFO';
const MOCK='CDPXNHHVSLX3HFAHV7XOISM23MZH36WSXTO45RNDOBIDFZBGTSOVD4OY';
const VAULT='CCEW6NSPCV7XUEQV75ZMII5HK5DGXK5JP2QOTGLV4UFLDBPEKRGO4Y4B';
const NATIVE='CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const POOL='CCMNSENXDBNJSY72BDIPH5CCXLLHBKZ4LXTRKDLKZN4UI2NJFQLWTLD6';
const POOL_ID='9ac7a9cde23ac2ada11105eeaa42e43c2ea8332ca0aa8f41f58d7160274d718e';
const XLM_ID=`${NETWORK}:native:XLM`,MOCK_ID=`${NETWORK}:soroban:${MOCK}`,RECEIPT_ID=`${NETWORK}:soroban:${VAULT}`;
const ACTIONS=new Set(['margin.collateral_swap','margin.vault_deposit','margin.transfer','margin.open_begin','margin.open_swap','margin.open_activate','margin.open_cancel','margin.close_atomic','margin.return','margin.vault_withdraw']);
export const isMarginApprovalAction=(action:string):boolean=>ACTIONS.has(action);
const bytes=(value:{toXDR(format:'base64'):string})=>value.toXDR('base64');
const addr=(value:string)=>new Address(value).toScVal();
const num=(value:bigint,type:'u128'|'i128'|'u64')=>nativeToScVal(value,{type});
const call=(contract:string,method:string,args:xdr.ScVal[])=>new Contract(contract).call(method,...args).body().invokeHostFunctionOp().hostFunction().invokeContract();
const fail=():never=>{throw Error('This Margin transaction differs from your reviewed intent');};
function amount(value:string|undefined,decimals:number,max?:bigint):bigint{
 if(!value)return fail();const n=toAtomic(value,decimals);if(n<=0n||n>=(1n<<127n)||max!==undefined&&n>max)return fail();return n;
}
function position(value:string|undefined):xdr.ScVal{
 if(!value||!/^[1-9]\d{0,19}$/.test(value)||BigInt(value)>=(1n<<64n))return fail();return num(BigInt(value),'u64');
}
/** Elevated deposit fee is limited to the reviewed archived-code/instance subset. */
function feeCap(action:PreparedAction):bigint{
 if(action.summary.action!=='margin.vault_deposit')return 10000000n;
 const tx=TransactionBuilder.fromXDR(action.unsignedXdr,NETWORK_PASSPHRASE);
 if(!(tx instanceof Transaction)||tx.networkPassphrase!==NETWORK_PASSPHRASE||tx.source!==action.walletAddress||tx.operations.length!==1)return fail();
 const ext=tx.toEnvelope().v1().tx().ext();if(ext.switch()!==1)return fail();
 const data=ext.sorobanData();if(data.ext().switch()===0)return 10000000n;
 if(data.ext().switch()!==1)return fail();
 const rw=data.resources().footprint().readWrite(),indices=data.ext().resourceExt().archivedSorobanEntries();
 if(!indices.length||indices.some((index,i)=>index<0||index>=rw.length||i>0&&index<=indices[i-1]!))return fail();
 const allowedCodes=new Set(['2ed4328b5ad24a6a829c1d1d6654349f5bd88bf69fc3ea07b9034b18797e1866','c22680741c50eb52758a720b36d44c44b7f3f86271bcb8873ef90734607de120']);
 for(const index of indices){const key=rw[index]!;
  if(key.switch().name==='contractCode'){if(!allowedCodes.has(Array.from(key.contractCode().hash()).map(b=>b.toString(16).padStart(2,'0')).join('')))return fail();}
  else if(key.switch().name==='contractData'){const data=key.contractData();if(Address.fromScAddress(data.contract()).toString()!==VAULT||data.key().switch().name!=='scvLedgerKeyContractInstance'||data.durability().name!=='persistent')return fail();}
  else return fail();
 }
 return 80000000n;
}
/** Pure browser approval: exact deployed call, exact summary, source auth and every child. */
export function inspectMarginApproval(action:PreparedAction,operation:Transaction['operations'][number]):void{
 try{
  const s=action.summary,user=action.walletAddress;
  if(action.network!==NETWORK||!StrKey.isValidEd25519PublicKey(user)||!isMarginApprovalAction(s.action)||operation.type!=='invokeHostFunction'||operation.source||operation.func.switch().name!=='hostFunctionTypeInvokeContract'||!s.maxFeeStroops||!/^[1-9]\d{0,8}$/.test(s.maxFeeStroops)||BigInt(s.maxFeeStroops)>feeCap(action))return fail();
  let contract=MARGIN,method:string,args:xdr.ScVal[],child:xdr.InvokeContractArgs|undefined;
  let from:string|undefined,to:string|undefined,recipient=user,hasAmount=false,hasMinimum=false,hasPosition=false;
  switch(s.action){
   case 'margin.collateral_swap':{contract=POOL;method='swap';from=XLM_ID;to=MOCK_ID;hasAmount=hasMinimum=true;const n=amount(s.amount,7,100000000n),min=amount(s.minReceive,7);args=[addr(user),nativeToScVal(0,{type:'u32'}),nativeToScVal(1,{type:'u32'}),num(n,'u128'),num(min,'u128')];child=call(NATIVE,'transfer',[addr(user),addr(POOL),num(n,'i128')]);break;}
   case 'margin.vault_deposit':{contract=VAULT;method='deposit';from=MOCK_ID;to=RECEIPT_ID;recipient=VAULT;hasAmount=true;const n=amount(s.amount,7,10000000n);args=[addr(user),num(n,'u128')];child=call(MOCK,'transfer',[addr(user),addr(VAULT),num(n,'i128')]);break;}
   case 'margin.transfer':{method='transfer_spot_to_margin';from=RECEIPT_ID;recipient=MARGIN;hasAmount=true;const n=amount(s.amount,6,10000000n);args=[addr(user),addr(MOCK),num(n,'u128')];child=call(VAULT,'transfer',[addr(user),addr(MARGIN),num(n,'i128')]);break;}
   case 'margin.open_begin':{method='begin_open_position_v3';from=RECEIPT_ID;to=XLM_ID;recipient=MARGIN;hasAmount=hasMinimum=true;args=[addr(user),addr(MOCK),addr(NATIVE),num(amount(s.amount,6,10000000n),'u128'),num(2n,'u128'),xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Long')]),xdr.ScVal.scvVec([addr(NATIVE),addr(MOCK)]),nativeToScVal(Uint8Array.from(POOL_ID.match(/../g)!.map(value=>parseInt(value,16)))),addr(POOL),num(amount(s.minReceive,7),'u128')];break;}
   case 'margin.open_swap':case 'margin.open_cancel':{method=s.action==='margin.open_swap'?'swap_open_position_v3':'cancel_pending_open_v3';from=RECEIPT_ID;to=s.action==='margin.open_swap'?XLM_ID:undefined;recipient=s.action==='margin.open_swap'?MARGIN:user;hasAmount=hasPosition=true;amount(s.amount,6,10000000n);args=[addr(user),position(s.positionId)];break;}
   case 'margin.open_activate':{method='activate_open_position_v3';hasPosition=true;args=[addr(user),position(s.positionId)];break;}
   case 'margin.close_atomic':{method='close_position_v3';from=XLM_ID;to=MOCK_ID;recipient=MARGIN;hasMinimum=hasPosition=true;args=[addr(user),position(s.positionId),num(amount(s.minReceive,7),'u128')];break;}
   // Repaid position is server-verified workflow context; these deployed methods have no position argument.
   case 'margin.return':{method='transfer_margin_to_spot';from=RECEIPT_ID;hasAmount=hasPosition=true;position(s.positionId);args=[addr(user),addr(MOCK),num(amount(s.amount,6),'u128')];break;}
   case 'margin.vault_withdraw':{contract=VAULT;method='withdraw';from=RECEIPT_ID;to=MOCK_ID;hasAmount=hasPosition=true;position(s.positionId);args=[addr(user),num(amount(s.amount,6),'u128')];break;}
   default:return fail();
  }
  if(s.contractId!==contract||s.recipient!==recipient||s.fromAssetId!==from||s.toAssetId!==to||(!hasAmount&&s.amount!==undefined)||(!hasMinimum&&s.minReceive!==undefined)||(!hasPosition&&s.positionId!==undefined))return fail();
  const expected=call(contract,method,args),invocation=operation.func.invokeContract();if(bytes(expected)!==bytes(invocation))return fail();
  const auth=operation.auth;if(auth?.length!==1||auth[0]!.credentials().switch().name!=='sorobanCredentialsSourceAccount')return fail();
  const root=auth[0]!.rootInvocation();if(root.function().switch().name!=='sorobanAuthorizedFunctionTypeContractFn'||bytes(root.function().contractFn())!==bytes(expected)||root.subInvocations().length!==(child?1:0))return fail();
  if(child){const node=root.subInvocations()[0]!;if(node.function().switch().name!=='sorobanAuthorizedFunctionTypeContractFn'||node.subInvocations().length||bytes(node.function().contractFn())!==bytes(child))return fail();}
 }catch{return fail();}
}
