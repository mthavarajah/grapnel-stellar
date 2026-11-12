/** Client freshness/refresh coordination only. No JWT acceptance or wallet
 * authority is established here: the server must verify every selected token. */
export class IdentityTokenError extends Error {
 constructor(public readonly code:'IDENTITY_REQUIRED'|'IDENTITY_CHANGED'|'TOKEN_UNAVAILABLE'|'REFRESH_TIMEOUT'|'REFRESH_COOLDOWN',message:string){super(message);}
}
interface IdentityContext {appId:string;userId:string|null;}
interface RefreshInput {currentToken:string|null|undefined;refresh:()=>Promise<string|null>;}
/** One instance per browser module preserves singleflight across route remounts.
 * No successful JWT or raw credential is retained in a cache. */
export function createIdentityTokenResolver(options:{now?:()=>number;timeoutMs?:number}={}){
 const now=options.now??Date.now,timeoutMs=options.timeoutMs??15000;
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>15000)throw Error('Identity refresh timeout must be bounded');
 let identity:IdentityContext={appId:'',userId:null},generation=0,cooldownUntil=0;
 let pending:{generation:number;promise:Promise<string>}|null=null;
 const failure=(code:ConstructorParameters<typeof IdentityTokenError>[0],message:string):never=>{throw new IdentityTokenError(code,message);};
 function fresh(token:unknown,context:IdentityContext):token is string{
  if(typeof token!=='string'||token.length>32768)return false;
  try{
   const parts=token.split('.');if(parts.length!==3||parts.some(part=>!part||!/^[A-Za-z0-9_-]+$/.test(part)))return false;
   const decode=(part:string)=>JSON.parse(atob(part.replace(/-/g,'+').replace(/_/g,'/')));
   const header=decode(parts[0]!),claims=decode(parts[1]!);
   return header.alg==='ES256'&&header.typ==='JWT'&&claims.iss==='privy.io'&&claims.aud===context.appId&&claims.sub===context.userId&&typeof claims.exp==='number'&&Number.isSafeInteger(claims.exp*1000)&&claims.exp*1000>now()+30000;
  }catch{return false;}
 }
 return {
  setIdentity(context:IdentityContext):void{
   if(context.appId===identity.appId&&context.userId===identity.userId)return;
   identity={...context};generation++;pending=null;
   // Preserve a provider cooldown across account changes: switching accounts
   // must not become a way to hammer the same browser/provider rate limit.
  },
  async resolve({currentToken,refresh}:RefreshInput):Promise<string>{
   const context={...identity},version=generation;
   if(!context.appId||!context.userId?.startsWith('did:privy:'))return failure('IDENTITY_REQUIRED','Please sign in first.');
   if(fresh(currentToken,context))return currentToken;
   if(pending?.generation===version)return pending.promise;
   if(cooldownUntil>now())return failure('REFRESH_COOLDOWN','Please wait a moment, then connect again.');
   let timer:ReturnType<typeof setTimeout>|undefined;
   const operation=Promise.race([Promise.resolve().then(refresh),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new IdentityTokenError('REFRESH_TIMEOUT','Sign-in timed out. Please try again.')),timeoutMs);})]);
   const promise=operation.then(token=>{
    if(version!==generation)return failure('IDENTITY_CHANGED','Your account changed. Please connect again.');
    if(!fresh(token,context))return failure('TOKEN_UNAVAILABLE','Your session could not be refreshed. Please sign in again.');
    return token;
   }).catch((error:unknown)=>{
    if(version!==generation)return failure('IDENTITY_CHANGED','Your account changed. Please connect again.');
    const provider=error as {status?:unknown;statusCode?:unknown;code?:unknown}|null;
    const limited=provider?.status===429||provider?.statusCode===429||provider?.code==='too_many_requests';
    cooldownUntil=now()+(limited?60000:5000);
    if(limited)return failure('REFRESH_COOLDOWN','Too many requests. Wait a minute, then connect again.');
    if(error instanceof IdentityTokenError)throw error;
    return failure('TOKEN_UNAVAILABLE','Your session could not be refreshed. Please try again.');
   }).finally(()=>{if(timer!==undefined)clearTimeout(timer);if(pending?.promise===promise)pending=null;});
   pending={generation:version,promise};return promise;
  },
 };
}
