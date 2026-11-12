import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {describe,it,expect} from 'vitest';
import {StockActivityRows,stockActivityLabel,type StockActivityItem} from './stock-activity';
const row:StockActivityItem={id:'one',kind:'buy',state:'completed',symbol:'TSLA',amount:'1.2345678',paid_amount:'1',received_amount:'1.2345678',tx_hash:'0x'+'11'.repeat(32),created_at:'2026-11-12T20:00:00Z'};
describe('consumer stock activity',()=>{
 it('shows shares, paid currency and a Robinhood transaction link',()=>{const html=renderToStaticMarkup(createElement(StockActivityRows,{items:[row]}));expect(html).toContain('Bought');expect(html).toContain('TSLA');expect(html).toContain('Paid');expect(html).toContain('USDG');expect(html).toContain('explorer.testnet.chain.robinhood.com/tx/');expect(html).not.toContain('stellar.expert');});
 it('keeps pending trades and approvals distinct from completed purchases',()=>{expect(stockActivityLabel({...row,state:'confirming'})).toBe('Buy TSLA');expect(stockActivityLabel({...row,kind:'approval'})).toContain('Approved');expect(stockActivityLabel({...row,kind:'funding',amount:'20'})).toBe('Received 20 USDG + 0.001 ETH');});
});
