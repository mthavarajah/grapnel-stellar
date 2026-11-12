import {createHash} from 'node:crypto';
import {Keypair} from '@stellar/stellar-sdk';
import {GrapnelError} from '@grapnel/contracts';
import {stable} from '../../adapters/hyperliquid/execution/guards.js';
import type {ApprovedPerpetualIntent} from './execution-contract.js';
import type {PerpetualScope,PerpetualChallenge} from './workflow-contract.js';
export const approvalDigest=(message:string)=>createHash('sha256').update(message,'utf8').digest('hex');
export function bindingMessage(scope:PerpetualScope,id:string,accountAddress:string,expiresAt:string){
 return 'Grapnel Perpetuals account binding\n'+stable({version:1,network:'hyperliquid-testnet',challengeId:id,...scope,accountAddress,expiresAt});
}
export function orderApprovalMessage(scope:PerpetualScope,intent:ApprovedPerpetualIntent){
 const {customerApprovalHash:_,...fields}=intent;
 return 'Grapnel Perpetuals order approval\n'+stable({version:1,...fields,stellarAddress:scope.stellarAddress});
}
export function stellarApproval(address:string,digest:string,signature:string):string {
 const raw=signature.replace(/^0x/,'');
 try{if(!/^[0-9a-f]{128}$/i.test(raw)||!Keypair.fromPublicKey(address).verify(Buffer.from(digest,'hex'),Buffer.from(raw,'hex')))throw Error();}
 catch{throw new GrapnelError(403,'CUSTOMER_APPROVAL_INVALID','The approval does not match your Stellar wallet and reviewed action');}
 return raw.toLowerCase();
}
export function publicChallenge(challenge:PerpetualChallenge){return challenge;}
