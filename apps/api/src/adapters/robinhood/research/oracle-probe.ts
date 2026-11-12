/** Read-only official REST probe. No keys, account creation, signing or writes. */
import {writeFile} from 'node:fs/promises';
import {RobinhoodMarketDataReader,ROBINHOOD_PRICE_SYMBOLS} from '../market-data.js';
const requests:unknown[]=[];
const reader=new RobinhoodMarketDataReader({fetch:async(url,options)=>{const response=await fetch(url,options),body:unknown=await response.json();requests.push({method:'GET',url,status:response.status,receivedAt:new Date().toISOString(),body});return{ok:response.ok,status:response.status,headers:response.headers,json:async()=>body};}});
const observations=[];
for(const symbol of ROBINHOOD_PRICE_SYMBOLS){try{observations.push({symbol,status:'observed',observation:await reader.read(symbol),coverage:reader.history(symbol).coverage});}catch(error){observations.push({symbol,status:'unavailable',reason:error instanceof Error?error.message:String(error)});}}
const evidence={capturedAt:new Date().toISOString(),purpose:'Offchain official underlying reference prices, not Testnet pool execution proof',onchainWrites:0,sourceRequests:requests,observations};
await writeFile(new URL('./oracle-rest-evidence.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({symbols:observations.map(x=>({symbol:x.symbol,status:x.status})),requests:requests.length,onchainWrites:0}));
