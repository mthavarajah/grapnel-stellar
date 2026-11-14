/** This legacy Soroswap token is distinct from the issuer-based USDC used by Velocity. */
const HIDDEN_SPOT_ASSETS = new Set([
 'stellar-testnet:soroban:CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F',
 'stellar-testnet:soroban:CBRQHWJDLPYVR4BSVUUWJCZGG4N4FF3CUZKDGRVTE36FAWNEJZEMQRME',
 'stellar-testnet:soroban:CDBCM2JWK2ERIE6EAVAZJJW3P25U5S3FLNHJDY72AVSVAVTU4E6NAQ43',
]);
export function isCustomerSpotMarket(entry:{asset_in_id?:unknown;asset_out_id?:unknown}):boolean {
 return typeof entry.asset_in_id==='string'&&typeof entry.asset_out_id==='string'
  &&entry.asset_in_id!==entry.asset_out_id&&!HIDDEN_SPOT_ASSETS.has(entry.asset_in_id)&&!HIDDEN_SPOT_ASSETS.has(entry.asset_out_id);
}
