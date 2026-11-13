import {Address,Asset,Transaction,scValToNative,xdr}from'@stellar/stellar-sdk';
import{GrapnelError,NETWORK_PASSPHRASE,ZENEX_TESTNET as P,ZENEX_USDC_ID,ZENEX_FULL_CLOSE,toAtomic,type PreparedAction}from'@grapnel/contracts';
const atomic=(v:string,d:number)=>/^0(?:\.0+)?$/.test(v)?0n:toAtomic(v,d);
const fail=():never=>{throw new GrapnelError(403,'INTENT_MISMATCH','Perpetual transaction differs from the exact authorized XLM intent');};
export function inspectZenex(action:PreparedAction,tx:Transaction){
 const s=action.summary,op=tx.operations[0];if(s.fromAssetId!==ZENEX_USDC_ID||s.recipient!==action.walletAddress||s.toAssetId!==undefined||s.minReceive!==undefined||tx.operations.length!==1||!op||op.source)return fail();
 if(s.action==='zenex.trustline'){if(op.type!=='changeTrust'||!(op.line instanceof Asset)||op.line.getCode()!=='USDC'||op.line.getIssuer()!==P.issuer||atomic(op.limit,7)!==100000000000n||s.amount!=='10000'||s.contractId!==undefined||tx.fee!=='100')return fail();return;}
 if(op.type!=='invokeHostFunction'||op.func.switch().name!=='hostFunctionTypeInvokeContract'||s.contractId!==P.market)return fail();
 const f=op.func.invokeContract(),args=f.args().map(scValToNative),name=f.functionName().toString();if(Address.fromScAddress(f.contractAddress()).toString()!==P.market)return fail();
 if(s.action==='zenex.cancel'){if(name!=='cancel_order'||args.length!==2||args[0]!==action.walletAddress||args[1]!==Number(s.positionId))return fail();}
 else{const p=s.perpetual;if(!p||p.market_id!==P.marketId||!['zenex.open','zenex.close'].includes(s.action)||name!=='create_order'||args.length!==8||args[0]!==action.walletAddress||args[1]!==p.is_long||args[2]!==(s.action==='zenex.open'?0:3)||args[3]!==(s.action==='zenex.open'?atomic(p.size_usd,7):ZENEX_FULL_CLOSE)||args[4]!==(s.action==='zenex.open'?atomic(p.collateral,7):0n)||args[5]!==0n||args[6]!==BigInt(p.price_bound18)||args[7]!==p.expiration_ledger||s.amount!==p.collateral)return fail();}
 const auth=op.auth;if(auth?.length!==1||auth[0]!.credentials().switch().name!=='sorobanCredentialsSourceAccount')return fail();const root=auth[0]!.rootInvocation();if(root.function().switch().name!=='sorobanAuthorizedFunctionTypeContractFn'||root.function().contractFn().toXDR('base64')!==f.toXDR('base64'))return fail();
 const children=root.subInvocations();if(s.action==='zenex.cancel'){if(children.length)return fail();return;}
 if(children.length!==1)return fail();const child=children[0]!;if(child.function().switch().name!=='sorobanAuthorizedFunctionTypeContractFn'||child.subInvocations().length)return fail();const transfer=child.function().contractFn(),v=transfer.args().map(scValToNative),margin=s.action==='zenex.open'?atomic(s.perpetual!.collateral,7):0n;
 if(Address.fromScAddress(transfer.contractAddress()).toString()!==P.token||transfer.functionName().toString()!=='transfer'||v.length!==3||v[0]!==action.walletAddress||v[1]!==P.market||typeof v[2]!=='bigint'||v[2]<=margin||v[2]>margin+100000n)return fail();
}
export function inspectZenexFootprint(tx:Transaction,pins:Record<string,string>){
 const data=tx.toEnvelope().v1().tx().ext().sorobanData(),r=data.resources(),fp=r.footprint(),keys=[...fp.readOnly(),...fp.readWrite()];
 if(BigInt(tx.fee)>10000000n||BigInt(data.resourceFee().toString())>10000000n||r.instructions()>100000000||r.diskReadBytes()>1048576||r.writeBytes()>131072||keys.length>64||new Set(keys.map(k=>k.toXDR('base64'))).size!==keys.length)return fail();
 for(const k of keys){const kind=k.switch().name;if(kind==='contractCode'){if(!Object.values(pins).includes(k.contractCode().hash().toString('hex')))return fail();}
 else if(kind==='contractData'){const c=Address.fromScAddress(k.contractData().contract()).toString(),key=k.contractData().key();if(![P.market,P.token,P.vault,P.oracle,P.treasury].includes(c as any))return fail();if(key.switch().name==='scvLedgerKeyContractInstance')continue;const v=scValToNative(key);if(!Array.isArray(v))return fail();if(c===P.market){if(['Position','Order','OrderCounter','ClaimableCredit'].includes(v[0])){if(v[1]!==tx.source)return fail();}else if(v.length!==1||v[0]!=='MarketData')return fail();}else if(c===P.token){if(v[0]!=='Balance'||![tx.source,P.market].includes(v[1]))return fail();}else return fail();}
 else if(kind==='account'){if(Address.fromScAddress(xdr.ScAddress.scAddressTypeAccount(k.account().accountId())).toString()!==tx.source&&Address.fromScAddress(xdr.ScAddress.scAddressTypeAccount(k.account().accountId())).toString()!==P.issuer)return fail();}
 else if(kind==='trustline'){const t=k.trustLine(),a=t.asset();if(Address.fromScAddress(xdr.ScAddress.scAddressTypeAccount(t.accountId())).toString()!==tx.source||a.switch().name!=='assetTypeCreditAlphanum4'||a.alphaNum4().assetCode().toString().replace(/\0/g,'')!=='USDC'||Address.fromScAddress(xdr.ScAddress.scAddressTypeAccount(a.alphaNum4().issuer())).toString()!==P.issuer)return fail();}
 else return fail();}
}
