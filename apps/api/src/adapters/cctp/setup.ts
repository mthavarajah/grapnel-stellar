import {Account,Address,Asset,Contract,Operation,StrKey,TransactionBuilder,rpc,scValToNative,xdr} from '@stellar/stellar-sdk';
import {GrapnelError,NETWORK,NETWORK_PASSPHRASE,PreparedActionSchema,fromAtomic,toAtomic,type CustomerContext,type PreparedAction} from '@grapnel/contracts';
import {CCTP_TESTNET as P} from './registry.js';
import {readStellarRegistry} from './reader.js';
import {CIRCLE_USDC_ASSET_ID,CIRCLE_USDC_TRUSTLINE_ACTION,CIRCLE_USDC_ALLOWANCE_ACTION,CIRCLE_USDC_TRUSTLINE_LIMIT,CIRCLE_USDC_ALLOWANCE_LEDGER_WINDOW,CIRCLE_USDC_MAX_SETUP_FEE,buildCircleAllowanceOperation,inspectCircleSetupOperation,inspectCircleSetupPrepared,inspectCircleAllowanceFootprint} from './setup-inspection.js';
export interface CircleSetupRequest {operationId:string;customer:CustomerContext;expiresAt:string;}
export interface CircleAllowanceRequest extends CircleSetupRequest{amountStellarAtomic:string;maxFeeStroops:string;}
export interface CircleUsdcSetupStatus {
 network:'stellar-testnet';business_id:string;customer_id:string;wallet_id:string;wallet_address:string;asset_id:string;issuer:string;contract_id:string;decimals:7;
 trustline_exists:boolean;trustline_limit:string|null;trustline_authorized:boolean|null;wallet_amount:string|null;spendable_before_reservations:string|null;
 allowance_amount:string|null;allowance_atomic:string|null;allowance_read_available:boolean;source_sequence:string;as_of_ledger:number;as_of:string;
 native_spendable_before_reservations:string;base_reserve_stroops:string;additional_reserve_stroops:string;faucet_url:'https://faucet.circle.com/';
}
export interface CircleUsdcSetupDependencies {
 server?:Pick<rpc.Server,'getNetwork'|'getAccount'|'getLatestLedger'|'simulateTransaction'>;fetcher?:typeof fetch;now?:()=>number;
 /** Root injects the current reservation-adjusted native available balance for this exact tenant/wallet. */
 readSpendableXlm?:(customer:CustomerContext,operationId:string)=>Promise<bigint>;
 verifyRegistry?:()=>Promise<unknown>;
 readStatus?:(customer:CustomerContext)=>Promise<CircleUsdcSetupStatus>;
}
const fail=(reason:string):never=>{throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Circle USDC setup needs a fresh wallet check',false,{reason});};
const insufficient=():never=>{throw new GrapnelError(409,'INSUFFICIENT_BALANCE','Your available XLM must cover this setup fee and any additional account reserve');};
const unsigned=(value:unknown):bigint=>{if(typeof value!=='string'||!/^\d{1,20}$/.test(value))return fail('CCTP_SETUP_INVALID_ACCOUNT');return BigInt(value);};
function customerValid(c:CustomerContext):void {
 if(!c||!c.businessId||!c.customerId||!c.walletId||!c.privyUserId||!StrKey.isValidEd25519PublicKey(c.walletAddress))fail('CCTP_SETUP_CUSTOMER_REQUIRED');
}
function requestValid(input:CircleSetupRequest,now:number):CircleSetupRequest{
 customerValid(input.customer);if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.operationId))fail('CCTP_SETUP_OPERATION_REQUIRED');
 const expiry=Date.parse(input.expiresAt);if(!Number.isFinite(expiry)||expiry<=now||expiry>now+120000)fail('CCTP_SETUP_EXPIRED');
 return {...input,customer:{...input.customer},expiresAt:new Date(Math.floor(expiry/1000)*1000).toISOString()};
}
async function responseJson(response:Response):Promise<any>{
 if(!response.ok||!response.body)fail('CCTP_SETUP_READ_UNAVAILABLE');const reader=response.body!.getReader();let size=0;const chunks:Uint8Array[]=[];
 try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>262144)fail('CCTP_SETUP_RESPONSE_TOO_LARGE');chunks.push(next.value);}}finally{await reader.cancel();}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
