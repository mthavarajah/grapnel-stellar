import {describe,expect,it} from 'vitest';
import {serializeOperation} from './service.js';
const hash='a'.repeat(64),asset='stellar-testnet:native:XLM';
function row(){return{id:'op',customer_id:'customer',wallet_id:'wallet',module_code:'capital.lending',type:'blend.repay',state:'completed',tx_hash:hash,provider:'blend',created_at:new Date(),updated_at:new Date(),request_json:{amount:'0.1001002',asset_id:asset},result_json:{blend_borrowing_verification:{verified:true,operation:'repay',tx_hash:hash,asset_id:asset,repay_incoming_atomic:'1001002',repay_refund_atomic:'1001'}}};}
describe('Consumer repayment activity amounts',()=>{
 it('displays the proven actual net repayment after an excess refund',()=>expect(serializeOperation(row()).display_amount).toBe('0.1000001'));
 it('keeps the maximum amount while the customer is still reviewing it',()=>expect(serializeOperation({...row(),state:'awaiting_customer_authorization'}).display_amount).toBe('0.1001002'));
 it.each(['verified','tx_hash','asset_id'])('omits completed amount when settlement %s disagrees',key=>{const r=row();(r.result_json.blend_borrowing_verification as Record<string,unknown>)[key]=key==='verified'?false:'foreign';expect(serializeOperation(r).display_amount).toBeUndefined();});
 it('does not invent a completed amount from a requested maximum alone',()=>expect(serializeOperation({...row(),result_json:{}}).display_amount).toBeUndefined());
});
