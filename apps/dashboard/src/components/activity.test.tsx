import { describe,it,expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActivityTable,type ActivityRow } from './activity';
const row:ActivityRow={operation_id:'op',customer_id:'customer-123',external_customer_id:'velocity-user',wallet_address:'G'+'A'.repeat(55),action:'blend.borrow',status:'confirming',provider:'blend',tx_hash:'a'.repeat(64),created_at:'2026-11-13T12:00:00Z',updated_at:'2026-11-13T12:00:01Z',amount:'0.1',asset_id:'stellar-testnet:native:XLM'};
describe('Stellar activity rows',()=>{
 it('identifies the customer and wallet, amount and actual pending status with a Testnet explorer link',()=>{const html=renderToStaticMarkup(createElement(ActivityTable,{activities:[row]}));for(const text of['velocity-user','customer-123','Borrow','0.1 XLM','confirming','https://stellar.expert/explorer/testnet/tx/'+row.tx_hash])expect(html).toContain(text);expect(html).not.toContain('is-completed');});
 it('does not invent an amount or link an invalid hash',()=>{const html=renderToStaticMarkup(createElement(ActivityTable,{activities:[{...row,amount:null,tx_hash:'0xinvalid'}]}));expect(html).not.toContain('href=');expect(html).toContain('—');});
});
