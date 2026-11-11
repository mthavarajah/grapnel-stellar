import{createHash}from'node:crypto';import{Address,rpc,xdr}from'@stellar/stellar-sdk';import{GrapnelError,NETWORK_PASSPHRASE}from'@grapnel/contracts';import{PERIDOT_TESTNET_PINS as P}from'../config.js';
const fail=(reason:string):never=>{throw new GrapnelError(403,'PERIDOT_NATIVE_RESTORE_SCOPE','The v3 phase exceeds the reviewed native-vault restoration scope',false,{reason});};
const bytes=(v:{toXDR(format:'base64'):string})=>v.toXDR('base64');
export const pinnedNativeVaultInstance=()=>xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({contract:new Address(P.native_vault.address).toScAddress(),key:xdr.ScVal.scvLedgerKeyContractInstance(),durability:xdr.ContractDataDurability.persistent()}));
/** Supplement to, never a replacement for, each v3 phase's exact invocation/auth/footprint inspector. */
export function inspectOnlyNativeVaultRestoration(data:xdr.SorobanTransactionData):void{
 const ro=data.resources().footprint().readOnly(),rw=data.resources().footprint().readWrite(),all=[...ro,...rw];
 if(new Set(all.map(bytes)).size!==all.length||rw.some(k=>k.switch().name==='contractCode'))return fail('DUPLICATE_OR_CODE_WRITE');
 if(!/^\d+$/.test(data.resourceFee().toString())||BigInt(data.resourceFee().toString())>10000000n)return fail('ONE_XLM_FEE_CAP');
 if(data.ext().switch()===0)return;
 if(data.ext().switch()!==1)return fail('RESOURCE_EXTENSION');
 const indices=data.ext().resourceExt().archivedSorobanEntries();if(indices.length!==1||!Number.isSafeInteger(indices[0])||indices[0]!<0||indices[0]!>=rw.length||bytes(rw[indices[0]!]!)!==bytes(pinnedNativeVaultInstance()))return fail('RESTORATION_SCOPE');
}
export async function verifyNativeVaultRestorationCode(server:rpc.Server):Promise<void>{
 if((await server.getNetwork()).passphrase!==NETWORK_PASSPHRASE)return fail('NETWORK');
 const exe=(await server.getContractData(P.native_vault.address,xdr.ScVal.scvLedgerKeyContractInstance())).val.contractData().val().instance().executable();
 if(exe.switch().name!=='contractExecutableWasm'||exe.wasmHash().toString('hex')!==P.native_vault.wasmHash)return fail('EXECUTABLE_CHANGED');
 const result=await server.getLedgerEntries(xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({hash:Buffer.from(P.native_vault.wasmHash,'hex')})));
 if(result.entries.length!==1||createHash('sha256').update(result.entries[0]!.val.contractCode().code()).digest('hex')!==P.native_vault.wasmHash)return fail('CODE_BYTES_CHANGED_OR_UNAVAILABLE');
}
