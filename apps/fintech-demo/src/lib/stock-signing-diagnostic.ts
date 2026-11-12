/** Never collect transaction payloads, signatures, tokens or wallet key material. */
export function stockSigningDiagnostic(stage:string,cause:unknown){
 const e=cause&&typeof cause==='object'?cause as Record<string,unknown>:{},child=e.cause??e.error,nested=child&&typeof child==='object'?child as Record<string,unknown>:{};
 const clean=(value:unknown)=>String(value??'').replace(/0x[a-f0-9]{32,}/gi,'[redacted]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted]').replace(/\bS[A-Z2-7]{55}\b/g,'[redacted]').replace(/Bearer\s+\S+/gi,'Bearer [redacted]').replace(/\b[a-f0-9]{64,}\b/gi,'[redacted]').replace(/(secret|private[-_ ]?key|access[-_ ]?token|authorization)\s*[:=]\s*\S+/gi,'$1=[redacted]').replace(/[\r\n\t]/g,' ').slice(0,240);
 return{stage,name:clean(e.name||nested.name||typeof cause),code:clean(e.code||nested.code||''),message:clean(e.message||e.shortMessage||nested.message||'Unspecified wallet error')};
}
export function reportStockSigningFailure(stage:string,cause:unknown){
 void fetch('/api/stock-signing-diagnostic',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(stockSigningDiagnostic(stage,cause)),credentials:'same-origin',keepalive:true}).catch(()=>{});
}
