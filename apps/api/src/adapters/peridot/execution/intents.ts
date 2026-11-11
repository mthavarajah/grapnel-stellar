import {Address,Contract,StrKey,nativeToScVal,xdr} from '@stellar/stellar-sdk';
import {GrapnelError} from '@grapnel/contracts';
import {PERIDOT_POOL_ID,PERIDOT_TESTNET_PINS as P} from '../config.js';

export type PeridotDirection='long'|'short';
export type PeridotPositionStep='open_swap'|'open_activate'|'open_cancel'|'close_prepare'|'close_finish'|'close_cancel';
type WalletIntent={walletAddress:string};
export type PeridotStepIntent = WalletIntent & (
 | {step:'vault_deposit';underlyingAtomic:string}
 | {step:'vault_withdraw'|'margin_transfer'|'margin_return';receiptAtomic:string}
 | {step:'open_begin';marginReceiptAtomic:string;leverage:2|3|4|5;direction:PeridotDirection;minimumOutputAtomic:string}
 | {step:PeridotPositionStep;positionId:string}
 | {step:'close_swap';positionId:string;minimumOutputAtomic:string}
 | {step:'close_short_swap';positionId:string;maximumInputAtomic:string;minimumDebtOutputAtomic:string}
);
export const PERIDOT_STEP_ACTIONS={
 vault_deposit:'margin.vault_deposit',vault_withdraw:'margin.vault_withdraw',margin_transfer:'margin.transfer',margin_return:'margin.return',
 open_begin:'margin.open_begin',open_swap:'margin.open_swap',open_activate:'margin.open_activate',open_cancel:'margin.open_cancel',
 close_prepare:'margin.close_prepare',close_swap:'margin.close_swap',close_short_swap:'margin.close_short_swap',close_finish:'margin.close_finish',close_cancel:'margin.close_cancel',
} as const;
const invalid=():never=>{throw new GrapnelError(422,'INVALID_MARGIN_INTENT','Peridot requires an exact reviewed Testnet step intent');};
function unsigned(value:unknown,bits:number,allowZero=false):bigint{
 if(typeof value!=='string'||!/^(0|[1-9]\d{0,38})$/.test(value))return invalid();
 const amount=BigInt(value);if((!allowZero&&amount===0n)||amount>=(1n<<BigInt(bits)))return invalid();return amount;
}
const address=(value:string)=>new Address(value).toScVal();
const u128=(value:string)=>nativeToScVal(unsigned(value,127),{type:'u128'});
const u64=(value:string)=>nativeToScVal(unsigned(value,64,true),{type:'u64'});
/** Canonical one-invocation builders. They do not sign, broadcast, mint tokens,
 * alter prices, authorize a workflow transition or establish executable status. */
export function buildPeridotStepOperation(intent:PeridotStepIntent):string{
 if(!StrKey.isValidEd25519PublicKey(intent.walletAddress))return invalid();
 const user=address(intent.walletAddress),collateral=address(P.mock_usdt.address);
 let method:string,args:xdr.ScVal[],contract:string=P.margin.address;
 switch(intent.step){
  case 'vault_deposit':contract=P.mock_usdt_vault.address;method='deposit';args=[user,u128(intent.underlyingAtomic)];break;
  case 'vault_withdraw':contract=P.mock_usdt_vault.address;method='withdraw';args=[user,u128(intent.receiptAtomic)];break;
  case 'margin_transfer':method='transfer_spot_to_margin';args=[user,collateral,u128(intent.receiptAtomic)];break;
  case 'margin_return':method='transfer_margin_to_spot';args=[user,collateral,u128(intent.receiptAtomic)];break;
  case 'open_begin':{
   if(!Number.isInteger(intent.leverage)||intent.leverage<2||intent.leverage>5||!['long','short'].includes(intent.direction))return invalid();
   method='begin_open_position_v3';args=[user,collateral,address(P.native_token.address),u128(intent.marginReceiptAtomic),nativeToScVal(BigInt(intent.leverage),{type:'u128'}),xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(intent.direction==='long'?'Long':'Short')]),xdr.ScVal.scvVec([address(P.native_token.address),collateral]),xdr.ScVal.scvBytes(Buffer.from(PERIDOT_POOL_ID,'hex')),address(P.aquarius_pool.address),u128(intent.minimumOutputAtomic)];break;
  }
  case 'open_swap':method='swap_open_position_v3';args=[user,u64(intent.positionId)];break;
  case 'open_activate':method='activate_open_position_v3';args=[user,u64(intent.positionId)];break;
  case 'open_cancel':method='cancel_pending_open_v3';args=[user,u64(intent.positionId)];break;
  case 'close_prepare':method='prepare_close_position_v3';args=[user,u64(intent.positionId)];break;
  case 'close_swap':method='swap_close_position_v3';args=[user,u64(intent.positionId),u128(intent.minimumOutputAtomic)];break;
  case 'close_short_swap':method='swap_close_short_position_v3';args=[user,u64(intent.positionId),u128(intent.maximumInputAtomic),u128(intent.minimumDebtOutputAtomic)];break;
  case 'close_finish':method='finish_close_position_v3';args=[u64(intent.positionId)];break;
  case 'close_cancel':method='cancel_close_position_v3';args=[user,u64(intent.positionId)];break;
  default:return invalid();
 }
 return new Contract(contract).call(method,...args).toXDR('base64');
}
/** Byte equality against the approved canonical call prevents alternate pools,
 * assets, owners, invocation methods, argument encodings or hidden op sources. */
export function inspectPeridotStepOperation(operationXdr:string,intent:PeridotStepIntent):void{
 try{if(xdr.Operation.fromXDR(operationXdr,'base64').toXDR('base64')!==buildPeridotStepOperation(intent))throw Error('mismatch');}
 catch{throw new GrapnelError(403,'MARGIN_INTENT_MISMATCH','Peridot operation differs from the exact approved step');}
}

export function strictMarginMinimum(estimatedAtomic:string,oracleMinimumAtomic:string,slippageBps:number):string{
 const expected=unsigned(estimatedAtomic,127),oracle=unsigned(oracleMinimumAtomic,127);
 if(!Number.isInteger(slippageBps)||slippageBps<0||slippageBps>500)return invalid();
 const approved=(expected*BigInt(10000-slippageBps)+9999n)/10000n;
 const required=approved>oracle?approved:oracle;
 if(expected<required)throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','The pool quote violates the approved oracle band',false,{reason:'ORACLE_POOL_DEVIATION'});
 return required.toString();
}
