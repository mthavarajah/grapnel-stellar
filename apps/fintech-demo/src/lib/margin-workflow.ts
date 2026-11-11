import {MarginWorkflowInputSchema,MarginStepQuoteSchema,type MarginWorkflowPublic} from '@grapnel/contracts';
import {z} from 'zod';
export const MARGIN_MARKET_ID='stellar-testnet:peridot:XLM-USDT-MARGIN';
export const MarginBrowserInputSchema=MarginWorkflowInputSchema.omit({customer_id:true,wallet_id:true});
export const MarginBrowserPrepareSchema=z.object({quote:MarginStepQuoteSchema}).strict();
export const MarginEmptyInputSchema=z.object({}).strict();
export const marginStepLabels:Record<MarginWorkflowPublic['next_steps'][number],string>={vault_deposit:'Deposit collateral',margin_transfer:'Move collateral',open_begin:'Start opening',open_swap:'Swap opening assets',open_activate:'Activate position',open_cancel:'Cancel opening',close_prepare:'Start closing',close_swap:'Swap closing assets',close_short_swap:'Repay closing debt',close_finish:'Finish closing',close_cancel:'Cancel closing',margin_return:'Return collateral',vault_withdraw:'Withdraw collateral'};
export const marginPhaseLabels:Record<MarginWorkflowPublic['phase'],string>={awaiting_collateral:'Collateral deposit needed',awaiting_margin_transfer:'Collateral transfer needed',awaiting_open_begin:'Ready to start opening',opening_pending:'Opening in progress',opening_swapped:'Ready to activate position',open:'Position open',closing_prepared:'Closing in progress',closing_swapped:'Ready to finish closing',closed:'Position closed',awaiting_vault_withdraw:'Collateral withdrawal needed',recovered:'Collateral recovered'};
export const marginStorageKey=(customer:string,wallet:string)=>`grapnel.margin.workflow.v1:${customer}:${wallet}:${MARGIN_MARKET_ID}`;
