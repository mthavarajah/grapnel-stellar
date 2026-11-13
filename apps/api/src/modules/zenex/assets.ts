import type{PoolClient}from'pg';import{GrapnelError,ZENEX_TESTNET as P,ZENEX_USDC_ID}from'@grapnel/contracts';
/** Call only after the adapter verifies the live Testnet registry and exact SAC identity. */
export async function registerVerifiedZenexCollateral(client:Pick<PoolClient,'query'>){
 const row=await client.query(`INSERT INTO assets(id,network,kind,code,issuer,contract_id,decimals,verified,source_url,verified_at,demo_only)
 VALUES($1,'stellar-testnet','classic','USDC',$2,$3,7,true,$4,now(),true)
 ON CONFLICT(id) DO UPDATE SET verified=true,verified_at=now(),source_url=EXCLUDED.source_url
 WHERE assets.network=EXCLUDED.network AND assets.kind=EXCLUDED.kind AND assets.code=EXCLUDED.code
 AND assets.issuer=EXCLUDED.issuer AND assets.contract_id=EXCLUDED.contract_id AND assets.decimals=EXCLUDED.decimals RETURNING id`,[ZENEX_USDC_ID,P.issuer,P.token,P.api+'/v1/config']);
 if(row.rowCount!==1)throw new GrapnelError(409,'ASSET_MISMATCH','Trading collateral differs from the verified Testnet asset');
}
