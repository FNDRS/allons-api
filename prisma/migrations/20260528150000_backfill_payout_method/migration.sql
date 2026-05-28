-- Backfill: replace the hardcoded fake bank string with a neutral label.
-- Previous service code fell back to 'BAC Honduras · ****4521' whenever the
-- payout request body omitted `method`; every such row carries that string in
-- provider_payout_requests.method (and it surfaces in the mobile payout history).
-- The service now uses 'Transferencia bancaria' as the fallback.
UPDATE provider_payout_requests
SET method = 'Transferencia bancaria'
WHERE method = 'BAC Honduras · ****4521';
