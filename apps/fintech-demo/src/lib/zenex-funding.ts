import{toAtomic}from'@grapnel/contracts';
type Snapshot={has_trustline:boolean;balance:string;config:{exec_fee:string}};
const amount=(value:string)=>/^0(?:\.0+)?$/.test(value)?0n:toAtomic(value,7);
/** Run only after an explicit trade click; preserve exact issuer balance and confirmed setup stages. */
export async function ensureZenexCollateral(collateral:string,ports:{read:()=>Promise<Snapshot>;enable:()=>Promise<unknown>;fund:()=>Promise<unknown>}){
 const requested=toAtomic(collateral,7);let s=await ports.read();const enough=()=>amount(s.balance)>=requested+BigInt(s.config.exec_fee);
 if(s.has_trustline&&enough())return;
 if(!s.has_trustline){await ports.enable();s=await ports.read();if(!s.has_trustline)throw Error('Trading setup is still confirming. Check its status before trying again.');}
 if(!enough()){await ports.fund();s=await ports.read();}
 if(!s.has_trustline||!enough())throw Error('Your available trading USDC is too low for this amount and fee.');
}
