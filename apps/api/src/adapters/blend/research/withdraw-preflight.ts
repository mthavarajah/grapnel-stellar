// Read-only diagnostic; intentionally no signer, key, or broadcasting API.
import {rpc,TransactionBuilder,xdr} from '@stellar/stellar-sdk';
import {BlendSorobanPreparer} from '../../stellar/blend-soroban.js';
import {buildBlendOperation} from '../index.js';
(async()=>{
const passphrase='Test SDF Network ; September 2015';
const source='GCY4DPMIBYCQ352UDKVWDJFKRXOIB2YCOLF2PQFUZHZPYU4WD4PW3LBE';
const server=new rpc.Server('https://soroban-testnet.stellar.org');
const preparer=new BlendSorobanPreparer({network:'testnet',passphrase,gate1Passed:false});
const registry=await preparer.getVerifiedRegistry();
const account=await server.getAccount(source);
const op=buildBlendOperation({action:'withdraw',poolId:registry.poolId,reserveId:registry.reserveId,walletAddress:source,amountAtomic:10000000n});
const tx=new TransactionBuilder(account,{fee:'100',networkPassphrase:passphrase}).addOperation(xdr.Operation.fromXDR(op,'base64')).setTimeout(120).build();
const result=await server.simulateTransaction(tx,undefined,'record');
const report={observed_at:new Date().toISOString(),network:'stellar-testnet',mode:'read_only_simulation',source,purpose:'withdraw_preflight_only_existing_treasury_not_customer_acceptance',amount_atomic:'10000000',registry,ledger:result.latestLedger,simulation_success:rpc.Api.isSimulationSuccess(result),error:rpc.Api.isSimulationError(result)?result.error:null,broadcast:false,signed:false,tx_hash:null,execution_available:false,remaining_requirement:'Actual customer collateral position; no-debt/health checks; observed standalone withdraw auth and footprint; exact-envelope revalidation and confirmed balance/position deltas'};
console.log(JSON.stringify(report));
})().catch(()=>{console.error('Read-only probe failed; no signing or broadcast');process.exitCode=1});
