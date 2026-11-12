import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const path=new URL('./http-evidence.json',import.meta.url);
const out=JSON.parse(await readFile(path,'utf8'));
for(const url of ['https://api.robinhood.com/rhj/assets','https://ghost-trading-api.synthra.org/v1/chains']){
 const response=await fetch(url);const text=await response.text();const data=JSON.parse(text);
 if(url.includes('/rhj/')){
  const entries=Array.isArray(data)?data:data.results??data.assets??[];const counts={};const testnet=[];
  for(const entry of entries)for(const dep of entry.deployments??[]){counts[dep.chainId]=(counts[dep.chainId]??0)+1;if(dep.chainId===46630)testnet.push(entry);}
  out[url]={http_status:response.status,sha256:createHash('sha256').update(text).digest('hex'),asset_count:entries.length,deployment_chain_counts:counts,testnet_entries:testnet};
 }else out[url]={http_status:response.status,response:data};
}
out.captured_at=new Date().toISOString();await writeFile(path,JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out,null,2));
