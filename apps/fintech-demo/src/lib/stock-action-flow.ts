import type{RobinhoodDraft,RobinhoodRequest}from'./robinhood-customer';
export interface StockActionPorts{
 prepare:(input:RobinhoodDraft)=>Promise<RobinhoodRequest>;
 authorize:(request:RobinhoodRequest,input:RobinhoodDraft)=>Promise<RobinhoodRequest>;
 read:(id:string)=>Promise<RobinhoodRequest>;
 approvalConfirmed:(request:RobinhoodRequest)=>boolean;
 current:()=>void;
 waiting:()=>void;
 wait:()=>Promise<void>;
}
/** Called only from Buy/Sell. Approval confirmation may advance this same intent;
 * passive recovery never calls this function and unknown sends are never repeated. */
export async function executeStockTrade(input:RobinhoodDraft,p:StockActionPorts,retryRequest?:RobinhoodRequest){
 const sameRequest=(a:RobinhoodRequest,b:RobinhoodRequest)=>a.id===b.id&&a.kind===b.kind&&a.market_id===b.market_id&&JSON.stringify(Object.entries(a.intent).sort())===JSON.stringify(Object.entries(b.intent).sort());
 // Explicit Retry continues the inspected, unsigned request. It must run the
 // same approval-to-swap sequence rather than treating an allowance as a trade.
 p.current();const first=retryRequest??await p.prepare(input);p.current();let result=await p.authorize(first,input);p.current();
 if(!sameRequest(first,result))throw Error('The transaction status does not match this trade.');
 if(input.kind==='swap')return result;
 for(let n=0;!['completed','cancelled','reverted'].includes(result.state)&&n<12;n++){
  p.waiting();await p.wait();p.current();const next=await p.read(first.id);p.current();
  if(!sameRequest(first,next))throw Error('The approval status belongs to a different transaction.');result=next;
 }
 if(result.state!=='completed'||!p.approvalConfirmed(result))throw Error('The spending approval has not confirmed. Check its status before buying or selling.');
 const swap:RobinhoodDraft={...input,kind:'swap'};p.current();const prepared=await p.prepare(swap);p.current();return p.authorize(prepared,swap);
}
