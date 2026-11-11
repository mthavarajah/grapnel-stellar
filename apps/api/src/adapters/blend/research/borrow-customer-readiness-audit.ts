/** Public-wallet read-only audit. Creates no Grapnel session or operation, signs nothing and never submits.
 * Diagnostic customer labels are deliberately not real tenant/customer IDs and provide no authorization.
 */
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {Transaction,TransactionBuilder,rpc} from '@stellar/stellar-sdk';
import {GrapnelError,NETWORK_PASSPHRASE,type CustomerContext} from '@grapnel/contracts';
import {BlendBorrowAdapter,BORROW_POOL_ID,BORROW_ASSETS} from '../borrow.js';
import {BlendBorrowSorobanPreparer} from '../../stellar/blend-borrow-preparer.js';
const wallet='GB4PC65ZHBPVEZMAHY2K2KYMS3RFBIN2FQIE3LGTLEHT2DEWVMTD7JYQ';
const started=new Date().toISOString();
const payment=await fetch('https://horizon-testnet.stellar.org/transactions/c1fd6b62b43b062ec88b4bdeddf86e45ea329ac1b9e5969a199289b536208ab2',{redirect:'error',signal:AbortSignal.timeout(12000)});
const publicPayment=await payment.json() as {successful?:boolean;source_account?:string;hash?:string;ledger?:number};
const gate1PublicPaymentFound=payment.ok&&publicPayment.successful===true&&publicPayment.source_account===wallet&&publicPayment.hash==='c1fd6b62b43b062ec88b4bdeddf86e45ea329ac1b9e5969a199289b536208ab2';
if(!gate1PublicPaymentFound)throw Error('The actual known customer Testnet payment could not be independently read');
const context:CustomerContext={businessId:'read-only-public-wallet-not-a-tenant',customerId:'read-only-public-wallet-not-an-authenticated-customer',walletId:'read-only-public-wallet-not-a-bound-wallet',privyUserId:'read-only-no-identity-proof',walletAddress:wallet};
const preparer=new BlendBorrowSorobanPreparer({network:'testnet',passphrase:NETWORK_PASSPHRASE,gate1Passed:true});
const adapter=new BlendBorrowAdapter({network:'testnet',passphrase:NETWORK_PASSPHRASE,gate1Passed:true},{prepareAndSimulate:input=>preparer.prepare(input)});
const before=await adapter.readWallet(wallet),positionsBefore=await adapter.positionsWallet(wallet);
const results:unknown[]=[];
for(const asset of BORROW_ASSETS){
 const input={operationId:randomUUID(),marketId:`stellar-testnet:blend:${BORROW_POOL_ID}:${asset.contractId}`,assetId:asset.id,amount:'1.0000000'};
 try{
  const prepared=await adapter.prepareCollateral('supply',input,context),tx=TransactionBuilder.fromXDR(prepared.unsignedXdr,NETWORK_PASSPHRASE) as Transaction,data=tx.toEnvelope().v1().tx().ext().sorobanData();
  results.push({asset:asset.code,action:'collateral_supply',unsigned_preparation_passed:true,customer_authorized:false,signatures:tx.signatures.length,fee_stroops:tx.fee,summary:prepared.summary,footprint:{read_only:data.resources().footprint().readOnly().length,read_write:data.resources().footprint().readWrite().length,instructions:data.resources().instructions(),extension:data.ext().switch()},operation_persisted:false,tx_hash:null,broadcast:false});
 }catch(error){results.push({asset:asset.code,action:'collateral_supply',unsigned_preparation_passed:false,error:error instanceof GrapnelError?{code:error.code,message:error.message,details:error.details}:{message:error instanceof Error?error.message:String(error)},broadcast:false});}
 for(const action of ['borrow','repay'] as const){
  try{await adapter.prepare(action,{...input,operationId:randomUUID()},context);results.push({asset:asset.code,action,prepared:true,customer_authorized:false,signatures:0,broadcast:false,tx_hash:null});}
  catch(error){results.push({asset:asset.code,action,prepared:false,error:error instanceof GrapnelError?{code:error.code,message:error.message,details:error.details}:{message:error instanceof Error?error.message:String(error)},broadcast:false});}
 }
}
const positionsAfter=await adapter.positionsWallet(wallet);
const reservePositionsUnchanged=positionsBefore.every(before=>{const after=positionsAfter.find(row=>row.market_id===before.market_id);return after?.debt_tokens===before.debt_tokens&&after.collateral_tokens===before.collateral_tokens;});
const report={started_at:started,observed_at:new Date().toISOString(),network:'stellar-testnet',mode:'public_read_and_unsigned_preparation_only',wallet,pool_id:BORROW_POOL_ID,signatures_created:0,broadcast:false,operations_persisted:0,customer_authorized:false,new_transaction_hashes:[],gate1_public_payment_found:gate1PublicPaymentFound,gate1_public_payment_ledger:publicPayment.ledger,before,positions_before:positionsBefore,results,positions_after:positionsAfter,position_tokens_unchanged:reservePositionsUnchanged};
await writeFile(new URL('./borrow-customer-readiness-audit.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
