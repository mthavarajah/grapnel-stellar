import {createHash} from 'node:crypto';
import type {SolverRequest,SolverWallet} from './contracts.js';
/** Shared canonical representation; JSON only, no undefined or floating amounts. */
export function solverJson(value:unknown):string{
 if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isSafeInteger(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(solverJson).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>JSON.stringify(key)+':'+solverJson(item)).join(',')+'}';
 throw Error('Noncanonical solver intent');
}
export const solverHash=(value:unknown)=>createHash('sha256').update(solverJson(value)).digest('hex');
export const solverMemo=(kind:'deposit'|'withdraw',intentHash:string)=>createHash('sha256').update(`Grapnel solver ${kind==='deposit'?'deposit':'withdrawal'}\n${intentHash}`).digest('hex');
export function solverBindingHash(wallet:SolverWallet,origin:string){return solverHash({version:1,network:'stellar-testnet',purpose:'bind',scope:{businessId:wallet.businessId,customerId:wallet.customerId,identityWalletId:wallet.identityWalletId,freighterAddress:wallet.freighterAddress},assetId:wallet.assetId,escrowAddress:wallet.escrowAddress,masterAddress:wallet.masterAddress,origin});}
export function solverIntentHash(request:SolverRequest,wallet:SolverWallet){
 const terms={...request.terms} as Record<string,unknown>;if(request.kind==='deposit')delete terms.memoHashHex;
 return solverHash({version:1,network:'stellar-testnet',id:request.id,scope:{businessId:request.businessId,customerId:request.customerId,identityWalletId:request.identityWalletId,freighterAddress:wallet.freighterAddress},walletId:request.walletId,module:request.module,kind:request.kind,terms,expiresAt:request.expiresAt});
}
