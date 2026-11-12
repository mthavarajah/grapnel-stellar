import {operationProgress,type ApprovalPhase} from '../lib/operation-progress';
export function ProgressIndicator({label,spinning=false,completed=false}:{label:string;spinning?:boolean;completed?:boolean}){
 return <span className="operation-progress" role="status" aria-live="polite"><span className={spinning?'operation-spinner':completed?'operation-complete':'operation-dot'} aria-hidden="true">{completed?'✓':null}</span><span>{label}</span></span>;
}
export function OperationProgress({status,approvalPhase}:{status:string;approvalPhase?:ApprovalPhase|null}){return <ProgressIndicator {...operationProgress(status,approvalPhase)}/>;}
