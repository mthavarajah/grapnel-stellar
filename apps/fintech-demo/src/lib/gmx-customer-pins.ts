/** Exact Arbitrum Sepolia acceptance registry; source: reviewed GMX adapter. */
import {parseAbi} from 'viem';
export const GMX_CUSTOMER={chainId:421614,collateral:'0x3253a335e7bffb4790aa4c25c4250d206e9b9773',router:'0x72f13a44c8ba16a678cad549f17bc9e06d2b8bd2',exchange:'0x3fb6d5429612588510341ea60aacc282db264295',orderVault:'0x1b8ac606de71686fd2a1aedecb6e0efba28909a2',markets:{"ETH":{"market":"0xb6fc4c9eb02c35a134044526c62bb15014ac0bcc","index":"0x980b62da83eff3d4576c647993b0c1d7faf17c73","decimals":18},"BTC":{"market":"0x3a83246bddd60c4e71c91c10d9a66fd64399bbcf","index":"0xf79ce1cf38a09d572b021b4c5548b75a14082f12","decimals":8},"CRV":{"market":"0xade9d177b9e060d2064ee9f798125e6539fdaa1c","index":"0xd5ddaed48b09fa1d7944bd662cb05265fcd7077c","decimals":18},"XAU":{"market":"0x860f6b4b2f218885935c306b1c782a864ed2d67f","index":"0x0f16dfba0242f23f4a5fade95cd138139dd7592f","decimals":18},"XAG":{"market":"0x8490d84c29134da93f434210d76721179c382471","index":"0xac0cee37770fdc16732c1f591a6b90a4ea580643","decimals":18},"XPT":{"market":"0x02f0d10977f044d59460b2e71afb8c07dc7b5e1f","index":"0xf3a3486de22725d8d762671ac4479d8ab9c21173","decimals":18}}}as const;
export const GMX_CUSTOMER_ABI=parseAbi([
 'function mint(address account,uint256 amount)',
 'function approve(address spender,uint256 amount) returns(bool)',
 'function multicall(bytes[] data) payable returns(bytes[] results)',
 'function sendWnt(address receiver,uint256 amount) payable',
 'function sendTokens(address token,address receiver,uint256 amount) payable',
 'function createOrder(((address receiver,address cancellationReceiver,address callbackContract,address uiFeeReceiver,address market,address initialCollateralToken,address[] swapPath) addresses,(uint256 sizeDeltaUsd,uint256 initialCollateralDeltaAmount,uint256 triggerPrice,uint256 acceptablePrice,uint256 executionFee,uint256 callbackGasLimit,uint256 minOutputAmount,uint256 validFromTime) numbers,uint8 orderType,uint8 decreasePositionSwapType,bool isLong,bool shouldUnwrapNativeToken,bool autoCancel,bytes32 referralCode,bytes32[] dataList) params) payable returns(bytes32)',
]);

export type GmxCustomerSymbol=keyof typeof GMX_CUSTOMER.markets;
export const GMX_CUSTOMER_SYMBOLS=['ETH','BTC','CRV','XAU','XAG','XPT']as const;
