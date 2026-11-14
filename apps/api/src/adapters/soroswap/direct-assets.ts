import {SPOT_TOKEN_PAIR_ASSETS,SPOT_TOKEN_PAIR_PINS,type AssetIdentity} from '@grapnel/contracts';
export const APPROVED_TOKEN_WASM='263d165c1a1bf5a0dddbd0f21744a55cd8cacedf96ade78f53c570df11490e46';
export const CORE_TESTNET_TOKENS='https://raw.githubusercontent.com/soroswap/core/main/public/tokens.json';
/** Finite direct routes independently read from official Testnet factory and current pool state. */
export const STANDALONE_NATIVE_ROUTES=[
 {code:'XTAR',name:'Dogstar',contract:'CCZGLAUBDKJSQK72QOZHVU7CUWKW45OZWYWCLL27AEK74U2OIBK6LXF2',pair:'CDH4NEG6TAII2AXGJY52WSMMOGCPMFIQBBH245ATW2TIZ7MBYM23YOAR'},
 {code:'USDC',name:'USDCoin',contract:'CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F',pair:'CDVAIOYHCD4RUSLQNVFI7RIZBFT2JZMJWM4RTOLQZQXL4QAVXU5RFKDB'},
 {code:'XRP',name:'Ripple',contract:'CDDIA6HYANLPMDKBVQRIIXY3NA6S3TMHZFJUNPMBEJGZ5JSHN3E2TAUI',pair:'CBCRYX4VG5GCKQ5KUIHV3AUOIEKEJKXDOXO5DWFYNRPK547N6MNVGEOZ'},
 {code:'BTC',name:'Bitcoin',contract:'CB7ICEHVRIRMF3CF6SIP2C2R3Z4E7WRPATT552QSVLIXZ5RSN6KLUDAE',pair:'CDZL65OIXMVK63DCIWKJ7ULKVHZ7V4B4OM3XQHRNHR4OCFADIUV4FL64'},
 {code:'EURC',name:'EURoCoin',contract:'CBQDUWBOHS7P4TZIJ3KUPUZQOWMKJC6CQPPFEONSV3BH4X27YVEXWNOT',pair:'CDRKRVJLWZNKB4W5GCJU27R6LVT2GD2WNYVUPBB2J3MXBEOHMB74WOX5'},
] as const;
export const STANDALONE_SPOT_ASSETS=[...STANDALONE_NATIVE_ROUTES,SPOT_TOKEN_PAIR_ASSETS.ARST,SPOT_TOKEN_PAIR_ASSETS.AQUA] as const;
export const standaloneAssetId=(contract:string)=>`stellar-testnet:soroban:${contract}`;
export const isApprovedStandaloneAssetId=(id:string)=>STANDALONE_SPOT_ASSETS.some(t=>standaloneAssetId(t.contract)===id);
export function standaloneAsset(route:{code:string;name:string;contract:string}):AssetIdentity{return {id:standaloneAssetId(route.contract),network:'stellar-testnet',kind:'soroban',code:route.code,name:route.name,contractId:route.contract,decimals:7,verified:true,sourceUrl:CORE_TESTNET_TOKENS};}

export function isApprovedSpotDirection(a:string,b:string):boolean {
 const native='stellar-testnet:native:XLM',classic='stellar-testnet:classic:USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56';
 if(a===native||b===native){const token=a===native?b:a;return token===classic||STANDALONE_NATIVE_ROUTES.some(t=>standaloneAssetId(t.contract)===token);}
 return SPOT_TOKEN_PAIR_PINS.some(r=>(a===standaloneAssetId(r.a.contract)&&b===standaloneAssetId(r.b.contract))||(b===standaloneAssetId(r.a.contract)&&a===standaloneAssetId(r.b.contract)));
}
