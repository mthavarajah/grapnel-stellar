import {toAtomic} from '@grapnel/contracts';
export function earnAmountMessage(amount:string,available:string|null|undefined,decimals:number,action:'supply'|'withdraw'):string|null{
 if(!amount.trim())return null;
 let requested:bigint;
 try{requested=toAtomic(amount,decimals);}catch{return `Enter a positive amount with up to ${decimals} decimal places.`;}
 if(requested<=0n)return 'Enter an amount greater than zero.';
 if(available==null)return 'Waiting for your available balance.';
 try{if(requested>(/^0(?:\.0+)?$/.test(available)?0n:toAtomic(available,decimals)))return action==='withdraw'?'This amount exceeds your Earn balance.':'This amount exceeds your available wallet balance.';}catch{return 'Your available balance could not be checked. Refresh and try again.';}
 return null;
}
