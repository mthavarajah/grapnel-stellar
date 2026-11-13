export type ApprovalPhase='approving'|'signed';
export type ProgressState={label:string;spinning:boolean;completed:boolean};
/** Labels reflect a server state or the actual local signature request, never a timer. */
export function operationProgress(status:string,approvalPhase?:ApprovalPhase|null):ProgressState{
 if(status==='awaiting_customer_authorization'&&approvalPhase)return {label:approvalPhase==='approving'?'Approving':'Approved · submitting',spinning:true,completed:false};
 const label:Record<string,string>={accepted:'Processing',validating:'Processing',preparing:'Processing',awaiting_customer_authorization:'Needs approval',submitted:'Submitted',confirming:'Confirming',completed:'Completed',failed:'Failed',rejected:'Declined',expired:'Expired',recovery_required:'Check transaction'};
 return {label:label[status]??'In progress',spinning:['accepted','validating','preparing','submitted','confirming'].includes(status),completed:status==='completed'};
}
/** A signature is called approved only once the signer has returned it. */
export async function trackApproval<T,S>(sign:()=>Promise<S>,submit:(signed:S)=>Promise<T>,phase:(value:ApprovalPhase|null)=>void):Promise<T>{
 phase('approving');try{const signed=await sign();phase('signed');return await submit(signed);}finally{phase(null);}
}
/** Keep an actively watched transaction responsive; only slow long/background waits. */
export function operationPollDelay(attempt:number,visible=true):number{return !visible?10000:attempt<20?1500:attempt<60?3000:10000;}
