"use client";
import {Address,Asset,scValToNative,type Transaction} from '@stellar/stellar-sdk';
import {NETWORK,NETWORK_PASSPHRASE,toAtomic,type PreparedAction} from '@grapnel/contracts';
const POOL='CB3447A446DY3USGWPIDXTNQHF5EX24XDQA2EN6TAZP62JTPBTNOA52Q';
const ISSUER='GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56';
const requests:Readonly<Record<string,number>>={'blend.borrow':4,'blend.repay':5,'blend.borrow_collateral_supply':2,'blend.borrow_collateral_withdraw':3};
export const isBorrowApprovalAction=(action:string)=>Object.hasOwn(requests,action);
/** The browser checks the same separate pool, exact single request and source-only transfer intent. */
export function inspectBorrowApproval(action:PreparedAction,operation:Transaction['operations'][number]):void{
 try{
  const s=action.summary,usdc=`${NETWORK}:classic:USDC:${ISSUER}`,reserve=s.fromAssetId===usdc?new Asset('USDC',ISSUER).contractId(NETWORK_PASSPHRASE):Asset.native().contractId(NETWORK_PASSPHRASE);
  if(!isBorrowApprovalAction(s.action)||![`${NETWORK}:native:XLM`,usdc].includes(s.fromAssetId??'')||s.contractId!==POOL||s.recipient!==action.walletAddress||s.toAssetId!==undefined||s.minReceive!==undefined||!s.amount||BigInt(s.maxFeeStroops??'0')<=0n||BigInt(s.maxFeeStroops??'0')>10000000n||operation.type!=='invokeHostFunction'||operation.source||operation.func.switch().name!=='hostFunctionTypeInvokeContract')throw Error();
  const invocation=operation.func.invokeContract(),args=invocation.args().map(scValToNative);
  if(Address.fromScAddress(invocation.contractAddress()).toString()!==POOL||invocation.functionName().toString()!=='submit'||args.length!==4||args.slice(0,3).some(value=>value!==action.walletAddress)||!Array.isArray(args[3])||args[3].length!==1)throw Error();
  const request=args[3][0],amount=toAtomic(s.amount,7);
  if(!request||typeof request!=='object'||Object.keys(request).sort().join(',')!=='address,amount,request_type'||request.address!==reserve||request.amount!==amount||request.request_type!==requests[s.action])throw Error();
  const auth=operation.auth;if(auth?.length!==1||auth[0]!.credentials().switch().name!=='sorobanCredentialsSourceAccount')throw Error();
  const root=auth[0]!.rootInvocation(),incoming=s.action==='blend.repay'||s.action==='blend.borrow_collateral_supply';
  if(root.function().switch().name!=='sorobanAuthorizedFunctionTypeContractFn'||root.function().contractFn().toXDR('base64')!==invocation.toXDR('base64')||root.subInvocations().length!==(incoming?1:0))throw Error();
  if(incoming){const child=root.subInvocations()[0]!;if(child.subInvocations().length||child.function().switch().name!=='sorobanAuthorizedFunctionTypeContractFn')throw Error();const transfer=child.function().contractFn(),values=transfer.args().map(scValToNative);if(Address.fromScAddress(transfer.contractAddress()).toString()!==reserve||transfer.functionName().toString()!=='transfer'||values.length!==3||values[0]!==action.walletAddress||values[1]!==POOL||values[2]!==amount)throw Error();}
 }catch{throw Error('This Borrow transaction differs from your reviewed intent');}
}
