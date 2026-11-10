import './lib/env.js';
import { buildApp } from './app.js';
import { loadConfig } from './lib/config.js';
const config=loadConfig();
const app=await buildApp({config});
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{void app.close().then(()=>process.exit(0));});
await app.listen({host:'0.0.0.0',port:config.port});
console.log(`Grapnel Stellar Testnet API listening on ${config.port}`);
