/** Public wallet inspection only. These labels are not authenticated application customer IDs. */
import {writeFile} from 'node:fs/promises';
import {CctpUsdcSetupPreparer} from '../setup.js';
const customer={businessId:'public-readonly-evidence',customerId:'public-readonly-evidence',walletId:'public-readonly-evidence',privyUserId:'public-readonly-evidence',walletAddress:'GB4PC65ZHBPVEZMAHY2K2KYMS3RFBIN2FQIE3LGTLEHT2DEWVMTD7JYQ'};
const status=await new CctpUsdcSetupPreparer().readStatus(customer);
await writeFile(new URL('./customer-setup-readiness.json',import.meta.url),JSON.stringify({context_note:'Public address observation only; labels do not assert an authenticated tenant/customer session.',status,setup_prepared:false,signatures_created:0,faucet_request_made:false,broadcast:false,tx_hash:null},null,2)+'\n');
console.log(JSON.stringify({ledger:status.as_of_ledger,canonical_trustline:status.trustline_exists,canonical_balance:status.wallet_amount,allowance:status.allowance_amount,broadcast:false}));
