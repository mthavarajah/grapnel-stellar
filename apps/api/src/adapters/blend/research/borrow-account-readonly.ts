import {writeFile} from 'node:fs/promises';
import {NETWORK_PASSPHRASE} from '@grapnel/contracts';
import {BlendBorrowAdapter} from '../borrow.js';
const wallet='GB4PC65ZHBPVEZMAHY2K2KYMS3RFBIN2FQIE3LGTLEHT2DEWVMTD7JYQ';
const adapter=new BlendBorrowAdapter({network:'testnet',passphrase:NETWORK_PASSPHRASE,gate1Passed:true});
const report={observed_at:new Date().toISOString(),mode:'read_only',broadcast:false,signatures:0,tx_hash:null,account:await adapter.readWallet(wallet),positions:await adapter.positionsWallet(wallet)};
const text=JSON.stringify(report,null,2);await writeFile(new URL('./borrow-account-read.json',import.meta.url),text+'\n');console.log(text);
