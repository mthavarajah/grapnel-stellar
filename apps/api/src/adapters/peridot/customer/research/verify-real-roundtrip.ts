/** Read-only replay of the independent own-QA protocol proof. Never signs or submits. */
import {readFileSync,writeFileSync} from 'node:fs';
import {Horizon} from '@stellar/stellar-sdk';
import {NETWORK,NETWORK_PASSPHRASE,XLM} from '@grapnel/contracts';
import {PeridotCustomerAdapter} from '../adapter.js';
import {PeridotRoundTripVerifier} from '../roundtrip.js';
import {PERIDOT_CUSTOMER_POLICY} from '../policy.js';
const journal=JSON.parse(readFileSync(new URL('../../execution/research/qa-recovery-evidence.json',import.meta.url),'utf8'));
const labels=[['collateral_swap','qa_funding_native_to_mock_usdt'],['vault_deposit','qa_one_mock_usdt_vault_deposit'],['margin_transfer','qa_one_mock_usdt_margin_transfer'],['open_begin','qa_two_x_long_begin'],['open_cancel','qa_unswapped_pending_open_cancel'],['open_begin','qa_replacement_two_x_long_begin'],['open_swap','qa_two_x_long_open_swap'],['open_activate','qa_two_x_long_activate'],['close_atomic','qa_two_x_long_atomic_close'],['margin_return','qa_margin_return_recovered_receipts'],['vault_withdraw','qa_vault_withdraw_recovered_underlying']];
const manifest={version:1,network:NETWORK,network_passphrase:NETWORK_PASSPHRASE,signer:'own_QA_ed25519_NOT_Privy_customer_flow',customer_privy_proof:false,owner:journal.qa_address,pins_hash:PERIDOT_CUSTOMER_POLICY.pinsHash,steps:labels.map(([step,label])=>({step,tx_hash:journal.actions.find((a:{label:string})=>a.label===label)?.hash}))};
const horizon=new Horizon.Server('https://horizon-testnet.stellar.org');
const adapter=new PeridotCustomerAdapter({
 horizonTransaction:async hash=>horizon.transactions().transaction(hash).call(),
 nativeBalance:async customer=>{const account=await horizon.loadAccount(customer.walletAddress),balance=account.balances.find(b=>b.asset_type==='native');if(!balance||balance.asset_type!=='native')throw Error('Native balance required');return{asset_id:XLM.id,wallet_amount:balance.balance,spendable:balance.balance,reserved:'0',source:'stellar_horizon_testnet',as_of:new Date().toISOString()};},
});
const verifier=new PeridotRoundTripVerifier({chain:adapter.chain,bindings:adapter.bindings,readManifest:async()=>manifest});
const verified=await verifier.verify();
const result={verified,reason:verifier.lastFailureReason,checked_at:new Date().toISOString(),customer_privy_proof:false,manifest_proposal:manifest};
writeFileSync(new URL('./real-roundtrip-verification.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
if(!verified)process.exitCode=1;
