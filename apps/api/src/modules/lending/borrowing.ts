import {Address,Asset,StrKey,scValToNative,xdr} from '@stellar/stellar-sdk';
import {z} from 'zod';
import {AmountSchema,GrapnelError,NETWORK_PASSPHRASE,XLM,fromAtomic,toAtomic,type CustomerContext,type PreparedAction,type WalletBalance} from '@grapnel/contracts';
import {BLEND_USDC_ASSET_ID,BLEND_USDC_ISSUER} from '../../adapters/blend/usdc-inspector.js';

export const BORROW_POOL_ID='CB3447A446DY3USGWPIDXTNQHF5EX24XDQA2EN6TAZP62JTPBTNOA52Q';
const XLM_RESERVE=Asset.native().contractId(NETWORK_PASSPHRASE);
const USDC_RESERVE=new Asset('USDC',BLEND_USDC_ISSUER).contractId(NETWORK_PASSPHRASE);
export type BorrowingAction='borrow'|'repay'|'collateral_supply'|'collateral_withdraw';
export interface BorrowingPosition {
 market_id:string;asset_id:string;pool_contract_id:string;reserve_contract_id:string;
 borrowed:string;collateral:string;supplied?:string;as_of:string;as_of_ledger:number;
 debt_tokens?:string;collateral_tokens?:string;debt_rate?:string;collateral_rate?:string;rate_decimals?:number;reserve_index?:number;
}
export interface BorrowingAdapter {
 read(customer:CustomerContext):Promise<unknown>;
 positions(customer:CustomerContext):Promise<BorrowingPosition[]>;
 prepare(action:'borrow'|'repay',input:{operationId:string;marketId:string;assetId:string;amount:string},customer:CustomerContext):Promise<PreparedAction>;
 prepareCollateral?(action:'supply'|'withdraw',input:{operationId:string;marketId:string;assetId:string;amount:string},customer:CustomerContext):Promise<PreparedAction>;
}
const uint=z.string().regex(/^(0|[1-9]\d{0,38})$/).refine(value=>BigInt(value)<(1n<<127n));
const positive=uint.refine(value=>BigInt(value)>0n);
const decimals=z.number().int().min(0).max(38);
const reserveFor=(asset:string)=>asset===XLM.id?XLM_RESERVE:asset===BLEND_USDC_ASSET_ID?USDC_RESERVE:null;
const amountAtomic=(value:string)=>/^0(?:\.0+)?$/.test(value)?0n:toAtomic(value,7);
export const BorrowBaselineSchema=z.object({
 asset_id:z.enum([XLM.id,BLEND_USDC_ASSET_ID]),market_id:z.string().min(1),pool_contract_id:z.literal(BORROW_POOL_ID),
 reserve_contract_id:z.string(),wallet_address:z.string().refine(StrKey.isValidEd25519PublicKey),wallet_amount:AmountSchema,native_wallet_amount:AmountSchema,native_as_of:z.string().datetime(),
 borrowed:AmountSchema,collateral:AmountSchema,debt_tokens:uint,collateral_tokens:uint,debt_rate:positive,collateral_rate:positive,
 rate_decimals:z.literal(12),reserve_index:z.number().int().min(0).max(31),as_of:z.string().datetime(),position_as_of:z.string().datetime(),position_ledger:z.number().int().positive(),
}).strict().superRefine((value,ctx)=>{
 if(value.reserve_contract_id!==reserveFor(value.asset_id)||value.market_id!==`stellar-testnet:blend:${BORROW_POOL_ID}:${value.reserve_contract_id}`)
  ctx.addIssue({code:z.ZodIssueCode.custom,message:'Borrow baseline must match the exact reviewed pool and reserve'});
});
export type BorrowBaseline=z.infer<typeof BorrowBaselineSchema>;
export function borrowingReservationPlan(action:BorrowingAction,assetId:string,amount:string,feeStroops:string):{assetId:string;amountAtomic:bigint}[]{
 if(!['borrow','repay','collateral_supply','collateral_withdraw'].includes(action))throw new GrapnelError(422,'INVALID_ACTION','Unknown borrowing action');
 if(!reserveFor(assetId))throw new GrapnelError(422,'ASSET_MISMATCH','Only the reviewed XLM and USDC borrowing reserves are supported');
 if(!/^[1-9]\d{0,11}$/.test(feeStroops)||BigInt(feeStroops)>10_000_000n)throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','A bounded reviewed Soroban fee is required');
 const principal=toAtomic(amount,7),fee=BigInt(feeStroops),spends=action==='repay'||action==='collateral_supply';
 if(assetId===XLM.id)return [{assetId:XLM.id,amountAtomic:fee+(spends?principal:0n)}];
 return [...(spends?[{assetId,amountAtomic:principal}]:[]),{assetId:XLM.id,amountAtomic:fee}];
}
export function createBorrowBaseline(position:BorrowingPosition,balances:WalletBalance[],walletAddress:string,now=Date.now()):BorrowBaseline{
 const selected=balances.filter(x=>x.asset_id===position.asset_id&&x.source==='stellar_horizon_testnet'),native=balances.filter(x=>x.asset_id===XLM.id&&x.source==='stellar_horizon_testnet');
 if(selected.length!==1||native.length!==1)throw new GrapnelError(409,'BALANCE_UNAVAILABLE','Confirmed exact wallet balances are required');
 const balance=selected[0]!,nativeBalance=native[0]!;
 const parsed=BorrowBaselineSchema.safeParse({asset_id:position.asset_id,market_id:position.market_id,pool_contract_id:position.pool_contract_id,reserve_contract_id:position.reserve_contract_id,wallet_address:walletAddress,wallet_amount:balance.wallet_amount,native_wallet_amount:nativeBalance.wallet_amount,native_as_of:nativeBalance.as_of,
 borrowed:position.borrowed,collateral:position.collateral,debt_tokens:position.debt_tokens,collateral_tokens:position.collateral_tokens,debt_rate:position.debt_rate,collateral_rate:position.collateral_rate,rate_decimals:position.rate_decimals,reserve_index:position.reserve_index,
 as_of:balance.as_of,position_as_of:position.as_of,position_ledger:position.as_of_ledger});
 if(!parsed.success)throw new GrapnelError(409,'POSITION_BASELINE_UNAVAILABLE','Exact verified borrowing position metadata is required');
 const baseline=parsed.data;
 if(balance.asset_id!==position.asset_id||balance.source!=='stellar_horizon_testnet'||!fresh(balance.as_of,15000,now)||!fresh(nativeBalance.as_of,15000,now)||!fresh(position.as_of,30000,now))
  throw new GrapnelError(409,'POSITION_BASELINE_UNAVAILABLE','Fresh verified wallet and borrowing positions are required');
 return baseline;
}
const fresh=(at:string,maxAge:number,now:number)=>Number.isFinite(Date.parse(at))&&Date.parse(at)<=now+1000&&now-Date.parse(at)<=maxAge;
const ceil=(n:bigint,d:bigint)=>(n+d-1n)/d;

