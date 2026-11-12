-- Exact reviewed Testnet identities. Receipt name/symbol both report the vault address;
-- customer-facing descriptions must not invent a pUSDT token symbol or a USD peg.
INSERT INTO assets(id,network,kind,code,contract_id,decimals,verified,source_url,verified_at)
VALUES
 ('stellar-testnet:soroban:CDPXNHHVSLX3HFAHV7XOISM23MZH36WSXTO45RNDOBIDFZBGTSOVD4OY','stellar-testnet','soroban','USDT','CDPXNHHVSLX3HFAHV7XOISM23MZH36WSXTO45RNDOBIDFZBGTSOVD4OY',7,true,'https://peridot.finance/app/margin','2026-11-11T23:08:47Z'),
 ('stellar-testnet:soroban:CCEW6NSPCV7XUEQV75ZMII5HK5DGXK5JP2QOTGLV4UFLDBPEKRGO4Y4B','stellar-testnet','soroban','CCEW6NSPCV7XUEQV75ZMII5HK5DGXK5JP2QOTGLV4UFLDBPEKRGO4Y4B','CCEW6NSPCV7XUEQV75ZMII5HK5DGXK5JP2QOTGLV4UFLDBPEKRGO4Y4B',6,true,'https://peridot.finance/app/margin','2026-11-11T23:08:47Z')
ON CONFLICT(id) DO UPDATE SET network=EXCLUDED.network,kind=EXCLUDED.kind,code=EXCLUDED.code,issuer=NULL,contract_id=EXCLUDED.contract_id,decimals=EXCLUDED.decimals,verified=EXCLUDED.verified,source_url=EXCLUDED.source_url,verified_at=EXCLUDED.verified_at;
