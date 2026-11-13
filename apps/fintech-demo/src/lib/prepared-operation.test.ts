import {expect,it,vi} from 'vitest';
import {currentCustomerOperation} from './prepared-operation';
const owner={customer_id:'customer',wallet_id:'wallet'},created={...owner,operation_id:'operation',status:'awaiting_customer_authorization'};
it('fetches the current one-use authorization even when creation was already prepared',async()=>{
 const read=vi.fn(async()=>({...created,customer_action_token:'fresh-token',prepared_action:{}}));
 const result=await currentCustomerOperation(created,owner,read);
 expect(read).toHaveBeenCalledWith('operation');expect(result).toHaveProperty('customer_action_token','fresh-token');
});
it.each(['customer_id','wallet_id','operation_id'] as const)('rejects a changed %s on the authorization response',async(field)=>{
 await expect(currentCustomerOperation(created,owner,async()=>({...created,[field]:'other'}))).rejects.toThrow('another wallet');
});
it('does not fetch authorization for an unprepared or completed operation',async()=>{
 const read=vi.fn();for(const status of ['accepted','preparing','completed'])await currentCustomerOperation({...created,status},owner,read);expect(read).not.toHaveBeenCalled();
});
