"use client";
import type{ReactNode}from'react';import{PrivyProvider}from'@privy-io/react-auth';import{defineChain}from'viem';import{arbitrumSepolia,hyperliquidEvmTestnet}from'viem/chains';
const robinhoodTestnet=defineChain({id:46630,name:'Robinhood Testnet',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:['https://rpc.testnet.chain.robinhood.com']}},blockExplorers:{default:{name:'Robinhood Explorer',url:'https://explorer.testnet.chain.robinhood.com'}},testnet:true});
/** Root-layout lifetime: route changes must not recreate the wallet SDK/session. */
export function FintechProviders({children}:{children:ReactNode}){
 const id=process.env.NEXT_PUBLIC_PRIVY_APP_ID;
 return id?<PrivyProvider appId={id} config={{loginMethods:['email'],embeddedWallets:{ethereum:{createOnLogin:'users-without-wallets'}},supportedChains:[robinhoodTestnet,arbitrumSepolia,hyperliquidEvmTestnet],defaultChain:arbitrumSepolia,appearance:{theme:'light',accentColor:'#2555d7'}}}>{children}</PrivyProvider>:children;
}
