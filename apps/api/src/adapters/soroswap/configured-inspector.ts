import {SoroswapTokenPairInspector} from './token-pair-inspector.js';
import {GrapnelError,XLM,SPOT_TOKEN_PAIR_PINS,type PreparedAction} from '@grapnel/contracts';
import {SoroswapDirectInspector,USDC_ISSUER,type InspectorDependencies} from './inspector.js';
import {STANDALONE_NATIVE_ROUTES,standaloneAssetId} from './direct-assets.js';
import type {SpotXdrInspector,SpotExactQuoteReader} from './index.js';
const CLASSIC_PAIR='CBR76WMT6J733CCVBP23M2EL5QGP5HXLPEFNFZGZ7IB6QHOJAHP7YM3V';
/** Finite exact pair dispatcher. No arbitrary pair, aggregator or multihop route acceptance. */
export class SoroswapConfiguredInspector {
 private readonly entries:{assetId:string;counterpartId:string;pair:string;inspector:SoroswapDirectInspector|SoroswapTokenPairInspector}[];
 constructor(deps:InspectorDependencies={}){this.entries=[{assetId:`stellar-testnet:classic:USDC:${USDC_ISSUER}`,counterpartId:XLM.id,pair:CLASSIC_PAIR,inspector:new SoroswapDirectInspector(CLASSIC_PAIR,deps)},...STANDALONE_NATIVE_ROUTES.map(r=>({assetId:standaloneAssetId(r.contract),counterpartId:XLM.id,pair:r.pair,inspector:new SoroswapDirectInspector(r.pair,deps)})),...SPOT_TOKEN_PAIR_PINS.map(r=>({assetId:standaloneAssetId(r.a.contract),counterpartId:standaloneAssetId(r.b.contract),pair:r.pair,inspector:new SoroswapTokenPairInspector(r,deps)}))];}
 private forAssets(from?:string,to?:string){const found=this.entries.find(e=>(e.assetId===from&&e.counterpartId===to)||(e.assetId===to&&e.counterpartId===from));if(!found)throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Only independently inspected exact direct Testnet pairs are available',false,{reason:'DIRECT_REVIEWED_ROUTE_REQUIRED'});return found.inspector;}
 readonly readExactQuote:SpotExactQuoteReader=input=>this.forAssets(input.market.asset_in.id,input.market.asset_out.id).readExactQuote(input);
 readonly inspect:SpotXdrInspector=input=>this.forAssets(input.quote.asset_in_id,input.quote.asset_out_id).inspect(input);
 verifyForSubmission(action:PreparedAction,signed:string){return this.forAssets(action.summary.fromAssetId,action.summary.toAssetId).verifyForSubmission(action,signed);}
 market(){return this.entries[0]!.inspector.market();}
 registry(){return this.entries[0]!.inspector.registry();}
 registryForMarket(id:string){const e=this.entries.find(e=>id.startsWith(`stellar-testnet:soroswap:${e.pair}:`));if(!e)throw new GrapnelError(409,'EXECUTION_UNAVAILABLE','Market has no inspected direct route');return e.inspector.registry();}
 async markets(){const groups=await Promise.all(this.entries.filter(e=>e.counterpartId===XLM.id).map(async e=>{try{return await e.inspector.markets();}catch{return []}}));return groups.flat();}
}