export interface BorrowTransactionEvidence {
 tx_hash:string;confirmed_ledger:number;pool_contract_id:string;reserve_contract_id:string;wallet_address:string;reserve_index:number;
 debt_tokens_before:string;debt_tokens_after:string;collateral_tokens_before:string;collateral_tokens_after:string;debt_rate:string;collateral_rate:string;
 other_positions_unchanged:boolean;
}
const evidenceSchema=z.object({tx_hash:z.string().regex(/^[a-f0-9]{64}$/),confirmed_ledger:z.number().int().positive(),pool_contract_id:z.literal(BORROW_POOL_ID),reserve_contract_id:z.string(),wallet_address:z.string(),reserve_index:z.number().int().min(0).max(31),debt_tokens_before:uint,debt_tokens_after:uint,collateral_tokens_before:uint,collateral_tokens_after:uint,debt_rate:positive,collateral_rate:positive,other_positions_unchanged:z.literal(true)}).strict();
export interface BorrowDeltaInput {
 action:BorrowingAction;baseline:unknown;request:{asset_id?:unknown;market_id?:unknown;amount?:unknown};walletAddress:string;
 positions:BorrowingPosition[];balances:WalletBalance[];confirmedLedger:number;txHash:string;feeStroops:string;transactionEvidence:unknown;now?:number;
}
/** Requires exact SUCCESS transaction metadata, not just a later positive position delta. */
export function inspectBorrowingDeltas(input:BorrowDeltaInput):{verified:boolean;result:{blend_borrowing_verification:Record<string,unknown>}}{
 const now=input.now??Date.now(),reject=(reason:string)=>({verified:false,result:{blend_borrowing_verification:{verified:false,reason,observed_at:new Date(now).toISOString()}}});
 try{
  const b=BorrowBaselineSchema.parse(input.baseline),e=evidenceSchema.parse(input.transactionEvidence);
  if(!['borrow','repay','collateral_supply','collateral_withdraw'].includes(input.action)||input.request.asset_id!==b.asset_id||input.request.market_id!==b.market_id||typeof input.request.amount!=='string'||b.wallet_address!==input.walletAddress
    ||!Number.isSafeInteger(input.confirmedLedger)||input.confirmedLedger<b.position_ledger||e.confirmed_ledger!==input.confirmedLedger||e.tx_hash!==input.txHash
    ||e.pool_contract_id!==b.pool_contract_id||e.reserve_contract_id!==b.reserve_contract_id||e.wallet_address!==b.wallet_address||e.reserve_index!==b.reserve_index
    ||e.debt_tokens_before!==b.debt_tokens||e.collateral_tokens_before!==b.collateral_tokens||!/^[0-9]{1,12}$/.test(input.feeStroops)||BigInt(input.feeStroops)<=0n||BigInt(input.feeStroops)>10_000_000n)
   return reject('BORROW_BASELINE_OR_TRANSACTION_MISMATCH');
  const positions=input.positions.filter(p=>p.market_id===b.market_id&&p.asset_id===b.asset_id&&p.pool_contract_id===b.pool_contract_id&&p.reserve_contract_id===b.reserve_contract_id);
  const balances=input.balances.filter(x=>x.asset_id===b.asset_id&&x.source==='stellar_horizon_testnet');
  if(positions.length!==1||balances.length!==1)return reject('POST_CHAIN_OBSERVATION_UNAVAILABLE');
  const p=positions[0]!,balance=balances[0]!;
  const nativeBalances=input.balances.filter(x=>x.asset_id===XLM.id&&x.source==='stellar_horizon_testnet');
  if(nativeBalances.length!==1)return reject('POST_CHAIN_FEE_OBSERVATION_UNAVAILABLE');
  const nativeBalance=nativeBalances[0]!;
  if(!fresh(nativeBalance.as_of,15000,now)||Date.parse(nativeBalance.as_of)<Date.parse(b.native_as_of)||(b.asset_id!==XLM.id&&amountAtomic(nativeBalance.wallet_amount)-amountAtomic(b.native_wallet_amount)!==-BigInt(input.feeStroops)))return reject('POST_CHAIN_FEE_MOVEMENT_MISMATCH');
  if(!fresh(p.as_of,30000,now)||!fresh(balance.as_of,15000,now)||Date.parse(p.as_of)<Date.parse(b.position_as_of)||Date.parse(balance.as_of)<Date.parse(b.as_of)
   ||!Number.isSafeInteger(p.as_of_ledger)||p.as_of_ledger<input.confirmedLedger||p.debt_tokens!==e.debt_tokens_after||p.collateral_tokens!==e.collateral_tokens_after||p.rate_decimals!==b.rate_decimals||p.reserve_index!==b.reserve_index)
   return reject('POST_CHAIN_POSITION_OR_TIME_MISMATCH');
  const requested=toAtomic(input.request.amount,7),scale=10n**BigInt(b.rate_decimals),debtRate=BigInt(e.debt_rate),supplyRate=BigInt(e.collateral_rate);
  if(debtRate<BigInt(b.debt_rate)||supplyRate<BigInt(b.collateral_rate))return reject('EXECUTION_RATE_REGRESSED');
  const debtBefore=ceil(BigInt(e.debt_tokens_before)*debtRate,scale),debtAfter=ceil(BigInt(e.debt_tokens_after)*debtRate,scale);
  const collateralBefore=BigInt(e.collateral_tokens_before)*supplyRate/scale,collateralAfter=BigInt(e.collateral_tokens_after)*supplyRate/scale;
  const grossWalletDelta=amountAtomic(balance.wallet_amount)-amountAtomic(b.wallet_amount)+(b.asset_id===XLM.id?BigInt(input.feeStroops):0n);
  const debtDelta=debtAfter-debtBefore,collateralDelta=collateralAfter-collateralBefore;
  const debtTolerance=ceil(debtRate,scale)+1n,collateralTolerance=ceil(supplyRate,scale)+1n;
  let verified=false;
  if(input.action==='borrow')verified=grossWalletDelta===requested&&debtDelta>=requested&&debtDelta-requested<=debtTolerance&&e.collateral_tokens_before===e.collateral_tokens_after;
  if(input.action==='repay'){
   const paid=-grossWalletDelta,reduction=-debtDelta;
   verified=paid>0n&&paid===(requested<debtBefore?requested:debtBefore)&&reduction>0n&&reduction<=paid&&paid-reduction<=debtTolerance&&e.collateral_tokens_before===e.collateral_tokens_after;
  }
  if(input.action==='collateral_supply')verified=grossWalletDelta===-requested&&collateralDelta>0n&&collateralDelta<=requested&&requested-collateralDelta<=collateralTolerance&&e.debt_tokens_before===e.debt_tokens_after;
  if(input.action==='collateral_withdraw')verified=grossWalletDelta===requested&&collateralDelta<0n&&-collateralDelta>=grossWalletDelta&&-collateralDelta-grossWalletDelta<=collateralTolerance&&e.debt_tokens_before===e.debt_tokens_after;
  return {verified,result:{blend_borrowing_verification:{verified,operation:input.action,tx_hash:input.txHash,asset_id:b.asset_id,pool_contract_id:b.pool_contract_id,reserve_contract_id:b.reserve_contract_id,requested_atomic:requested.toString(),wallet_before:b.wallet_amount,wallet_after:balance.wallet_amount,wallet_principal_delta:fromAtomic(grossWalletDelta,7),debt_principal_delta:fromAtomic(debtDelta,7),collateral_principal_delta:fromAtomic(collateralDelta,7),debt_tokens_before:e.debt_tokens_before,debt_tokens_after:e.debt_tokens_after,collateral_tokens_before:e.collateral_tokens_before,collateral_tokens_after:e.collateral_tokens_after,actual_fee_stroops:input.feeStroops,confirmed_ledger:input.confirmedLedger,observed_ledger:p.as_of_ledger,observed_at:new Date(now).toISOString()}}};
 }catch{return reject('BORROW_OBSERVATION_INVALID');}
}

