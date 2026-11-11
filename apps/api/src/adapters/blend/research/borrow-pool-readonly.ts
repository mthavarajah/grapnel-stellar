/** Read-only public Testnet pool verification. No signer or transaction submission. */
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PoolV2,TokenMetadata} from '@blend-capital/blend-sdk';
import {Account,Address,Contract,TransactionBuilder,rpc,scValToNative,xdr} from '@stellar/stellar-sdk';
import {NETWORK_PASSPHRASE,fromAtomic} from '@grapnel/contracts';
const POOL='CB3447A446DY3USGWPIDXTNQHF5EX24XDQA2EN6TAZP62JTPBTNOA52Q';
const OLD_POOL='CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF';
const USER='GB4PC65ZHBPVEZMAHY2K2KYMS3RFBIN2FQIE3LGTLEHT2DEWVMTD7JYQ';
const network={rpc:'https://soroban-testnet.stellar.org',passphrase:NETWORK_PASSPHRASE};
const server=new rpc.Server(network.rpc);
const json=(value:unknown)=>JSON.stringify(value,(_key,v)=>typeof v==='bigint'?v.toString():v,2);
async function balance(token:string,owner:string){
 const tx=new TransactionBuilder(new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF','0'),{fee:'100',networkPassphrase:NETWORK_PASSPHRASE}).addOperation(new Contract(token).call('balance',Address.fromString(owner).toScVal())).setTimeout(30).build();
 const sim=await server.simulateTransaction(tx);if(!rpc.Api.isSimulationSuccess(sim)||!sim.result)throw Error('Balance simulation failed');
 return {amount:scValToNative(sim.result.retval),ledger:sim.latestLedger,auth_count:sim.result.auth.length};
}
const networkResult=await server.getNetwork();if(networkResult.passphrase!==NETWORK_PASSPHRASE)throw Error('Network mismatch');
const report:any={observed_at:new Date().toISOString(),mode:'read_only',network:networkResult,broadcast:false,signatures:0,tx_hash:null,pools:[]};
for(const id of [POOL,OLD_POOL]){
 try{
  const entry=await server.getContractData(id,xdr.ScVal.scvLedgerKeyContractInstance());
  const instance=entry.val.contractData().val().instance(),hash=instance.executable().wasmHash().toString('hex');
  const code=await server.getLedgerEntries(xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({hash:Buffer.from(hash,'hex')})));
  const wasm=code.entries[0]?.val.contractCode().code();
  const pool=await PoolV2.load(network,id),user=await pool.loadUser(USER);
  const reserves=[];
  for(const reserve of pool.reserves.values()){
   const token=await TokenMetadata.load(network,reserve.assetId);
   reserves.push({asset_id:reserve.assetId,symbol:token.symbol,decimals:token.decimals,classic_asset:token.asset?{code:token.asset.getCode(),issuer:token.asset.isNative()?null:token.asset.getIssuer(),sac:token.asset.contractId(NETWORK_PASSPHRASE)}:null,config:reserve.config,data:reserve.data,supply_apr:reserve.supplyApr,supply_apy:reserve.estSupplyApy,borrow_apr:reserve.borrowApr,borrow_apy:reserve.estBorrowApy,total_supplied:fromAtomic(reserve.totalSupply(),reserve.config.decimals),total_borrowed:fromAtomic(reserve.totalLiabilities(),reserve.config.decimals),liquidity:await balance(reserve.assetId,id),customer:{supply:fromAtomic(user.getSupply(reserve),reserve.config.decimals),collateral:fromAtomic(user.getCollateral(reserve),reserve.config.decimals),borrowed:fromAtomic(user.getLiabilities(reserve),reserve.config.decimals)}});
  }
  let oracle;try{const o=await pool.loadOracle();oracle={keys:Object.keys(o),value:o};}catch(error){oracle={error:String(error)};}
  report.pools.push({pool_id:id,ledger:entry.lastModifiedLedgerSeq,wasm_hash:hash,wasm_sha256:wasm?createHash('sha256').update(wasm).digest('hex'):null,metadata:pool.metadata,user_positions:user.positions,reserves,oracle});
 }catch(error){report.pools.push({pool_id:id,error:String(error)});}
}
await writeFile(new URL('./borrow-pool-read.json',import.meta.url),json(report)+'\n');
console.log(json(report));
