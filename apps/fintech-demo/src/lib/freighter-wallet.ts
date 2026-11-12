import {Buffer} from 'buffer';
import {hash,Keypair,StrKey,Transaction,TransactionBuilder} from '@stellar/stellar-sdk';
const TESTNET='Test SDF Network ; September 2015';
const ISSUERS=['GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56','GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'];
export interface FreighterApiPort {
 requestAccess():Promise<{address:string;error?:unknown}>;
 getAddress():Promise<{address:string;error?:unknown}>;
 getNetworkDetails():Promise<{networkPassphrase:string;error?:unknown}>;
 signMessage(message:string,options:{networkPassphrase:string;address:string}):Promise<{signedMessage:string|Uint8Array|null;signerAddress:string;error?:unknown}>;
 signTransaction(xdr:string,options:{networkPassphrase:string;address:string}):Promise<{signedTxXdr:string;signerAddress:string;error?:unknown}>;
}
export interface FreighterScope {businessId:string;customerId:string;identityWalletId:string;freighterAddress:string;}
export interface FreighterChallenge {id:string;scope:FreighterScope;purpose:'bind'|'order'|'withdraw';intentHash:string;message:string;nonce:string;expiresAt:string;origin:string;assetId:string;}
export interface FreighterExpectedContext {scope:FreighterScope;purpose:FreighterChallenge['purpose'];intentHash:string;origin:string;assetId:string;}
export interface FreighterDeposit {id:string;intentHash:string;source:string;treasury:string;assetId:string;amountAtomic7:string;expiresAt:string;unsignedXdr:string;signingHashHex:string;memoHashHex:string;feeStroops:string;}
export class FreighterWalletError extends Error {constructor(public readonly code:'NETWORK_MISMATCH'|'WALLET_MISMATCH'|'INVALID_INTENT'|'WALLET_REJECTED',message:string){super(message);}}
const fail=(code:FreighterWalletError['code']='INVALID_INTENT'):never=>{throw new FreighterWalletError(code,code==='NETWORK_MISMATCH'?'Select Stellar Testnet in your wallet.':code==='WALLET_MISMATCH'?'Select the wallet connected to this account.':code==='WALLET_REJECTED'?'The wallet request was not approved.':'The wallet approval does not match your request.');};
const canonical=(value:unknown):string=>value&&typeof value==='object'&&!Array.isArray(value)?`{${Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`:JSON.stringify(value);
const sep53=(message:string)=>hash(Buffer.concat([Buffer.from('Stellar Signed Message:\n','utf8'),Buffer.from(message,'utf8')]));
function exactAsset(id:string):string{const issuer=id.replace('stellar-testnet:classic:USDC:','');if(id!==`stellar-testnet:classic:USDC:${issuer}`||!ISSUERS.includes(issuer))return fail();return issuer;}
function challengeMessage(value:FreighterChallenge):string{return 'Grapnel Solver Intent\n'+canonical({assetId:value.assetId,expiresAt:value.expiresAt,id:value.id,intentHash:value.intentHash,network:'stellar-testnet',nonce:value.nonce,origin:value.origin,purpose:value.purpose,scope:value.scope,version:1});}
function currentContext(value:FreighterExpectedContext):void{
 if(!value.scope||![value.scope.businessId,value.scope.customerId,value.scope.identityWalletId].every(item=>typeof item==='string'&&item.length>0&&item.length<=128&&!/[\x00-\x1f\x7f]/.test(item))||!StrKey.isValidEd25519PublicKey(value.scope.freighterAddress))return fail();
 try{const url=new URL(value.origin);if(url.origin!==value.origin||url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))return fail();}catch{return fail();}
}
/** Explicitly invoked by customer UI only; constructor performs no connection,
 * signature, installation or broadcast. Inject @stellar/freighter-api6.0.1. */
