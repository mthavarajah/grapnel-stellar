/**
 * Explicit lead-authorized protocol QA, NOT the customer/Privy application flow.
 * A new QA-owned key exists in memory only; this file never reads a customer or
 * treasury key, creates DB operations, mints tokens, or signs mainnet envelopes.
 */
import {createReadStream} from 'node:fs';
import {writeFile,readFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';
import {Account,Address,Horizon,Keypair,Operation,StrKey,Transaction,TransactionBuilder,rpc,scValToNative,xdr} from '@stellar/stellar-sdk';
import {NETWORK_PASSPHRASE,XLM,fromAtomic,toAtomic,type ChainAction} from '@grapnel/contracts';
import {buildUsdcTrustline,verifyUsdcTrustline,TESTNET_USDC_ISSUER} from '../../stellar/usdc-trustline.js';
import {BlendBorrowSorobanPreparer} from '../../stellar/blend-borrow-preparer.js';
import {SoroswapSpotAdapter} from '../../soroswap/index.js';
import {SoroswapDirectInspector,USDC_SAC,NATIVE_SAC,inspectSwapTransaction,narrowSwapTimebounds,reconstructSwapResources,type SwapIntent} from '../../soroswap/inspector.js';
import {BlendBorrowAdapter,BORROW_ASSETS,BORROW_POOL_ID,BORROW_XLM_RESERVE,BORROW_USDC_RESERVE,buildBorrowOperation,borrowSummaryAction,borrowReadAtomic,type BorrowAction} from '../borrow.js';
const server=new rpc.Server('https://soroban-testnet.stellar.org');
const horizon=new Horizon.Server('https://horizon-testnet.stellar.org');
const label='ephemeral_qa_ed25519_NOT_Privy_customer_flow';
if(!process.argv.includes('--lead-approved-live-testnet-qa'))throw Error('This script requires the explicit lead-approved live Testnet QA flag; it is not a read-only smoke test');
let ownKey:Keypair|undefined=Keypair.random();
const own=ownKey.publicKey();
if(['GB4PC65ZHBPVEZMAHY2K2KYMS3RFBIN2FQIE3LGTLEHT2DEWVMTD7JYQ','GCY4DPMIBYCQ352UDKVWDJFKRXOIB2YCOLF2PQFUZHZPYU4WD4PW3LBE'].includes(own))throw Error('QA ownership isolation failed');
const report:any={started_at:new Date().toISOString(),network:'stellar-testnet',network_passphrase:NETWORK_PASSPHRASE,signer:label,qa_account:own,customer_privy_acceptance:false,database_operations_created:false,private_key_persisted:false,scope:{additional_collateral_max_xlm:'0.5',cumulative_collateral_max_xlm:'10.5',borrow_max_xlm:'0.1',borrow_max_usdc:'0.01',additional_swap_max_xlm:'0.2',cumulative_swap_max_xlm:'2.2',fee_max_per_tx_stroops:'10000000',max_total_transactions:19,cap_revision:'lead-approved 19 including eight prior transactions'},transactions:[],complete:false};
const output=new URL('./borrow-live-qa.json',import.meta.url);
const json=(v:unknown)=>JSON.stringify(v,(_k,value)=>typeof value==='bigint'?value.toString():value instanceof Map?Object.fromEntries(value):value,2);
const persist=()=>writeFile(output,json(report)+'\n');
const atomic=(v:string)=>/^0(?:\.0+)?$/.test(v)?0n:toAtomic(v,7);
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function onlyProviderKey(){
 if(process.env.SOROSWAP_API_KEY)return process.env.SOROSWAP_API_KEY;
 // Read only the named provider credential; do not load .env or other secrets.
 const lines=createInterface({input:createReadStream(process.env.GRAPNEL_QA_PROVIDER_ENV_FILE??new URL('../../../../../../.env',import.meta.url)),crlfDelay:Infinity});
 for await(const line of lines){if(line.startsWith('SOROSWAP_API_KEY=')){lines.close();const value=line.slice('SOROSWAP_API_KEY='.length).trim();return value.startsWith('"')&&value.endsWith('"')?JSON.parse(value):value;}}
 throw Error('The server-only Soroswap provider key is required for the owned QA interest buffer');
}
async function wallet(){const a=await horizon.loadAccount(own);return {native:a.balances.find(b=>b.asset_type==='native')!.balance,usdc:a.balances.find(b=>b.asset_type!=='native'&&'asset_code'in b&&b.asset_code==='USDC'&&b.asset_issuer===TESTNET_USDC_ISSUER)?.balance??null,sequence:a.sequence};}
const borrow=new BlendBorrowAdapter({network:'testnet',passphrase:NETWORK_PASSPHRASE,gate1Passed:true});
const preparer=new BlendBorrowSorobanPreparer({network:'testnet',passphrase:NETWORK_PASSPHRASE,gate1Passed:true});
async function state(){return {wallet:await wallet(),positions:await borrow.positionsWallet(own),as_of:new Date().toISOString()};}
function sourceFee(meta:xdr.TransactionMeta,source:string=own):bigint{
 if(meta.switch()!==4)throw Error('CAP0067 fee proof requires actual V4 metadata');
 let total=0n,charges=0,refunds=0;
 for(const item of meta.v4().events()){
  const event=item.event(),body=event.body().v0(),topics=body.topics().map(scValToNative);
  if(topics[0]!=='fee')continue;
  const contract=event.contractId()?Address.fromScAddress(xdr.ScAddress.scAddressTypeContract(event.contractId()!)).toString():null;
  const amount=scValToNative(body.data()),stage=item.stage().name;
  if(contract!==NATIVE_SAC||topics.length!==2||topics[1]!==source||typeof amount!=='bigint'||amount===0n)throw Error('Fee event does not bind the exact native source');
  if(amount>0n){if(stage!=='transactionEventStageBeforeAllTxes'||++charges!==1)throw Error('Invalid initial fee stage/count');}
  else if(!['transactionEventStageAfterTx','transactionEventStageAfterAllTxes'].includes(stage)||++refunds>1)throw Error('Invalid refund stage/count');
  total+=amount;
 }
 if(charges!==1||total<=0n)throw Error('Missing actual native fee events');return total;
}
async function verifyHistoricalFeeSemantics(){
 const txHash='1ad63c4281c7fd6a730a914c6f182beb60b6a9872103882b4a9506caa572a09a';
 const observed=await server.getTransaction(txHash);if(observed.status!=='SUCCESS')throw Error('Historical public fee reference unavailable');
 const h=await horizon.transactions().transaction(txHash).call(),envelope=TransactionBuilder.fromXDR(h.envelope_xdr,NETWORK_PASSPHRASE) as Transaction;
 const actual=sourceFee(observed.resultMetaXdr,envelope.source),result=BigInt(observed.resultXdr.feeCharged().toString()),horizonFee=BigInt(h.fee_charged);
 if(actual!==result||actual!==horizonFee||actual>BigInt(envelope.fee))throw Error('Current fee event, RPC result and Horizon fees disagree');
 const meta=observed.resultMetaXdr.v4().sorobanMeta();let resourceComponents:any=null;
 if(meta&&meta.ext().switch()===1){const component=meta.ext().v1();const nonrefundable=BigInt(component.totalNonRefundableResourceFeeCharged().toString()),refundable=BigInt(component.totalRefundableResourceFeeCharged().toString()),rent=BigInt(component.rentFeeCharged().toString());if(nonrefundable+refundable>actual||rent>refundable)throw Error('Soroban charged resource components disagree');resourceComponents={non_refundable:nonrefundable.toString(),refundable:refundable.toString(),rent:rent.toString(),inclusion:(actual-nonrefundable-refundable).toString()};}
 const proof={observed_at:new Date().toISOString(),read_only:true,customer_transaction_used_only_as_public_fee_reference:true,tx_hash:txHash,ledger:observed.ledger,fee_event_sum_stroops:actual.toString(),result_fee_charged_stroops:result.toString(),horizon_fee_charged_stroops:horizonFee.toString(),declared_fee_stroops:envelope.fee,resource_components:resourceComponents,source:'CAP0067 and Stellar-ledger.x final feeCharged semantics'};
 await writeFile(new URL('./borrow-live-qa-fee-proof.json',import.meta.url),json(proof)+'\n');report.fee_semantics_reference=proof;await persist();
}

function poolChanges(meta:xdr.TransactionMeta){const ops=meta.switch()===3?meta.v3().operations():meta.switch()===4?meta.v4().operations():null;if(!ops||ops.length!==1)throw Error('Unexpected operation count in metadata');const out:any[]=[];for(const c of ops[0]!.changes()){const kind=c.switch().name;if(!['ledgerEntryState','ledgerEntryCreated','ledgerEntryUpdated'].includes(kind))continue;const e=kind==='ledgerEntryState'?c.state():kind==='ledgerEntryCreated'?c.created():c.updated();if(e.data().switch().name!=='contractData')continue;const cd=e.data().contractData();if(Address.fromScAddress(cd.contract()).toString()!==BORROW_POOL_ID)continue;const k=scValToNative(cd.key());if(Array.isArray(k)&&k.length===2&&((k[0]==='Positions'&&k[1]===own)||(k[0]==='ResData'&&[BORROW_XLM_RESERVE,BORROW_USDC_RESERVE].includes(k[1]))))out.push({kind,key:k,value:scValToNative(cd.val())});}return out;}
async function submitOnce(unsigned:Transaction,tag:string,before:any,verify:(signed:Transaction)=>Promise<void>|void,extra:any={}){
 if(!ownKey||unsigned.source!==own||unsigned.networkPassphrase!==NETWORK_PASSPHRASE||unsigned.signatures.length||BigInt(unsigned.fee)>10_000_000n||(report.transactions.length+(report.prior_transactions?.length??0))>=19)throw Error('QA authority or transaction budget mismatch');
 unsigned.sign(ownKey);if(unsigned.signatures.length!==1||!ownKey.verify(unsigned.hash(),unsigned.signatures[0]!.signature()))throw Error('Own QA signature invalid');await verify(unsigned);
 const hash=unsigned.hash().toString('hex'),row:any={action:tag,signer:label,tx_hash:hash,explorer:`https://stellar.expert/explorer/testnet/tx/${hash}`,status:'prepared_before_single_send',declared_fee_stroops:unsigned.fee,before,...extra};report.transactions.push(row);await persist();
 // This is the only send call for this exact stored hash. Never blindly resend.
 const sent=await server.sendTransaction(unsigned);row.send_status=sent.status;await persist();
 const deadline=Date.now()+120000;let found:rpc.Api.GetTransactionResponse|undefined;
 while(Date.now()<deadline){found=await server.getTransaction(hash);if(found.status==='SUCCESS'||found.status==='FAILED')break;await sleep(1000);}
 if(!found||found.status!=='SUCCESS'){row.status=found?.status??'unresolved';await persist();throw Error(`QA transaction ${tag} did not succeed; stored hash must be reconciled without resending`);}
 row.status='SUCCESS';row.confirmed_ledger=found.ledger;row.result_xdr=found.resultXdr.toXDR('base64');row.result_meta_xdr=found.resultMetaXdr.toXDR('base64');row.result_fee_charged_stroops=found.resultXdr.feeCharged().toString();row.actual_fee_metadata_stroops=sourceFee(found.resultMetaXdr).toString();const horizonTx=await horizon.transactions().transaction(hash).call();row.horizon_fee_charged_stroops=horizonTx.fee_charged;if(row.actual_fee_metadata_stroops!==row.result_fee_charged_stroops||BigInt(horizonTx.fee_charged)!==BigInt(row.actual_fee_metadata_stroops))throw Error('Exact fee events, RPC and Horizon disagree');if(BigInt(row.actual_fee_metadata_stroops)>BigInt(unsigned.fee)||BigInt(row.actual_fee_metadata_stroops)>10000000n)throw Error('Actual fee exceeds inspected budget');row.pool_changes=poolChanges(found.resultMetaXdr);
 for(let attempt=0;attempt<20;attempt++){try{row.after=await state();if(row.after.positions.every((p:any)=>p.as_of_ledger>=found!.ledger))break;}catch{}await sleep(500);}
 if(!row.after)throw Error('Post-chain state unavailable');await persist();console.log(json({action:tag,status:row.status,hash,ledger:row.confirmed_ledger,actual_fee_stroops:row.actual_fee_metadata_stroops}));return row;
}
function validateBorrowReceipt(row:any,action:BorrowAction,reserveId:string,requested:bigint){
 const selected=(s:any)=>s.positions.find((p:any)=>p.reserve_contract_id===reserveId);const before=selected(row.before),after=selected(row.after);if(!before||!after)throw Error('Missing position observations');
 const fee=BigInt(row.actual_fee_metadata_stroops),native=reserveId===BORROW_XLM_RESERVE;
 const walletBefore=atomic(native?row.before.wallet.native:row.before.wallet.usdc??'0'),walletAfter=atomic(native?row.after.wallet.native:row.after.wallet.usdc??'0');
 const gross=walletAfter-walletBefore+(native?fee:0n),collateralDelta=BigInt(after.collateral_tokens)-BigInt(before.collateral_tokens),debtDelta=BigInt(after.debt_tokens)-BigInt(before.debt_tokens);
 if(action==='borrow'&&(gross!==requested||debtDelta<=0n))throw Error('Borrow actual wallet/debt proof mismatch');
 if(action==='repay'&&(gross>=0n||-gross>requested||debtDelta>=0n))throw Error('Repayment actual wallet/debt proof mismatch');
 if(action==='collateral_supply'&&(gross!==-requested||collateralDelta<=0n))throw Error('Collateral supply actual wallet/position proof mismatch');
 if(action==='collateral_withdraw'&&(gross!==requested||collateralDelta>=0n))throw Error('Collateral withdrawal actual wallet/position proof mismatch');
 row.verification={verified:true,requested_atomic:requested.toString(),gross_wallet_delta_atomic:gross.toString(),collateral_token_delta:collateralDelta.toString(),debt_token_delta:debtDelta.toString(),before_debt_tokens:before.debt_tokens,after_debt_tokens:after.debt_tokens,before_collateral_tokens:before.collateral_tokens,after_collateral_tokens:after.collateral_tokens,price_scope:'protocol_oracle_not_public_spot',actual_fee_source:'CAP0067 native fee/refund events equals RPC result feeCharged and Horizon fee_charged'};
}
async function blendAction(action:BorrowAction,reserveId:string,amount:string){const asset=BORROW_ASSETS.find(a=>a.contractId===reserveId)!;const requested=toAtomic(amount,7);if((action==='collateral_supply'&&requested>5000000n)||(action==='borrow'&&requested>(reserveId===BORROW_XLM_RESERVE?1000000n:100000n)))throw Error('QA principal exceeds fixed budget');
 const intent={action,poolId:BORROW_POOL_ID,reserveId,walletAddress:own,amountAtomic:requested};const input:ChainAction={operationId:randomUUID(),customerId:randomUUID(),walletAddress:own,operationXdr:buildBorrowOperation(intent),allowedContracts:[BORROW_POOL_ID,reserveId],summary:{action:borrowSummaryAction(action),fromAssetId:asset.id,amount,recipient:own,contractId:BORROW_POOL_ID,expiresAt:new Date(Date.now()+120000).toISOString()}};
 // The UUID is an unregistered QA correlation label, never a registered customer or Privy identity.
 const before=await state(),prepared=await preparer.prepare(input),tx=TransactionBuilder.fromXDR(prepared.unsignedXdr,NETWORK_PASSPHRASE) as Transaction;
 const row=await submitOnce(tx,`${action}:${asset.code}`,before,signed=>preparer.verifyForSubmission(prepared,signed.toXDR()),{prepared_summary:prepared.summary,application_customer_identity:false});validateBorrowReceipt(row,action,reserveId,requested);await persist();return row;
}
async function classicTrustline(){
 const before=await state(),account=await horizon.loadAccount(own),latest=(await horizon.ledgers().order('desc').limit(1).call()).records[0]!;
 const base=BigInt(latest.base_reserve_in_stroops);if(base!==5000000n||before.wallet.usdc!==null)throw Error('Unexpected account trustline or current base reserve');
 const expiresAt=new Date((Math.floor(Date.now()/1000)+120)*1000).toISOString();const reviewed=buildUsdcTrustline({network:'testnet',passphrase:NETWORK_PASSPHRASE},{network:'stellar-testnet',action:'wallet.usdc_trustline',walletAddress:own,assetCode:'USDC',issuer:TESTNET_USDC_ISSUER,limit:'1000',sequence:(BigInt(account.sequence)+1n).toString(),maxFeeStroops:'100',expiresAt},{spendableXlmAtomic:atomic(before.wallet.native)-base*BigInt(2+account.subentry_count),additionalReserveAtomic:base});
 const tx=TransactionBuilder.fromXDR(reviewed.unsignedXdr,NETWORK_PASSPHRASE) as Transaction;
 const row=await submitOnce(tx,'qa_classic_usdc_trustline',before,signed=>verifyUsdcTrustline(reviewed,signed.toXDR()),{classic_exception:{lead_approved:true,simulation_status:'not_applicable_classic_operation',rpc_unsupported:'transaction contains unsupported operation type: OperationTypeChangeTrust',exact_limit:'1000',exact_fee_stroops:'100',base_reserve_stroops:base.toString()}});
 if(row.after.wallet.usdc!=='0.0000000')throw Error('Exact QA USDC trustline not confirmed');row.verification={verified:true,exact_issuer:TESTNET_USDC_ISSUER,limit:'1000',classic_not_soroban_simulated:true};await persist();
}

function assertSwapCoverage(tx:Transaction,sim:rpc.Api.SimulateTransactionResponse){
 if(!rpc.Api.isSimulationSuccess(sim)||rpc.Api.isSimulationRestore(sim)||!sim.result)throw Error('Exact QA swap enforce simulation failed');
 const declared=tx.toEnvelope().v1().tx().ext().sorobanData(),observed=sim.transactionData.build(),a=declared.resources(),b=observed.resources();
 const op=tx.operations[0];if(op?.type!=='invokeHostFunction'||sim.result.auth.length!==1||sim.result.auth[0]!.toXDR('base64')!==op.auth?.[0]?.toXDR('base64')||declared.ext().toXDR('base64')!==observed.ext().toXDR('base64')||a.footprint().toXDR('base64')!==b.footprint().toXDR('base64')||a.instructions()<b.instructions()||a.diskReadBytes()<b.diskReadBytes()||a.writeBytes()<b.writeBytes()||BigInt(declared.resourceFee().toString())<BigInt(sim.minResourceFee)||BigInt(tx.fee)<BigInt(sim.minResourceFee)+100n)throw Error('Exact QA swap enforce changed authorization/footprint or exceeds inspected resources');
}
async function swapBuffer(){
 const apiKey=await onlyProviderKey(),inspector=new SoroswapDirectInspector('CBR76WMT6J733CCVBP23M2EL5QGP5HXLPEFNFZGZ7IB6QHOJAHP7YM3V',{quoteReadSource:own}),market=await inspector.market(),registry=await inspector.registry();
 const adapter=new SoroswapSpotAdapter({network:'testnet',networkPassphrase:NETWORK_PASSPHRASE,apiKey,gate1Passed:true,markets:[market]},undefined,undefined,inspector.readExactQuote);
 const before=await state(),quote=await adapter.quote({quoteId:randomUUID(),marketId:market.id,assetId:XLM.id,amount:'0.2000000',slippageBps:50});
 const response=await fetch('https://api.soroswap.finance/quote/build?network=testnet',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({quote:quote.provider_quote,from:own,to:own}),redirect:'error',signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error(`Exact QA buffer build rejected: ${response.status}`);const body=await response.json() as {xdr?:string};if(!body.xdr)throw Error('Exact buffer build missing XDR');
 const intent:SwapIntent={wallet:own,amount:2000000n,minimum:BigInt(quote.min_out_atomic),expiresAt:quote.expires_at,assetIn:NATIVE_SAC,assetOut:USDC_SAC};const raw=TransactionBuilder.fromXDR(body.xdr,NETWORK_PASSPHRASE) as Transaction;inspectSwapTransaction(raw,intent,registry,true);
 const narrowed=narrowSwapTimebounds(raw,intent.expiresAt);inspectSwapTransaction(narrowed,intent,registry);const swapOp=narrowed.operations[0];if(swapOp?.type!=='invokeHostFunction')throw Error('Wrong QA swap invocation');const recordInput=TransactionBuilder.cloneFrom(narrowed).clearOperations().addOperation(Operation.invokeHostFunction({func:swapOp.func,auth:[]})).build();const record=await server.simulateTransaction(recordInput,undefined,'record');if(!rpc.Api.isSimulationSuccess(record)||!record.result||record.result.auth.length!==1||record.result.auth[0]!.toXDR('base64')!==swapOp.auth?.[0]?.toXDR('base64')||record.transactionData.build().resources().footprint().toXDR('base64')!==narrowed.toEnvelope().v1().tx().ext().sorobanData().resources().footprint().toXDR('base64'))throw Error('QA auth-free record clone changed approved auth or footprint');const tx=reconstructSwapResources(narrowed,record,intent.expiresAt);inspectSwapTransaction(tx,intent,registry);const enforce=await server.simulateTransaction(tx,undefined,'enforce');assertSwapCoverage(tx,enforce);inspectSwapTransaction(tx,intent,registry);
 const row=await submitOnce(tx,'qa_owned_xlm_to_usdc_interest_buffer',before,async signed=>{if(!ownKey?.verify(signed.hash(),signed.signatures[0]!.signature()))throw Error('Own swap signature invalid');const unsigned=TransactionBuilder.fromXDR(tx.toXDR(),NETWORK_PASSPHRASE) as Transaction;unsigned.signatures.length=0;inspectSwapTransaction(unsigned,intent,registry);const sim=await server.simulateTransaction(signed,undefined,'enforce');assertSwapCoverage(unsigned,sim);},{quote:{amount:quote.amount_in,expected_out:quote.expected_out,minimum_receive:quote.min_receive,slippage_bps:quote.slippage_bps},record_enforce_simulations:true,qa_owned_assets_only:true});
 const spent=atomic(row.before.wallet.native)-atomic(row.after.wallet.native)-BigInt(row.actual_fee_metadata_stroops),received=atomic(row.after.wallet.usdc)-atomic(row.before.wallet.usdc??'0');if(spent!==2000000n||received<BigInt(quote.min_out_atomic))throw Error('Actual QA swap balance proof mismatch');row.verification={verified:true,input_atomic:spent.toString(),output_atomic:received.toString(),minimum_atomic:quote.min_out_atomic};await persist();
}
async function runStep(name:string,fn:()=>Promise<unknown>):Promise<void>{
 for(;;){const startCount=report.transactions.length;try{await fn();delete report.paused;await persist();return;}catch(error){
  report.paused={step:name,name:(error as any)?.name??'Error',code:(error as any)?.code??null,message:String((error as any)?.message??error).slice(0,1500),observed_at:new Date().toISOString(),writes_paused:true,qa_key_retained_only_in_running_memory:true,new_hashes:report.transactions.slice(startCount).map((t:any)=>({hash:t.tx_hash,status:t.status,verified:t.verification?.verified??false}))};await persist();console.log(json({paused:report.paused,qa_account:own,allowed_commands:'ROOT_RETRY_REVIEWED (pre-send only), ROOT_CONTINUE_VERIFIED (already verified success only), ABORT'}));
  const lines=createInterface({input:process.stdin,crlfDelay:Infinity});let retry=false;
  for await(const line of lines){
   const command=line.trim();
   if(command==='ABORT'){lines.close();throw Error('QA halted by lead; no more writes');}
   const progress=report.transactions.slice(startCount),verifiedProgress=progress.length>0&&progress.every((t:any)=>t.status==='SUCCESS'&&t.verification?.verified===true);
   if(command==='ROOT_CONTINUE_VERIFIED'&&verifiedProgress){report.paused.root_reviewed_continue=true;await persist();lines.close();return;}
   if(command==='ROOT_RETRY_REVIEWED'&&(progress.length===0||name.startsWith('repay_')&&verifiedProgress)){report.paused.root_reviewed_retry=true;await persist();retry=true;break;}
   console.log('Command rejected: writes remain paused; recorded hashes must be reconciled without blind re-send.');
  }
  lines.close();if(!retry)throw Error('QA control input closed; no more writes');

 }}
}
async function repayAsset(reserve:string){
 const code=reserve===BORROW_XLM_RESERVE?'XLM':'USDC';
 while(report.transactions.filter((t:any)=>t.action===`repay:${code}`).length<2){const current=(await borrow.positionsWallet(own)).find(p=>p.reserve_contract_id===reserve)!;if(borrowReadAtomic(current.borrowed)===0n)return;await blendAction('repay',reserve,current.borrowed);}
 if((await borrow.positionsWallet(own)).some(p=>p.reserve_contract_id===reserve&&borrowReadAtomic(p.borrowed)>0n))throw Error('Debt remains after bounded repayments; stop rather than resubmit blindly');
}
async function main(){
 const prior=await Promise.all(['borrow-live-qa-attempt1.json','borrow-live-qa-attempt2.json','borrow-live-qa-attempt3.json'].map(async name=>JSON.parse(await readFile(new URL(name,import.meta.url),'utf8'))));
 report.prior_transactions=prior.flatMap(value=>value.transactions.map((t:any)=>({action:t.action,tx_hash:t.tx_hash,status:t.status})));
 if(report.prior_transactions.length!==8||19-report.prior_transactions.length<11)throw Error('Unexpected lead-approved cumulative transaction allocation');
 const priorCollateral=prior.flatMap(value=>value.transactions).filter((t:any)=>t.action==='collateral_supply:XLM').reduce((sum:bigint,t:any)=>sum+toAtomic(t.prepared_summary.amount,7),0n),priorSwap=prior.flatMap(value=>value.transactions).filter((t:any)=>t.action==='qa_owned_xlm_to_usdc_interest_buffer').reduce((sum:bigint,t:any)=>sum+toAtomic(t.quote.amount,7),0n);
 if(priorCollateral+5000000n>105000000n||priorSwap+2000000n>22000000n)throw Error('Cumulative collateral or swap allocation exhausted');
 await persist();if((await server.getNetwork()).passphrase!==NETWORK_PASSPHRASE)throw Error('Official network mismatch');await borrow.verifyRegistry();await verifyHistoricalFeeSemantics();
 await runStep('friendbot_activation',async()=>{
  if(report.friendbot_request_sent)throw Error('Friendbot was already requested; reconcile without retrying');report.friendbot_request_sent=true;await persist();
  const activate=await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(own)}`,{redirect:'error',signal:AbortSignal.timeout(30000)});if(!activate.ok)throw Error(`Friendbot activation failed ${activate.status}`);const activation=await activate.json()as{hash?:string};if(!activation.hash||!/^[a-f0-9]{64}$/.test(activation.hash))throw Error('Friendbot did not return actual hash');report.transactions.push({action:'qa_friendbot_activation',tx_hash:activation.hash,status:'friendbot_reported',signer:'Stellar_Friendbot_NOT_customer_or_treasury'});await persist();
 });
 await runStep('initial_snapshot',async()=>{for(let i=0;i<20;i++){try{await horizon.loadAccount(own);break;}catch{await sleep(500);}}report.initial=await state();await persist();});
 await runStep('classic_trustline',classicTrustline);await runStep('swap_buffer',swapBuffer);
 await runStep('collateral_supply',()=>blendAction('collateral_supply',BORROW_XLM_RESERVE,'0.5000000'));
 await runStep('borrow_usdc',()=>blendAction('borrow',BORROW_USDC_RESERVE,'0.0100000'));
 await runStep('borrow_xlm',()=>blendAction('borrow',BORROW_XLM_RESERVE,'0.1000000'));
 await runStep('repay_usdc',()=>repayAsset(BORROW_USDC_RESERVE));await runStep('repay_xlm',()=>repayAsset(BORROW_XLM_RESERVE));
 await runStep('collateral_withdraw',()=>blendAction('collateral_withdraw',BORROW_XLM_RESERVE,'0.5000000'));
 await runStep('final_verification',async()=>{report.final=await state();if(report.final.positions.some((p:any)=>p.debt_tokens!=='0'))throw Error('Final actual QA debt is nonzero');if(report.transactions.some((t:any)=>t.action!=='qa_friendbot_activation'&&(!t.verification?.verified||t.status!=='SUCCESS')))throw Error('A financial step lacks verified chain evidence');report.complete=true;report.completed_at=new Date().toISOString();await persist();console.log(json({complete:true,signer:label,qa_account:own,transactions:report.transactions.map((t:any)=>({action:t.action,tx_hash:t.tx_hash,status:t.status})),final:report.final}));});
}
main().catch(async error=>{report.error={name:error?.name??'Error',code:error?.code??null,message:String(error?.message??error).slice(0,1500),observed_at:new Date().toISOString()};await persist();console.log(json({complete:false,qa_account:own,error:report.error,transactions:report.transactions.map((t:any)=>({action:t.action,tx_hash:t.tx_hash,status:t.status}))}));process.exitCode=1;}).finally(()=>{ownKey=undefined;});
