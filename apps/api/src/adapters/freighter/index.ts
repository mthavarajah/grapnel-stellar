import {createHash} from 'node:crypto';
import {Keypair,StrKey} from '@stellar/stellar-sdk';
import {GrapnelError,NETWORK_PASSPHRASE} from '@grapnel/contracts';
export const FREIGHTER_API_VERSION='6.0.1';
export const FREIGHTER_PROOF_SCHEME='stellar-sep53-v1' as const;
export const SOLVER_USDC_ASSETS=[
 'stellar-testnet:classic:USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56',
 'stellar-testnet:classic:USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
] as const;
export interface SolverScope {businessId:string;customerId:string;identityWalletId:string;freighterAddress:string;}
export interface SolverChallenge {id:string;scope:SolverScope;purpose:'bind'|'order'|'withdraw';intentHash:string;message:string;nonce:string;expiresAt:string;origin:string;assetId:string;}
export interface FreighterMessageProof {scheme:typeof FREIGHTER_PROOF_SCHEME;signer_address:string;signature_base64:string;}
export interface FreighterProofContext {scope:SolverScope;purpose:SolverChallenge['purpose'];intentHash:string;origin:string;assetId:string;networkPassphrase:string;}
const fail=():never=>{throw new GrapnelError(403,'INVALID_FREIGHTER_PROOF','Freighter approval does not match the current customer intent');};
const bounded=(value:unknown,max=128):value is string=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\x00-\x1f\x7f]/.test(value);
function canonical(value:unknown):string{return value&&typeof value==='object'&&!Array.isArray(value)?`{${Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`:JSON.stringify(value);}
function validate(challenge:SolverChallenge,now?:number):void{
 if(!challenge||!bounded(challenge.id)||!bounded(challenge.nonce)||challenge.nonce.length<16||!['bind','order','withdraw'].includes(challenge.purpose)||!/^[a-f0-9]{64}$/.test(challenge.intentHash)||!SOLVER_USDC_ASSETS.includes(challenge.assetId as typeof SOLVER_USDC_ASSETS[number]))return fail();
 const scope=challenge.scope;if(!scope||![scope.businessId,scope.customerId,scope.identityWalletId].every(value=>bounded(value))||!StrKey.isValidEd25519PublicKey(scope.freighterAddress))return fail();
 let origin:URL;try{origin=new URL(challenge.origin);}catch{return fail();}
 if(origin.origin!==challenge.origin||origin.protocol!=='https:'&&!(origin.protocol==='http:'&&['localhost','127.0.0.1'].includes(origin.hostname)))return fail();
 const expires=Date.parse(challenge.expiresAt);if(!Number.isFinite(expires)||new Date(expires).toISOString()!==challenge.expiresAt||now!==undefined&&(expires<=now||expires>now+300000))return fail();
}
/** Exact lead-approved printable payload; it includes Testnet because SEP53's
 * own prefix contains no network discriminator. Root persists the challenge. */
export function buildFreighterChallengeMessage(challenge:Omit<SolverChallenge,'message'>):string{
 validate({...challenge,message:''});
 return 'Grapnel Solver Intent\n'+canonical({assetId:challenge.assetId,expiresAt:challenge.expiresAt,id:challenge.id,intentHash:challenge.intentHash,network:'stellar-testnet',nonce:challenge.nonce,origin:challenge.origin,purpose:challenge.purpose,scope:challenge.scope,version:1});
}
/** SEP53, verified against published extension handler/helpers and official vectors. */
export function freighterMessageHash(message:string):Buffer{
 if(typeof message!=='string'||!message.length||Buffer.byteLength(message,'utf8')>8192)return fail();
 return createHash('sha256').update('Stellar Signed Message:\n','utf8').update(message,'utf8').digest();
}
/** Must follow verified customer/session DB checks and precede atomic one-use
 * challenge consumption. A proof never replaces Privy identity authorization. */
export function verifyFreighterMessageProof(challenge:SolverChallenge,proof:FreighterMessageProof,expected:FreighterProofContext,now=Date.now()):void{
 validate(challenge,now);
 if(expected.networkPassphrase!==NETWORK_PASSPHRASE||canonical(challenge.scope)!==canonical(expected.scope)||challenge.purpose!==expected.purpose||challenge.intentHash!==expected.intentHash||challenge.origin!==expected.origin||challenge.assetId!==expected.assetId||challenge.message!==buildFreighterChallengeMessage(challenge)||proof?.scheme!==FREIGHTER_PROOF_SCHEME||proof.signer_address!==challenge.scope.freighterAddress||typeof proof.signature_base64!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(proof.signature_base64))return fail();
 const signature=Buffer.from(proof.signature_base64,'base64');if(signature.length!==64||signature.toString('base64')!==proof.signature_base64||!Keypair.fromPublicKey(proof.signer_address).verify(freighterMessageHash(challenge.message),signature))return fail();
}
