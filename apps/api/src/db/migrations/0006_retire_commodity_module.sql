-- Retire the module without deleting audit history or historical operations.
-- The enum value remains for historical records from baseline migration 0001.
UPDATE business_modules SET enabled=false,revision=revision+1,updated_at=now()
WHERE module_code='trade.commodities' AND enabled=true;
UPDATE businesses SET revision=revision+1 WHERE id IN
(SELECT business_id FROM business_modules WHERE module_code='trade.commodities');
DELETE FROM business_modules WHERE module_code='trade.commodities';
