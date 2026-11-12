import { z } from 'zod';
export const CONTRACT_VERSION = '0.2.5' as const;
export const NETWORK = 'stellar-testnet' as const;
export const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015' as const;
export const MODULE_IDS = ['capital.wallets','capital.testnet_funding','capital.lending','trade.spot','trade.stocks','trade.perps'] as const;
export const ModuleIdSchema = z.enum(MODULE_IDS);
export type ModuleId = z.infer<typeof ModuleIdSchema>;
export const ExecutionStatusSchema = z.enum(['testnet_verified','discovery_only','blocked','simulation']);
export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>;
export const AmountSchema = z.string().regex(/^(0|[1-9]\d*)(\.\d+)?$/).max(100);
export function toAtomic(value: string, decimals: number): bigint {
  AmountSchema.parse(value);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) throw new Error('INVALID_DECIMALS');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new Error('AMOUNT_PRECISION');
  const atomic = BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals,'0') || '0');
  if (atomic <= 0n || atomic.toString().length > 78) throw new Error('INVALID_AMOUNT');
  return atomic;
}
export function fromAtomic(value: bigint, decimals: number): string {
  const sign = value < 0n ? '-' : ''; const digits = (value < 0n ? -value : value).toString().padStart(decimals+1,'0');
  return sign + (decimals ? digits.slice(0,-decimals)+'.'+digits.slice(-decimals) : digits);
}
/** Display only: truncate to significant digits so available funds are never overstated. */
export function formatTokenAmount(value:string|null|undefined,significantDigits=6):string {
 if(typeof value!=='string'||value.length>100||!/^\d+(?:\.\d+)?$/.test(value)||!Number.isInteger(significantDigits)||significantDigits<1||significantDigits>18)return 'Unavailable';
 const [whole,fraction='']=value.split('.');if(fraction.length>38)return 'Unavailable';
 let atomic=BigInt(whole!+fraction);const length=atomic.toString().length;
 if(length>significantDigits){const factor=10n**BigInt(length-significantDigits);atomic=atomic/factor*factor;}
 const [integer,decimal='']=fromAtomic(atomic,fraction.length).split('.');
 const tail=decimal.replace(/0+$/,'');return integer!.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(tail?'.'+tail:'');
}
export const AssetIdentitySchema = z.object({id:z.string(),network:z.literal(NETWORK),kind:z.enum(['native','classic','soroban']),code:z.string(),name:z.string().optional(),issuer:z.string().optional(),contractId:z.string().optional(),decimals:z.number().int().min(0).max(38),verified:z.boolean(),sourceUrl:z.string().url()});
export type AssetIdentity = z.infer<typeof AssetIdentitySchema>;
/** Additive metadata for asset selectors; identifiers stay authoritative. */
export const SpotMarketAssetsSchema=z.object({asset_in_id:z.string(),asset_out_id:z.string(),asset_in:AssetIdentitySchema.optional(),asset_out:AssetIdentitySchema.optional()}).superRefine((market,context)=>{
 for(const side of ['in','out'] as const){const asset=market[`asset_${side}`];if(asset&&asset.id!==market[`asset_${side}_id`])context.addIssue({code:z.ZodIssueCode.custom,path:[`asset_${side}`],message:'Asset metadata must match the exact market identity'});}
});
export const CapabilitySchema = z.object({module:ModuleIdSchema,enabled:z.boolean(),provider:z.string(),execution_status:ExecutionStatusSchema,reason:z.string().nullable(),actions:z.array(z.string())});
export type Capability = z.infer<typeof CapabilitySchema>;
export const OperationStatusSchema = z.enum(['accepted','validating','preparing','awaiting_customer_authorization','submitted','confirming','completed','rejected','expired','failed','recovery_required']);
export type OperationStatus = z.infer<typeof OperationStatusSchema>;
export const PreparedActionSchema = z.object({operationId:z.string(),customerId:z.string(),network:z.literal(NETWORK),walletAddress:z.string(),unsignedXdr:z.string(),signingHashHex:z.string().regex(/^[a-f0-9]{64}$/),summary:z.object({action:z.string(),positionId:z.string().regex(/^[1-9]\d{0,19}$/).optional(),fromAssetId:z.string().optional(),toAssetId:z.string().optional(),amount:z.string().optional(),recipient:z.string().optional(),contractId:z.string().optional(),maxFeeStroops:z.string().optional(),minReceive:z.string().optional(),expiresAt:z.string().datetime()}),authorization:z.object({method:z.literal('privy_stellar'),expiresAt:z.string().datetime()})});
export type PreparedAction = z.infer<typeof PreparedActionSchema>;
export const OperationSchema = z.object({operation_id:z.string(),customer_id:z.string(),wallet_id:z.string(),module:ModuleIdSchema,type:z.string(),status:OperationStatusSchema,network:z.literal(NETWORK),tx_hash:z.string().nullable(),provider:z.string(),created_at:z.string(),updated_at:z.string(),error:z.object({code:z.string(),message:z.string()}).nullable(),prepared_action:PreparedActionSchema.optional(),customer_action_token:z.string().optional(),display_amount:AmountSchema.optional(),display_asset_id:z.string().optional()});
export type Operation = z.infer<typeof OperationSchema>;
export const CustomerInputSchema = z.object({external_customer_id:z.string().min(1).max(200)}).strict();
export const ModulesInputSchema = z.object({modules:z.array(ModuleIdSchema).max(7)}).strict();
export const WalletInputSchema = z.object({customer_id:z.string().uuid(),privy_identity_proof:z.string().min(1)}).strict();
export const FundingInputSchema = z.object({customer_id:z.string().uuid(),wallet_id:z.string().uuid(),asset_id:z.string(),amount:AmountSchema}).strict();
export const LendingInputSchema = FundingInputSchema.extend({market_id:z.string()});
export const MARGIN_STEP_IDS=['vault_deposit','margin_transfer','open_begin','open_swap','open_activate','open_cancel','close_atomic','close_prepare','close_swap','close_short_swap','close_finish','close_cancel','margin_return','vault_withdraw'] as const;
export const MarginStepSchema=z.enum(MARGIN_STEP_IDS);
export const MarginPhaseSchema=z.enum(['awaiting_collateral','awaiting_margin_transfer','awaiting_open_begin','opening_pending','opening_swapped','open','closing_prepared','closing_swapped','closed','awaiting_vault_withdraw','recovered']);
const MarginAtomicSchema=z.string().regex(/^(0|[1-9]\d{0,37})$/);
const MarginPositiveAtomicSchema=z.string().regex(/^[1-9]\d{0,37}$/);
export const MarginCustomerBindingSchema=z.object({customer_id:z.string().uuid(),wallet_id:z.string().uuid().optional()}).strict();
export const MarginWorkflowInputSchema=MarginCustomerBindingSchema.extend({market_id:z.string().min(1).max(200),direction:z.enum(['long','short']),leverage:z.union([z.literal(2),z.literal(3),z.literal(4),z.literal(5)]),amount:AmountSchema.refine(value=>{try{toAtomic(value,7);return true;}catch{return false;}},'A positive amount with at most seven decimals is required'),slippage_bps:z.number().int().min(0).max(50)}).strict();
/** Only exact step output/input bounds are public; server policy, pins and chain baselines stay private. */
export const MarginStepTermsSchema=z.object({minimumOutputAtomic:MarginPositiveAtomicSchema.optional(),maximumInputAtomic:MarginPositiveAtomicSchema.optional(),minimumDebtOutputAtomic:MarginPositiveAtomicSchema.optional()}).strict();
export const MarginStepInputSchema=MarginCustomerBindingSchema.extend({terms:MarginStepTermsSchema}).strict();
export const MarginWorkflowPublicSchema=z.object({workflow_id:z.string().uuid(),customer_id:z.string().uuid(),wallet_id:z.string().uuid(),market_id:z.string(),direction:z.enum(['long','short']),leverage:z.union([z.literal(2),z.literal(3),z.literal(4),z.literal(5)]),amount_atomic:MarginPositiveAtomicSchema,asset_id:z.string(),phase:MarginPhaseSchema,revision:z.number().int().nonnegative(),position_id:MarginAtomicSchema.nullable(),active_operation_id:z.string().uuid().nullable(),receipt_atomic:MarginAtomicSchema.nullable().optional(),created_at:z.string().datetime(),updated_at:z.string().datetime(),next_steps:z.array(MarginStepSchema),execution_status:ExecutionStatusSchema,preparation_available:z.boolean(),reason:z.string().max(300).optional()}).strict();
export const MarginStepQuoteSchema=z.object({workflow_id:z.string().uuid(),step:MarginStepSchema,revision:z.number().int().nonnegative(),terms:MarginStepTermsSchema,expires_at:z.string().datetime()}).strict();
export type MarginWorkflowPublic=z.infer<typeof MarginWorkflowPublicSchema>;
export type MarginStepQuote=z.infer<typeof MarginStepQuoteSchema>;
export const MarginCollateralFundingQuoteInputSchema=MarginCustomerBindingSchema.extend({amount:AmountSchema.refine(value=>{try{return toAtomic(value,7)<=100000000n;}catch{return false;}},'A positive amount of at most10XLM with seven decimals is required')}).strict();
export const MarginCollateralFundingInputSchema=MarginCollateralFundingQuoteInputSchema.extend({minimum_output_atomic:MarginPositiveAtomicSchema}).strict();
export const MarginCollateralFundingQuoteSchema=z.object({from_asset_id:z.string(),to_asset_id:z.string(),amount_in_atomic:MarginPositiveAtomicSchema,expected_out_atomic:MarginPositiveAtomicSchema,minimum_out_atomic:MarginPositiveAtomicSchema,expires_at:z.string().datetime()}).strict();
/** Repayment transfers a customer-approved maximum; only proven actual debt is retained by the pool. */
export const BorrowRepayAllFieldsSchema=z.object({repay_all_amount:AmountSchema.nullable().optional(),can_prepare_repay_all:z.boolean().optional()}).passthrough().superRefine((row,ctx)=>{
 if(row.can_prepare_repay_all===true){try{toAtomic(row.repay_all_amount??'',7);}catch{ctx.addIssue({code:z.ZodIssueCode.custom,path:['repay_all_amount'],message:'Repay All requires an exact positive seven-decimal maximum debit'});}}
});
export const QuoteInputSchema = z.object({customer_id:z.string().uuid(),market_id:z.string(),exact_in:z.object({asset_id:z.string(),amount:AmountSchema}).strict(),slippage_bps:z.number().int().min(0).max(500)}).strict();
export const OrderInputSchema = z.object({customer_id:z.string().uuid(),quote_id:z.string().uuid(),wallet_id:z.string().uuid()}).strict();
export const AuthorizeInputSchema = z.object({customer_action_token:z.string(),signed_xdr:z.string(),privy_identity_proof:z.string()}).strict();
export const XLM: AssetIdentity = {id:'stellar-testnet:native:XLM',network:NETWORK,kind:'native',code:'XLM',decimals:7,verified:true,sourceUrl:'https://developers.stellar.org/docs/tokens/stellar-asset-contract'};
export interface CustomerContext { businessId:string; customerId:string; walletId:string; walletAddress:string; privyUserId:string; }
export interface WalletSigner {
 provisionForCustomer(customerId:string,privyUserId:string):Promise<{privyWalletId:string;stellarAddress:string;publicKey:string}>;
 verifyClientSignedAction(action:PreparedAction,signedXdr:string,customerIdentity:string):Promise<void>;
}
export interface ChainAction { operationId:string; customerId:string; walletAddress:string; operationXdr:string; summary:PreparedAction['summary']; allowedContracts:string[]; }
export interface NetworkExecutor {
 prepareAndSimulate(input:ChainAction):Promise<PreparedAction>;
 submit(signedXdr:string,operationId:string):Promise<{txHash:string;state:'submitted'}>;
 reconcile(txHash:string):Promise<'completed'|'failed'|'pending'>;
}
export interface AdapterCapabilities {provider:string;networks:typeof NETWORK[];modes:('read'|'quote'|'execute')[];status:ExecutionStatus;reason?:string;}
export interface FinancialAdapter<TRequest,TPosition> {
 capabilities():Promise<AdapterCapabilities>;
 validate(request:TRequest,customer:CustomerContext):Promise<void>;
 prepare(request:TRequest,customer:CustomerContext):Promise<PreparedAction>;
 reconcile(operation:Operation):Promise<{state:string;positions?:TPosition[];txHash?:string}>;
}
export class GrapnelError extends Error {
 constructor(public statusCode:number,public code:string,message:string,public retryable=false,public details:Record<string,unknown>={}) {super(message);}
}
export interface VerifiedIdentity {userId:string;wallets:{id:string;address:string;publicKey:string}[];}
export interface IdentityVerifier {verify(token:string):Promise<VerifiedIdentity>;}
export interface WalletBalance {asset_id:string;wallet_amount:string;reserved:string;spendable:string;as_of:string;source:string;asset?:AssetIdentity;}
