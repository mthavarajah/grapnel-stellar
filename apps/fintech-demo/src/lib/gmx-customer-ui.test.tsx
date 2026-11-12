import {describe,it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
vi.mock('@privy-io/react-auth',()=>({}));
import {GmxPerpetualExecutionCard,type GmxPerpetualExecutionCardProps} from '../components/gmx-perpetual-execution';
const props:GmxPerpetualExecutionCardProps={api:vi.fn(),customerId:'customer',walletId:'wallet',symbol:'ETH',wallet:null,walletsReady:true,onCreate:vi.fn()};
describe('GMX card is passive before an explicit customer action',()=>{
 it('has a clear create-wallet action and unknown balances rather than fake funding',()=>{const html=renderToStaticMarkup(createElement(GmxPerpetualExecutionCard,props));expect(html).toContain('Create trading wallet');expect(html).toContain('Available collateral');expect(html).toContain('—');expect(html).toContain('Review');expect(html).toContain('disabled');expect(html).not.toContain('Position opened');expect(props.api).not.toHaveBeenCalled();expect(props.onCreate).not.toHaveBeenCalled();});
 it('keeps existing wallet signing/network changes explicit and uses selected market',()=>{const wallet={address:'0x'+'11'.repeat(20),getEthereumProvider:vi.fn(),signTransaction:vi.fn(),switchToTestnet:vi.fn()},html=renderToStaticMarkup(createElement(GmxPerpetualExecutionCard,{...props,symbol:'BTC',wallet}));expect(html).toContain('Trade BTC');expect(html).toContain('Switch trading network');for(const port of [wallet.getEthereumProvider,wallet.signTransaction,wallet.switchToTestnet])expect(port).not.toHaveBeenCalled();expect(html).not.toContain('input address');});
});
