/** Existing public account; exact hypothetical preparation only. No signing, DB operation or broadcast. */
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {TransactionBuilder} from '@stellar/stellar-sdk';
import {NETWORK_PASSPHRASE,type ChainAction} from '@grapnel/contracts';
import {BlendBorrowSorobanPreparer} from '../../stellar/blend-borrow-preparer.js';
import {BORROW_POOL_ID,BORROW_ASSETS,buildBorrowOperation} from '../borrow.js';
const wallet='GB4PC65ZHBPVEZMAHY2K2KYMS3RFBIN2FQIE3LGTLEHT2DEWVMTD7JYQ';
const preparer=new BlendBorrowSorobanPreparer({network:'testnet',passphrase:NETWORK_PASSPHRASE,gate1Passed:true});
const actions=[];
for(const asset of BORROW_ASSETS){
 const intent={action:'collateral_supply' as const,poolId:BORROW_POOL_ID,reserveId:asset.contractId!,walletAddress:wallet,amountAtomic:10000000n};
 const input:ChainAction={operationId:randomUUID(),customerId:'2a007496-0afb-41a4-af3f-b61eb05f3398',walletAddress:wallet,operationXdr:buildBorrowOperation(intent),allowedContracts:[BORROW_POOL_ID,asset.contractId!],summary:{action:'blend.borrow_collateral_supply',fromAssetId:asset.id,amount:'1.0000000',contractId:BORROW_POOL_ID,recipient:wallet,expiresAt:new Date(Date.now()+120000).toISOString()}};
 const action=await preparer.prepare(input),tx=TransactionBuilder.fromXDR(action.unsignedXdr,NETWORK_PASSPHRASE);
 actions.push({asset:asset.code,signatures:tx.signatures.length,action});
}
const report={observed_at:new Date().toISOString(),mode:'read_only_unsigned_preparation',broadcast:false,customer_approved:false,tx_hash:null,actions};
await writeFile(new URL('./borrow-collateral-prepare-read.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,actions:actions.map(row=>({...row,action:{...row.action,unsignedXdr:undefined}}))},null,2));
