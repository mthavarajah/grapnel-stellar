/** Creation responses are not authorization responses. Retrieve the scoped,
 * current action token before asking the wallet to sign an immediately prepared action. */
export async function currentCustomerOperation<T extends {operation_id:string;customer_id?:string;wallet_id?:string;status:string}>(
 operation:T,owner:{customer_id:string;wallet_id:string},read:(id:string)=>Promise<T>,
):Promise<T>{
 if(operation.customer_id!==owner.customer_id||operation.wallet_id!==owner.wallet_id)throw Error('This action belongs to another wallet session.');
 if(operation.status!=='awaiting_customer_authorization')return operation;
 const current=await read(operation.operation_id);
 if(current.operation_id!==operation.operation_id||current.customer_id!==owner.customer_id||current.wallet_id!==owner.wallet_id)throw Error('This action belongs to another wallet session.');
 return current;
}
