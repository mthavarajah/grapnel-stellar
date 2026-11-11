/** Opt-in provider diagnosis only: quote/build never signs, sends or fills an order.
 * Run with RUN_LIVE_MARKET_READS=true and SOROSWAP_API_KEY injected server-side. */
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../apps/api/package.json',import.meta.url));
const {Asset,TransactionBuilder}=require('@stellar/stellar-sdk');
const passphrase='Test SDF Network ; September 2015';
const issuer='GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56';
if(process.env.RUN_LIVE_MARKET_READS!=='true')throw Error('Set RUN_LIVE_MARKET_READS=true for explicit read-only Testnet diagnosis');
if(!process.env.SOROSWAP_API_KEY)throw Error('SOROSWAP_API_KEY is required server-side');
const source=process.env.MARKETS_DIAGNOSTIC_ACCOUNT??'GA237QIWQI6TUI3DTTWQELRHCGNMB3WWMSKY7LLXW3B4FBQJN3TN6IP4';
async function horizon(path:string){const r=await fetch('https://horizon-testnet.stellar.org'+path,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Testnet Horizon read returned '+r.status);return r.json();}
async function provider(path:string,body?:unknown){const r=await fetch('https://api.soroswap.finance'+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+process.env.SOROSWAP_API_KEY,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Read-only provider request '+path+' returned '+r.status);return {status:r.status,body:await r.json()};}
const root=await horizon('');if(root.network_passphrase!==passphrase)throw Error('Testnet passphrase mismatch');
const account=await horizon('/accounts/'+encodeURIComponent(source));
if(!account.balances.some((b:{asset_code?:string;asset_issuer?:string;is_authorized?:boolean})=>b.asset_code==='USDC'&&b.asset_issuer===issuer&&b.is_authorized!==false))throw Error('Diagnostic account lacks exact authorized Testnet USDC trustline');
const protocols=await provider('/protocols?network=testnet');if(!Array.isArray(protocols.body)||!protocols.body.includes('soroswap'))throw Error('Soroswap Testnet protocol unavailable');
const assetIn=Asset.native().contractId(passphrase),assetOut=new Asset('USDC',issuer).contractId(passphrase);
const quoted=await provider('/quote?network=testnet',{assetIn,assetOut,amount:'10000000',tradeType:'EXACT_IN',protocols:['soroswap'],slippageBps:49});const q=quoted.body;
if(q.assetIn!==assetIn||q.assetOut!==assetOut||q.amountIn!=='10000000'||q.tradeType!=='EXACT_IN'||typeof q.amountOut!=='string'||typeof q.otherAmountThreshold!=='string'||BigInt(q.otherAmountThreshold)<(BigInt(q.amountOut)*9950n+9999n)/10000n)throw Error('Quote violates exact asset/amount/slippage intent');
const built=await provider('/quote/build?network=testnet',{quote:q,from:source,to:source});if(typeof built.body.xdr!=='string')throw Error('Provider returned no unsigned XDR');
const tx=TransactionBuilder.fromXDR(built.body.xdr,passphrase);if(tx.source!==source||tx.signatures.length||tx.operations.length!==1||tx.operations[0]?.type!=='invokeHostFunction')throw Error('Unexpected unsigned build shape');
console.log(JSON.stringify({observed_at:new Date().toISOString(),mode:'read_only_provider_diagnosis',network:'stellar-testnet',broadcast:false,signing:false,protocols_status:protocols.status,protocols:protocols.body,quote_status:quoted.status,build_status:built.status,asset_in:assetIn,asset_out:assetOut,amount_in_atomic:q.amountIn,expected_out_atomic:q.amountOut,min_out_atomic:q.otherAmountThreshold,unsigned_operation:tx.operations[0].type,unsigned_fee_stroops:tx.fee,unsigned_auth_entries:tx.operations[0].auth?.length??0,execution_verified:false,note:'Raw provider build requires adapter intent/auth/footprint inspection and enforce simulation; this is not a prepared approval or chain proof.'},null,2));