type PositionMaps={liabilities:Map<number,bigint>;collateral:Map<number,bigint>;supply:Map<number,bigint>};
const emptyPositions=():PositionMaps=>({liabilities:new Map(),collateral:new Map(),supply:new Map()});
function positionMaps(value:xdr.ScVal):PositionMaps{
 if(value.switch().name!=='scvMap'||value.map()?.length!==3)throw Error('Invalid Positions ABI');
 const output=emptyPositions(),seen=new Set<string>();
 for(const item of value.map()!){
  if(item.key().switch().name!=='scvSymbol')throw Error('Invalid Positions field');
  const name=item.key().sym().toString();
  if(!['liabilities','collateral','supply'].includes(name)||seen.has(name)||item.val().switch().name!=='scvMap')throw Error('Invalid Positions fields');
  seen.add(name);const target=output[name as keyof PositionMaps];
  for(const entry of item.val().map()??[]){
   if(entry.key().switch().name!=='scvU32'||entry.val().switch().name!=='scvI128')throw Error('Invalid position amount');
   const index=entry.key().u32(),amount=scValToNative(entry.val());
   if(index>31||target.has(index)||typeof amount!=='bigint'||amount<0n)throw Error('Invalid position identity');
   target.set(index,amount);
  }
 }
 if(seen.size!==3)throw Error('Missing position fields');return output;
}
function rates(value:xdr.ScVal):{debt_rate:string;collateral_rate:string}{
 if(value.switch().name!=='scvMap')throw Error('Invalid reserve ABI');
 const found=new Map<string,xdr.ScVal>();
 const expected=['d_rate','b_rate','ir_mod','d_supply','b_supply','backstop_credit','last_time'];
 for(const item of value.map()??[]){
  if(item.key().switch().name!=='scvSymbol')throw Error('Invalid reserve field');
  const name=item.key().sym().toString();if(!expected.includes(name)||found.has(name))throw Error('Unknown or duplicate reserve field');found.set(name,item.val());
 }
 if(found.size!==expected.length)throw Error('Incomplete reserve state');
 const read=(name:string)=>{const val=found.get(name)!;if(val.switch().name!=='scvI128')throw Error('Invalid rate type');const n=scValToNative(val);if(typeof n!=='bigint'||n<=0n)throw Error('Invalid rate');return n.toString();};
 return {debt_rate:read('d_rate'),collateral_rate:read('b_rate')};
}
function sameOtherPositions(before:PositionMaps,after:PositionMaps,index:number,action:BorrowingAction):boolean{
 const allowed=action==='borrow'||action==='repay'?'liabilities':'collateral';
 for(const name of ['liabilities','collateral','supply'] as const){
  const keys=new Set([...before[name].keys(),...after[name].keys()]);
  for(const key of keys)if(!(name===allowed&&key===index)&&(before[name].get(key)??0n)!==(after[name].get(key)??0n))return false;
 }
 return true;
}
/** Extract from the exact successful RPC resultMetaXdr already bound to the known transaction hash.
 * Both V3 and V4 transaction metadata expose operation-local entry changes. No legacy/future ABI fallback. */
