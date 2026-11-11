import {Contract,StrKey,TransactionBuilder,nativeToScVal,rpc,scValToNative,xdr} from '@stellar/stellar-sdk';
import {GrapnelError,NETWORK_PASSPHRASE} from '@grapnel/contracts';
import {PERIDOT_POOL_ID,PERIDOT_TESTNET_PINS as P} from '../config.js';
import type {PeridotDirection,PeridotStepIntent} from './intents.js';

export interface MarginPositionSnapshot {
 positionId:string;walletAddress:string;direction:PeridotDirection;status:'PendingOpen'|'Open'|'Closing'|'Closed'|'Liquidated';
 position:Record<string,unknown>;perps:Record<string,unknown>|null;pendingOpen:Record<string,unknown>|null;
 openExecution:Record<string,unknown>|null;pendingClose:Record<string,unknown>|null;observedLedger:number;observedAt:string;
}
const fail=(reason:string):never=>{throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Peridot position state does not permit this exact action',false,{reason});};
const record=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const integer=(v:unknown):bigint=>typeof v==='bigint'&&v>=0n?v:fail('INVALID_CHAIN_INTEGER');
const union=(v:unknown)=>Array.isArray(v)&&v.length===1&&typeof v[0]==='string'?v[0]:fail('INVALID_CHAIN_ENUM');
const pool=(v:Record<string,unknown>)=>{
 const id=v.pool_id;if(v.pool!==P.aquarius_pool.address||!Buffer.isBuffer(id)||id.toString('hex')!==PERIDOT_POOL_ID||!Array.isArray(v.pool_tokens)||v.pool_tokens.length!==2||v.pool_tokens[0]!==P.native_token.address||v.pool_tokens[1]!==P.mock_usdt.address)return fail('POSITION_POOL_MISMATCH');
};
/** Decode only actual, independently returned onchain records; never infer a position from a submit response. */
export function validateMarginPositionSnapshot(input:{positionId:string;walletAddress:string;direction:PeridotDirection;position:unknown;perps:unknown;pendingOpen:unknown;openExecution:unknown;pendingClose:unknown;observedLedger:number;observedAt:string}):MarginPositionSnapshot{
 if(!StrKey.isValidEd25519PublicKey(input.walletAddress)||!/^(0|[1-9]\d{0,19})$/.test(input.positionId)||BigInt(input.positionId)>=(1n<<64n)||!Number.isSafeInteger(input.observedLedger)||input.observedLedger<=0||!Number.isFinite(Date.parse(input.observedAt)))return fail('INVALID_SNAPSHOT');
 const position=record(input.position);if(!position||position.owner!==input.walletAddress)return fail('POSITION_OWNER_MISMATCH');
 const side=input.direction==='long'?'Long':'Short',status=union(position.status);
 if(union(position.side)!==side||!['PendingOpen','Open','Closing','Closed','Liquidated'].includes(status))return fail('POSITION_PHASE_MISMATCH');
 const debt=input.direction==='long'?P.mock_usdt.address:P.native_token.address,collateral=input.direction==='long'?P.native_token.address:P.mock_usdt.address;
 // v3 long collateral is the purchased base; short collateral is the purchased quote.
 if(position.debt_asset!==debt||position.collateral_asset!==collateral)return fail('POSITION_ASSET_MISMATCH');
 integer(position.collateral_ptokens);integer(position.debt_shares);integer(position.entry_price_scaled);integer(position.opened_at);
 const perps=record(input.perps),pendingOpen=record(input.pendingOpen),openExecution=record(input.openExecution),pendingClose=record(input.pendingClose);
 for(const detail of [perps,pendingOpen])if(detail){if(detail.base_asset!==P.native_token.address||detail.margin_asset!==P.mock_usdt.address||union(detail.side)!==side)return fail('POSITION_DETAIL_MISMATCH');pool(detail);}
 for(const detail of [pendingOpen,pendingClose])if(detail){if(detail.owner!==input.walletAddress)return fail('PENDING_OWNER_MISMATCH');integer(detail.expires_at);}
 if(pendingOpen){integer(pendingOpen.margin_ptokens);integer(pendingOpen.margin_amount);integer(pendingOpen.borrow_amount);integer(pendingOpen.min_position_amount);if(pendingOpen.margin_vault!==P.mock_usdt_vault.address||pendingOpen.debt_vault!==(input.direction==='long'?P.mock_usdt_vault.address:P.native_vault.address)||pendingOpen.position_vault!==(input.direction==='long'?P.native_vault.address:P.mock_usdt_vault.address))return fail('PENDING_VAULT_MISMATCH');}
 if(openExecution){integer(openExecution.position_amount);integer(openExecution.margin_received);}
 if(pendingClose){integer(pendingClose.collateral_underlying);integer(pendingClose.debt_amount);integer(pendingClose.prepared_ledger);integer(pendingClose.received_debt_asset);}
 if(status==='PendingOpen'&&(!pendingOpen||pendingClose)||status==='Open'&&(!perps||pendingOpen||pendingClose)||status==='Closing'&&(!perps||!pendingClose||pendingOpen)||['Closed','Liquidated'].includes(status)&&(pendingOpen||pendingClose))return fail('INCONSISTENT_PHASE');
 return{...input,status:status as MarginPositionSnapshot['status'],position,perps,pendingOpen,openExecution,pendingClose};
}
/** All owner actions, including the ownerless finish ABI, are tied to this exact chain snapshot. */
export function assertMarginStepPhase(intent:PeridotStepIntent,snapshot:MarginPositionSnapshot,now=Date.now()):void{
 if(!('positionId'in intent)||intent.positionId!==snapshot.positionId||intent.walletAddress!==snapshot.walletAddress||now<Date.parse(snapshot.observedAt)||now-Date.parse(snapshot.observedAt)>15000)return fail('STALE_OR_FOREIGN_POSITION');
 const pendingExpiry=snapshot.pendingOpen?.expires_at??snapshot.pendingClose?.expires_at,expired=pendingExpiry!==undefined&&integer(pendingExpiry)*1000n<=BigInt(now);
 const swapped=!!snapshot.openExecution&&integer(snapshot.openExecution.position_amount)>0n;
 switch(intent.step){
  case 'open_swap':if(snapshot.status!=='PendingOpen'||expired||swapped)return fail('OPEN_SWAP_PHASE');break;
  case 'open_activate':if(snapshot.status!=='PendingOpen'||expired||!swapped)return fail('OPEN_ACTIVATE_PHASE');break;
  case 'open_cancel':if(snapshot.status!=='PendingOpen'||swapped)return fail('OPEN_CANCEL_PHASE');break;
  case 'close_prepare':if(snapshot.status!=='Open')return fail('CLOSE_PREPARE_PHASE');break;
  case 'close_swap':if(snapshot.direction!=='long'||snapshot.status!=='Closing'||expired||integer(snapshot.pendingClose!.received_debt_asset)>0n)return fail('CLOSE_SWAP_PHASE');break;
  case 'close_short_swap':if(snapshot.direction!=='short'||snapshot.status!=='Closing'||expired||integer(snapshot.pendingClose!.received_debt_asset)>0n)return fail('CLOSE_SWAP_PHASE');break;
  case 'close_finish':if(snapshot.status!=='Closing'||integer(snapshot.pendingClose!.received_debt_asset)<=0n)return fail('CLOSE_FINISH_PHASE');break;
  case 'close_cancel':if(snapshot.status!=='Closing'||integer(snapshot.pendingClose!.received_debt_asset)>0n)return fail('CLOSE_CANCEL_PHASE');break;
  default:return fail('POSITION_STEP_REQUIRED');
 }
}
/** Unsigned view reader. Pin verification is mandatory before interpreting deployed v3 state. */
export class PeridotPositionReader{
 constructor(private source:string,private server=new rpc.Server('https://soroban-testnet.stellar.org'),private now=Date.now){}
 async read(walletAddress:string,positionId:string,direction:PeridotDirection):Promise<MarginPositionSnapshot>{
  if(!StrKey.isValidEd25519PublicKey(this.source)||!StrKey.isValidEd25519PublicKey(walletAddress)||!/^(0|[1-9]\d{0,19})$/.test(positionId)||BigInt(positionId)>=(1n<<64n))return fail('INVALID_READ_INPUT');
  if((await this.server.getNetwork()).passphrase!==NETWORK_PASSPHRASE)return fail('NETWORK_MISMATCH');
  for(const pin of Object.values(P)){const executable=(await this.server.getContractData(pin.address,xdr.ScVal.scvLedgerKeyContractInstance())).val.contractData().val().instance().executable();if('wasmHash'in pin){if(executable.switch().name!=='contractExecutableWasm'||executable.wasmHash().toString('hex')!==pin.wasmHash)return fail('CODE_CHANGED');}else if(executable.switch().name!=='contractExecutableStellarAsset')return fail('NATIVE_CHANGED');}
  const args=[nativeToScVal(BigInt(positionId),{type:'u64'})],values:unknown[]=[],ledgers:number[]=[];
  for(const method of ['get_position','get_perps_position','get_pending_perps_open','get_pending_perps_open_execution','get_pending_perps_close']){
   const tx=new TransactionBuilder(await this.server.getAccount(this.source),{fee:'100',networkPassphrase:NETWORK_PASSPHRASE}).addOperation(new Contract(P.margin.address).call(method,...args)).setTimeout(30).build(),sim=await this.server.simulateTransaction(tx);
   if(!rpc.Api.isSimulationSuccess(sim)||rpc.Api.isSimulationRestore(sim)||!sim.result||sim.result.auth.length)return fail('STATE_READ_UNAVAILABLE');values.push(scValToNative(sim.result.retval));ledgers.push(sim.latestLedger);
  }
  if(Math.max(...ledgers)-Math.min(...ledgers)>2)return fail('INCONSISTENT_READ_LEDGER');
  return validateMarginPositionSnapshot({walletAddress,positionId,direction,position:values[0],perps:values[1],pendingOpen:values[2],openExecution:values[3],pendingClose:values[4],observedLedger:Math.max(...ledgers),observedAt:new Date(this.now()).toISOString()});
 }
}