/** Customer context must come from root's verified tenant/customer/wallet lookup, never browser IDs. */
export class CctpUsdcSetupPreparer {
 private server:NonNullable<CircleUsdcSetupDependencies['server']>;private fetcher:typeof fetch;private now:()=>number;
 constructor(private deps:CircleUsdcSetupDependencies={}){this.server=deps.server??new rpc.Server(P.stellar.rpc,{timeout:15});this.fetcher=deps.fetcher??fetch;this.now=deps.now??Date.now;}
 private async network(){if((await this.server.getNetwork()).passphrase!==NETWORK_PASSPHRASE)fail('CCTP_SETUP_NETWORK_MISMATCH');}
 async readStatus(customer:CustomerContext):Promise<CircleUsdcSetupStatus>{
  customerValid(customer);await this.network();const started=this.now();
  const [account,ledgerPage,latest]=await Promise.all([
   this.fetcher(`https://horizon-testnet.stellar.org/accounts/${customer.walletAddress}`,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000)}).then(responseJson),
   this.fetcher('https://horizon-testnet.stellar.org/ledgers?order=desc&limit=1',{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000)}).then(responseJson),
   this.server.getLatestLedger(),
  ]);
  const ledger=ledgerPage?._embedded?.records?.[0];
  if(account?.account_id!==customer.walletAddress||!Array.isArray(account.balances)||account.balances.length>1000||!ledger||!Number.isSafeInteger(ledger.sequence)||!Number.isSafeInteger(latest.sequence)||Math.abs(ledger.sequence-latest.sequence)>12)fail('CCTP_SETUP_INVALID_ACCOUNT');
  const sourceSequence=String(account.sequence);if(unsigned(sourceSequence)>9223372036854775806n)fail('CCTP_SETUP_INVALID_ACCOUNT');
  const baseReserve=unsigned(String(ledger.base_reserve_in_stroops));if(baseReserve!==5000000n||unsigned(String(ledger.base_fee_in_stroops))!==100n)fail('CCTP_SETUP_RESERVE_OR_FEE_CHANGED');
  const count=(v:unknown)=>{if(!Number.isSafeInteger(v)||Number(v)<0||Number(v)>10000)fail('CCTP_SETUP_INVALID_ACCOUNT');return BigInt(Number(v));};
  const reserveUnits=2n+count(account.subentry_count)+count(account.num_sponsoring??0)-count(account.num_sponsored??0);if(reserveUnits<0n)fail('CCTP_SETUP_INVALID_ACCOUNT');
  const native=account.balances.find((b:any)=>b.asset_type==='native'),trustline=account.balances.find((b:any)=>b.asset_type==='credit_alphanum4'&&b.asset_code==='USDC'&&b.asset_issuer===P.stellar.issuer);
  if(!native)fail('CCTP_SETUP_NATIVE_BALANCE_UNAVAILABLE');
  const amount=(value:unknown)=>{if(typeof value!=='string')return fail('CCTP_SETUP_INVALID_BALANCE');if(/^0(?:\.0+)?$/.test(value))return 0n;try{return toAtomic(value,7);}catch{return fail('CCTP_SETUP_INVALID_BALANCE');}};
  const nativeFree=amount(native.balance)-amount(native.selling_liabilities??'0')-reserveUnits*baseReserve;
  let walletAmount:string|null=null,freeAmount:string|null=null,trustlineLimit:string|null=null;
  if(trustline){const balance=amount(trustline.balance),free=balance-amount(trustline.selling_liabilities??'0');walletAmount=fromAtomic(balance,7);freeAmount=fromAtomic(free<0n?0n:free,7);trustlineLimit=fromAtomic(amount(trustline.limit),7);}
  const source=await this.server.getAccount(customer.walletAddress),tx=new TransactionBuilder(new Account(source.accountId(),source.sequenceNumber()),{fee:'100',networkPassphrase:NETWORK_PASSPHRASE}).addOperation(new Contract(P.stellar.usdc).call('allowance',new Address(customer.walletAddress).toScVal(),new Address(P.stellar.messenger).toScVal())).setTimeout(90).build();
  const sim=await this.server.simulateTransaction(tx,undefined,'record');let allowance:bigint|null=null;
  if(rpc.Api.isSimulationSuccess(sim)&&!rpc.Api.isSimulationRestore(sim)&&sim.result&&sim.result.auth.length===0&&sim.result.retval.switch().name==='scvI128'&&sim.transactionData.build().resources().footprint().readWrite().length===0){const value:unknown=scValToNative(sim.result.retval);if(typeof value==='bigint'&&value>=0n)allowance=value;}
  if(this.now()-started>30000)fail('CCTP_SETUP_READ_EXPIRED');
  return {network:'stellar-testnet',business_id:customer.businessId,customer_id:customer.customerId,wallet_id:customer.walletId,wallet_address:customer.walletAddress,asset_id:CIRCLE_USDC_ASSET_ID,issuer:P.stellar.issuer,contract_id:P.stellar.usdc,decimals:7,trustline_exists:!!trustline,trustline_limit:trustlineLimit,trustline_authorized:trustline?typeof trustline.is_authorized==='boolean'?trustline.is_authorized:null:null,wallet_amount:walletAmount,spendable_before_reservations:freeAmount,allowance_amount:allowance===null?null:fromAtomic(allowance,7),allowance_atomic:allowance?.toString()??null,allowance_read_available:allowance!==null,source_sequence:sourceSequence,as_of_ledger:latest.sequence,as_of:new Date(this.now()).toISOString(),native_spendable_before_reservations:fromAtomic(nativeFree<0n?0n:nativeFree,7),base_reserve_stroops:baseReserve.toString(),additional_reserve_stroops:trustline?'0':baseReserve.toString(),faucet_url:'https://faucet.circle.com/'};
 }
 private async status(customer:CustomerContext){const s=await(this.deps.readStatus?this.deps.readStatus({...customer}):this.readStatus(customer));const age=this.now()-Date.parse(s.as_of);if(s.network!=='stellar-testnet'||s.business_id!==customer.businessId||s.customer_id!==customer.customerId||s.wallet_id!==customer.walletId||s.wallet_address!==customer.walletAddress||s.asset_id!==CIRCLE_USDC_ASSET_ID||s.issuer!==P.stellar.issuer||s.contract_id!==P.stellar.usdc||s.decimals!==7||!Number.isFinite(age)||age<0||age>30000||!Number.isSafeInteger(s.as_of_ledger)||s.as_of_ledger<=0)fail('CCTP_SETUP_STALE_OR_MISMATCHED_STATUS');return s;}
 private async spendable(customer:CustomerContext,operationId:string,required:bigint){const value=await this.deps.readSpendableXlm?.({...customer},operationId);if(typeof value!=='bigint')return fail('CCTP_SETUP_SPENDABLE_CALLBACK_REQUIRED');if(value<required)insufficient();}
 async prepareTrustline(input:CircleSetupRequest):Promise<PreparedAction>{
  const request=requestValid(input,this.now());await this.network();await(this.deps.verifyRegistry??readStellarRegistry)();const status=await this.status(request.customer);
  if(status.trustline_exists)fail('CCTP_SETUP_TRUSTLINE_ALREADY_EXISTS');
  if(status.additional_reserve_stroops!=='5000000'||status.base_reserve_stroops!=='5000000')fail('CCTP_SETUP_RESERVE_CHANGED');
  await this.spendable(request.customer,request.operationId,5000100n);
  const account=await this.server.getAccount(request.customer.walletAddress),sequence=BigInt(account.sequenceNumber())+1n;
  const tx=new TransactionBuilder(account,{fee:'100',networkPassphrase:NETWORK_PASSPHRASE,timebounds:{minTime:0,maxTime:Date.parse(request.expiresAt)/1000}}).addOperation(Operation.changeTrust({asset:new Asset('USDC',P.stellar.issuer),limit:CIRCLE_USDC_TRUSTLINE_LIMIT})).build();
  const action=PreparedActionSchema.parse({operationId:request.operationId,customerId:request.customer.customerId,network:NETWORK,walletAddress:request.customer.walletAddress,unsignedXdr:tx.toXDR(),signingHashHex:tx.hash().toString('hex'),summary:{action:CIRCLE_USDC_TRUSTLINE_ACTION,fromAssetId:CIRCLE_USDC_ASSET_ID,amount:CIRCLE_USDC_TRUSTLINE_LIMIT,recipient:request.customer.walletAddress,maxFeeStroops:'100',expiresAt:request.expiresAt},authorization:{method:'privy_stellar',expiresAt:request.expiresAt}});
  inspectCircleSetupPrepared(action,tx,{customerId:request.customer.customerId,walletAddress:request.customer.walletAddress,expectedSequence:sequence,now:this.now()});
  if(BigInt((await this.server.getAccount(request.customer.walletAddress)).sequenceNumber())+1n!==sequence)fail('CCTP_SETUP_SEQUENCE_CHANGED');return action;
 }
 async prepareAllowance(input:CircleAllowanceRequest):Promise<PreparedAction>{
  const request={...requestValid(input,this.now()),amountStellarAtomic:input.amountStellarAtomic,maxFeeStroops:input.maxFeeStroops};
  if(!/^[1-9]\d{0,10}$/.test(request.amountStellarAtomic))fail('CCTP_SETUP_ALLOWANCE_AMOUNT_INVALID');const amount=BigInt(request.amountStellarAtomic);if(amount>10000000000n||amount%10n)fail('CCTP_SETUP_ALLOWANCE_AMOUNT_INVALID');
  if(!/^[1-9]\d{0,7}$/.test(request.maxFeeStroops))fail('CCTP_SETUP_FEE_INVALID');const ceiling=BigInt(request.maxFeeStroops);if(ceiling<=100n||ceiling>CIRCLE_USDC_MAX_SETUP_FEE)fail('CCTP_SETUP_FEE_INVALID');
  await this.network();await(this.deps.verifyRegistry??readStellarRegistry)();const status=await this.status(request.customer);
  if(!status.trustline_exists||status.trustline_authorized!==true)fail('CCTP_CIRCLE_USDC_TRUSTLINE_REQUIRED');
  if(status.spendable_before_reservations===null||!positiveEnough(status.spendable_before_reservations,amount))fail('CCTP_CIRCLE_USDC_BALANCE_REQUIRED');
  const latest=await this.server.getLatestLedger();if(!Number.isSafeInteger(latest.sequence)||latest.sequence<status.as_of_ledger||latest.sequence>status.as_of_ledger+12||latest.sequence>4294967295-CIRCLE_USDC_ALLOWANCE_LEDGER_WINDOW)fail('CCTP_SETUP_LEDGER_CHANGED');
  const expirationLedger=latest.sequence+CIRCLE_USDC_ALLOWANCE_LEDGER_WINDOW,source=await this.server.getAccount(request.customer.walletAddress),sequence=BigInt(source.sequenceNumber())+1n;
  const tx=new TransactionBuilder(source,{fee:'100',networkPassphrase:NETWORK_PASSPHRASE,timebounds:{minTime:0,maxTime:Date.parse(request.expiresAt)/1000}}).addOperation(buildCircleAllowanceOperation(request.customer.walletAddress,amount,expirationLedger)).build();
  const summary={action:CIRCLE_USDC_ALLOWANCE_ACTION,fromAssetId:CIRCLE_USDC_ASSET_ID,amount:fromAtomic(amount,7),recipient:P.stellar.messenger,contractId:P.stellar.usdc,maxFeeStroops:ceiling.toString(),allowanceExpirationLedger:String(expirationLedger),expiresAt:request.expiresAt};
  const template:PreparedAction={operationId:request.operationId,customerId:request.customer.customerId,network:NETWORK,walletAddress:request.customer.walletAddress,unsignedXdr:tx.toXDR(),signingHashHex:tx.hash().toString('hex'),summary,authorization:{method:'privy_stellar',expiresAt:request.expiresAt}};
  const successful=(sim:rpc.Api.SimulateTransactionResponse)=>{if(!rpc.Api.isSimulationSuccess(sim)||rpc.Api.isSimulationRestore(sim)||!sim.result||sim.result.retval.switch().name!=='scvVoid'||!/^[0-9]{1,12}$/.test(sim.minResourceFee)||BigInt(sim.minResourceFee)<=0n||BigInt(sim.minResourceFee)+100n>ceiling) return fail('CCTP_SETUP_ALLOWANCE_SIMULATION_FAILED');const op=tx.operations[0];if(op?.type!=='invokeHostFunction')return fail('CCTP_SETUP_OPERATION_INVALID');inspectCircleSetupOperation(template,{...op,auth:sim.result.auth},latest.sequence);inspectCircleAllowanceFootprint(sim.transactionData.build(),request.customer.walletAddress,ceiling);return sim;};
  const recorded=successful(await this.server.simulateTransaction(tx,{cpuInstructions:500000},'record')),data=recorded.transactionData.build(),resources=data.resources();resources.instructions(Math.ceil(resources.instructions()*1.1));resources.diskReadBytes(Math.ceil(resources.diskReadBytes()*1.1));resources.writeBytes(Math.ceil(resources.writeBytes()*1.1));data.resources(resources);data.resourceFee(xdr.Int64.fromString(((BigInt(recorded.minResourceFee)*110n+99n)/100n).toString()));
  const op=tx.operations[0];if(op?.type!=='invokeHostFunction')return fail('CCTP_SETUP_OPERATION_INVALID');const prepared=TransactionBuilder.cloneFrom(tx,{fee:'100',networkPassphrase:NETWORK_PASSPHRASE,sorobanData:data}).clearOperations().addOperation(Operation.invokeHostFunction({func:op.func,auth:recorded.result!.auth})).build();
  await this.spendable(request.customer,request.operationId,BigInt(prepared.fee));
  const action=PreparedActionSchema.parse({...template,unsignedXdr:prepared.toXDR(),signingHashHex:prepared.hash().toString('hex'),summary:{...summary,maxFeeStroops:prepared.fee}});
  inspectCircleSetupPrepared(action,prepared,{customerId:request.customer.customerId,walletAddress:request.customer.walletAddress,expectedSequence:sequence,currentLedger:latest.sequence,now:this.now()});
  const enforced=successful(await this.server.simulateTransaction(prepared,undefined,'enforce')),fresh=enforced.transactionData.build().resources(),approved=prepared.toEnvelope().v1().tx().ext().sorobanData().resources();
  if(fresh.footprint().toXDR('base64')!==approved.footprint().toXDR('base64')||fresh.instructions()>approved.instructions()||fresh.diskReadBytes()>approved.diskReadBytes()||fresh.writeBytes()>approved.writeBytes()||BigInt(enforced.minResourceFee)+100n>BigInt(prepared.fee)||recorded.result!.auth.map(a=>a.toXDR('base64')).join(':')!==enforced.result!.auth.map(a=>a.toXDR('base64')).join(':'))fail('CCTP_SETUP_FRESH_SCOPE_CHANGED');
  const finalLedger=await this.server.getLatestLedger();if(finalLedger.sequence>=expirationLedger||finalLedger.sequence<latest.sequence||BigInt((await this.server.getAccount(request.customer.walletAddress)).sequenceNumber())+1n!==sequence||this.now()>=Date.parse(request.expiresAt))fail('CCTP_SETUP_APPROVAL_CHANGED');return action;
 }
}
function positiveEnough(value:string,amount:bigint):boolean{try{return toAtomic(value,7)>=amount;}catch{return false;}}
