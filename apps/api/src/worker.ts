import './lib/env.js';
import { setTimeout } from 'node:timers/promises';
import { createRuntime } from './runtime.js';
const runtime=await createRuntime();
let stopping=false;
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{stopping=true;});
console.log(`Testnet worker ready; financial provider execution ${runtime.gate1Passed?'gated proof loaded':'blocked pending Gate 1'}`);
try{while(!stopping){const worked=await runtime.worker.tick();const perpsWorked=await runtime.tickPerpetuals();if(!worked&&!perpsWorked)await setTimeout(2000);}}
finally{await runtime.app.close();}
