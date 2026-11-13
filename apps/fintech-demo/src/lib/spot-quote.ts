import{toAtomic}from'@grapnel/contracts';
export type SpotQuoteIntent={market:string;input:string;output:string;amount:string;inputDecimals:number;outputDecimals:number;slippage:number};
export function validSpotAmount(amount:string,decimals:number):boolean{try{return toAtomic(amount,decimals)>0n;}catch{return false;}}
/** An estimate must belong to this exact amount, pair and slippage before display or execution. */
export function matchesSpotQuote(q:any,i:SpotQuoteIntent,now=Date.now(),requireFresh=true):boolean{
 try{return q?.market_id===i.market&&q.asset_in_id===i.input&&q.asset_out_id===i.output&&q.network==='stellar-testnet'&&q.provider==='soroswap'&&typeof q.quote_id==='string'&&q.quote_id.length>0&&q.slippage_bps===i.slippage&&toAtomic(q.amount_in,i.inputDecimals)===toAtomic(i.amount,i.inputDecimals)&&toAtomic(q.expected_out,i.outputDecimals)>0n&&toAtomic(q.min_receive,i.outputDecimals)>0n&&toAtomic(q.min_receive,i.outputDecimals)<=toAtomic(q.expected_out,i.outputDecimals)&&Number.isFinite(Date.parse(q.expires_at))&&(!requireFresh||Date.parse(q.expires_at)>now);}catch{return false;}
}
/** Quotes are read-only estimates. Retry one quick transport failure, never a
 * financial operation, an initial failure after 15 seconds, or an obsolete selection. */
export async function readSpotQuoteWithRetry<T>(read:()=>Promise<T>,current:()=>boolean,wait:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=Date.now):Promise<T>{
 const started=now();
 for(let attempt=0;attempt<2;attempt++){
  if(!current())throw Error('The quote selection changed.');
  try{return await read();}catch(cause){
   const error=cause as {status?:number;name?:string},temporary=typeof error?.status==='number'&&(error.status===408||error.status>=500)||['TimeoutError','AbortError','TypeError'].includes(error?.name??'');
   if(attempt||!temporary||now()-started>15000||!current())throw cause;
   await wait(1500);
  }
 }
 throw Error('A fresh quote could not be loaded.');
}
