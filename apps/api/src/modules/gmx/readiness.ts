/** Serialize independent chain-proof reads to avoid overwhelming the public RPC.
 * Every true result still comes from the supplied canonical verifier. */
export function createGmxReadiness(check:(symbol:string)=>Promise<boolean>,now:()=>number=Date.now){
 const cache=new Map<string,{at:number;value:boolean}>(),pending=new Map<string,Promise<boolean>>();let queue=Promise.resolve();
 return(symbol:string):Promise<boolean>=>{
  const fresh=()=>{const c=cache.get(symbol);return c&&now()-c.at<(c.value?30000:3000)?c.value:undefined;},cached=fresh();if(cached!==undefined)return Promise.resolve(cached);
  const current=pending.get(symbol);if(current)return current;
  const result=queue.then(async()=>{const value=fresh();if(value!==undefined)return value;let verified=false;try{verified=await check(symbol)===true;}catch{/* Unavailable proof stays unavailable. */}cache.set(symbol,{at:now(),value:verified});return verified;});
  queue=result.then(()=>undefined,()=>undefined);pending.set(symbol,result);void result.finally(()=>{if(pending.get(symbol)===result)pending.delete(symbol);});return result;
 };
}
