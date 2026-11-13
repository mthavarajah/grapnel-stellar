-- Additive lead-approved registry extension. Keep persistence as strict as signing.
ALTER TABLE gmx_customer_requests DROP CONSTRAINT gmx_customer_requests_market_id_check;
ALTER TABLE gmx_customer_requests ADD CONSTRAINT gmx_customer_requests_market_id_check
 CHECK(market_id IN('gmx-testnet:perps:ETH','gmx-testnet:perps:BTC','gmx-testnet:perps:CRV','gmx-testnet:perps:XAU','gmx-testnet:perps:XAG','gmx-testnet:perps:XPT'));