export class FreighterWallet {
 constructor(private readonly api:FreighterApiPort,private readonly now:()=>number=Date.now){}
 private async network():Promise<void>{const value=await this.api.getNetworkDetails();if(value.error||value.networkPassphrase!==TESTNET)return fail('NETWORK_MISMATCH');}
 private async owner(address:string):Promise<void>{await this.network();const value=await this.api.getAddress();if(value.error||value.address!==address||!StrKey.isValidEd25519PublicKey(address))return fail('WALLET_MISMATCH');}
 async connect():Promise<string>{await this.network();const result=await this.api.requestAccess();if(result.error||!StrKey.isValidEd25519PublicKey(result.address))return fail('WALLET_REJECTED');await this.owner(result.address);return result.address;}
 async signChallenge(challenge:FreighterChallenge,expected:FreighterExpectedContext){
  currentContext(expected);const expires=Date.parse(challenge.expiresAt);exactAsset(challenge.assetId);
  if(!['bind','order','withdraw'].includes(challenge.purpose)||challenge.purpose!==expected.purpose||challenge.intentHash!==expected.intentHash||!/^[a-f0-9]{64}$/.test(challenge.intentHash)||challenge.origin!==expected.origin||challenge.assetId!==expected.assetId||canonical(challenge.scope)!==canonical(expected.scope)||!challenge.id||challenge.id.length>128||challenge.nonce.length<16||challenge.nonce.length>128||!Number.isFinite(expires)||expires<=this.now()||expires>this.now()+300000||challenge.message!==challengeMessage(challenge)||Buffer.byteLength(challenge.message,'utf8')>8192)return fail();
  await this.owner(expected.scope.freighterAddress);
  const signed=await this.api.signMessage(challenge.message,{networkPassphrase:TESTNET,address:expected.scope.freighterAddress});
  if(signed.error||signed.signerAddress!==expected.scope.freighterAddress||!signed.signedMessage)return fail('WALLET_REJECTED');
  await this.owner(expected.scope.freighterAddress);if(expires<=this.now())return fail();
  const signature=typeof signed.signedMessage==='string'?Buffer.from(signed.signedMessage,'base64'):Buffer.from(signed.signedMessage);
  if(signature.length!==64||typeof signed.signedMessage==='string'&&signature.toString('base64')!==signed.signedMessage||!Keypair.fromPublicKey(expected.scope.freighterAddress).verify(sep53(challenge.message),signature))return fail();
  return {scheme:'stellar-sep53-v1' as const,signer_address:signed.signerAddress,signature_base64:signature.toString('base64')};
 }
 async signDeposit(prepared:FreighterDeposit,expected:{source:string;treasury:string;assetId:string;intentHash:string}){
  const issuer=exactAsset(prepared.assetId),now=this.now(),expires=Date.parse(prepared.expiresAt);
  if(prepared.source!==expected.source||prepared.treasury!==expected.treasury||prepared.source===prepared.treasury||prepared.assetId!==expected.assetId||prepared.intentHash!==expected.intentHash||!/^[a-f0-9]{64}$/.test(prepared.intentHash)||!StrKey.isValidEd25519PublicKey(prepared.source)||!StrKey.isValidEd25519PublicKey(prepared.treasury)||!prepared.id||!Number.isFinite(expires)||expires<=now||expires>now+90000||!/^[1-9]\d{0,18}$/.test(prepared.amountAtomic7)||BigInt(prepared.amountAtomic7)%10n||BigInt(prepared.amountAtomic7)>9223372036854775807n)return fail();
  let tx:Transaction;try{const candidate=TransactionBuilder.fromXDR(prepared.unsignedXdr,TESTNET);if(!(candidate instanceof Transaction))return fail();tx=candidate;}catch{return fail();}
  const memoHash=hash(Buffer.from('Grapnel solver deposit\n'+prepared.intentHash,'utf8')).toString('hex'),op=tx.operations[0];
  const amount=BigInt(prepared.amountAtomic7),decimal=`${amount/10000000n}.${(amount%10000000n).toString().padStart(7,'0')}`;
  if(tx.source!==prepared.source||tx.signatures.length||tx.operations.length!==1||op?.type!=='payment'||op.source&&op.source!==prepared.source||op.destination!==prepared.treasury||op.asset.isNative()||op.asset.getCode()!=='USDC'||op.asset.getIssuer()!==issuer||op.amount!==decimal||tx.memo.type!=='hash'||Buffer.from(tx.memo.value as Buffer).toString('hex')!==memoHash||prepared.memoHashHex!==memoHash||tx.fee!==prepared.feeStroops||!/^\d{1,4}$/.test(tx.fee)||BigInt(tx.fee)<100n||BigInt(tx.fee)>1000n||tx.timeBounds?.minTime!=='0'||Number(tx.timeBounds.maxTime)*1000!==expires||tx.toEnvelope().v1().tx().ext().switch()!==0||tx.toEnvelope().v1().tx().cond().switch().name!=='precondTime'||tx.hash().toString('hex')!==prepared.signingHashHex)return fail();
  await this.owner(prepared.source);const result=await this.api.signTransaction(prepared.unsignedXdr,{networkPassphrase:TESTNET,address:prepared.source});
  if(result.error||result.signerAddress!==prepared.source)return fail('WALLET_REJECTED');
  await this.owner(prepared.source);if(expires<=this.now())return fail();
  try{const signed=TransactionBuilder.fromXDR(result.signedTxXdr,TESTNET);if(!(signed instanceof Transaction)||signed.toEnvelope().v1().tx().toXDR('base64')!==tx.toEnvelope().v1().tx().toXDR('base64')||signed.signatures.length!==1||!signed.signatures[0]!.hint().equals(Keypair.fromPublicKey(prepared.source).signatureHint())||!Keypair.fromPublicKey(prepared.source).verify(signed.hash(),signed.signatures[0]!.signature()))return fail();}catch{return fail();}
  return {signedXdr:result.signedTxXdr,signerAddress:result.signerAddress,signingHashHex:prepared.signingHashHex};
 }
}
