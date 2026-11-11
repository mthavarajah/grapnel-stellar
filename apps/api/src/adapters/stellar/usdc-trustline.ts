import { Account, Asset, Keypair, Operation, StrKey, TransactionBuilder } from '@stellar/stellar-sdk';
import { GrapnelError, NETWORK_PASSPHRASE, toAtomic } from '@grapnel/contracts';
import { assertTestnet, parseTestnetTransaction, type StellarConfig } from './index.js';

/** Exact current Testnet classic identity. Symbols alone never select an issuer. */
export const TESTNET_USDC_ISSUER='GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56';
export interface UsdcTrustlineIntent {
 network:'stellar-testnet'; action:'wallet.usdc_trustline'; walletAddress:string;
 assetCode:'USDC'; issuer:typeof TESTNET_USDC_ISSUER; limit:string;
 sequence:string; maxFeeStroops:'100'; expiresAt:string;
}
export interface ReviewedUsdcTrustline {intent:UsdcTrustlineIntent;unsignedXdr:string;signingHashHex:string;}
const reject=(message:string):never=>{throw new GrapnelError(403,'INTENT_MISMATCH',message);};
function canonical(intent:UsdcTrustlineIntent){
 if(intent.network!=='stellar-testnet'||intent.action!=='wallet.usdc_trustline'||intent.assetCode!=='USDC'||intent.issuer!==TESTNET_USDC_ISSUER||!StrKey.isValidEd25519PublicKey(intent.walletAddress)||intent.walletAddress===intent.issuer)reject('Only the exact customer Testnet USDC trustline is supported');
 let limit:bigint;try{limit=toAtomic(intent.limit,7);}catch{return reject('A positive seven-decimal trust limit is required');}
 if(limit>10000000000n)reject('Demo trust limit may not exceed 1000 Testnet USDC');
 const expiry=Date.parse(intent.expiresAt);if(!Number.isSafeInteger(expiry)||expiry%1000!==0||expiry<=Date.now()||expiry>Date.now()+120000)reject('Trustline requires an unexpired authorization of at most 120 seconds');
 if(!/^[1-9]\d*$/.test(intent.sequence)||BigInt(intent.sequence)>9223372036854775807n||intent.maxFeeStroops!=='100')reject('Invalid approved sequence or fee');
 return new TransactionBuilder(new Account(intent.walletAddress,(BigInt(intent.sequence)-1n).toString()),{fee:'100',networkPassphrase:NETWORK_PASSPHRASE,timebounds:{minTime:0,maxTime:expiry/1000}}).addOperation(Operation.changeTrust({asset:new Asset('USDC',TESTNET_USDC_ISSUER),limit:intent.limit})).build();
}
/** Preparation only. Caller must verify live Testnet, current account sequence,
 * absent trustline, current base reserve and reservation-adjusted XLM budget.
 * Does not accept provider XDR, sign, broadcast, or authorize an API action. */
export function buildUsdcTrustline(config:StellarConfig,intent:UsdcTrustlineIntent,budget:{spendableXlmAtomic:bigint;additionalReserveAtomic:bigint}):ReviewedUsdcTrustline {
 assertTestnet(config);
 if(budget.additionalReserveAtomic<=0n||budget.spendableXlmAtomic<budget.additionalReserveAtomic+100n)throw new GrapnelError(409,'INSUFFICIENT_BALANCE','Trustline must preserve its extra XLM reserve and approved fee');
 const tx=canonical(intent);
 return {intent:{...intent},unsignedXdr:tx.toXDR(),signingHashHex:tx.hash().toString('hex')};
}
/** Signature verifier for this helper only; existing generic signing/submission
 * paths deliberately remain unavailable until the lead integrates an approved API. */
export function verifyUsdcTrustline(prepared:ReviewedUsdcTrustline,signedXdr:string):void {
 const expected=canonical(prepared.intent);const unsigned=parseTestnetTransaction(prepared.unsignedXdr);const signed=parseTestnetTransaction(signedXdr);
 const hash=expected.hash().toString('hex');
 if(unsigned.signatures.length||hash!==prepared.signingHashHex||unsigned.hash().toString('hex')!==hash||signed.hash().toString('hex')!==hash)reject('Trustline differs from the exact approved asset, limit, sequence, fee or expiry');
 const customer=Keypair.fromPublicKey(prepared.intent.walletAddress);
 if(signed.signatures.length!==1||!signed.signatures[0]!.hint().equals(customer.signatureHint())||!customer.verify(signed.hash(),signed.signatures[0]!.signature()))throw new GrapnelError(403,'INVALID_CUSTOMER_SIGNATURE','Exact trustline approval requires the customer wallet signature');
}

/** Bridge the frozen customer approval envelope into the narrow trustline verifier. */
export function verifyPreparedUsdcTrustline(action:import('@grapnel/contracts').PreparedAction,signedXdr:string):void {
 const unsigned=parseTestnetTransaction(action.unsignedXdr);
 const assetId=`stellar-testnet:classic:USDC:${TESTNET_USDC_ISSUER}`;
 if(action.network!=='stellar-testnet'||action.authorization.method!=='privy_stellar'||action.summary.action!=='wallet.usdc_trustline'||action.summary.fromAssetId!==assetId||action.summary.recipient!==action.walletAddress||action.summary.maxFeeStroops!=='100'||action.summary.expiresAt!==action.authorization.expiresAt||action.summary.contractId!==undefined||action.summary.toAssetId!==undefined||action.summary.minReceive!==undefined)reject('Trustline summary differs from the approved asset and limit');
 verifyUsdcTrustline({intent:{network:'stellar-testnet',action:'wallet.usdc_trustline',walletAddress:action.walletAddress,assetCode:'USDC',issuer:TESTNET_USDC_ISSUER,limit:action.summary.amount??'',sequence:unsigned.sequence,maxFeeStroops:'100',expiresAt:action.summary.expiresAt},unsignedXdr:action.unsignedXdr,signingHashHex:action.signingHashHex},signedXdr);
}
