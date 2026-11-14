import{describe,it,expect}from'vitest';import{isCustomerSpotMarket}from'./spot-catalog';
const xlm='stellar-testnet:native:XLM',usdc='stellar-testnet:classic:USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56',legacy='stellar-testnet:soroban:CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F';
describe('customer crypto catalog',()=>{
 it('removes the exact USDCoin identity in both directions, retaining wallet USDC',()=>{for(const [a,b]of[[xlm,legacy],[legacy,xlm],[usdc,legacy]])expect(isCustomerSpotMarket({asset_in_id:a,asset_out_id:b})).toBe(false);for(const[a,b]of[[xlm,usdc],[usdc,xlm]])expect(isCustomerSpotMarket({asset_in_id:a,asset_out_id:b})).toBe(true);});
 it('retains additional genuine routes without a ticker allowlist',()=>expect(isCustomerSpotMarket({asset_in_id:xlm,asset_out_id:'stellar-testnet:soroban:new-reviewed-route'})).toBe(true));
 it('rejects incomplete and same-asset entries',()=>{expect(isCustomerSpotMarket({})).toBe(false);expect(isCustomerSpotMarket({asset_in_id:xlm,asset_out_id:xlm})).toBe(false);});
});

it.each(['CBRQHWJDLPYVR4BSVUUWJCZGG4N4FF3CUZKDGRVTE36FAWNEJZEMQRME','CDBCM2JWK2ERIE6EAVAZJJW3P25U5S3FLNHJDY72AVSVAVTU4E6NAQ43'])('excludes owner-removed ARST/AQUA identity %s in both directions',contract=>{const id='stellar-testnet:soroban:'+contract;expect(isCustomerSpotMarket({asset_in_id:xlm,asset_out_id:id})).toBe(false);expect(isCustomerSpotMarket({asset_in_id:id,asset_out_id:xlm})).toBe(false);});
