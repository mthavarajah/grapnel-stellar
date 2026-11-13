import {describe,it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
vi.mock('@privy-io/react-auth',()=>({}));
import {GmxPerpetualExecutionCard,GmxExecutionPriceReview,gmxAmountFeedback,gmxPositionValue,type GmxPerpetualExecutionCardProps} from '../components/gmx-perpetual-execution';
import type {GmxCustomerRequest} from './gmx-customer';
const props:GmxPerpetualExecutionCardProps={api:vi.fn(),customerId:'customer',walletId:'wallet',symbol:'ETH',wallet:null,walletsReady:true,onCreate:vi.fn()};
describe('GMX card is passive before an explicit customer action',()=>{
 it('has a clear create-wallet action and unknown balances rather than fake funding',()=>{const html=renderToStaticMarkup(createElement(GmxPerpetualExecutionCard,props));expect(html).toContain('Enable perpetuals');expect(html).toContain('Available collateral');expect(html).toContain('—');expect(html).toContain('Long ETH');expect(html).not.toContain('>Review<');expect(html).toContain('disabled');expect(html).not.toContain('Position opened');expect(props.api).not.toHaveBeenCalled();expect(props.onCreate).not.toHaveBeenCalled();});
 it('shows adverse execution and every quoted impact component before approval',()=>{const record={kind:'close',intent:{symbol:'ETH',quoteMinPrice30:(2014n*10n**30n).toString(),quoteMaxPrice30:(2014n*10n**30n).toString(),executionPrice:(1725n*10n**12n).toString(),indexDecimals:18,priceImpactUsd:(-3n*10n**30n).toString(),priceImpactDiffUsd:(2n*10n**30n).toString(),totalImpactUsd:(-1n*10n**30n).toString(),proportionalPendingImpactUsd:'0',executionQuoteBlock:'123',executionQuoteSource:'gmx_reader_getExecutionPrice'}}as GmxCustomerRequest;const html=renderToStaticMarkup(createElement(GmxExecutionPriceReview,{record}));expect(html).toContain('Reference price');expect(html).toContain('2,014');expect(html).toContain('Estimated execution price');expect(html).toContain('1,725');expect(html).toContain('Execution vs reference');expect(html).toContain('-14.34%');expect(html).toContain('Price impact difference');expect(html).toContain('Pending impact component');expect(html).toContain('Total quoted impact');expect(html).toContain('-3 USD');expect(html).not.toContain('Unavailable');});
 it('keeps existing wallet signing/network changes explicit and uses selected market',()=>{const wallet={address:'0x'+'11'.repeat(20),getEthereumProvider:vi.fn(),signTransaction:vi.fn(),switchToTestnet:vi.fn()},html=renderToStaticMarkup(createElement(GmxPerpetualExecutionCard,{...props,symbol:'BTC',wallet}));expect(html).toContain('Trade BTC');expect(html).not.toContain('Switch trading network');expect(html).not.toContain('Approve USDC');for(const port of [wallet.getEthereumProvider,wallet.signTransaction,wallet.switchToTestnet])expect(port).not.toHaveBeenCalled();expect(html).not.toContain('input address');});
});

it('explains collateral and fee limits and calculates mark-based position equity with exact integers',()=>{
 expect(gmxAmountFeedback('10',2,'9','0.002')).toContain('Available');expect(gmxAmountFeedback('10',2,'20','0')).toContain('transaction fees');expect(gmxAmountFeedback('10',2,'20','0.002')).toBeNull();
 const p={sizeUsd30:(20n*10n**30n).toString(),sizeTokens:(10n**16n).toString(),collateralAtomic6:'10000000',isLong:true}as any,market={price_min30:(2100n*10n**30n).toString(),price_max30:(2100n*10n**30n).toString(),index_decimals:18}as any;
 expect(gmxPositionValue(p,market)).toMatchObject({entry:'2000.'+'0'.repeat(30),pnl:'1.'+'0'.repeat(30),equity:'11.'+'0'.repeat(30)});
 expect(gmxPositionValue({...p,isLong:false},market)?.equity).toBe('9.'+'0'.repeat(30));expect(gmxPositionValue(p,{...market,price_min30:null})).toBeNull();
});
