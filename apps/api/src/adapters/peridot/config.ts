import{NETWORK,NETWORK_PASSPHRASE,type AssetIdentity}from'@grapnel/contracts';
export const PERIDOT_TESTNET_PINS={
  "troller": {
    "address": "CDMXPWG55776NECXQMWNBXMEQXZUAWA2AJBCQS7SU7SA64XHMO3KB3O6",
    "wasmHash": "f2e018ae64fe3345e3711b46dcdf7e05abee169abd6085bc3f7c7808fe7a5ab3"
  },
  "margin": {
    "address": "CAKKHUGHP67UA4F42QOYPKNGRSBJEOE62MGDXA2UURTEYFOQGSMIRUFO",
    "wasmHash": "da68ef52027b0821141b071eeac29ef0c2cef0b269864ca266de56e427c2d7e2"
  },
  "swap_adapter": {
    "address": "CBSTR53W52JHCRXW4I4QAL7FJJIT2D7MVFTNC3VJRNOPTIKCCZKDTKDL",
    "wasmHash": "ce7ce0c664c23714ab8d1c4f2cb2523a5bd3129af22c729e3fb6b525b6948544"
  },
  "oracle": {
    "address": "CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63",
    "wasmHash": "25fc306065cbb9b05461db78ec259802cb916053ba5b3ab911b0a72dd1a81439"
  },
  "native_token": {
    "address": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
  },
  "native_vault": {
    "address": "CB32OVY4AADCHQT3DLKJYW5QVTWY5MOX7BBNZFT3SDHZ5HPSDDEA2THJ",
    "wasmHash": "c22680741c50eb52758a720b36d44c44b7f3f86271bcb8873ef90734607de120"
  },
  "mock_usdt": {
    "address": "CDPXNHHVSLX3HFAHV7XOISM23MZH36WSXTO45RNDOBIDFZBGTSOVD4OY",
    "wasmHash": "2ed4328b5ad24a6a829c1d1d6654349f5bd88bf69fc3ea07b9034b18797e1866"
  },
  "mock_usdt_vault": {
    "address": "CCEW6NSPCV7XUEQV75ZMII5HK5DGXK5JP2QOTGLV4UFLDBPEKRGO4Y4B",
    "wasmHash": "c22680741c50eb52758a720b36d44c44b7f3f86271bcb8873ef90734607de120"
  },
  "aquarius_router": {
    "address": "CBCFTQSPDBAIZ6R6PJQKSQWKNKWH2QIV3I4J72SHWBIK3ADRRAM5A6GD",
    "wasmHash": "d34668cd0b957f4e549719032951503495310a4d1c401ddce591c0f152834254"
  },
  "aquarius_pool": {
    "address": "CCMNSENXDBNJSY72BDIPH5CCXLLHBKZ4LXTRKDLKZN4UI2NJFQLWTLD6",
    "wasmHash": "d691135aade93ff0f7c229e009cde042130a05124cf7202b03d11246b4f9b473"
  }
} as const;
export const PERIDOT_MARKET_ID='stellar-testnet:peridot:XLM-USDT-MARGIN';
export const PERIDOT_PUBLIC_APP='https://peridot.finance/app/margin';
export const PERIDOT_HISTORY_URL='https://peridot.finance/api/markets/xlm-price';
export const PERIDOT_DOCS='https://peridot.finance/docs/margin-trading';
export const PERIDOT_POOL_ID='9ac7a9cde23ac2ada11105eeaa42e43c2ea8332ca0aa8f41f58d7160274d718e';
export const PERIDOT_BASE:AssetIdentity={id:'stellar-testnet:native:XLM',network:NETWORK,kind:'native',code:'XLM',name:'Stellar Lumens',decimals:7,contractId:PERIDOT_TESTNET_PINS.native_token.address,verified:true,sourceUrl:PERIDOT_PUBLIC_APP};
export const PERIDOT_COLLATERAL:AssetIdentity={id:`stellar-testnet:soroban:${PERIDOT_TESTNET_PINS.mock_usdt.address}`,network:NETWORK,kind:'soroban',code:'USDT',name:'Mock USDT',decimals:7,contractId:PERIDOT_TESTNET_PINS.mock_usdt.address,verified:true,sourceUrl:PERIDOT_PUBLIC_APP};
// These are reviewed application/chain pins, not Grapnel-deployed contracts.
export{NETWORK_PASSPHRASE};
