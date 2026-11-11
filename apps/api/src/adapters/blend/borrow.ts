import {createHash} from 'node:crypto';
import {PoolV2,PoolContractV2,RequestType,type Pool,type Reserve,type PoolUser} from '@blend-capital/blend-sdk';
import {Account,Address,Asset,Contract,StrKey,TransactionBuilder,rpc,scValToNative,xdr} from '@stellar/stellar-sdk';
import {GrapnelError,NETWORK,NETWORK_PASSPHRASE,XLM,fromAtomic,toAtomic,type AssetIdentity,type ChainAction,type CustomerContext,type PreparedAction} from '@grapnel/contracts';
import {BLEND_REGISTRY_URL} from './index.js';

export const BORROW_POOL_ID='CB3447A446DY3USGWPIDXTNQHF5EX24XDQA2EN6TAZP62JTPBTNOA52Q';
export const BORROW_POOL_WASM='a41fc53d6753b6c04eb15b021c55052366a4c8e0e21bc72700f461264ec1350e';
export const BORROW_ORACLE_ID='CAZOKR2Y5E2OSWSIBRVZMJ47RUTQPIGVWSAQ2UISGAVC46XKPGDG5PKI';
export const BORROW_ORACLE_WASM='66c0b87b5eb481be594175d59e66ec9a9ac8945be0fec4e09f6c28bf7a1708be';
export const BORROW_USDC_ISSUER='GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56';
export const BORROW_USDC_ID=`stellar-testnet:classic:USDC:${BORROW_USDC_ISSUER}`;
export const BORROW_XLM_RESERVE=Asset.native().contractId(NETWORK_PASSPHRASE);
export const BORROW_USDC_RESERVE=new Asset('USDC',BORROW_USDC_ISSUER).contractId(NETWORK_PASSPHRASE);
const SCALE=10_000_000n;
const CEILING=1n<<127n;
const SAFETY_BPS=9000n;
export const BORROW_ASSETS:readonly AssetIdentity[]=[{...XLM,contractId:BORROW_XLM_RESERVE,sourceUrl:BLEND_REGISTRY_URL},{id:BORROW_USDC_ID,network:NETWORK,kind:'classic',code:'USDC',issuer:BORROW_USDC_ISSUER,contractId:BORROW_USDC_RESERVE,decimals:7,verified:true,sourceUrl:BLEND_REGISTRY_URL}];
export type BorrowAction='borrow'|'repay'|'collateral_supply'|'collateral_withdraw';
export interface BorrowIntent{action:BorrowAction;poolId:string;reserveId:string;walletAddress:string;amountAtomic:bigint;}
export interface BorrowOracleSnapshot{decimals:number;prices:Map<string,{price:bigint;timestamp:number}>;ledger:number;}
export interface BorrowAssetRead {market_id:string;asset:AssetIdentity;borrow_apr:string|null;borrow_apy:string|null;available_liquidity:string|null;borrowed:string;collateral:string;as_of_ledger:number;repayable:string;collateral_value:string|null;borrow_limit:string|null;available_to_borrow:string|null;health_factor:string|null;can_prepare_borrow:boolean;can_prepare_repay:boolean;can_prepare_collateral_supply:boolean;can_prepare_collateral_withdraw:boolean;reason:string|null;}
export interface BorrowRead {pool_id:string;as_of:string;assets:BorrowAssetRead[];}
export interface BorrowPosition {market_id:string;pool_contract_id:string;reserve_contract_id:string;asset_id:string;supplied:string;collateral:string;borrowed:string;as_of:string;as_of_ledger:number;debt_tokens:string;debt_rate:string;rate_decimals:number;reserve_index:number;collateral_tokens:string;collateral_rate:string;}
export interface BorrowConfig{network:string;passphrase:string;rpcUrl?:string;gate1Passed:boolean;}
export interface BorrowDependencies{
 fetcher?:typeof fetch;now?:()=>number;verifyRegistry?:()=>Promise<void>;
 server?:Pick<rpc.Server,'getNetwork'|'getContractData'|'getLedgerEntries'|'simulateTransaction'>;
 loadPool?:(poolId:string)=>Promise<Pool>;
 readOracle?:()=>Promise<BorrowOracleSnapshot>;
 readBalance?:(reserveId:string,wallet:string)=>Promise<bigint>;
 prepareAndSimulate?:(input:ChainAction)=>Promise<PreparedAction>;
}
const unavailable=(reason:string,message='Borrowing is unavailable for this position'):never=>{throw new GrapnelError(409,'EXECUTION_UNAVAILABLE',message,false,{reason});};
const invalid=(message:string):never=>{throw new GrapnelError(502,'BLEND_INVALID_RESPONSE',message);};
export const borrowReadAtomic=(value:string):bigint=>/^0(?:\.0+)?$/.test(value)?0n:toAtomic(value,7);
const min=(...values:bigint[])=>values.reduce((a,b)=>a<b?a:b);
const ceil=(a:bigint,b:bigint)=>(a+b-1n)/b;
const decimalRatio=(a:bigint,b:bigint):string=>{if(b<=0n)throw Error('Invalid ratio');const n=a*SCALE/b;return fromAtomic(n,7);};
function positiveAmount(value:string):bigint{try{const amount=toAtomic(value,7);if(amount<=0n||amount>=CEILING)throw Error();return amount;}catch{throw new GrapnelError(422,'INVALID_AMOUNT','Enter a positive amount with at most seven decimal places');}}
function knownAsset(reserveId:string):AssetIdentity{const asset=BORROW_ASSETS.find(a=>a.contractId===reserveId);if(!asset)return unavailable('ASSET_RESERVE_NOT_REVIEWED');return asset;}
export function buildBorrowOperation(intent:BorrowIntent):string{
 if(intent.poolId!==BORROW_POOL_ID||!StrKey.isValidEd25519PublicKey(intent.walletAddress)||intent.amountAtomic<=0n||intent.amountAtomic>=CEILING)throw new GrapnelError(422,'INVALID_BLEND_INTENT','Invalid exact borrowing intent');
 knownAsset(intent.reserveId);
 const request={borrow:RequestType.Borrow,repay:RequestType.Repay,collateral_supply:RequestType.SupplyCollateral,collateral_withdraw:RequestType.WithdrawCollateral}[intent.action];
 if(request===undefined)throw new GrapnelError(422,'INVALID_BLEND_INTENT','Unsupported borrowing action');
 return new PoolContractV2(intent.poolId).submit({from:intent.walletAddress,spender:intent.walletAddress,to:intent.walletAddress,requests:[{request_type:request,address:intent.reserveId,amount:intent.amountAtomic}]});
}
export function inspectBorrowOperation(operationXdr:string,intent:BorrowIntent):void{try{if(xdr.Operation.fromXDR(operationXdr,'base64').toXDR('base64')!==xdr.Operation.fromXDR(buildBorrowOperation(intent),'base64').toXDR('base64'))throw Error();}catch{throw new GrapnelError(403,'BLEND_INTENT_MISMATCH','Borrowing operation differs from the exact approved intent');}}
export function borrowSummaryAction(action:BorrowAction):string{return action==='borrow'||action==='repay'?`blend.${action}`:`blend.borrow_${action}`;}
interface Snapshot{pool:Pool;user:PoolUser;asOf:number;oracle:BorrowOracleSnapshot|null;oracleReason:string|null;liquidity:Map<string,bigint|null>;balances:Map<string,bigint|null>;}
/** Read-only risk/intent adapter for the separately approved Testnet v2.1 pool. No signer or sender. */
export class BlendBorrowAdapter{
 private server:NonNullable<BorrowDependencies['server']>;private fetcher:typeof fetch;private now:()=>number;
 constructor(readonly config:BorrowConfig,private deps:BorrowDependencies={}){
  if(config.network!=='testnet'||config.passphrase!==NETWORK_PASSPHRASE||(config.rpcUrl&&config.rpcUrl!=='https://soroban-testnet.stellar.org'))throw new GrapnelError(400,'NETWORK_MISMATCH','Borrowing requires official Stellar Testnet');
  this.server=deps.server??new rpc.Server('https://soroban-testnet.stellar.org');this.fetcher=deps.fetcher??fetch;this.now=deps.now??Date.now;
 }
 async verifyRegistry():Promise<void>{
  if(this.deps.verifyRegistry)return this.deps.verifyRegistry();
  if((await this.server.getNetwork()).passphrase!==NETWORK_PASSPHRASE)throw new GrapnelError(400,'NETWORK_MISMATCH','RPC network mismatch');
  const response=await this.fetcher(BLEND_REGISTRY_URL,{redirect:'error',signal:AbortSignal.timeout(12_000)});if(!response.ok)return unavailable('BLEND_REGISTRY_UNAVAILABLE');
  const registry=await response.json() as {ids?:Record<string,string>;hashes?:Record<string,string>};
  if(registry.ids?.XLM!==BORROW_XLM_RESERVE||registry.ids?.USDC!==BORROW_USDC_RESERVE||registry.ids?.oraclemock!==BORROW_ORACLE_ID||registry.hashes?.lendingPoolV2!==BORROW_POOL_WASM||registry.hashes?.oraclemock!==BORROW_ORACLE_WASM)return unavailable('BORROW_REGISTRY_MISMATCH');
  for(const [contract,expected] of [[BORROW_POOL_ID,BORROW_POOL_WASM],[BORROW_ORACLE_ID,BORROW_ORACLE_WASM]]){
   const entry=await this.server.getContractData(contract!,xdr.ScVal.scvLedgerKeyContractInstance()),executable=entry.val.contractData().val().instance().executable();
   if(executable.switch().name!=='contractExecutableWasm'||executable.wasmHash().toString('hex')!==expected)return unavailable('BORROW_CONTRACT_MISMATCH');
   const code=await this.server.getLedgerEntries(xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({hash:Buffer.from(expected!,'hex')})));
   if(code.entries.length!==1||createHash('sha256').update(code.entries[0]!.val.contractCode().code()).digest('hex')!==expected)return unavailable('BORROW_CONTRACT_MISMATCH');
  }
 }
 private async view(contract:string,fn:string,args:xdr.ScVal[]=[]):Promise<{value:unknown;ledger:number}>{
  const tx=new TransactionBuilder(new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF','0'),{fee:'100',networkPassphrase:NETWORK_PASSPHRASE}).addOperation(new Contract(contract).call(fn,...args)).setTimeout(30).build();
  const sim=await this.server.simulateTransaction(tx);if(!rpc.Api.isSimulationSuccess(sim)||rpc.Api.isSimulationRestore(sim)||!sim.result||sim.result.auth.length)return unavailable('BORROW_READ_UNAVAILABLE');
  return {value:scValToNative(sim.result.retval),ledger:sim.latestLedger};
 }
 private async balance(reserve:string,wallet:string):Promise<bigint>{if(this.deps.readBalance)return this.deps.readBalance(reserve,wallet);const amount=(await this.view(reserve,'balance',[Address.fromString(wallet).toScVal()])).value;if(typeof amount!=='bigint'||amount<0n||amount>=CEILING)return invalid('Invalid reserve balance');return amount;}
 private async oracle():Promise<BorrowOracleSnapshot>{
  if(this.deps.readOracle)return this.deps.readOracle();
  const decimals=await this.view(BORROW_ORACLE_ID,'decimals');if(decimals.value!==7)return unavailable('BORROW_ORACLE_DECIMALS_MISMATCH');
  const prices=new Map<string,{price:bigint;timestamp:number}>();let ledger=decimals.ledger;
  for(const asset of BORROW_ASSETS){const result=await this.view(BORROW_ORACLE_ID,'lastprice',[xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Stellar'),Address.fromString(asset.contractId!).toScVal()])]);const v=result.value as {price?:unknown;timestamp?:unknown};if(!v||typeof v.price!=='bigint'||v.price<=0n||v.price>=CEILING||typeof v.timestamp!=='bigint'||v.timestamp>BigInt(Number.MAX_SAFE_INTEGER))return unavailable('BORROW_ORACLE_PRICE_INVALID');prices.set(asset.contractId!,{price:v.price,timestamp:Number(v.timestamp)});ledger=Math.max(ledger,result.ledger);}
  return {decimals:7,prices,ledger};
 }
 private freshOracle(oracle:BorrowOracleSnapshot):boolean{return oracle.decimals===7&&BORROW_ASSETS.every(asset=>{const price=oracle.prices.get(asset.contractId!);return !!price&&price.price>0n&&Number.isSafeInteger(price.timestamp)&&this.now()/1000-price.timestamp<=60&&price.timestamp-this.now()/1000<=5;});}
 private async snapshot(customer:Pick<CustomerContext,'walletAddress'>):Promise<Snapshot>{
  if(!StrKey.isValidEd25519PublicKey(customer.walletAddress))throw new GrapnelError(422,'INVALID_WALLET','Invalid customer wallet');
  await this.verifyRegistry();
  const pool=await(this.deps.loadPool?.(BORROW_POOL_ID)??PoolV2.load({rpc:'https://soroban-testnet.stellar.org',passphrase:NETWORK_PASSPHRASE},BORROW_POOL_ID));
  if(pool.id!==BORROW_POOL_ID||pool.metadata.wasmHash!==BORROW_POOL_WASM||pool.metadata.oracle!==BORROW_ORACLE_ID)return unavailable('BORROW_POOL_MISMATCH');
  for(const asset of BORROW_ASSETS){const reserve=pool.reserves.get(asset.contractId!);if(!reserve||reserve.config.index!==(asset.id===XLM.id?0:3)||reserve.config.decimals!==7||!('enabled'in reserve.config)||typeof reserve.config.enabled!=='boolean'||reserve.config.c_factor<=0||reserve.config.c_factor>10000000||reserve.config.l_factor<=0||reserve.config.l_factor>10000000||reserve.config.max_util<=0||reserve.config.max_util>10000000)return unavailable('BORROW_RESERVE_MISMATCH');}
  const user=await pool.loadUser(customer.walletAddress),liquidity=new Map<string,bigint|null>(),balances=new Map<string,bigint|null>();
  await Promise.all(BORROW_ASSETS.map(async asset=>{const id=asset.contractId!;await Promise.all([this.balance(id,BORROW_POOL_ID).then(v=>liquidity.set(id,v)).catch(()=>liquidity.set(id,null)),this.balance(id,customer.walletAddress).then(v=>balances.set(id,v)).catch(()=>balances.set(id,null))]);}));
  let oracle:BorrowOracleSnapshot|null=null,oracleReason:string|null=null;try{oracle=await this.oracle();if(!this.freshOracle(oracle)){oracle=null;oracleReason='BORROW_ORACLE_STALE';}}catch{oracleReason='BORROW_ORACLE_UNAVAILABLE';}
  return {pool,user,asOf:this.now(),oracle,oracleReason,liquidity,balances};
 }
 private risk(snapshot:Snapshot):{collateral:bigint;effectiveCollateral:bigint;effectiveDebt:bigint}|null{
  if(!snapshot.oracle)return null;let collateral=0n,effectiveCollateral=0n,effectiveDebt=0n;
  for(const [id,reserve] of snapshot.pool.reserves){const supplied=snapshot.user.getCollateral(reserve),debt=snapshot.user.getLiabilities(reserve);if(supplied===0n&&debt===0n)continue;const price=snapshot.oracle.prices.get(id);if(!price||reserve.config.decimals!==7)return null;const value=supplied*price.price/SCALE;collateral+=value;effectiveCollateral+=value*BigInt(reserve.config.c_factor)/SCALE;effectiveDebt+=ceil(ceil(debt*price.price,SCALE)*SCALE,BigInt(reserve.config.l_factor));}
  return {collateral,effectiveCollateral,effectiveDebt};
 }
 private rows(s:Snapshot):BorrowAssetRead[]{const risk=this.risk(s);return BORROW_ASSETS.map(asset=>{const reserve=s.pool.reserves.get(asset.contractId!)!,debt=s.user.getLiabilities(reserve),balance=s.balances.get(asset.contractId!)??null,liquidity=s.liquidity.get(asset.contractId!)??null,price=s.oracle?.prices.get(asset.contractId!);let available:bigint|null=null;
   if(risk&&price&&liquidity!==null){const effectiveRoom=risk.effectiveCollateral>risk.effectiveDebt?risk.effectiveCollateral-risk.effectiveDebt:0n;const collateralCapacity=effectiveRoom*BigInt(reserve.config.l_factor)/price.price*SAFETY_BPS/10_000n;const utilCapacity=reserve.totalSupply()*BigInt(reserve.config.max_util)/SCALE-reserve.totalLiabilities();available=min(collateralCapacity,liquidity,utilCapacity>0n?utilCapacity:0n);}
   const active=s.pool.metadata.status===0||s.pool.metadata.status===1;const reason=!this.config.gate1Passed?'GATE_1_SIGNING_PROOF_REQUIRED':!active?'BORROW_POOL_NOT_ACTIVE':!('enabled'in reserve.config)||!reserve.config.enabled?'BORROW_RESERVE_DISABLED':risk&&risk.collateral<(s.pool.metadata.minCollateral??0n)?'MIN_COLLATERAL_REQUIRED':s.oracleReason??(!risk?'UNREVIEWED_COLLATERAL_ASSET':liquidity===null?'BORROW_LIQUIDITY_UNAVAILABLE':available===0n?'COLLATERAL_REQUIRED':null);const repayable=balance===null?0n:min(debt,balance);
   return {market_id:`stellar-testnet:blend:${BORROW_POOL_ID}:${asset.contractId}`,asset:{...asset},borrow_apr:Number.isFinite(reserve.borrowApr)&&reserve.borrowApr>=0?String(reserve.borrowApr):null,borrow_apy:Number.isFinite(reserve.estBorrowApy)&&reserve.estBorrowApy>=0?String(reserve.estBorrowApy):null,available_liquidity:liquidity===null?null:fromAtomic(liquidity,7),borrowed:fromAtomic(debt,7),collateral:fromAtomic(s.user.getCollateral(reserve),7),as_of_ledger:Math.max(s.pool.metadata.latestLedger,reserve.latestLedger,s.oracle?.ledger??0),repayable:fromAtomic(repayable,7),collateral_value:risk?fromAtomic(risk.collateral,7):null,borrow_limit:risk?fromAtomic(risk.effectiveCollateral,7):null,available_to_borrow:available===null?null:fromAtomic(available,7),health_factor:risk&&risk.effectiveDebt>0n?decimalRatio(risk.effectiveCollateral,risk.effectiveDebt):null,can_prepare_borrow:reason===null&&!!this.deps.prepareAndSimulate&&available!==null&&available>0n,can_prepare_repay:this.config.gate1Passed&&!!this.deps.prepareAndSimulate&&balance!==null&&repayable>0n,can_prepare_collateral_supply:this.config.gate1Passed&&!!this.deps.prepareAndSimulate&&active&&'enabled'in reserve.config&&reserve.config.enabled===true&&balance!==null&&balance>0n,can_prepare_collateral_withdraw:this.config.gate1Passed&&!!this.deps.prepareAndSimulate&&s.user.getCollateral(reserve)>0n&&![...s.user.positions.liabilities.values()].some(value=>value>0n)&&liquidity!==null&&liquidity>0n,reason};
  });}
 async read(customer:CustomerContext):Promise<BorrowRead>{return this.readWallet(customer.walletAddress);}
 async readWallet(walletAddress:string):Promise<BorrowRead>{const s=await this.snapshot({walletAddress});return {pool_id:BORROW_POOL_ID,as_of:new Date(s.asOf).toISOString(),assets:this.rows(s)};}
 async positions(customer:CustomerContext):Promise<BorrowPosition[]>{return this.positionsWallet(customer.walletAddress);}
 async positionsWallet(walletAddress:string):Promise<BorrowPosition[]>{const s=await this.snapshot({walletAddress});return BORROW_ASSETS.map(asset=>{const reserve=s.pool.reserves.get(asset.contractId!)!;return {market_id:`stellar-testnet:blend:${BORROW_POOL_ID}:${asset.contractId}`,pool_contract_id:BORROW_POOL_ID,reserve_contract_id:asset.contractId!,asset_id:asset.id,supplied:fromAtomic(s.user.getSupply(reserve)+s.user.getCollateral(reserve),7),collateral:fromAtomic(s.user.getCollateral(reserve),7),borrowed:fromAtomic(s.user.getLiabilities(reserve),7),as_of:new Date(s.asOf).toISOString(),as_of_ledger:Math.max(s.pool.metadata.latestLedger,reserve.latestLedger),debt_tokens:(s.user.positions.liabilities.get(reserve.config.index)??0n).toString(),debt_rate:reserve.data.dRate.toString(),rate_decimals:reserve.rateDecimals,reserve_index:reserve.config.index,collateral_tokens:(s.user.positions.collateral.get(reserve.config.index)??0n).toString(),collateral_rate:reserve.data.bRate.toString()};});}
 async walletBalance(reserveId:string,walletAddress:string):Promise<bigint>{knownAsset(reserveId);return this.balance(reserveId,walletAddress);}
 async prepare(action:'borrow'|'repay',input:{operationId:string;marketId:string;assetId:string;amount:string},customer:CustomerContext):Promise<PreparedAction>{return this.prepareAction(action,input,customer);}
 async prepareCollateral(action:'supply'|'withdraw',input:{operationId:string;marketId:string;assetId:string;amount:string},customer:CustomerContext):Promise<PreparedAction>{return this.prepareAction(action==='supply'?'collateral_supply':'collateral_withdraw',input,customer);}
 private async prepareAction(action:BorrowAction,input:{operationId:string;marketId:string;assetId:string;amount:string},customer:CustomerContext):Promise<PreparedAction>{
  if(!this.config.gate1Passed)return unavailable('GATE_1_SIGNING_PROOF_REQUIRED');if(!this.deps.prepareAndSimulate)return unavailable('BORROW_INSPECTOR_REQUIRED');
  const s=await this.snapshot(customer),row=this.rows(s).find(r=>r.market_id===input.marketId);if(!row)throw new GrapnelError(404,'NOT_FOUND','Borrow market not found');if(row.asset.id!==input.assetId)throw new GrapnelError(422,'ASSET_MISMATCH','Exact borrow reserve identity required');const amount=positiveAmount(input.amount),reserve=s.pool.reserves.get(row.asset.contractId!)!;
  if(action==='borrow'){if(!row.can_prepare_borrow)return unavailable(row.reason??'BORROW_CAPACITY_UNAVAILABLE');if(row.available_to_borrow===null||amount>toAtomic(row.available_to_borrow,7))return unavailable('BORROW_CAPACITY_EXCEEDED');}
  if(action==='repay'&&(amount>borrowReadAtomic(row.repayable)||!row.can_prepare_repay))return unavailable('REPAY_AMOUNT_EXCEEDS_DEBT_OR_BALANCE');
  if(action==='collateral_supply'){if(!('enabled'in reserve.config)||!reserve.config.enabled)return unavailable('BORROW_RESERVE_DISABLED');if(![0,1].includes(s.pool.metadata.status))return unavailable('BORROW_POOL_NOT_ACTIVE');if((s.balances.get(row.asset.contractId!)??0n)<amount)throw new GrapnelError(409,'INSUFFICIENT_BALANCE','Collateral exceeds wallet balance');}
  if(action==='collateral_withdraw'){if(s.user.getCollateral(reserve)<amount)return unavailable('COLLATERAL_WITHDRAW_EXCEEDS_POSITION');if([...s.user.positions.liabilities.values()].some(v=>v>0n))return unavailable('COLLATERAL_WITHDRAW_WITH_DEBT_REQUIRES_REPAYMENT');if(row.available_liquidity===null||amount>toAtomic(row.available_liquidity,7))return unavailable('COLLATERAL_WITHDRAW_LIQUIDITY_UNAVAILABLE');}
  const intent:BorrowIntent={action,poolId:BORROW_POOL_ID,reserveId:row.asset.contractId!,walletAddress:customer.walletAddress,amountAtomic:amount},operationXdr=buildBorrowOperation(intent);inspectBorrowOperation(operationXdr,intent);
  return this.deps.prepareAndSimulate({operationId:input.operationId,customerId:customer.customerId,walletAddress:customer.walletAddress,operationXdr,allowedContracts:[BORROW_POOL_ID,intent.reserveId],summary:{action:borrowSummaryAction(action),fromAssetId:row.asset.id,amount:fromAtomic(amount,7),recipient:customer.walletAddress,contractId:BORROW_POOL_ID,expiresAt:new Date(this.now()+120_000).toISOString()}});
 }
}