export function extractBorrowTransactionEvidence(input:{meta:xdr.TransactionMeta;txHash:string;confirmedLedger:number;baseline:unknown;action:BorrowingAction}):BorrowTransactionEvidence|null{
 try{
  const b=BorrowBaselineSchema.parse(input.baseline);
  if(!/^[a-f0-9]{64}$/.test(input.txHash)||!Number.isSafeInteger(input.confirmedLedger)||input.confirmedLedger<b.position_ledger)return null;
  const version=input.meta.switch(),operations=version===3?input.meta.v3().operations():version===4?input.meta.v4().operations():null;
  if(!operations||operations.length!==1)return null;
  const entries:{before?:xdr.ScVal;after?:xdr.ScVal;created?:boolean}={};
  let reserveAfter:xdr.ScVal|undefined;
  for(const change of operations[0]!.changes()){
   const kind=change.switch().name;
   if(!['ledgerEntryState','ledgerEntryCreated','ledgerEntryUpdated','ledgerEntryRestored'].includes(kind))continue;
   const entry=kind==='ledgerEntryState'?change.state():kind==='ledgerEntryCreated'?change.created():kind==='ledgerEntryUpdated'?change.updated():change.restored();
   if(entry.data().switch().name!=='contractData')continue;
   const data=entry.data().contractData();
   if(Address.fromScAddress(data.contract()).toString()!==b.pool_contract_id)continue;
   if(data.key().switch().name!=='scvVec'||data.key().vec()?.length!==2)continue;
   const key=data.key().vec()!;if(key[0]!.switch().name!=='scvSymbol')continue;
   const name=key[0]!.sym().toString(),target=scValToNative(key[1]!);
   if(name==='Positions'&&target===b.wallet_address){
    if(data.durability().name!=='persistent'||kind==='ledgerEntryRestored')return null;
    if(kind==='ledgerEntryState'){if(entries.before||entries.created)return null;entries.before=data.val();}
    else {if(entries.after)return null;entries.after=data.val();entries.created=kind==='ledgerEntryCreated';}
   }
   if(name==='ResData'&&target===b.reserve_contract_id&&kind!=='ledgerEntryState'){
    if(data.durability().name!=='persistent'||kind!=='ledgerEntryUpdated'||reserveAfter)return null;reserveAfter=data.val();
   }
  }
  if(!entries.after||!reserveAfter||(!entries.before&&!entries.created)||entries.created&&entries.before)return null;
  const before=entries.before?positionMaps(entries.before):emptyPositions(),after=positionMaps(entries.after);
  if(!sameOtherPositions(before,after,b.reserve_index,input.action))return null;
  const e={tx_hash:input.txHash,confirmed_ledger:input.confirmedLedger,pool_contract_id:b.pool_contract_id,reserve_contract_id:b.reserve_contract_id,wallet_address:b.wallet_address,reserve_index:b.reserve_index,
   debt_tokens_before:(before.liabilities.get(b.reserve_index)??0n).toString(),debt_tokens_after:(after.liabilities.get(b.reserve_index)??0n).toString(),
   collateral_tokens_before:(before.collateral.get(b.reserve_index)??0n).toString(),collateral_tokens_after:(after.collateral.get(b.reserve_index)??0n).toString(),...rates(reserveAfter),other_positions_unchanged:true};
  return evidenceSchema.parse(e);
 }catch{return null;}
}
