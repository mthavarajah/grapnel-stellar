import {describe,it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const ports=vi.hoisted(()=>({create:vi.fn(),connect:vi.fn(),sign:vi.fn(),provider:vi.fn(),switchChain:vi.fn()}));
vi.mock('@privy-io/react-auth',()=>({useWallets:()=>({ready:true,wallets:[{address:'0x'+'11'.repeat(20),walletClientType:'privy',getEthereumProvider:ports.provider,switchChain:ports.switchChain}]}),useConnectWallet:()=>({connectWallet:ports.connect}),useCreateWallet:()=>({createWallet:ports.create}),useSignTransaction:()=>({signTransaction:ports.sign})}));
import {PrivyPerpetualExecution,type PerpetualExecutionProps} from '../components/perpetual-execution';
const props:PerpetualExecutionProps={api:vi.fn(),customerId:'customer',walletId:'wallet',stellarAddress:'fixture-stellar',signRawHash:vi.fn(),market:{market_id:'hyperliquid-testnet:perps:3',asset_class:'perps',provider_symbol:'BTC',provider_dex:'',max_leverage:20,underlying:{symbol:'BTC'},settlement_asset:{code:'USDC',compatibility:'usdc'},quote_symbol:'USDC'}};
describe('customer Privy EVM wrapper has no financial render effects',()=>{
 it('renders existing account controls without creating, connecting, switching, signing or broadcasting',()=>{const html=renderToStaticMarkup(createElement(PrivyPerpetualExecution,props));expect(html).toContain('Trade BTC');expect(html).not.toContain('Trading wallet</span>');expect(html).not.toContain('Bound account:');expect(html).toContain('Perpetuals balance');expect(html).not.toContain('Available to trade</span>');expect(html).not.toContain('Completed');for(const port of Object.values(ports))expect(port).not.toHaveBeenCalled();expect(props.api).not.toHaveBeenCalled();expect(props.signRawHash).not.toHaveBeenCalled();});
});
