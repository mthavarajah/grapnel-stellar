/** Exact Arbitrum Sepolia acceptance registry; source: reviewed GMX adapter. */
import {parseAbi} from 'viem';
export const GMX_CUSTOMER={chainId:421614,collateral:'0x3253a335e7bffb4790aa4c25c4250d206e9b9773',router:'0x72f13a44c8ba16a678cad549f17bc9e06d2b8bd2',exchange:'0x3fb6d5429612588510341ea60aacc282db264295',orderVault:'0x1b8ac606de71686fd2a1aedecb6e0efba28909a2',markets:{ETH:{market:'0xb6fc4c9eb02c35a134044526c62bb15014ac0bcc',index:'0x980b62da83eff3d4576c647993b0c1d7faf17c73',decimals:18},BTC:{market:'0x3a83246bddd60c4e71c91c10d9a66fd64399bbcf',index:'0xf79ce1cf38a09d572b021b4c5548b75a14082f12',decimals:8}}}as const;
export const GMX_CUSTOMER_ABI=parseAbi([
 'function mint(address account,uint256 amount)',
 'function approve(address spender,uint256 amount) returns(bool)',
 'function multicall(bytes[] data) payable returns(bytes[] results)',
 'function sendWnt(address receiver,uint256 amount) payable',
 'function sendTokens(address token,address receiver,uint256 amount) payable',
 'function createOrder(((address receiver,address cancellationReceiver,address callbackContract,address uiFeeReceiver,address market,address initialCollateralToken,address[] swapPath) addresses,(uint256 sizeDeltaUsd,uint256 initialCollateralDeltaAmount,uint256 triggerPrice,uint256 acceptablePrice,uint256 executionFee,uint256 callbackGasLimit,uint256 minOutputAmount,uint256 validFromTime) numbers,uint8 orderType,uint8 decreasePositionSwapType,bool isLong,bool shouldUnwrapNativeToken,bool autoCancel,bytes32 referralCode,bytes32[] dataList) params) payable returns(bytes32)',
]);
