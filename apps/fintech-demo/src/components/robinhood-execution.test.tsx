import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('@privy-io/react-auth', () => ({}));
import { RobinhoodExecutionCard, type RobinhoodExecutionCardProps } from './robinhood-execution';
const props: RobinhoodExecutionCardProps = { api: vi.fn(), customerId: 'customer', walletId: 'wallet', symbol: 'TSLA', wallet: null, walletsReady: true, onCreate: vi.fn() };
describe('Robinhood stock card waits for explicit customer action', () => {
    it('shows Enable stocks, buy/sell, unknown source balance and disabled Review without creating a wallet', () => { const html = renderToStaticMarkup(createElement(RobinhoodExecutionCard, props)); expect(html).toContain('Enable stocks'); expect(html).toContain('Trade TSLA'); expect(html).toContain('Buy'); expect(html).toContain('Sell'); expect(html).toContain('Available USDG'); expect(html).toContain('—'); expect(html).toContain('Review'); expect(html).toContain('disabled'); expect(html).not.toContain('Bought'); expect(props.api).not.toHaveBeenCalled(); expect(props.onCreate).not.toHaveBeenCalled(); });
    it('does not ask for another wallet address, broadcast or sign while displaying an existing account', () => { const wallet = { address: '0x' + '11'.repeat(20), provider: vi.fn(), sign: vi.fn(), switchNetwork: vi.fn() }, html = renderToStaticMarkup(createElement(RobinhoodExecutionCard, { ...props, symbol: 'AMD', wallet })); expect(html).toContain('Trade AMD'); expect(html).not.toContain('Enable stocks'); expect(html).not.toContain('input address'); expect(html).not.toContain('MetaMask'); for (const port of [wallet.provider, wallet.sign, wallet.switchNetwork])
        expect(port).not.toHaveBeenCalled(); });
});
