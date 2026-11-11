/** Read-only verification of persisted real Testnet QA execution metadata. */
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const report=JSON.parse(await readFile(new URL('./borrow-live-qa.json',import.meta.url),'utf8'));
const scale=10n**12n,ceil=(n:bigint,d:bigint)=>(n+d-1n)/d;
const proofs=[];
for(const tx of report.transactions.filter((t:any)=>t.pool_changes?.length)){
 const [action,code]=tx.action.split(':'),index=code==='XLM'?'0':'3';
 const position=tx.after.positions.find((p:any)=>p.reserve_index===Number(index));
 const changes=tx.pool_changes;
 const res=changes.find((c:any)=>c.kind==='ledgerEntryUpdated'&&c.key[0]==='ResData'&&c.key[1]===position.reserve_contract_id)?.value;
 assert(res,'Execution ResData required');
 const before=changes.find((c:any)=>c.kind==='ledgerEntryState'&&c.key[0]==='Positions')?.value??{collateral:{},liabilities:{},supply:{}};
 const after=changes.find((c:any)=>['ledgerEntryUpdated','ledgerEntryCreated'].includes(c.kind)&&c.key[0]==='Positions')?.value;
 assert(after,'Execution Positions required');
 const selected=action==='borrow'||action==='repay'?'liabilities':'collateral',rate=BigInt(selected==='liabilities'?res.d_rate:res.b_rate);
 const amount=BigInt(tx.verification.requested_atomic),old=BigInt(before[selected][index]??'0'),next=BigInt(after[selected][index]??'0');
 let expected:bigint;
 if(action==='borrow')expected=ceil(amount*scale,rate);
 else if(action==='repay')expected=-(amount*scale/rate>old?old:amount*scale/rate);
 else if(action==='collateral_supply')expected=amount*scale/rate;
 else expected=-ceil(amount*scale,rate);
 assert.equal(next-old,expected,'Exact dToken/bToken rounding at execution rate');
 for(const field of ['collateral','liabilities','supply']){
  for(const key of new Set([...Object.keys(before[field]),...Object.keys(after[field])])){
   if(field===selected&&key===index)continue;
   assert.equal(before[field][key]??'0',after[field][key]??'0','Unrelated position unchanged');
  }
 }
 const observedBefore=tx.before.positions.find((p:any)=>p.reserve_index===Number(index));
 assert.equal(BigInt(selected==='liabilities'?observedBefore.debt_tokens:observedBefore.collateral_tokens),old);
 assert.equal(BigInt(selected==='liabilities'?position.debt_tokens:position.collateral_tokens),next);
 assert.equal(tx.actual_fee_metadata_stroops,tx.result_fee_charged_stroops);assert.equal(tx.actual_fee_metadata_stroops,tx.horizon_fee_charged_stroops);
 proofs.push({action:tx.action,tx_hash:tx.tx_hash,ledger:tx.confirmed_ledger,reserve_index:Number(index),execution_rate:rate.toString(),rate_decimals:12,requested_atomic:amount.toString(),before_tokens:old.toString(),after_tokens:next.toString(),exact_expected_token_delta:expected.toString(),gross_wallet_delta_atomic:tx.verification.gross_wallet_delta_atomic,actual_fee_stroops:tx.actual_fee_metadata_stroops,exact_metadata_and_wallet_verified:true,unrelated_positions_unchanged:true});
}
assert.equal(proofs.length,6);assert(report.complete);assert(report.final.positions.every((p:any)=>p.debt_tokens==='0'));
const result={observed_at:new Date().toISOString(),read_only:true,signer:report.signer,customer_privy_acceptance:false,pool_id:report.final.positions[0].pool_contract_id,qa_account:report.qa_account,all_exact:true,proofs,final_debt_tokens:{XLM:'0',USDC:'0'},residual_earned_collateral:report.final.positions[0].collateral,transactions_this_run:report.transactions.length,cumulative_transactions:report.transactions.length+report.prior_transactions.length,cap:report.scope.max_total_transactions};
await writeFile(new URL('./borrow-live-qa-metadata-proof.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
