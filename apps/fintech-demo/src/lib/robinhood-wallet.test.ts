import{expect,it,vi}from'vitest';import{currentStockProvider}from'./robinhood-wallet';
it('uses the latest post-switch provider instead of the wallet captured before preparation',async()=>{
 const before={address:'0xabc',getEthereumProvider:vi.fn(async()=>({request:vi.fn(async()=> '0x66eee')}))};
 const after={address:'0xabc',getEthereumProvider:vi.fn(async()=>({request:vi.fn(async()=> '0xb626')}))};
 let current=before;const get=()=>current;current=after;
 const provider=await currentStockProvider(before.address,get);expect(await provider.request({method:'eth_chainId'})).toBe('0xb626');expect(before.getEthereumProvider).not.toHaveBeenCalled();
});
it('refuses a switched account before obtaining its provider',async()=>{
 const getEthereumProvider=vi.fn();await expect(currentStockProvider('0xabc',()=>({address:'0xdef',getEthereumProvider}))).rejects.toThrow('wallet changed');expect(getEthereumProvider).not.toHaveBeenCalled();
});
