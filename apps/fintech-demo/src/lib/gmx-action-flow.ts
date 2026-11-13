import{toAtomic}from'@grapnel/contracts';
import type{GmxCustomerDraft,GmxCustomerRequest}from'./gmx-customer';
export interface GmxActionPorts{
 prepare:(input:GmxCustomerDraft)=>Promise<GmxCustomerRequest>;
 authorize:(request:GmxCustomerRequest,input:GmxCustomerDraft)=>Promise<GmxCustomerRequest>;
 read:(id:string)=>Promise<GmxCustomerRequest>;
 approvalConfirmed:(request:GmxCustomerRequest)=>boolean;
 allowanceAtomic6:bigint;
 current:()=>void;waiting:()=>void;wait:()=>Promise<void>;
}
const same=(a:GmxCustomerRequest,b:GmxCustomerRequest)=>a.id===b.id&&a.kind===b.kind&&a.market_id===b.market_id&&JSON.stringify(Object.entries(a.intent).sort())===JSON.stringify(Object.entries(b.intent).sort());
/** Explicit Long/Short/Retry only. Passive recovery never invokes a signer. */
export async function executeGmxAction(input:GmxCustomerDraft,p:GmxActionPorts,retry?:GmxCustomerRequest){
 p.current();
 const needsApproval=input.kind==='open'&&(retry?retry.kind==='approve':p.allowanceAtomic6<toAtomic(input.collateral,6));
 const firstInput:GmxCustomerDraft=needsApproval?{kind:'approve',symbol:input.symbol,amount:input.kind==='open'?input.collateral:''}:input;
 const first=retry??await p.prepare(firstInput);p.current();let result=await p.authorize(first,firstInput);p.current();
 if(!same(first,result))throw Error('The transaction status does not match this action.');
 if(!needsApproval)return result;
 for(let n=0;!['completed','cancelled','reverted'].includes(result.state)&&n<20;n++){
  p.waiting();await p.wait();p.current();const next=await p.read(first.id);p.current();if(!same(first,next))throw Error('The approval status belongs to a different transaction.');result=next;
 }
 if(result.state!=='completed'||!p.approvalConfirmed(result))throw Error('The spending approval has not confirmed. Check its status before opening a position.');
 const order=await p.prepare(input);p.current();return p.authorize(order,input);
}
