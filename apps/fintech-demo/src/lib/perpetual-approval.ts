/** Browser-only independent intent verification. Never imports a server adapter. */
import {Buffer} from 'buffer';
import {Keypair,StrKey} from '@stellar/stellar-sdk';
import {canonicalize,createL1ActionHash} from '@nktkas/hyperliquid/signing';
import {OrderRequest} from '@nktkas/hyperliquid/api/exchange';
import {recoverMessageAddress,recoverTypedDataAddress,stringToHex,type Hex} from 'viem';
import {z} from 'zod';
import {derivativeClass} from './perpetual-market';
const address=z.string().regex(/^0x[a-fA-F0-9]{40}$/),decimal=z.string().regex(/^(0|[1-9]\d{0,29})(\.\d{1,18})?$/),signedDecimal=z.string().regex(/^-?(0|[1-9]\d{0,29})(\.\d{1,18})?$/),digest=z.string().regex(/^[a-f0-9]{64}$/);
const scope=z.object({businessId:z.string().min(1),customerId:z.string().min(1),walletId:z.string().min(1),stellarAddress:z.string()}).strict();
const account=scope.extend({accountAddress:address,signingKeyRef:z.string().min(1).max(200)}).strict();
const intent=z.object({operationId:z.string().uuid(),businessId:z.string().min(1),customerId:z.string().min(1),walletId:z.string().min(1),network:z.literal('hyperliquid-testnet'),accountAddress:address,marketId:z.string(),providerSymbol:z.string().min(1).max(200),assetIndex:z.number().int().nonnegative().safe(),dex:z.string().max(128),side:z.enum(['buy','sell']),leverage:z.number().int().min(1).max(1000),size:decimal,limitPrice:decimal,reduceOnly:z.boolean(),nonce:z.number().int().positive().safe(),clientOrderId:z.string().regex(/^0x[a-f0-9]{32}$/),expiresAt:z.string().datetime(),customerApprovalHash:digest}).strict();
const wire=z.object({action:z.unknown(),nonce:z.number().int().positive().safe(),expiresAfter:z.number().int().positive().safe()}).strict();
const payload=z.object({version:z.literal(1),intent,account,market:z.object({symbol:z.string(),assetIndex:z.number().int().nonnegative(),localAssetIndex:z.number().int().nonnegative(),dex:z.string(),dexIndex:z.number().int().nonnegative(),szDecimals:z.number().int().min(0).max(6),maxLeverage:z.number().int().positive()}).strict(),before:z.object({size:signedDecimal,leverageType:z.enum(['cross','isolated']),observedAt:z.number().int().positive().safe()}).strict(),wire}).strict();
const unsigned=z.object({network:z.literal('hyperliquid-testnet'),accountAddress:address,operationId:z.string().uuid(),nonce:z.number().int().positive().safe(),clientOrderId:z.string(),intentHash:digest,payload,typedData:z.unknown()}).strict();
export const PreparedPerpetualOrderSchema=z.object({id:z.string().uuid(),intent,approvalMessage:z.string().max(10000),approvalDigest:digest,unsignedAction:unsigned});
const challenge=z.object({id:z.string().uuid(),scope,accountAddress:address,message:z.string().max(10000),digest,expiresAt:z.string().datetime()});
export type PreparedPerpetualOrder=z.infer<typeof PreparedPerpetualOrderSchema>;
export type PerpetualBindingChallenge=z.infer<typeof challenge>;
export type ExpectedPerpetualScope={customerId:string;walletId:string;stellarAddress:string;businessId?:string};
export type PerpetualMarketApproval={market_id:string;asset_class:'perps'|'stocks';provider_symbol:string;provider_dex:string;max_leverage:number;underlying:{symbol:string;display_decimals?:number};settlement_asset?:{code?:string|null;compatibility?:'usdc'|'other'|'unresolved'}};
export type PerpetualOrderDraft={market_id:string;side:'buy'|'sell';size:string;limit_price:string;leverage:number;reduce_only:boolean};
export type RawStellarHashSigner=(input:{address:string;chainType:'stellar';hash:Hex})=>Promise<{signature:Hex}>;
export type BrowserEvmProvider={request(input:{method:string;params?:unknown[]}):Promise<unknown>};
const fail=(message='The wallet request differs from your review.'):never=>{throw Error(message);};
const checkedBindings=new WeakSet<object>(),checkedOrders=new WeakSet<object>();
const checkedStellarMessages=new Map<string,{message:string;expiresAt:number}>();
function rememberApproval(address:string,digest:string,message:string,expiresAt:number){for(const[key,value]of checkedStellarMessages)if(value.expiresAt<=Date.now())checkedStellarMessages.delete(key);while(checkedStellarMessages.size>=128)checkedStellarMessages.delete(checkedStellarMessages.keys().next().value!);checkedStellarMessages.set(address+':'+digest,{message,expiresAt});}
function freezeApproval<T>(value:T):T{if(value&&typeof value==='object'){for(const child of Object.values(value))freezeApproval(child);Object.freeze(value);}return value;}

