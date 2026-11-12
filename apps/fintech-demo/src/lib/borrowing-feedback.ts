import {toAtomic} from '@grapnel/contracts';
const reasons:Record<string,string>={
 COLLATERAL_REQUIRED:'Your collateral does not support any additional borrowing. Add collateral or repay existing debt to increase your available limit.',
 MIN_COLLATERAL_REQUIRED:'Your collateral value is below the minimum required to borrow. Add more collateral, then refresh your borrowing limit.',
 BORROW_CAPACITY_EXCEEDED:'This amount exceeds your available borrowing limit. Enter a smaller amount or add more collateral.',
 BORROW_CAPACITY_UNAVAILABLE:'Your borrowing limit could not be confirmed. Refresh your loan before trying again.',
 BORROW_POOL_NOT_ACTIVE:'Borrowing is temporarily paused. You can try again when it resumes.',
 BORROW_RESERVE_DISABLED:'New borrowing for this asset is currently paused.',
 BORROW_LIQUIDITY_UNAVAILABLE:'Available funds for this loan could not be confirmed. Refresh and try again.',
 REPAY_AMOUNT_EXCEEDS_DEBT_OR_BALANCE:'This repayment exceeds your debt or available wallet balance. Enter a smaller amount, or use Repay all for the current full repayment amount.',
 COLLATERAL_WITHDRAW_EXCEEDS_POSITION:'You do not have enough collateral to remove this amount. Enter a smaller amount.',
 COLLATERAL_WITHDRAW_WITH_DEBT_REQUIRES_REPAYMENT:'Repay your outstanding loans before removing collateral.',
 COLLATERAL_WITHDRAW_LIQUIDITY_UNAVAILABLE:'There are not enough available funds to remove this collateral right now. Try a smaller amount or try again later.',
};
export const borrowingReasonMessage=(reason:unknown):string|null=>typeof reason==='string'?reasons[reason]??(/ORACLE|UNPRICED|UNREVIEWED_COLLATERAL/.test(reason)?'Your collateral value could not be confirmed from current prices. Refresh your loan and try again.':null):null;
export function borrowingAmountMessage(amount:string,available:string|null,code:string,decimals:number):string|null{
 if(!amount||available==null)return null;
 try{if(toAtomic(amount,decimals)>toAtomic(available,decimals))return `You can borrow up to ${available} ${code} with your current collateral and available funds. Enter a smaller amount or add more collateral.`;}catch{/* The server validates the entered amount. */}
 return null;
}
