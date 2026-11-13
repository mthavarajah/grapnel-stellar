import type{RobinhoodProvider}from'./robinhood-customer';
type Wallet={address:string;getEthereumProvider:()=>Promise<{request:(input:any)=>Promise<any>}>};
/** switchChain changes the hook's wallet snapshot. An async order handler must
 * obtain the provider from that latest snapshot, rather than its pre-switch closure. */
export async function currentStockProvider(address:string,current:()=>Wallet|undefined):Promise<RobinhoodProvider>{
 const wallet=current();
 if(!wallet||wallet.address.toLowerCase()!==address.toLowerCase())throw Error('The connected stock wallet changed. Reload your account.');
 const provider=await wallet.getEthereumProvider();
 return {request:input=>provider.request(input)};
}