/** Only deterministic JSON values are accepted; matches the frozen lead encoding. */
export function stableApprovalJson(value:unknown):string{
 if(value===null||typeof value!=='object'){if(value===undefined||!['string','number','boolean'].includes(typeof value)&&value!==null||typeof value==='number'&&!Number.isFinite(value))return fail();return JSON.stringify(value);}
 if(Array.isArray(value))return '['+value.map(stableApprovalJson).join(',')+']';
 return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>JSON.stringify(key)+':'+stableApprovalJson(item)).join(',')+'}';
}
export async function approvalSha256(message:string):Promise<string>{return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(message)))].map(value=>value.toString(16).padStart(2,'0')).join('');}
export function normalizedDecimal(value:string):string{if(!signedDecimal.safeParse(value).success)return fail('Enter a valid decimal amount.');const negative=value.startsWith('-'),[whole,fraction='']=(negative?value.slice(1):value).split('.'),trim=fraction.replace(/0+$/,'');return(negative&&(whole!=='0'||trim)?'-':'')+whole+(trim?'.'+trim:'');}
/** Prepare the opposite, reduce-only side without converting token size to Number. */
export function positionCloseFields(positionSize:string):{side:'buy'|'sell';size:string;reduceOnly:true}{
 const value=normalizedDecimal(positionSize);
 if(value==='0')return fail('There is no open position to close.');
 return {side:value.startsWith('-')?'buy':'sell',size:value.replace(/^-/,''),reduceOnly:true};
}
const units=(value:string,decimals:number,signed=false)=>{if(!(signed?signedDecimal:decimal).safeParse(value).success)return fail();const neg=value.startsWith('-'),[whole,fraction='']=(neg?value.slice(1):value).split('.');if(fraction.length>decimals)return fail('The amount has too many decimal places.');return (BigInt(whole!)*10n**BigInt(decimals)+BigInt(fraction.padEnd(decimals,'0')||'0'))*(neg?-1n:1n);};
function expectedScope(actual:z.infer<typeof scope>,expected:ExpectedPerpetualScope){if(actual.customerId!==expected.customerId||actual.walletId!==expected.walletId||actual.stellarAddress!==expected.stellarAddress||expected.businessId&&actual.businessId!==expected.businessId||!StrKey.isValidEd25519PublicKey(expected.stellarAddress))return fail('This request belongs to a different wallet session.');}
export function bindingApprovalMessage(value:Pick<PerpetualBindingChallenge,'id'|'scope'|'accountAddress'|'expiresAt'>):string{return 'Grapnel Perpetuals account binding\n'+stableApprovalJson({version:1,network:'hyperliquid-testnet',challengeId:value.id,...value.scope,accountAddress:value.accountAddress.toLowerCase(),expiresAt:value.expiresAt});}
export async function inspectPerpetualBinding(value:unknown,expected:ExpectedPerpetualScope,evmAddress:string,now=Date.now()):Promise<PerpetualBindingChallenge>{
 const c=challenge.parse(structuredClone(value));expectedScope(c.scope,expected);if(!address.safeParse(evmAddress).success||c.accountAddress.toLowerCase()!==evmAddress.toLowerCase()||Date.parse(c.expiresAt)<=now||Date.parse(c.expiresAt)>now+600000)return fail('This connection review is invalid or expired.');
 const message=bindingApprovalMessage(c);if(c.message!==message||c.digest!==await approvalSha256(message))return fail();rememberApproval(c.scope.stellarAddress,c.digest,c.message,Date.parse(c.expiresAt));freezeApproval(c);checkedBindings.add(c);return c;
}
export function orderApprovalMessage(i:z.infer<typeof intent>,stellarAddress:string):string{
 const {customerApprovalHash:_,...fields}=i;return 'Grapnel Perpetuals order approval\n'+stableApprovalJson({version:1,...fields,stellarAddress});
}
export function reconstructedOrderAction(i:z.infer<typeof intent>){return canonicalize(OrderRequest.entries.action,{type:'order',orders:[{a:i.assetIndex,b:i.side==='buy',p:normalizedDecimal(i.limitPrice),s:normalizedDecimal(i.size),r:i.reduceOnly,t:{limit:{tif:'Ioc' as const}},c:i.clientOrderId}],grouping:'na' as const});}
export function reconstructedOrderTypedData(action:Record<string,unknown>,nonce:number,expiresAfter:number){return {domain:{name:'Exchange',version:'1',chainId:1337,verifyingContract:'0x0000000000000000000000000000000000000000' as const},types:{Agent:[{name:'source',type:'string'},{name:'connectionId',type:'bytes32'}]},primaryType:'Agent' as const,message:{source:'b',connectionId:createL1ActionHash({action,nonce,expiresAfter})}};}
export async function inspectPerpetualOrder(value:unknown,expected:ExpectedPerpetualScope,evmAddress:string,market:PerpetualMarketApproval,draft:PerpetualOrderDraft,now=Date.now()):Promise<PreparedPerpetualOrder>{
 const order=PreparedPerpetualOrderSchema.parse(structuredClone(value)),i=order.intent,u=order.unsignedAction,p=u.payload;expectedScope(p.account,expected);
 if(derivativeClass(market.market_id)!==market.asset_class||market.settlement_asset?.compatibility!=='usdc'||i.accountAddress.toLowerCase()!==evmAddress.toLowerCase()||p.account.accountAddress.toLowerCase()!==evmAddress.toLowerCase()||i.businessId!==p.account.businessId||i.customerId!==expected.customerId||i.walletId!==expected.walletId||order.id!==i.operationId||i.marketId!==market.market_id||draft.market_id!==market.market_id||i.providerSymbol!==market.provider_symbol||i.dex!==market.provider_dex||i.side!==draft.side||i.leverage!==draft.leverage||i.leverage>market.max_leverage||i.reduceOnly!==draft.reduce_only||normalizedDecimal(i.size)!==normalizedDecimal(draft.size)||normalizedDecimal(i.limitPrice)!==normalizedDecimal(draft.limit_price))return fail();
 const index=Number(i.marketId.split(':').at(-1));if(!Number.isSafeInteger(index)||index!==i.assetIndex||p.market.assetIndex!==index||p.market.symbol!==i.providerSymbol||p.market.dex!==i.dex||p.market.maxLeverage!==market.max_leverage||market.underlying.display_decimals!==undefined&&p.market.szDecimals!==market.underlying.display_decimals||p.market.dexIndex===0&&(i.dex!==''||p.market.localAssetIndex!==i.assetIndex)||p.market.dexIndex>0&&(i.dex===''||100000+p.market.dexIndex*10000+p.market.localAssetIndex!==i.assetIndex)||Date.parse(i.expiresAt)<=now||Date.parse(i.expiresAt)>i.nonce+60000||i.nonce>now+1000||now-i.nonce>60000)return fail('This order review changed or expired. Prepare it again.');
 const size=units(i.size,p.market.szDecimals),price=units(i.limitPrice,18),fraction=normalizedDecimal(i.limitPrice).split('.')[1]??'';if(size<=0n||price<=0n||fraction.length>6-p.market.szDecimals||fraction&&normalizedDecimal(i.limitPrice).replace('.','').replace(/^0+/,'').length>5)return fail('This order precision is unavailable for the selected market.');
 const before=units(p.before.size,p.market.szDecimals,true);if(i.reduceOnly&&(before===0n||before>0n&&i.side!=='sell'||before<0n&&i.side!=='buy'||size>(before<0n?-before:before))||!i.reduceOnly&&(before>0n&&i.side!=='buy'||before<0n&&i.side!=='sell'))return fail('The order does not match the reviewed position direction.');
 const message=orderApprovalMessage(i,expected.stellarAddress),hash=await approvalSha256(message);
 if(order.approvalMessage!==message||order.approvalDigest!==hash||i.customerApprovalHash!==hash||stableApprovalJson(p.intent)!==stableApprovalJson(i)||u.operationId!==i.operationId||u.accountAddress.toLowerCase()!==i.accountAddress.toLowerCase()||u.nonce!==i.nonce||u.clientOrderId!==i.clientOrderId||u.intentHash!==await approvalSha256(stableApprovalJson({intent:i,account:p.account}))||p.wire.nonce!==i.nonce||p.wire.expiresAfter!==Date.parse(i.expiresAt))return fail();
 const action=reconstructedOrderAction(i),typed=reconstructedOrderTypedData(action,i.nonce,p.wire.expiresAfter);
 if(stableApprovalJson(p.wire.action)!==stableApprovalJson(action)||createL1ActionHash({action:p.wire.action as Record<string,unknown>,nonce:p.wire.nonce,expiresAfter:p.wire.expiresAfter})!==typed.message.connectionId||stableApprovalJson(u.typedData)!==stableApprovalJson(typed))return fail('The exchange signature does not match your reviewed order.');
 rememberApproval(expected.stellarAddress,hash,message,Date.parse(i.expiresAt));freezeApproval(order);checkedOrders.add(order);return order;
}
export async function signStellarApproval(message:string,digest:string,stellarAddress:string,sign:RawStellarHashSigner):Promise<string>{
 const registered=checkedStellarMessages.get(stellarAddress+':'+digest);if(!registered||registered.message!==message||registered.expiresAt<=Date.now()||digest!==await approvalSha256(message)||!StrKey.isValidEd25519PublicKey(stellarAddress))return fail();const result=await sign({address:stellarAddress,chainType:'stellar',hash:`0x${digest}`}),signature=result.signature.replace(/^0x/,'');if(!/^[a-fA-F0-9]{128}$/.test(signature)||!Keypair.fromPublicKey(stellarAddress).verify(Buffer.from(digest,'hex'),Buffer.from(signature,'hex')))return fail('The wallet signature did not match this approval.');return signature.toLowerCase();
}
async function assertProviderAccount(provider:BrowserEvmProvider,expected:string){const accounts=await provider.request({method:'eth_accounts'});if(!Array.isArray(accounts)||!accounts.some(value=>typeof value==='string'&&value.toLowerCase()===expected.toLowerCase()))return fail('Reconnect the selected trading wallet before approving.');}
export async function signEvmBinding(provider:BrowserEvmProvider,c:PerpetualBindingChallenge):Promise<Hex>{
 if(!checkedBindings.has(c)||Date.parse(c.expiresAt)<=Date.now())return fail('Review this wallet connection before signing.');await assertProviderAccount(provider,c.accountAddress);const sig=await provider.request({method:'personal_sign',params:[stringToHex(c.message),c.accountAddress]});if(typeof sig!=='string'||!/^0x[a-fA-F0-9]{130}$/.test(sig)||(await recoverMessageAddress({message:c.message,signature:sig as Hex})).toLowerCase()!==c.accountAddress.toLowerCase())return fail('The trading wallet signature did not match this connection.');return sig as Hex;
}
export async function signEvmOrder(provider:BrowserEvmProvider,order:PreparedPerpetualOrder):Promise<Hex>{
 if(!checkedOrders.has(order)||Date.parse(order.intent.expiresAt)<=Date.now())return fail('Review this order before signing.');const i=order.intent;await assertProviderAccount(provider,i.accountAddress);const typed=reconstructedOrderTypedData(reconstructedOrderAction(i),i.nonce,Date.parse(i.expiresAt));
 // RPC v4 needs the standard domain descriptor; the inspected SDK Agent data is unchanged.
 const forWallet={...typed,types:{EIP712Domain:[{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'}],...typed.types}};
 const sig=await provider.request({method:'eth_signTypedData_v4',params:[i.accountAddress,JSON.stringify(forWallet)]});if(typeof sig!=='string'||!/^0x[a-fA-F0-9]{130}$/.test(sig)||(await recoverTypedDataAddress({...typed,signature:sig as Hex})).toLowerCase()!==i.accountAddress.toLowerCase())return fail('The trading wallet signature did not match this order.');return sig as Hex;
}
export type PerpetualApi=(path:string,body?:unknown,method?:'GET'|'POST',idempotencyKey?:string)=>Promise<any>;
export const PerpetualAccountSnapshotSchema=z.object({network:z.literal('hyperliquid-testnet'),account:account.extend({id:z.string(),createdAt:z.string()}).passthrough().nullable(),execution_available:z.boolean(),reason:z.string().nullable(),withdrawable:decimal.nullable(),account_value:signedDecimal.nullable(),positions:z.array(z.object({symbol:z.string(),size:signedDecimal,entry_price:decimal.nullable(),unrealized_pnl:signedDecimal.nullable(),leverage:z.number().nonnegative()}).passthrough()),funding:z.object({asset_id:z.string(),trustline_ready:z.boolean(),balance:decimal.nullable(),allowance:decimal.nullable(),bridge_available:z.boolean(),reason:z.string().nullable()}).passthrough(),venues:z.array(z.object({dex:z.string(),withdrawable:decimal.nullable(),accountValue:signedDecimal.nullable(),positions:z.array(z.unknown())}).passthrough()).optional(),selected_market:z.object({market_id:z.string(),symbol:z.string(),leverage:z.number().int().positive(),leverage_type:z.enum(['cross','isolated']),max_trade_sizes:z.array(decimal).nullable(),available_to_trade:z.array(decimal).nullable()}).nullable().optional()}).passthrough();
export type PerpetualAccountSnapshot=z.infer<typeof PerpetualAccountSnapshotSchema>;
export function inspectPerpetualAccount(value:unknown,expected:ExpectedPerpetualScope,market:PerpetualMarketApproval):PerpetualAccountSnapshot{
 const result=PerpetualAccountSnapshotSchema.parse(value);if(result.account)expectedScope(result.account,expected);if(result.selected_market&&(result.selected_market.market_id!==market.market_id||result.selected_market.symbol!==market.provider_symbol))return fail('The trading account data does not match this market.');return result;
}
/** Top-level balances describe the native venue only, never a builder venue. */
export function selectedVenueBalance(snapshot:PerpetualAccountSnapshot|null,market:PerpetualMarketApproval):{withdrawable:string|null;accountValue:string|null}{
 if(!snapshot?.account||market.settlement_asset?.compatibility!=='usdc')return {withdrawable:null,accountValue:null};const venue=snapshot.venues?.find(row=>row.dex===market.provider_dex);
 if(venue)return {withdrawable:venue.withdrawable,accountValue:venue.accountValue};
 return market.provider_dex===''?{withdrawable:snapshot.withdrawable,accountValue:snapshot.account_value}:{withdrawable:null,accountValue:null};
}
export function hasPositiveDecimal(value:string|null|undefined):boolean{try{return typeof value==='string'&&units(value,18)>0n;}catch{return false;}}
