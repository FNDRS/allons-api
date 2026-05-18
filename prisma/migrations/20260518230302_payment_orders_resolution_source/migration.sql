-- Tracks which code path moved a payment_orders row from pending_payment
-- to a terminal state. Populated by:
--   webhook  - paygate.webhook.controller (paygate fired us)
--   polling  - MePaymentsService poll-time reconciliation
--   cron     - PaymentsReconciliationService nightly sweep
--   manual   - admin override / SQL fix
-- Nullable because pre-existing rows have no recorded source.

ALTER TABLE public.payment_orders
  ADD COLUMN IF NOT EXISTS resolution_source TEXT;

CREATE INDEX IF NOT EXISTS payment_orders_resolution_source_idx
  ON public.payment_orders(resolution_source, updated_at DESC);
